-- ============================================================================
-- F7 — Feedback (👍/👎) no log do Assistente de Dados
-- Projeto: qexdnxqmiaarzwwwrcor (PRODUÇÃO). Aplicar manualmente no SQL Editor.
-- Idempotente (add column if not exists). Transacional.
-- ============================================================================
-- Objetivo: guardar o veredito do usuário sobre cada resposta, junto da linha
-- que já existe em consultas_ia_log desde a F1. Não muda RLS nem grants — a
-- tabela já é "só service_role escreve" (F1); o UPDATE do veredito continua
-- passando pela Edge Function, nunca direto do navegador.
-- ============================================================================

begin;

alter table public.consultas_ia_log
  add column if not exists veredito text;

alter table public.consultas_ia_log
  drop constraint if exists consultas_ia_log_veredito_check;

alter table public.consultas_ia_log
  add constraint consultas_ia_log_veredito_check
  check (veredito is null or veredito in ('positivo', 'negativo'));

comment on column public.consultas_ia_log.veredito is
  'F7 (assistente): voto do usuário sobre a resposta — positivo (👍) / negativo (👎) / null (sem voto). Gravado via UPDATE da Edge Function, nunca escrito direto pelo navegador.';

-- Índice parcial cobrindo as linhas que a rotina de revisão (F7,
-- docs/assistente/rotina-revisao-falhas.md) precisa achar rápido: falhas e
-- 👎. Hoje a função gecope-assistant-painel ainda traz tudo e filtra em JS
-- (achado do rev-correcao) — este índice serve para quando essa consulta
-- passar a filtrar no banco, sem precisar de outra migração depois.
create index if not exists consultas_ia_log_problemas_idx
  on public.consultas_ia_log (created_at desc)
  where sucesso is false or veredito = 'negativo';

commit;

-- ============================================================================
-- Purga de retenção (LGPD) — prometida na F1 (fase-1-seguranca.md) e em
-- escopo-dados.md ("retenção: purga de registros com mais de 180 dias — job
-- pg_cron na F7"), não implementada até agora. Achado do rev-seguranca nesta
-- revisão; decisão do usuário (05/09/2026): implementar já, não adiar para
-- a F8. `pg_cron` já está instalado neste projeto (usado por
-- sincronizar-suite-horario). `cron.schedule` é idempotente pelo nome do
-- job — rodar de novo apenas atualiza o agendamento, não duplica.
-- ============================================================================
select cron.schedule(
  'gecope-assistente-purga-log',
  '0 3 * * *', -- todo dia às 3h (fora do horário comercial do job de sincronizar-suite)
  $$ delete from public.consultas_ia_log where created_at < now() - interval '180 days'; $$
);

-- ============================================================================
-- Bloco de verificação (rodar manualmente após aplicar, não faz parte da
-- migração)
-- ============================================================================
-- A: select column_name, data_type from information_schema.columns
--      where table_name = 'consultas_ia_log' and column_name = 'veredito';  -- text
-- B: update consultas_ia_log set veredito = 'positivo' where id = (select id from consultas_ia_log order by id desc limit 1);
--    -- deve funcionar (via service_role, ex.: MCP)
-- C: update consultas_ia_log set veredito = 'invalido' where id = (select id from consultas_ia_log order by id desc limit 1);
--    -- deve FALHAR (violação do check) — depois desfazer o teste do B:
--    update consultas_ia_log set veredito = null where id = (select id from consultas_ia_log order by id desc limit 1);
-- D: select has_table_privilege('authenticated', 'public.consultas_ia_log', 'UPDATE'); -- false (RLS da F1 intacta)
-- E: select jobname, schedule, active from cron.job where jobname = 'gecope-assistente-purga-log'; -- 1 linha, active=true
-- F: select public.consultas_ia_log.* from public.consultas_ia_log
--      where created_at < now() - interval '180 days' limit 5; -- confira que o que apareceria aqui é mesmo o que deve ser apagado

-- ============================================================================
-- ROLLBACK (se necessário)
-- ============================================================================
-- begin;
-- drop index if exists public.consultas_ia_log_problemas_idx;
-- alter table public.consultas_ia_log drop constraint if exists consultas_ia_log_veredito_check;
-- alter table public.consultas_ia_log drop column if exists veredito;
-- commit;
-- select cron.unschedule('gecope-assistente-purga-log');
