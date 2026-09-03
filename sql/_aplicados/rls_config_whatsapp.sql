-- =====================================================================================
-- RLS de public.config_whatsapp (2026-08-17)
-- =====================================================================================
-- Contexto: esta tabela guarda a configuração dos gatilhos automáticos de WhatsApp
-- (is_ativo, texto_mensagem, destinatarios por evento) e HOJE NÃO TEM RLS HABILITADA —
-- sinalizado como achado "critical" pelo advisor de segurança do Supabase. Qualquer
-- requisição com a anon key, mesmo sem login, consegue hoje ler e também ESCREVER nesta
-- tabela: desligar notificações, alterar o texto configurado, mudar destinatários.
--
-- Regras desejadas:
-- - SELECT: liberado para qualquer usuário AUTENTICADO (não anon). Necessário porque
--   `processarNotificacao` (whatsapp.js) lê esta tabela para decidir se dispara e com
--   qual configuração, e essa função roda no contexto de qualquer usuário comum que
--   dispare uma ação de negócio (criar processo, mudar status, etc.) — não só admin.
-- - INSERT/UPDATE: só admin (`app_users_is_admin()`, já usada em sql/rls_app_users.sql e
--   sql/create_cronograma_tables.sql). Só a tela de configuração (painel administrativo)
--   deve poder alterar gatilhos/texto/ativação.
-- - Sem policy de DELETE: o código só faz upsert por `evento_gatilho`
--   (WhatsAppConfigManager.save), nunca exclui linhas — fica bloqueado por padrão, o que
--   é o comportamento correto.
-- =====================================================================================

begin;

alter table public.config_whatsapp enable row level security;

drop policy if exists "config_whatsapp_select_authenticated" on public.config_whatsapp;
create policy "config_whatsapp_select_authenticated" on public.config_whatsapp
  for select
  to authenticated
  using (true);

drop policy if exists "config_whatsapp_insert_admin" on public.config_whatsapp;
create policy "config_whatsapp_insert_admin" on public.config_whatsapp
  for insert
  with check (app_users_is_admin());

drop policy if exists "config_whatsapp_update_admin" on public.config_whatsapp;
create policy "config_whatsapp_update_admin" on public.config_whatsapp
  for update
  using (app_users_is_admin())
  with check (app_users_is_admin());

commit;

-- =====================================================================================
-- Verificação pós-migração:
--
-- select rowsecurity from pg_tables where tablename = 'config_whatsapp'; -- deve ser true
-- select policyname, cmd, roles from pg_policies where tablename = 'config_whatsapp';
-- -- deve retornar exatamente 3 policies: select (authenticated), insert (admin via
-- -- with_check), update (admin via using+with_check)
--
-- Este script é seguro de rodar de novo a qualquer momento (create policy sempre
-- precedido de drop policy if exists).
-- =====================================================================================
