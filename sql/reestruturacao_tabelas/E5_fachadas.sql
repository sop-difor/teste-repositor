-- =====================================================================
-- E5 — Fachadas: views sinapi_itens / orse_itens / seinfra_itens
-- Ver gecope/tabelas.md §4.6.  Rollback: E5_rollback.sql
-- =====================================================================
-- Renomeia as tabelas atuais para *_itens_old e cria views com o nome antigo,
-- montadas sobre o modelo novo. security_invoker=true -> respeitam a RLS das
-- tabelas base (que têm política SELECT para anon/authenticated).
-- Colunas/tipos idênticos à §3. composicao remontada na forma que o front-end lê.
-- =====================================================================

-- ---- funções que remontam a composição analítica (forma A do front-end) ----
CREATE OR REPLACE FUNCTION rt_composicao_sinapi(p_codigo text, p_ref_ord int, p_encargo text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH ver AS (
    SELECT max(vigente_desde_ord) v FROM sinapi_composicao
    WHERE codigo = p_codigo AND vigente_desde_ord <= p_ref_ord
  ),
  elems AS (
    SELECT c.ordem, c.codigo_item, c.tipo_item, c.coeficiente
    FROM sinapi_composicao c, ver
    WHERE c.codigo = p_codigo AND c.vigente_desde_ord = ver.v
  )
  SELECT jsonb_agg(jsonb_build_object(
     'tipo_item',      e.tipo_item,
     'codigo_item',    e.codigo_item,
     'coeficiente',    e.coeficiente,
     'unidade',        cd.unidade,
     'descricao_item', cd.descricao,
     'preco_unitario', cp.preco,
     'valor_total',    round(e.coeficiente * coalesce(cp.preco, 0), 2)
   ) ORDER BY e.ordem)
  FROM elems e
  LEFT JOIN LATERAL (
     SELECT descricao, unidade FROM sinapi_descricao
     WHERE codigo = e.codigo_item AND vigente_desde_ord <= p_ref_ord
     ORDER BY vigente_desde_ord DESC LIMIT 1) cd ON true
  LEFT JOIN LATERAL (
     SELECT preco_unitario AS preco FROM sinapi_preco
     WHERE codigo = e.codigo_item AND tipo_encargo = p_encargo AND vigente_desde_ord <= p_ref_ord
     ORDER BY vigente_desde_ord DESC LIMIT 1) cp ON true
$$;

CREATE OR REPLACE FUNCTION rt_composicao_seinfra(p_codigo text, p_ref_ord int, p_encargo text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH ver AS (
    SELECT max(vigente_desde_ord) v FROM seinfra_composicao
    WHERE codigo = p_codigo AND tipo_encargo = p_encargo AND vigente_desde_ord <= p_ref_ord
  ),
  elems AS (
    SELECT c.ordem, c.codigo_item, c.tipo_item, c.categoria, c.coeficiente
    FROM seinfra_composicao c, ver
    WHERE c.codigo = p_codigo AND c.tipo_encargo = p_encargo AND c.vigente_desde_ord = ver.v
  )
  SELECT jsonb_agg(jsonb_build_object(
     'categoria',      e.categoria,
     'tipo_item',      e.tipo_item,
     'codigo_item',    e.codigo_item,
     'coeficiente',    e.coeficiente,
     'unidade',        cd.unidade,
     'descricao_item', cd.descricao,
     'preco_unitario', cp.preco,
     'valor_total',    round(e.coeficiente * coalesce(cp.preco, 0), 2)
   ) ORDER BY e.ordem)
  FROM elems e
  LEFT JOIN LATERAL (
     SELECT descricao, unidade FROM seinfra_descricao
     WHERE codigo = e.codigo_item AND vigente_desde_ord <= p_ref_ord
     ORDER BY vigente_desde_ord DESC LIMIT 1) cd ON true
  LEFT JOIN LATERAL (
     SELECT preco_unitario AS preco FROM seinfra_preco
     WHERE codigo = e.codigo_item AND tipo_encargo = p_encargo AND vigente_desde_ord <= p_ref_ord
     ORDER BY vigente_desde_ord DESC LIMIT 1) cp ON true
$$;

REVOKE EXECUTE ON FUNCTION rt_composicao_sinapi(text,int,text), rt_composicao_seinfra(text,int,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION rt_composicao_sinapi(text,int,text), rt_composicao_seinfra(text,int,text) TO anon, authenticated, service_role;

-- ---- renomear tabelas atuais ----
ALTER TABLE public.sinapi_itens  RENAME TO sinapi_itens_old;
ALTER TABLE public.orse_itens    RENAME TO orse_itens_old;
ALTER TABLE public.seinfra_itens RENAME TO seinfra_itens_old;

-- ---- views de fachada ----
CREATE VIEW public.sinapi_itens WITH (security_invoker = true) AS
SELECT
  hashtextextended(i.codigo || '|' || rc.referencia_label || '|' || pr.tipo_encargo, 0) AS id,
  i.identificacao,
  i.codigo,
  dsc.descricao,
  dsc.unidade,
  pr.preco_unitario,
  pr.tipo_encargo,
  rc.referencia_label::date AS referencia,
  rc.carregada_em AS created_at,
  rt_composicao_sinapi(i.codigo, rc.referencia_ord, pr.tipo_encargo) AS composicao
FROM referencia_carregada rc
JOIN sinapi_item_presenca pp
  ON pp.ref_ord_ini <= rc.referencia_ord AND pp.ref_ord_fim >= rc.referencia_ord
JOIN sinapi_item i ON i.codigo = pp.codigo
JOIN sinapi_descricao dsc ON dsc.codigo = i.codigo AND dsc.vigente_desde_ord <= rc.referencia_ord
  AND NOT EXISTS (SELECT 1 FROM sinapi_descricao d2
      WHERE d2.codigo = i.codigo AND d2.vigente_desde_ord <= rc.referencia_ord
        AND d2.vigente_desde_ord > dsc.vigente_desde_ord)
JOIN LATERAL (
  SELECT p.tipo_encargo, p.preco_unitario FROM sinapi_preco p
  WHERE p.codigo = i.codigo AND p.vigente_desde_ord <= rc.referencia_ord
    AND NOT EXISTS (SELECT 1 FROM sinapi_preco p2
        WHERE p2.codigo = i.codigo AND p2.tipo_encargo = p.tipo_encargo
          AND p2.vigente_desde_ord <= rc.referencia_ord
          AND p2.vigente_desde_ord > p.vigente_desde_ord)
) pr ON true
WHERE rc.fonte = 'SINAPI'
ORDER BY i.codigo, pr.tipo_encargo;

CREATE VIEW public.orse_itens WITH (security_invoker = true) AS
SELECT
  hashtextextended(i.codigo || '|' || rc.referencia_label || '|' || pr.tipo_encargo, 0) AS id,
  i.identificacao,
  i.codigo,
  dsc.descricao,
  dsc.unidade,
  pr.preco_unitario,
  pr.tipo_encargo,
  rc.referencia_label::date AS referencia,
  rc.carregada_em AS created_at
FROM referencia_carregada rc
JOIN orse_item_presenca pp
  ON pp.ref_ord_ini <= rc.referencia_ord AND pp.ref_ord_fim >= rc.referencia_ord
JOIN orse_item i ON i.codigo = pp.codigo
JOIN orse_descricao dsc ON dsc.codigo = i.codigo AND dsc.vigente_desde_ord <= rc.referencia_ord
  AND NOT EXISTS (SELECT 1 FROM orse_descricao d2
      WHERE d2.codigo = i.codigo AND d2.vigente_desde_ord <= rc.referencia_ord
        AND d2.vigente_desde_ord > dsc.vigente_desde_ord)
JOIN LATERAL (
  SELECT p.tipo_encargo, p.preco_unitario FROM orse_preco p
  WHERE p.codigo = i.codigo AND p.vigente_desde_ord <= rc.referencia_ord
    AND NOT EXISTS (SELECT 1 FROM orse_preco p2
        WHERE p2.codigo = i.codigo AND p2.tipo_encargo = p.tipo_encargo
          AND p2.vigente_desde_ord <= rc.referencia_ord
          AND p2.vigente_desde_ord > p.vigente_desde_ord)
) pr ON true
WHERE rc.fonte = 'ORSE'
ORDER BY i.codigo, pr.tipo_encargo;

CREATE VIEW public.seinfra_itens WITH (security_invoker = true) AS
SELECT
  hashtextextended(i.codigo || '|' || rc.referencia_label || '|' || pr.tipo_encargo, 0) AS id,
  i.identificacao,
  i.codigo,
  dsc.descricao,
  dsc.unidade,
  pr.preco_unitario,
  pr.tipo_encargo,
  rc.referencia_label::varchar(10) AS referencia,
  rc.carregada_em AS created_at,
  rt_composicao_seinfra(i.codigo, rc.referencia_ord, pr.tipo_encargo) AS composicao
FROM referencia_carregada rc
JOIN seinfra_item_presenca pp
  ON pp.ref_ord_ini <= rc.referencia_ord AND pp.ref_ord_fim >= rc.referencia_ord
JOIN seinfra_item i ON i.codigo = pp.codigo
JOIN seinfra_descricao dsc ON dsc.codigo = i.codigo AND dsc.vigente_desde_ord <= rc.referencia_ord
  AND NOT EXISTS (SELECT 1 FROM seinfra_descricao d2
      WHERE d2.codigo = i.codigo AND d2.vigente_desde_ord <= rc.referencia_ord
        AND d2.vigente_desde_ord > dsc.vigente_desde_ord)
JOIN LATERAL (
  SELECT p.tipo_encargo, p.preco_unitario FROM seinfra_preco p
  WHERE p.codigo = i.codigo AND p.vigente_desde_ord <= rc.referencia_ord
    AND NOT EXISTS (SELECT 1 FROM seinfra_preco p2
        WHERE p2.codigo = i.codigo AND p2.tipo_encargo = p.tipo_encargo
          AND p2.vigente_desde_ord <= rc.referencia_ord
          AND p2.vigente_desde_ord > p.vigente_desde_ord)
) pr ON true
WHERE rc.fonte = 'SEINFRA'
ORDER BY i.codigo, pr.tipo_encargo;

GRANT SELECT ON public.sinapi_itens, public.orse_itens, public.seinfra_itens TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
