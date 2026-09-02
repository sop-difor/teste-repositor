-- =====================================================================
-- E2b — composição em múltiplas formas + backfill de analítica
-- Ver gecope/tabelas.md §10-M.  Rollback: incluído em E2_rollback.sql
-- =====================================================================
-- Objetivo (decidido com o responsável): sintética + analítica em TODOS os
-- meses de 2025/2026, dentro de 500 MB. A analítica de um mês que hoje só
-- tem sintética pode ser completada depois via rt_aplicar_composicao_<fonte>.
--
-- Formas do jsonb `composicao` no legado SINAPI:
--   A) array de {codigo_item, descricao_item, tipo_item, coeficiente,
--      preco_unitario, valor_total, unidade}         (2025-07..2026-01)
--   B) objeto {grupo, perc_as, itens:[{codigo, descricao, tipo, coeficiente,
--      preco_unitario, valor, unidade, situacao}]}    (2026-06)
--   NULL                                              (2025-01, 2026-02, 2026-03)
-- SEINFRA: sempre forma A.  rt_comp_canon() normaliza A e B para a forma A.
-- =====================================================================

CREATE OR REPLACE FUNCTION rt_comp_canon(p jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p IS NULL THEN NULL
    WHEN jsonb_typeof(p) = 'array' THEN
      CASE WHEN jsonb_array_length(p) = 0 THEN NULL ELSE p END
    WHEN jsonb_typeof(p) = 'object' AND jsonb_typeof(p->'itens') = 'array' THEN (
      SELECT jsonb_agg(jsonb_build_object(
               'codigo_item',    e->>'codigo',
               'descricao_item', e->>'descricao',
               'tipo_item',      e->>'tipo',
               'coeficiente',    e->'coeficiente',
               'preco_unitario', e->'preco_unitario',
               'valor_total',    e->'valor',
               'unidade',        e->>'unidade'
             ) ORDER BY ord)
      FROM jsonb_array_elements(p->'itens') WITH ORDINALITY AS t(e, ord)
    )
    ELSE NULL
  END
$$;

-- ---------------------------------------------------------------------
-- Internas: aplicam SÓ a composição analítica de stg_<fonte> em v_ord.
-- Gravam versão nova apenas onde a assinatura estrutural muda (§10-D).
-- Retornam nº de linhas inseridas.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rt__comp_sinapi(v_ord int) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE n bigint;
BEGIN
  WITH src AS (
    SELECT d.codigo, (e.ord)::smallint AS ordem,
           coalesce(nullif(e.el->>'codigo_item',''), nullif(e.el->>'codigo',''), '') AS codigo_item,
           e.el->>'tipo_item' AS tipo_item,
           e.el->>'categoria' AS categoria,
           nullif(e.el->>'coeficiente','')::numeric AS coeficiente
    FROM (
      SELECT DISTINCT ON (codigo) codigo, rt_comp_canon(composicao) AS comp
      FROM stg_sinapi
      WHERE rt_comp_canon(composicao) IS NOT NULL
      ORDER BY codigo, tipo_encargo
    ) d
    CROSS JOIN LATERAL jsonb_array_elements(d.comp) WITH ORDINALITY AS e(el, ord)
  ),
  new_sig AS (
    SELECT codigo, md5(string_agg(rt_tok(codigo_item, coeficiente, tipo_item, categoria),
                                  '|' ORDER BY codigo_item, coeficiente, tipo_item)) AS sig
    FROM src GROUP BY codigo
  ),
  cur_ver AS (
    SELECT codigo, max(vigente_desde_ord) AS vord
    FROM sinapi_composicao WHERE vigente_desde_ord <= v_ord GROUP BY codigo
  ),
  cur_sig AS (
    SELECT c.codigo, md5(string_agg(rt_tok(c.codigo_item, c.coeficiente, c.tipo_item, c.categoria),
                                    '|' ORDER BY c.codigo_item, c.coeficiente, c.tipo_item)) AS sig
    FROM sinapi_composicao c JOIN cur_ver v ON v.codigo=c.codigo AND v.vord=c.vigente_desde_ord
    GROUP BY c.codigo
  ),
  mudou AS (
    SELECT n.codigo FROM new_sig n LEFT JOIN cur_sig cs ON cs.codigo=n.codigo
    WHERE n.sig IS DISTINCT FROM cs.sig
  ),
  ins AS (
    INSERT INTO sinapi_composicao (codigo, vigente_desde_ord, ordem, codigo_item, tipo_item, categoria, coeficiente)
    SELECT s.codigo, v_ord, s.ordem, s.codigo_item, s.tipo_item, s.categoria, s.coeficiente
    FROM src s JOIN mudou m ON m.codigo = s.codigo
    ON CONFLICT ON CONSTRAINT sinapi_composicao_pkey DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END $fn$;

CREATE OR REPLACE FUNCTION rt__comp_seinfra(v_ord int) RETURNS bigint
LANGUAGE plpgsql AS $fn$
DECLARE n bigint;
BEGIN
  WITH src AS (
    SELECT d.codigo, d.tipo_encargo, (e.ord)::smallint AS ordem,
           coalesce(nullif(e.el->>'codigo_item',''), nullif(e.el->>'codigo',''), '') AS codigo_item,
           e.el->>'tipo_item' AS tipo_item,
           e.el->>'categoria' AS categoria,
           nullif(e.el->>'coeficiente','')::numeric AS coeficiente
    FROM (
      SELECT DISTINCT ON (codigo, rt_norm_encargo(tipo_encargo))
             codigo, rt_norm_encargo(tipo_encargo) AS tipo_encargo, rt_comp_canon(composicao) AS comp
      FROM stg_seinfra
      WHERE rt_comp_canon(composicao) IS NOT NULL
      ORDER BY codigo, rt_norm_encargo(tipo_encargo)
    ) d
    CROSS JOIN LATERAL jsonb_array_elements(d.comp) WITH ORDINALITY AS e(el, ord)
  ),
  new_sig AS (
    SELECT codigo, tipo_encargo,
           md5(string_agg(rt_tok(codigo_item, coeficiente, tipo_item, categoria),
                          '|' ORDER BY codigo_item, coeficiente, tipo_item)) AS sig
    FROM src GROUP BY codigo, tipo_encargo
  ),
  cur_ver AS (
    SELECT codigo, tipo_encargo, max(vigente_desde_ord) AS vord
    FROM seinfra_composicao WHERE vigente_desde_ord <= v_ord GROUP BY codigo, tipo_encargo
  ),
  cur_sig AS (
    SELECT c.codigo, c.tipo_encargo,
           md5(string_agg(rt_tok(c.codigo_item, c.coeficiente, c.tipo_item, c.categoria),
                          '|' ORDER BY c.codigo_item, c.coeficiente, c.tipo_item)) AS sig
    FROM seinfra_composicao c
    JOIN cur_ver v ON v.codigo=c.codigo AND v.tipo_encargo=c.tipo_encargo AND v.vord=c.vigente_desde_ord
    GROUP BY c.codigo, c.tipo_encargo
  ),
  mudou AS (
    SELECT n.codigo, n.tipo_encargo FROM new_sig n
    LEFT JOIN cur_sig cs ON cs.codigo=n.codigo AND cs.tipo_encargo=n.tipo_encargo
    WHERE n.sig IS DISTINCT FROM cs.sig
  ),
  ins AS (
    INSERT INTO seinfra_composicao (codigo, tipo_encargo, vigente_desde_ord, ordem, codigo_item, tipo_item, categoria, coeficiente)
    SELECT s.codigo, s.tipo_encargo, v_ord, s.ordem, s.codigo_item, s.tipo_item, s.categoria, s.coeficiente
    FROM src s JOIN mudou m ON m.codigo=s.codigo AND m.tipo_encargo=s.tipo_encargo
    ON CONFLICT ON CONSTRAINT seinfra_composicao_pkey DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n FROM ins;
  RETURN n;
END $fn$;

-- ---------------------------------------------------------------------
-- rt_aplicar_sinapi / rt_aplicar_seinfra: agora usam rt__comp_* (forma A+B)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rt_aplicar_sinapi(p_ref_label text, p_limpar_stg boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fonte text := 'SINAPI';
  v_ord int := rt_ord_de_data(p_ref_label::date);
  v_prev_ord int;
  n_item bigint; n_desc bigint; n_preco bigint; n_comp bigint; n_pres bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM referencia_carregada WHERE fonte=v_fonte AND referencia_ord=v_ord) THEN
    RAISE EXCEPTION 'Referencia % (ord %) da fonte % ja foi carregada.', p_ref_label, v_ord, v_fonte;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stg_sinapi) THEN
    RAISE EXCEPTION 'stg_sinapi esta vazia — suba o CSV antes.';
  END IF;
  INSERT INTO referencia_carregada (fonte, referencia_ord, referencia_label) VALUES (v_fonte, v_ord, p_ref_label);
  v_prev_ord := (SELECT max(referencia_ord) FROM referencia_carregada WHERE fonte=v_fonte AND referencia_ord < v_ord);

  INSERT INTO sinapi_item (codigo, identificacao)
  SELECT DISTINCT codigo, upper(btrim(identificacao)) FROM stg_sinapi
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n_item = ROW_COUNT;

  UPDATE sinapi_item_presenca p SET ref_ord_fim = v_ord
  WHERE v_prev_ord IS NOT NULL AND p.ref_ord_fim = v_prev_ord
    AND EXISTS (SELECT 1 FROM stg_sinapi s WHERE s.codigo = p.codigo);
  INSERT INTO sinapi_item_presenca (codigo, ref_ord_ini, ref_ord_fim)
  SELECT DISTINCT s.codigo, v_ord, v_ord FROM stg_sinapi s
  WHERE NOT EXISTS (SELECT 1 FROM sinapi_item_presenca p WHERE p.codigo = s.codigo AND p.ref_ord_fim = v_ord)
  ON CONFLICT (codigo, ref_ord_ini) DO NOTHING;
  GET DIAGNOSTICS n_pres = ROW_COUNT;

  INSERT INTO sinapi_descricao (codigo, vigente_desde_ord, descricao, unidade)
  SELECT s.codigo, v_ord, s.descricao, s.unidade
  FROM (SELECT codigo, max(descricao) AS descricao, max(unidade) AS unidade FROM stg_sinapi GROUP BY codigo) s
  LEFT JOIN LATERAL (
    SELECT d.descricao, d.unidade, true AS achou FROM sinapi_descricao d
    WHERE d.codigo = s.codigo AND d.vigente_desde_ord <= v_ord ORDER BY d.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL OR (s.descricao, s.unidade) IS DISTINCT FROM (cur.descricao, cur.unidade)
  ON CONFLICT ON CONSTRAINT sinapi_descricao_pkey DO NOTHING;
  GET DIAGNOSTICS n_desc = ROW_COUNT;

  INSERT INTO sinapi_preco (codigo, tipo_encargo, vigente_desde_ord, preco_unitario)
  SELECT s.codigo, s.tipo_encargo, v_ord, s.preco_unitario
  FROM (SELECT codigo, rt_norm_encargo(tipo_encargo) AS tipo_encargo, min(preco_unitario) AS preco_unitario
        FROM stg_sinapi GROUP BY codigo, rt_norm_encargo(tipo_encargo)) s
  LEFT JOIN LATERAL (
    SELECT p.preco_unitario, true AS achou FROM sinapi_preco p
    WHERE p.codigo = s.codigo AND p.tipo_encargo = s.tipo_encargo AND p.vigente_desde_ord <= v_ord
    ORDER BY p.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL OR s.preco_unitario IS DISTINCT FROM cur.preco_unitario
  ON CONFLICT ON CONSTRAINT sinapi_preco_pkey DO NOTHING;
  GET DIAGNOSTICS n_preco = ROW_COUNT;

  n_comp := rt__comp_sinapi(v_ord);

  IF p_limpar_stg THEN TRUNCATE stg_sinapi; END IF;
  RETURN jsonb_build_object('fonte',v_fonte,'referencia',p_ref_label,'ord',v_ord,
    'itens_novos',n_item,'presencas',n_pres,'descricoes',n_desc,'precos',n_preco,'composicoes_linhas',n_comp);
END $fn$;

CREATE OR REPLACE FUNCTION rt_aplicar_seinfra(p_ref_label text, p_limpar_stg boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fonte text := 'SEINFRA';
  v_ord int := p_ref_label::int;
  v_prev_ord int;
  n_item bigint; n_desc bigint; n_preco bigint; n_comp bigint; n_pres bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM referencia_carregada WHERE fonte=v_fonte AND referencia_ord=v_ord) THEN
    RAISE EXCEPTION 'Referencia % da fonte % ja foi carregada.', p_ref_label, v_fonte;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stg_seinfra) THEN RAISE EXCEPTION 'stg_seinfra esta vazia.'; END IF;
  INSERT INTO referencia_carregada (fonte, referencia_ord, referencia_label) VALUES (v_fonte, v_ord, p_ref_label);
  v_prev_ord := (SELECT max(referencia_ord) FROM referencia_carregada WHERE fonte=v_fonte AND referencia_ord < v_ord);

  INSERT INTO seinfra_item (codigo, identificacao)
  SELECT DISTINCT codigo, upper(btrim(identificacao)) FROM stg_seinfra ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n_item = ROW_COUNT;

  UPDATE seinfra_item_presenca p SET ref_ord_fim = v_ord
  WHERE v_prev_ord IS NOT NULL AND p.ref_ord_fim = v_prev_ord
    AND EXISTS (SELECT 1 FROM stg_seinfra s WHERE s.codigo = p.codigo);
  INSERT INTO seinfra_item_presenca (codigo, ref_ord_ini, ref_ord_fim)
  SELECT DISTINCT s.codigo, v_ord, v_ord FROM stg_seinfra s
  WHERE NOT EXISTS (SELECT 1 FROM seinfra_item_presenca p WHERE p.codigo=s.codigo AND p.ref_ord_fim=v_ord)
  ON CONFLICT (codigo, ref_ord_ini) DO NOTHING;
  GET DIAGNOSTICS n_pres = ROW_COUNT;

  INSERT INTO seinfra_descricao (codigo, vigente_desde_ord, descricao, unidade)
  SELECT s.codigo, v_ord, s.descricao, s.unidade
  FROM (SELECT codigo, max(descricao) descricao, max(unidade) unidade FROM stg_seinfra GROUP BY codigo) s
  LEFT JOIN LATERAL (SELECT d.descricao, d.unidade, true achou FROM seinfra_descricao d
    WHERE d.codigo=s.codigo AND d.vigente_desde_ord <= v_ord ORDER BY d.vigente_desde_ord DESC LIMIT 1) cur ON true
  WHERE cur.achou IS NULL OR (s.descricao,s.unidade) IS DISTINCT FROM (cur.descricao,cur.unidade)
  ON CONFLICT ON CONSTRAINT seinfra_descricao_pkey DO NOTHING;
  GET DIAGNOSTICS n_desc = ROW_COUNT;

  INSERT INTO seinfra_preco (codigo, tipo_encargo, vigente_desde_ord, preco_unitario)
  SELECT s.codigo, s.tipo_encargo, v_ord, s.preco_unitario
  FROM (SELECT codigo, rt_norm_encargo(tipo_encargo) tipo_encargo, min(preco_unitario) preco_unitario
        FROM stg_seinfra GROUP BY codigo, rt_norm_encargo(tipo_encargo)) s
  LEFT JOIN LATERAL (SELECT p.preco_unitario, true achou FROM seinfra_preco p
    WHERE p.codigo=s.codigo AND p.tipo_encargo=s.tipo_encargo AND p.vigente_desde_ord <= v_ord
    ORDER BY p.vigente_desde_ord DESC LIMIT 1) cur ON true
  WHERE cur.achou IS NULL OR s.preco_unitario IS DISTINCT FROM cur.preco_unitario
  ON CONFLICT ON CONSTRAINT seinfra_preco_pkey DO NOTHING;
  GET DIAGNOSTICS n_preco = ROW_COUNT;

  n_comp := rt__comp_seinfra(v_ord);

  IF p_limpar_stg THEN TRUNCATE stg_seinfra; END IF;
  RETURN jsonb_build_object('fonte',v_fonte,'referencia',p_ref_label,'ord',v_ord,
    'itens_novos',n_item,'presencas',n_pres,'descricoes',n_desc,'precos',n_preco,'composicoes_linhas',n_comp);
END $fn$;

-- ---------------------------------------------------------------------
-- Backfill: completa a analítica de uma referência JÁ carregada
-- (mês que só tinha a sintética). Não refaz preços/descrições.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rt_aplicar_composicao_sinapi(p_ref_label text, p_limpar_stg boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_ord int := rt_ord_de_data(p_ref_label::date); n_comp bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referencia_carregada WHERE fonte='SINAPI' AND referencia_ord=v_ord) THEN
    RAISE EXCEPTION 'Referencia % ainda nao foi carregada — rode rt_aplicar_sinapi antes.', p_ref_label;
  END IF;
  IF EXISTS (SELECT 1 FROM sinapi_composicao WHERE vigente_desde_ord = v_ord) THEN
    RAISE EXCEPTION 'Ja existe versao de composicao exatamente em % (backfill e so para meses sem analitica).', p_ref_label;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stg_sinapi WHERE rt_comp_canon(composicao) IS NOT NULL) THEN
    RAISE EXCEPTION 'stg_sinapi nao tem composicao valida para backfill de %.', p_ref_label;
  END IF;
  n_comp := rt__comp_sinapi(v_ord);
  IF p_limpar_stg THEN TRUNCATE stg_sinapi; END IF;
  RETURN jsonb_build_object('fonte','SINAPI','referencia',p_ref_label,'ord',v_ord,'composicoes_linhas',n_comp,'obs','backfill analitica');
END $fn$;

CREATE OR REPLACE FUNCTION rt_aplicar_composicao_seinfra(p_ref_label text, p_limpar_stg boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE v_ord int := p_ref_label::int; n_comp bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM referencia_carregada WHERE fonte='SEINFRA' AND referencia_ord=v_ord) THEN
    RAISE EXCEPTION 'Referencia % ainda nao foi carregada — rode rt_aplicar_seinfra antes.', p_ref_label;
  END IF;
  IF EXISTS (SELECT 1 FROM seinfra_composicao WHERE vigente_desde_ord = v_ord) THEN
    RAISE EXCEPTION 'Ja existe versao de composicao exatamente em % (backfill e so para meses sem analitica).', p_ref_label;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stg_seinfra WHERE rt_comp_canon(composicao) IS NOT NULL) THEN
    RAISE EXCEPTION 'stg_seinfra nao tem composicao valida para backfill de %.', p_ref_label;
  END IF;
  n_comp := rt__comp_seinfra(v_ord);
  IF p_limpar_stg THEN TRUNCATE stg_seinfra; END IF;
  RETURN jsonb_build_object('fonte','SEINFRA','referencia',p_ref_label,'ord',v_ord,'composicoes_linhas',n_comp,'obs','backfill analitica');
END $fn$;

REVOKE ALL ON FUNCTION rt_aplicar_composicao_sinapi(text,boolean)  FROM public;
REVOKE ALL ON FUNCTION rt_aplicar_composicao_seinfra(text,boolean) FROM public;
GRANT EXECUTE ON FUNCTION rt_aplicar_composicao_sinapi(text,boolean)  TO service_role;
GRANT EXECUTE ON FUNCTION rt_aplicar_composicao_seinfra(text,boolean) TO service_role;
