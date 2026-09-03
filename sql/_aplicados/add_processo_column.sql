-- Script: add_processo_column.sql
-- Uso: Rode no Supabase SQL Editor ou via psql. Este script adiciona a coluna `processo` (se não existir),
-- permite popular valores iniciais e inclui instruções para torná-la NOT NULL/UNIQUE após validação.

BEGIN;

-- 1) Adiciona coluna `processo` se não existir (texto, nullable por ora)
ALTER TABLE IF EXISTS public.processos
  ADD COLUMN IF NOT EXISTS processo VARCHAR(255);

-- 2) (Opcional) Popular valores básicos para linhas que estejam com processo NULL.
--    Aqui há duas sugestões — escolha a que fizer sentido para você:
--    a) Copiar do `id` (útil quando id é legível/único):
-- UPDATE public.processos SET processo = id::text WHERE processo IS NULL;
--    b) Gerar a partir da data de criação + id curta:
-- UPDATE public.processos SET processo = to_char(created_at::date, 'YYYYMMDD') || '-' || left(id::text, 8) WHERE processo IS NULL;

-- Execute a atualização manualmente após revisão. Exemplo (comentar/descomentar):
-- UPDATE public.processos SET processo = id::text WHERE processo IS NULL;

-- 3) Criar índice para melhorar buscas por `processo` (não único por padrão)
CREATE INDEX IF NOT EXISTS idx_processos_processo ON public.processos(processo);

COMMIT;

-- INSTRUÇÕES PÓS-EXECUÇÃO:
-- - Verifique as linhas sem `processo`:
--   SELECT COUNT(*) FROM public.processos WHERE processo IS NULL;
-- - Se tudo estiver OK e você quiser garantir unicidade e não-null, rode:
--   ALTER TABLE public.processos ALTER COLUMN processo SET NOT NULL;
--   CREATE UNIQUE INDEX idx_processos_processo_unique ON public.processos(processo);
--   (A criação do índice único falhará caso haja duplicatas.)
-- - Atualize o código cliente/servidor para preencher `processo` ao inserir registros.
