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

-- Acelera as duas consultas do painel de observabilidade (F7): "quantas
-- falharam/tiveram 👎" e "lista das mais recentes com problema".
create index if not exists consultas_ia_log_problemas_idx
  on public.consultas_ia_log (created_at desc)
  where sucesso is false or veredito = 'negativo';

commit;

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

-- ============================================================================
-- ROLLBACK (se necessário)
-- ============================================================================
-- begin;
-- drop index if exists public.consultas_ia_log_problemas_idx;
-- alter table public.consultas_ia_log drop constraint if exists consultas_ia_log_veredito_check;
-- alter table public.consultas_ia_log drop column if exists veredito;
-- commit;
