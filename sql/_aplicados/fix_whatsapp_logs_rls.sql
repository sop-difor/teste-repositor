-- =====================================================================================
-- Correção de RLS de public.whatsapp_logs (2026-08-17)
-- =====================================================================================
-- Contexto: a tabela tem RLS habilitada, e já existe uma policy correta e restrita
-- ("Admins vêem todos os logs", SELECT só para admin), mas ela é anulada na prática por
-- outra policy permissiva que coexiste hoje: "Permitir tudo para anon"
-- (using(true)/with_check(true), ALL, papel `public`). Como policies permissivas do
-- Postgres são combinadas via OR, a policy mais aberta "vence" — hoje, na prática,
-- qualquer requisição não autenticada consegue ler, criar, alterar e apagar logs de
-- WhatsApp livremente.
--
-- Regras desejadas (substituem TODAS as policies antigas desta tabela por um conjunto
-- limpo e não redundante):
-- - SELECT: authenticated (true). O painel de mensagens com falha
--   (carregarLogsWhatsApp) hoje é acessível a qualquer usuário logado, sem checagem de
--   role no front-end — mantém-se essa paridade em vez de restringir a admin, o que
--   quebraria a tela para usuários não-admin sem ajuste correspondente no front-end.
-- - INSERT: authenticated, mas só com status inicial 'processando'
--   (with check (status = 'processando')) — fecha o vetor óbvio de um usuário inserir
--   uma linha já nascendo com status='sucesso' via DevTools, o que tornaria inútil
--   qualquer restrição de UPDATE feita abaixo.
-- - UPDATE: authenticated, mas MUITO restrito — using (status in ('processando','falha'))
--   with check (status in ('sucesso','falha')). O 'falha' em using cobre
--   `reenviarMensagemWhatsApp` (whatsapp.js:773-793), que busca um log já com
--   status='falha' e, se o reenvio der certo, atualiza DIRETO para 'sucesso' (nunca passa
--   por 'processando' de novo) — sem incluir 'falha' aqui, o botão "Reenviar" do painel
--   quebraria. Isto é ESTADO INTERINO, não o desenho final:
--   hoje (2026-08-17) `enviarMensagemIndividual` (whatsapp.js) já roda em produção toda
--   vez que uma ação de negócio dispara uma notificação (processarNotificacao é chamado
--   por qualquer usuário comum ao criar/mudar um processo, orçamento, composição etc.),
--   mesmo com o disparo de WhatsApp "pausado" — o guard de fetchComTimeout lança uma
--   exceção, que cai no `catch` de enviarMensagemIndividual, que TENTA atualizar o log
--   para 'falha'. Se esta policy de UPDATE fosse omitida agora (como o desenho final da
--   Fase 2 propõe, com o worker assumindo essa escrita via service role), esse update
--   falharia silenciosamente (0 linhas afetadas, sem erro visível) em CADA evento de
--   negócio do sistema a partir de agora — os logs ficariam presos em 'processando' para
--   sempre, e o painel de falhas (que filtra por status='falha') pararia de mostrar
--   qualquer coisa. A policy acima permite exatamente a transição que o código faz hoje
--   (processando -> sucesso/falha) e nada além disso (não permite alterar um log já
--   finalizado, nem pular direto para 'sucesso' num INSERT). QUANDO a Fase 2 (worker
--   escrevendo em whatsapp_logs via service role) e a Fase 4 (whatsapp.js parando de
--   fazer esse update do lado do cliente) estiverem no ar, esta policy de UPDATE deve
--   ser removida num script de acompanhamento (o service role ignora RLS, não precisa
--   dela) — deixando a responsabilidade de finalizar o status 100% do lado do servidor.
-- - DELETE: só admin (app_users_is_admin()) — mantém o comportamento de
--   excluirLogWhatsApp, que já era, na prática, uma ação de painel administrativo.
-- =====================================================================================

begin;

drop policy if exists "Permitir tudo para anon" on public.whatsapp_logs;
drop policy if exists "Admins vêem todos os logs" on public.whatsapp_logs;

drop policy if exists "whatsapp_logs_select_authenticated" on public.whatsapp_logs;
create policy "whatsapp_logs_select_authenticated" on public.whatsapp_logs
  for select
  to authenticated
  using (true);

drop policy if exists "whatsapp_logs_insert_authenticated" on public.whatsapp_logs;
create policy "whatsapp_logs_insert_authenticated" on public.whatsapp_logs
  for insert
  to authenticated
  with check (status = 'processando');

-- INTERINO — remover quando a Fase 2/4 estiverem no ar (ver cabeçalho). Só permite
-- transicionar um log que está 'processando' para 'sucesso'/'falha'; nada além disso.
drop policy if exists "whatsapp_logs_update_authenticated_interino" on public.whatsapp_logs;
create policy "whatsapp_logs_update_authenticated_interino" on public.whatsapp_logs
  for update
  to authenticated
  using (status in ('processando', 'falha'))
  with check (status in ('sucesso', 'falha'));

drop policy if exists "whatsapp_logs_delete_admin" on public.whatsapp_logs;
create policy "whatsapp_logs_delete_admin" on public.whatsapp_logs
  for delete
  using (app_users_is_admin());

commit;

-- =====================================================================================
-- Verificação pós-migração:
--
-- select policyname, cmd, roles from pg_policies where tablename = 'whatsapp_logs';
-- -- deve retornar exatamente 4 policies: select (authenticated), insert (authenticated,
-- -- check status='processando'), update (authenticated, interino, using status in
-- -- processando/falha, check status in sucesso/falha), delete (admin).
--
-- Teste funcional: com um usuário autenticado não-admin, tentar
-- `insert into whatsapp_logs (..., status) values (..., 'sucesso')` deve falhar (bloqueado
-- pelo with check da policy de insert); um `update` de processando->sucesso/falha deve
-- funcionar (fluxo de envio); um `update` de falha->sucesso deve funcionar (fluxo de
-- reenvio); um `update` de um log já 'sucesso' para qualquer outro valor deve falhar.
--
-- Este script é seguro de rodar de novo a qualquer momento (create policy sempre
-- precedido de drop policy if exists).
-- =====================================================================================
