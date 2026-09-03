-- Script de PREVIEW e DELETE compatível com o SQL Editor do Supabase
-- Uso: edite os valores em PROCESSO_VALUE e META_TO_REMOVE_VALUE abaixo e execute apenas o SELECT
-- (passo 1). Se revisar e confirmar, descomente o bloco DELETE (passo 2) e execute.

-- Defina aqui os valores que quer analisar antes de executar
-- Substitua entre aspas pelo processo desejado e pela data meta a remover (formato YYYY-MM-DD)
-- Exemplo: PROCESSO_VALUE = '43022.004997/2026-79'
--          META_TO_REMOVE_VALUE = '2026-06-29'

-- >>> EDITE ESTES VALORES ANTES DE RODAR
-- (apague as linhas de comentário e insira os valores desejados)
-- PROCESSO_VALUE := '43022.004997/2026-79';
-- META_TO_REMOVE_VALUE := '2026-06-29';

-- 1) Visualizar os registros candidatos à remoção (substitua literal PROCESSO_VALUE / META_TO_REMOVE_VALUE)
WITH target AS (
  SELECT id FROM public.processos WHERE processo = 'PROCESSO_VALUE'
)
SELECT h.*
FROM public.historico_metas h
JOIN target t ON h.processo_id = t.id
WHERE h.autor = 'Sistema'
  AND h.meta = 'META_TO_REMOVE_VALUE'::date
ORDER BY h.registros, h.meta;

-- 2) Caso confirme, remova (descomente e execute)
-- DELETE FROM public.historico_metas h
-- USING (
--   SELECT id FROM public.processos WHERE processo = 'PROCESSO_VALUE'
-- ) t
-- WHERE h.processo_id = t.id
--   AND h.autor = 'Sistema'
--   AND h.meta = 'META_TO_REMOVE_VALUE'::date;

-- 3) Alternativa: remover apenas registros duplicados do tipo 'Sistema' mantendo o mais recente
-- (CUIDADO: revise antes de executar)
-- WITH sist AS (
--   SELECT h.id, h.processo_id, h.registros::date AS registro_data,
--          ROW_NUMBER() OVER (PARTITION BY h.processo_id, h.registros::date ORDER BY h.id DESC) rn
--   FROM public.historico_metas h
--   WHERE h.autor = 'Sistema'
-- )
-- DELETE FROM public.historico_metas
-- WHERE id IN (
--   SELECT id FROM sist WHERE rn > 1
-- );

-- 4) Verificação final: listar históricos remanescentes para o processo
-- SELECT * FROM public.historico_metas WHERE processo_id = (SELECT id FROM public.processos WHERE processo = 'PROCESSO_VALUE') ORDER BY registros DESC;

-- NOTA: Sempre faça backup antes de executar deletes diretos.
