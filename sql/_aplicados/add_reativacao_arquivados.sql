-- Script: add_reativacao_arquivados.sql
-- Uso: Rode no Supabase SQL Editor ou via psql.
-- Suporte à reativação automática de processos arquivados: quando o job
-- sincronizar-suite detecta que um processo voltou a tramitar no SUITE
-- (sigla != ARQUIVADO), o status volta a ser o que era antes do arquivamento.

BEGIN;

-- Guarda o status que o processo tinha imediatamente antes de ser arquivado,
-- para que a reativação saiba para onde voltar.
ALTER TABLE IF EXISTS public.processos
  ADD COLUMN IF NOT EXISTS status_pre_arquivamento VARCHAR(100);

-- Timestamp da última vez que o job checou este processo arquivado no SUITE.
-- Usado para limitar a checagem de arquivados a 1x por dia (economia de egress).
ALTER TABLE IF EXISTS public.processos
  ADD COLUMN IF NOT EXISTS arquivado_check_em TIMESTAMPTZ;

COMMIT;
