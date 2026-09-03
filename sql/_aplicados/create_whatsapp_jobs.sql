-- =====================================================================================
-- Tabela public.whatsapp_jobs — fila de disparo do proxy WhatsApp (2026-08-17)
-- =====================================================================================
-- Contexto: a tabela já existe em produção (criada a partir de
-- server/whatsapp-proxy/supabase.sql, fora da pasta central de migrações), mas com RLS
-- aberta para qualquer requisição não autenticada (policy "Permitir tudo para testes",
-- using(true)/with_check(true) para o papel `public`) — qualquer pessoa com a anon key
-- consegue hoje enfileirar/ler/apagar jobs de envio de WhatsApp. Este script:
--   1) garante o schema final (idempotente tanto para criar do zero quanto para corrigir
--      um ambiente onde a tabela já existe com o shape antigo, sem `meta`/`log_id`/
--      `attempts`);
--   2) adiciona `log_id` (liga o job ao log em whatsapp_logs que originou o envio — ver
--      sql/fix_whatsapp_logs_rls.sql) e `attempts` (contagem de tentativas persistida;
--      hoje o worker só conta em memória, perdendo o estado se reiniciar no meio);
--   3) trava `status` a um conjunto fixo de valores;
--   4) remove a policy aberta e NÃO cria nenhuma policy nova — com RLS habilitada e zero
--      policies, Postgres nega acesso por padrão a anon/authenticated; só a service role
--      (usada exclusivamente pelo backend server/whatsapp-proxy) ignora RLS e consegue
--      operar nesta tabela, que é exatamente o comportamento desejado: só o proxy/worker
--      deve tocar na fila, nunca o cliente diretamente.
-- =====================================================================================

begin;

create table if not exists public.whatsapp_jobs (
  id uuid default gen_random_uuid() primary key,
  number text not null,
  text text not null,
  meta jsonb,
  log_id uuid references public.whatsapp_logs(id) on delete set null,
  attempts int not null default 0,
  status text not null default 'pending',
  created_at timestamptz default now(),
  started_at timestamptz,
  finished_at timestamptz,
  result jsonb
);

-- Mudanças aditivas idempotentes, para o caso do ambiente já ter a tabela no shape antigo
-- (sem estas colunas), sem precisar recriar nada.
alter table public.whatsapp_jobs add column if not exists meta jsonb;
alter table public.whatsapp_jobs add column if not exists log_id uuid references public.whatsapp_logs(id) on delete set null;
alter table public.whatsapp_jobs add column if not exists attempts int not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'whatsapp_jobs_status_check'
  ) then
    alter table public.whatsapp_jobs
      add constraint whatsapp_jobs_status_check
      check (status in ('pending', 'processing', 'success', 'failed'));
  end if;
end $$;

create index if not exists idx_whatsapp_jobs_status on public.whatsapp_jobs (status);
create index if not exists idx_whatsapp_jobs_log_id on public.whatsapp_jobs (log_id);

alter table public.whatsapp_jobs enable row level security;

-- Remove a policy aberta. Nenhuma policy nova é criada de propósito (ver cabeçalho).
drop policy if exists "Permitir tudo para testes" on public.whatsapp_jobs;

commit;

-- =====================================================================================
-- Verificação pós-migração (rodar manualmente, não faz parte da transação acima):
--
-- 1) Confirmar que não sobrou nenhuma policy na tabela:
--    select policyname, roles, cmd from pg_policies where tablename = 'whatsapp_jobs';
--    -- deve retornar 0 linhas
--
-- 2) Confirmar que RLS está habilitada:
--    select rowsecurity from pg_tables where tablename = 'whatsapp_jobs';
--    -- deve retornar true
--
-- 3) Confirmar que a coluna log_id aponta certo:
--    select column_name, data_type from information_schema.columns
--    where table_name = 'whatsapp_jobs' and column_name in ('log_id', 'attempts', 'meta');
--
-- Este script é seguro de rodar de novo a qualquer momento (create/add/drop são todos
-- guardados por IF (NOT) EXISTS).
-- =====================================================================================
