-- Script: delete_meta_2026_06_29.sql
-- Propósito: criar backup, visualizar e (opcionalmente) remover registros em historico_metas com meta = '2026-06-29'
-- ATENÇÃO: sempre revise o SELECT antes de executar o DELETE.

-- 0) Backup (execute antes de qualquer DELETE)
CREATE TABLE IF NOT EXISTS public.historico_metas_backup_20260529 AS TABLE public.historico_metas;

-- 1) Visualizar todos os registros com meta = 2026-06-29
SELECT h.*,
       p.processo AS processo_text
FROM public.historico_metas h
LEFT JOIN public.processos p ON p.id = h.processo_id
WHERE h.meta = '2026-06-29'::date
ORDER BY h.processo_id, h.registros;

-- 2) Visualizar somente registros do tipo 'Sistema' (recomendado)
SELECT h.*,
       p.processo AS processo_text
FROM public.historico_metas h
LEFT JOIN public.processos p ON p.id = h.processo_id
WHERE h.meta = '2026-06-29'::date
  AND h.autor = 'Sistema'
ORDER BY h.processo_id, h.registros;

-- 3) DELETE seguro (exclui somente autor = 'Sistema')
-- Descomente para executar APÓS revisar os selects acima
-- DELETE FROM public.historico_metas
-- WHERE meta = '2026-06-29'::date
--   AND autor = 'Sistema';

-- 4) DELETE agressivo (exclui todos com meta = 2026-06-29)
-- CUIDADO: remove também entradas manuais/usuário
-- Descomente somente se tiver certeza
-- DELETE FROM public.historico_metas
-- WHERE meta = '2026-06-29'::date;

-- 5) Verificação final (execute após o DELETE)
-- SELECT COUNT(*) FROM public.historico_metas WHERE meta = '2026-06-29'::date;
