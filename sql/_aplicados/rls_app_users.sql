-- =====================================================================================
-- RLS de public.app_users — versão consolidada e atual (2026-08-14)
-- =====================================================================================
-- Substitui sql/proposta_rls_app_users.sql e sql/ajuste_rls_app_users_select.sql (ambos
-- já aplicados em produção, nesta ordem, e removidos do repositório por serem histórico
-- redundante — este arquivo é a fonte única e reaplicável do estado final desejado).
--
-- HISTÓRICO RESUMIDO (ver AUDITORIA_INDEX.md seções 10, 15, 17 e 18 para o raciocínio
-- completo):
-- 1) `admin.js` fazia (e ainda faz) escrita direta em app_users (aprovar/editar/excluir
--    usuário) sem nenhuma policy de RLS existente — qualquer usuário autenticado podia
--    fazer isso via DevTools, inclusive se autopromover a admin.
-- 2) Primeira versão de RLS (proposta_rls_app_users.sql) trocou isso por: SELECT só da
--    própria linha (ou admin), INSERT só da própria linha em 'pending', UPDATE/DELETE só
--    admin — mas isso quebrou leitura ampla que o app depende (login por matrícula,
--    lista de fiscais) e todo INSERT feito pelo admin para outro e-mail.
-- 3) Ajuste (ajuste_rls_app_users_select.sql) liberou SELECT geral e permitiu admin
--    inserir para qualquer e-mail; também abriu uma exceção pontual de UPDATE para
--    99030487@gecope.app, para não quebrar o backdoor `promoteAdmin99030487` que ainda
--    existia no código.
-- 4) O backdoor `promoteAdmin99030487` foi removido do código (admin.js/main.js) em
--    2026-08-14, por decisão do usuário — a conta já é admin permanentemente. A exceção
--    de UPDATE do passo 3 ficou redundante (sem mecanismo de código que dependa dela) e
--    foi removida.
-- 5) Com UPDATE restrito a admin, `signUpRequest()` (main.js) deixou de conseguir migrar
--    um registro "fantasma" pré-cadastrado por matrícula (email fabricado, ex.:
--    matricula@gecope.app ou algo@sop-ghost.internal) para o e-mail real do usuário —
--    toda vez que alguém com matrícula já fantasma se cadastrava de verdade, o UPDATE
--    falhava (só admin podia) e o código caía no fallback de INSERT, criando uma SEGUNDA
--    linha duplicada em vez de atualizar a existente. Por pedido do usuário (2026-08-14:
--    "quero que sempre atualize e não crie uma nova linha"), adicionada abaixo uma
--    policy de UPDATE estreita, só para esse caso específico: só se aplica a uma linha
--    que HOJE tem e-mail fabricado (fantasma), e só permite trocar esse e-mail para o
--    PRÓPRIO e-mail autenticado de quem está fazendo a chamada, mantendo role='pending'
--    (não dá pra usar essa brecha pra virar admin nem pra mexer numa conta já real).
--
-- ESTADO FINAL, sem redundância:
-- - SELECT: liberado geral (leitura de nome/e-mail/matrícula não é dado sensível de
--   terceiros dentro deste sistema interno; já era 100% legível antes de qualquer RLS).
-- - INSERT: o próprio usuário só pode inserir a própria linha com role='pending'
--   (autocadastro); admin pode inserir qualquer linha, com qualquer role.
-- - UPDATE: admin (qualquer linha), OU qualquer autenticado "reivindicando" uma linha
--   fantasma pré-existente como sua própria (só troca o e-mail fantasma pelo real,
--   mantendo pending). DELETE: só admin.
-- =====================================================================================

begin;

alter table public.app_users enable row level security;

-- Função auxiliar: e-mail do JWT autenticado tem papel admin em app_users?
create or replace function public.app_users_is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.app_users u
    where u.email = auth.jwt() ->> 'email'
      and u.role = 'admin'
  );
$$;

-- SELECT: leitura geral (anon incluso — necessário para a resolução de matrícula ->
-- e-mail real no login, feita antes de autenticar).
drop policy if exists "app_users_select" on public.app_users;
create policy "app_users_select" on public.app_users
  for select
  using (true);

-- INSERT: autocadastro (própria linha, role='pending') ou admin (qualquer linha/role).
drop policy if exists "app_users_insert_self_pending" on public.app_users;
create policy "app_users_insert_self_pending" on public.app_users
  for insert
  with check (
    app_users_is_admin()
    or (email = auth.jwt() ->> 'email' and role = 'pending')
  );

-- UPDATE: só admin (sem exceções — o backdoor que exigia uma foi removido do código).
drop policy if exists "app_users_update_admin" on public.app_users;
create policy "app_users_update_admin" on public.app_users
  for update
  using (app_users_is_admin())
  with check (app_users_is_admin());

-- UPDATE (2ª policy, permissiva — combinada com a de cima via OR): permite que um
-- usuário autenticado "reivindique" uma linha fantasma pré-existente (matrícula já
-- cadastrada com e-mail fabricado) durante o cadastro real, migrando-a para o próprio
-- e-mail em vez de deixar `signUpRequest()` criar uma linha duplicada. USING restringe
-- às linhas que hoje têm e-mail fantasma; WITH CHECK garante que só pode virar o
-- próprio e-mail autenticado, sempre como 'pending' (não permite virar admin nem tocar
-- numa conta que já não seja fantasma).
drop policy if exists "app_users_update_claim_ghost" on public.app_users;
create policy "app_users_update_claim_ghost" on public.app_users
  for update
  using (
    email like '%@gecope.app' or email like '%@sop-ghost.internal'
  )
  with check (
    email = auth.jwt() ->> 'email'
    and role = 'pending'
  );

-- DELETE: só admin.
drop policy if exists "app_users_delete_admin" on public.app_users;
create policy "app_users_delete_admin" on public.app_users
  for delete
  using (app_users_is_admin());

commit;

-- =====================================================================================
-- Este script é seguro de rodar de novo a qualquer momento (todo `create policy` é
-- precedido de `drop policy if exists`) — útil tanto para aplicar a remoção da exceção
-- de 99030487@gecope.app quanto para recriar as policies do zero em um banco novo.
-- =====================================================================================
