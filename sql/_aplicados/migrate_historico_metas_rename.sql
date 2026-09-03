-- Migration: Rename historico_metas columns and backup
-- Usage: Run in Supabase SQL Editor. This creates a backup, renames columns and converts timestamp to date.

-- IMPORTANT: Run a backup first. Supabase's editor may not support dynamic object names.
-- Recommended manual backup (replace timestamp):
-- CREATE TABLE public.historico_metas_backup_20260529_000000 AS TABLE public.historico_metas;

BEGIN;

-- 1) Backup — run the manual CREATE TABLE above before proceeding.

-- 2) Rename columns
ALTER TABLE public.historico_metas RENAME COLUMN data_estabelecimento TO registros;
ALTER TABLE public.historico_metas RENAME COLUMN data_limite TO meta;

-- 3) Convert `registros` from timestamptz to date (keep only date part)
ALTER TABLE public.historico_metas ALTER COLUMN registros TYPE date USING (registros::date);

COMMIT;

-- Verify:
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name='historico_metas';
-- Review and update any RLS policies, views, functions or other scripts referencing the old column names.
