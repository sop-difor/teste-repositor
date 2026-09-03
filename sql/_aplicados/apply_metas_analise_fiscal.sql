-- Atualiza processos em ANÁLISE FISCAL para terem data_meta automática
-- e insere registro no historico_metas.
-- Uso: Cole este script no SQL Editor do projeto Supabase e execute.

-- 1) Função para somar dias úteis, considerando fins de semana e feriados (MM-DD list)
CREATE OR REPLACE FUNCTION public.add_business_days(start_date date, days int) RETURNS date
LANGUAGE plpgsql AS $$
DECLARE
    d date := start_date;
    cnt int := 0;
BEGIN
    IF days IS NULL OR days <= 0 THEN
        -- Monta tabela temporária com as metas calculadas para evitar problemas de escopo em editores
        DROP TABLE IF EXISTS temp_computed;
        CREATE TEMP TABLE temp_computed ON COMMIT DROP AS
        SELECT
            p.id,
            CASE WHEN upper(p.status) LIKE '%DEVOLVIDO%' OR upper(p.status) LIKE '%REANALISE%' THEN 10 ELSE 20 END AS dias,
            CASE WHEN upper(p.status) LIKE '%DEVOLVIDO%' OR upper(p.status) LIKE '%REANALISE%' THEN COALESCE(p.data_devolucao_correcoes::date, p.created_at::date) ELSE p.created_at::date END AS base_date,
            public.add_business_days(
                CASE WHEN upper(p.status) LIKE '%DEVOLVIDO%' OR upper(p.status) LIKE '%REANALISE%' THEN COALESCE(p.data_devolucao_correcoes::date, p.created_at::date) ELSE p.created_at::date END,
                CASE WHEN upper(p.status) LIKE '%DEVOLVIDO%' OR upper(p.status) LIKE '%REANALISE%' THEN 10 ELSE 20 END
            )::date AS nova_meta
        FROM public.processos p
        WHERE upper(p.status) LIKE '%ANÁLISE FISCAL%';

        -- Atualiza a tabela processos com a nova data (apenas onde difere ou é nula)
        UPDATE public.processos p
        SET data_compromisso_fiscal = t.nova_meta
        FROM temp_computed t
        WHERE p.id = t.id
          AND (p.data_compromisso_fiscal IS DISTINCT FROM t.nova_meta OR p.data_compromisso_fiscal IS NULL);

        -- Insere registros no historico_metas para as atualizações efetuadas (não duplica entradas existentes com mesma meta)
        INSERT INTO public.historico_metas (processo_id, registros, dias_estipulados, meta, autor)
        SELECT
            t.id,
            t.base_date::date,
            t.dias,
            t.nova_meta,
            'Sistema'
        FROM temp_computed t
        LEFT JOIN public.historico_metas h
            ON h.processo_id = t.id
            AND h.meta = t.nova_meta
        WHERE NOT EXISTS (
            SELECT 1 FROM public.historico_metas h2 WHERE h2.processo_id = t.id AND h2.meta = t.nova_meta
        );
    FROM to_update
)

-- Atualiza a tabela processos com a nova data (apenas onde difere ou é nula)
UPDATE public.processos p
SET data_compromisso_fiscal = c.nova_meta
FROM computed c
WHERE p.id = c.id
    AND (p.data_compromisso_fiscal IS DISTINCT FROM c.nova_meta OR p.data_compromisso_fiscal IS NULL);

-- 3) Insere registros no historico_metas para as atualizações efetuadas (não duplica entradas existentes com mesma meta)
INSERT INTO public.historico_metas (processo_id, registros, dias_estipulados, meta, autor)
SELECT
    c.id,
    to_char(c.base_date, 'YYYY-MM-DD')::date,
    c.dias,
    c.nova_meta,
    'Sistema'
FROM computed c
LEFT JOIN public.historico_metas h
    ON h.processo_id = c.id
    AND h.meta = c.nova_meta
WHERE NOT EXISTS (
    SELECT 1 FROM public.historico_metas h2 WHERE h2.processo_id = c.id AND h2.meta = c.nova_meta::date
);

-- FIM

-- Observações:
-- - Revise a lista de feriados em add_business_days() para contemplar feriados móveis e estaduais, se necessário.
-- - Execute primeiro em modo 'dry run' (selecionando computed) para revisar os resultados:
--   SELECT * FROM (
--     SELECT id, status, created_at::date, data_devolucao_correcoes::date,
--     CASE WHEN upper(status) LIKE '%DEVOLVIDO%' OR upper(status) LIKE '%REANALISE%' THEN 10 ELSE 20 END AS dias,
--     to_char(public.add_business_days(COALESCE(data_devolucao_correcoes::date, created_at::date), CASE WHEN upper(status) LIKE '%DEVOLVIDO%' OR upper(status) LIKE '%REANALISE%' THEN 10 ELSE 20 END), 'YYYY-MM-DD') AS nova_meta
--     FROM public.processos WHERE upper(status) LIKE '%ANÁLISE FISCAL%'
--   ) t;
