-- =====================================================================
-- E2 — Área de recebimento + funções de "grava só o que mudou"
-- Ver gecope/tabelas.md §4.7, §5, §10-D, §10-L.  Rollback: E2_rollback.sql
-- =====================================================================
-- Formato da área de recebimento (stg_*) = igual às *_itens de hoje (sem id).
-- É o que o programa de carga já produz. A transformação planilha -> esse formato
-- é responsabilidade do programa (documentada na E8).
--
-- Fluxo:  TRUNCATE stg_<fonte>;  (subir CSV)  SELECT rt_aplicar_<fonte>('<ref>');
--
-- prefixo rt_ = reestruturação de tabelas.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rt_norm_encargo(p text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE lower(btrim(coalesce(p,'')))
    WHEN 'onerada'        THEN 'onerada'
    WHEN 'onerado'        THEN 'onerada'
    WHEN 'desonerada'     THEN 'desonerada'
    WHEN 'desonerado'     THEN 'desonerada'
    WHEN 'não desonerada' THEN 'onerada'
    WHEN 'nao desonerada' THEN 'onerada'
    WHEN 'não desonerado' THEN 'onerada'
    WHEN 'nao desonerado' THEN 'onerada'
    ELSE lower(btrim(coalesce(p,'')))
  END
$$;

CREATE OR REPLACE FUNCTION rt_ord_de_data(d date) RETURNS int
LANGUAGE sql IMMUTABLE AS $$
  SELECT (extract(year FROM d)::int) * 100 + (extract(month FROM d)::int)
$$;

-- token de 1 elemento da composição, para a assinatura estrutural (§10-D):
-- ordem NÃO entra; coeficiente arredondado a 8 casas; categoria entra (SEINFRA).
CREATE OR REPLACE FUNCTION rt_tok(codigo_item text, coeficiente numeric, tipo_item text, categoria text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(codigo_item,'') || ':' ||
         coalesce(round(coeficiente, 8)::text,'') || ':' ||
         coalesce(tipo_item,'') || ':' ||
         coalesce(categoria,'')
$$;

-- ---------------------------------------------------------------------
-- Área de recebimento (uma por fonte). Admin-only (sem grant a anon).
-- ---------------------------------------------------------------------
CREATE TABLE public.stg_sinapi (
  identificacao  text,
  codigo         varchar(20),
  descricao      text,
  unidade        varchar(10),
  preco_unitario numeric,
  tipo_encargo   text,
  referencia     text,
  composicao     jsonb
);
CREATE TABLE public.stg_orse (
  identificacao  text,
  codigo         varchar(20),
  descricao      text,
  unidade        varchar(10),
  preco_unitario numeric,
  tipo_encargo   text,
  referencia     text
);
CREATE TABLE public.stg_seinfra (
  identificacao  text,
  codigo         varchar(20),
  descricao      text,
  unidade        varchar(10),
  preco_unitario numeric,
  tipo_encargo   text,
  referencia     text,
  composicao     jsonb
);

ALTER TABLE public.stg_sinapi  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stg_orse    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stg_seinfra ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.stg_sinapi, public.stg_orse, public.stg_seinfra FROM anon, authenticated;

CREATE INDEX stg_sinapi_codigo  ON public.stg_sinapi  (codigo);
CREATE INDEX stg_orse_codigo    ON public.stg_orse    (codigo);
CREATE INDEX stg_seinfra_codigo ON public.stg_seinfra (codigo);

COMMIT;

-- =====================================================================
-- Funções de aplicação de delta
-- =====================================================================

-- ------------------------- SINAPI ------------------------------------
CREATE OR REPLACE FUNCTION rt_aplicar_sinapi(p_ref_label text, p_limpar_stg boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fonte    text := 'SINAPI';
  v_ord      int  := rt_ord_de_data(p_ref_label::date);
  v_prev_ord int;
  n_item bigint; n_desc bigint; n_preco bigint; n_comp bigint; n_pres bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM referencia_carregada WHERE fonte=v_fonte AND referencia_ord=v_ord) THEN
    RAISE EXCEPTION 'Referencia % (ord %) da fonte % ja foi carregada.', p_ref_label, v_ord, v_fonte;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stg_sinapi) THEN
    RAISE EXCEPTION 'stg_sinapi esta vazia — suba o CSV antes de chamar rt_aplicar_sinapi.';
  END IF;

  INSERT INTO referencia_carregada (fonte, referencia_ord, referencia_label)
  VALUES (v_fonte, v_ord, p_ref_label);

  v_prev_ord := (SELECT max(referencia_ord) FROM referencia_carregada
                 WHERE fonte=v_fonte AND referencia_ord < v_ord);

  -- catálogo
  INSERT INTO sinapi_item (codigo, identificacao)
  SELECT DISTINCT codigo, upper(btrim(identificacao))
  FROM stg_sinapi
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n_item = ROW_COUNT;

  -- presença: estende intervalo de quem continuava; abre intervalo novo p/ o resto
  UPDATE sinapi_item_presenca p SET ref_ord_fim = v_ord
  WHERE v_prev_ord IS NOT NULL AND p.ref_ord_fim = v_prev_ord
    AND EXISTS (SELECT 1 FROM stg_sinapi s WHERE s.codigo = p.codigo);

  INSERT INTO sinapi_item_presenca (codigo, ref_ord_ini, ref_ord_fim)
  SELECT DISTINCT s.codigo, v_ord, v_ord
  FROM stg_sinapi s
  WHERE NOT EXISTS (SELECT 1 FROM sinapi_item_presenca p
                    WHERE p.codigo = s.codigo AND p.ref_ord_fim = v_ord)
  ON CONFLICT (codigo, ref_ord_ini) DO NOTHING;
  GET DIAGNOSTICS n_pres = ROW_COUNT;

  -- descrição: linha nova só na 1ª aparição ou quando muda vs. a vigente em v_ord
  INSERT INTO sinapi_descricao (codigo, vigente_desde_ord, descricao, unidade)
  SELECT s.codigo, v_ord, s.descricao, s.unidade
  FROM (
    SELECT codigo, max(descricao) AS descricao, max(unidade) AS unidade
    FROM stg_sinapi GROUP BY codigo
  ) s
  LEFT JOIN LATERAL (
    SELECT d.descricao, d.unidade, true AS achou
    FROM sinapi_descricao d
    WHERE d.codigo = s.codigo AND d.vigente_desde_ord <= v_ord
    ORDER BY d.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL
     OR (s.descricao, s.unidade) IS DISTINCT FROM (cur.descricao, cur.unidade)
  ON CONFLICT ON CONSTRAINT sinapi_descricao_pkey DO NOTHING;
  GET DIAGNOSTICS n_desc = ROW_COUNT;

  -- preço: por tipo_encargo; linha nova só na 1ª aparição ou quando muda
  INSERT INTO sinapi_preco (codigo, tipo_encargo, vigente_desde_ord, preco_unitario)
  SELECT s.codigo, s.tipo_encargo, v_ord, s.preco_unitario
  FROM (
    SELECT codigo, rt_norm_encargo(tipo_encargo) AS tipo_encargo, min(preco_unitario) AS preco_unitario
    FROM stg_sinapi GROUP BY codigo, rt_norm_encargo(tipo_encargo)
  ) s
  LEFT JOIN LATERAL (
    SELECT p.preco_unitario, true AS achou
    FROM sinapi_preco p
    WHERE p.codigo = s.codigo AND p.tipo_encargo = s.tipo_encargo AND p.vigente_desde_ord <= v_ord
    ORDER BY p.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL OR s.preco_unitario IS DISTINCT FROM cur.preco_unitario
  ON CONFLICT ON CONSTRAINT sinapi_preco_pkey DO NOTHING;
  GET DIAGNOSTICS n_preco = ROW_COUNT;

  -- composição: versão nova só quando a assinatura estrutural muda (§10-D).
  -- SINAPI: estrutura idêntica entre encargos (§1) -> pega 1 jsonb por código.
  WITH src AS (
    SELECT d.codigo,
           (e.ord)::smallint AS ordem,
           coalesce(nullif(e.el->>'codigo_item',''), nullif(e.el->>'codigo',''), '') AS codigo_item,
           e.el->>'tipo_item' AS tipo_item,
           e.el->>'categoria' AS categoria,
           (e.el->>'coeficiente')::numeric AS coeficiente
    FROM (
      SELECT DISTINCT ON (codigo) codigo, composicao
      FROM stg_sinapi
      WHERE composicao IS NOT NULL AND jsonb_typeof(composicao)='array'
            AND jsonb_array_length(composicao) > 0
      ORDER BY codigo, tipo_encargo
    ) d
    CROSS JOIN LATERAL jsonb_array_elements(d.composicao) WITH ORDINALITY AS e(el, ord)
  ),
  new_sig AS (
    SELECT codigo,
           md5(string_agg(rt_tok(codigo_item, coeficiente, tipo_item, categoria),
                          '|' ORDER BY codigo_item, coeficiente, tipo_item)) AS sig
    FROM src GROUP BY codigo
  ),
  cur_ver AS (
    SELECT codigo, max(vigente_desde_ord) AS vord
    FROM sinapi_composicao WHERE vigente_desde_ord <= v_ord GROUP BY codigo
  ),
  cur_sig AS (
    SELECT c.codigo,
           md5(string_agg(rt_tok(c.codigo_item, c.coeficiente, c.tipo_item, c.categoria),
                          '|' ORDER BY c.codigo_item, c.coeficiente, c.tipo_item)) AS sig
    FROM sinapi_composicao c
    JOIN cur_ver v ON v.codigo=c.codigo AND v.vord=c.vigente_desde_ord
    GROUP BY c.codigo
  ),
  mudou AS (
    SELECT n.codigo FROM new_sig n
    LEFT JOIN cur_sig cs ON cs.codigo=n.codigo
    WHERE n.sig IS DISTINCT FROM cs.sig
  ),
  ins AS (
    INSERT INTO sinapi_composicao (codigo, vigente_desde_ord, ordem, codigo_item, tipo_item, categoria, coeficiente)
    SELECT s.codigo, v_ord, s.ordem, s.codigo_item, s.tipo_item, s.categoria, s.coeficiente
    FROM src s JOIN mudou m ON m.codigo = s.codigo
    ON CONFLICT ON CONSTRAINT sinapi_composicao_pkey DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO n_comp FROM ins;

  IF p_limpar_stg THEN TRUNCATE stg_sinapi; END IF;

  RETURN jsonb_build_object(
    'fonte', v_fonte, 'referencia', p_ref_label, 'ord', v_ord,
    'itens_novos', n_item, 'presencas', n_pres,
    'descricoes', n_desc, 'precos', n_preco, 'composicoes_linhas', n_comp
  );
END $fn$;

-- ------------------------- ORSE (sem composição) --------------------
CREATE OR REPLACE FUNCTION rt_aplicar_orse(p_ref_label text, p_limpar_stg boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fonte    text := 'ORSE';
  v_ord      int  := rt_ord_de_data(p_ref_label::date);
  v_prev_ord int;
  n_item bigint; n_desc bigint; n_preco bigint; n_pres bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM referencia_carregada WHERE fonte=v_fonte AND referencia_ord=v_ord) THEN
    RAISE EXCEPTION 'Referencia % (ord %) da fonte % ja foi carregada.', p_ref_label, v_ord, v_fonte;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stg_orse) THEN
    RAISE EXCEPTION 'stg_orse esta vazia.';
  END IF;

  INSERT INTO referencia_carregada (fonte, referencia_ord, referencia_label)
  VALUES (v_fonte, v_ord, p_ref_label);
  v_prev_ord := (SELECT max(referencia_ord) FROM referencia_carregada
                 WHERE fonte=v_fonte AND referencia_ord < v_ord);

  INSERT INTO orse_item (codigo, identificacao)
  SELECT DISTINCT codigo, upper(btrim(identificacao)) FROM stg_orse
  ON CONFLICT (codigo) DO NOTHING;
  GET DIAGNOSTICS n_item = ROW_COUNT;

  UPDATE orse_item_presenca p SET ref_ord_fim = v_ord
  WHERE v_prev_ord IS NOT NULL AND p.ref_ord_fim = v_prev_ord
    AND EXISTS (SELECT 1 FROM stg_orse s WHERE s.codigo = p.codigo);
  INSERT INTO orse_item_presenca (codigo, ref_ord_ini, ref_ord_fim)
  SELECT DISTINCT s.codigo, v_ord, v_ord FROM stg_orse s
  WHERE NOT EXISTS (SELECT 1 FROM orse_item_presenca p WHERE p.codigo=s.codigo AND p.ref_ord_fim=v_ord)
  ON CONFLICT (codigo, ref_ord_ini) DO NOTHING;
  GET DIAGNOSTICS n_pres = ROW_COUNT;

  INSERT INTO orse_descricao (codigo, vigente_desde_ord, descricao, unidade)
  SELECT s.codigo, v_ord, s.descricao, s.unidade
  FROM (SELECT codigo, max(descricao) descricao, max(unidade) unidade FROM stg_orse GROUP BY codigo) s
  LEFT JOIN LATERAL (
    SELECT d.descricao, d.unidade, true achou FROM orse_descricao d
    WHERE d.codigo=s.codigo AND d.vigente_desde_ord <= v_ord
    ORDER BY d.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL OR (s.descricao,s.unidade) IS DISTINCT FROM (cur.descricao,cur.unidade)
  ON CONFLICT ON CONSTRAINT orse_descricao_pkey DO NOTHING;
  GET DIAGNOSTICS n_desc = ROW_COUNT;

  INSERT INTO orse_preco (codigo, tipo_encargo, vigente_desde_ord, preco_unitario)
  SELECT s.codigo, s.tipo_encargo, v_ord, s.preco_unitario
  FROM (SELECT codigo, rt_norm_encargo(tipo_encargo) tipo_encargo, min(preco_unitario) preco_unitario
        FROM stg_orse GROUP BY codigo, rt_norm_encargo(tipo_encargo)) s
  LEFT JOIN LATERAL (
    SELECT p.preco_unitario, true achou FROM orse_preco p
    WHERE p.codigo=s.codigo AND p.tipo_encargo=s.tipo_encargo AND p.vigente_desde_ord <= v_ord
    ORDER BY p.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL OR s.preco_unitario IS DISTINCT FROM cur.preco_unitario
  ON CONFLICT ON CONSTRAINT orse_preco_pkey DO NOTHING;
  GET DIAGNOSTICS n_preco = ROW_COUNT;

  IF p_limpar_stg THEN TRUNCATE stg_orse; END IF;
  RETURN jsonb_build_object('fonte',v_fonte,'referencia',p_ref_label,'ord',v_ord,
    'itens_novos',n_item,'presencas',n_pres,'descricoes',n_desc,'precos',n_preco);
END $fn$;

-- ------------------------- SEINFRA ---------------------------------
-- referência = número da tabela (texto). ord = esse número como int.
CREATE OR REPLACE FUNCTION rt_aplicar_seinfra(p_ref_label text, p_limpar_stg boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_fonte    text := 'SEINFRA';
  v_ord      int  := p_ref_label::int;
  v_prev_ord int;
  n_item bigint; n_desc bigint; n_preco bigint; n_comp bigint; n_pres bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM referencia_carregada WHERE fonte=v_fonte AND referencia_ord=v_ord) THEN
    RAISE EXCEPTION 'Referencia % da fonte % ja foi carregada.', p_ref_label, v_fonte;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM stg_seinfra) THEN
    RAISE EXCEPTION 'stg_seinfra esta vazia.';
  END IF;

  INSERT INTO referencia_carregada (fonte, referencia_ord, referencia_label)
  VALUES (v_fonte, v_ord, p_ref_label);
  v_prev_ord := (SELECT max(referencia_ord) FROM referencia_carregada
                 WHERE fonte=v_fonte AND referencia_ord < v_ord);

  INSERT INTO seinfra_item (codigo, identificacao)
  SELECT DISTINCT codigo, upper(btrim(identificacao)) FROM stg_seinfra
  ON CONFLICT (codigo) DO NOTHING;
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
  LEFT JOIN LATERAL (
    SELECT d.descricao, d.unidade, true achou FROM seinfra_descricao d
    WHERE d.codigo=s.codigo AND d.vigente_desde_ord <= v_ord
    ORDER BY d.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL OR (s.descricao,s.unidade) IS DISTINCT FROM (cur.descricao,cur.unidade)
  ON CONFLICT ON CONSTRAINT seinfra_descricao_pkey DO NOTHING;
  GET DIAGNOSTICS n_desc = ROW_COUNT;

  INSERT INTO seinfra_preco (codigo, tipo_encargo, vigente_desde_ord, preco_unitario)
  SELECT s.codigo, s.tipo_encargo, v_ord, s.preco_unitario
  FROM (SELECT codigo, rt_norm_encargo(tipo_encargo) tipo_encargo, min(preco_unitario) preco_unitario
        FROM stg_seinfra GROUP BY codigo, rt_norm_encargo(tipo_encargo)) s
  LEFT JOIN LATERAL (
    SELECT p.preco_unitario, true achou FROM seinfra_preco p
    WHERE p.codigo=s.codigo AND p.tipo_encargo=s.tipo_encargo AND p.vigente_desde_ord <= v_ord
    ORDER BY p.vigente_desde_ord DESC LIMIT 1
  ) cur ON true
  WHERE cur.achou IS NULL OR s.preco_unitario IS DISTINCT FROM cur.preco_unitario
  ON CONFLICT ON CONSTRAINT seinfra_preco_pkey DO NOTHING;
  GET DIAGNOSTICS n_preco = ROW_COUNT;

  -- composição SEINFRA: dimensão tipo_encargo (3/8850 pares diferem entre encargos, §1)
  WITH src AS (
    SELECT d.codigo, d.tipo_encargo,
           (e.ord)::smallint AS ordem,
           coalesce(nullif(e.el->>'codigo_item',''), nullif(e.el->>'codigo',''), '') AS codigo_item,
           e.el->>'tipo_item' AS tipo_item,
           e.el->>'categoria' AS categoria,
           (e.el->>'coeficiente')::numeric AS coeficiente
    FROM (
      SELECT DISTINCT ON (codigo, rt_norm_encargo(tipo_encargo))
             codigo, rt_norm_encargo(tipo_encargo) AS tipo_encargo, composicao
      FROM stg_seinfra
      WHERE composicao IS NOT NULL AND jsonb_typeof(composicao)='array'
            AND jsonb_array_length(composicao) > 0
      ORDER BY codigo, rt_norm_encargo(tipo_encargo)
    ) d
    CROSS JOIN LATERAL jsonb_array_elements(d.composicao) WITH ORDINALITY AS e(el, ord)
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
  SELECT count(*) INTO n_comp FROM ins;

  IF p_limpar_stg THEN TRUNCATE stg_seinfra; END IF;
  RETURN jsonb_build_object('fonte',v_fonte,'referencia',p_ref_label,'ord',v_ord,
    'itens_novos',n_item,'presencas',n_pres,'descricoes',n_desc,'precos',n_preco,'composicoes_linhas',n_comp);
END $fn$;

-- só service_role / postgres executam
REVOKE ALL ON FUNCTION rt_aplicar_sinapi(text,boolean)  FROM public;
REVOKE ALL ON FUNCTION rt_aplicar_orse(text,boolean)    FROM public;
REVOKE ALL ON FUNCTION rt_aplicar_seinfra(text,boolean) FROM public;
GRANT EXECUTE ON FUNCTION rt_aplicar_sinapi(text,boolean)  TO service_role;
GRANT EXECUTE ON FUNCTION rt_aplicar_orse(text,boolean)    TO service_role;
GRANT EXECUTE ON FUNCTION rt_aplicar_seinfra(text,boolean) TO service_role;

-- =====================================================================
-- Drivers da E3 — reprocessam o histórico a partir das *_itens atuais
-- =====================================================================
CREATE OR REPLACE FUNCTION rt_migrar_sinapi_legado()
RETURNS TABLE(referencia text, resumo jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE r date;
BEGIN
  FOR r IN SELECT DISTINCT s.referencia FROM sinapi_itens s ORDER BY 1 LOOP
    TRUNCATE stg_sinapi;
    INSERT INTO stg_sinapi (identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia, composicao)
    SELECT upper(btrim(identificacao)), codigo, descricao, unidade, preco_unitario,
           rt_norm_encargo(tipo_encargo), referencia::text, composicao
    FROM sinapi_itens WHERE referencia = r;
    referencia := to_char(r, 'YYYY-MM-DD');
    resumo := rt_aplicar_sinapi(referencia, p_limpar_stg => false);
    RETURN NEXT;
  END LOOP;
  TRUNCATE stg_sinapi;
END $fn$;

CREATE OR REPLACE FUNCTION rt_migrar_orse_legado()
RETURNS TABLE(referencia text, resumo jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE r date;
BEGIN
  FOR r IN SELECT DISTINCT o.referencia FROM orse_itens o ORDER BY 1 LOOP
    TRUNCATE stg_orse;
    INSERT INTO stg_orse (identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia)
    SELECT upper(btrim(identificacao)), codigo, descricao, unidade, preco_unitario,
           rt_norm_encargo(tipo_encargo), referencia::text
    FROM orse_itens WHERE referencia = r;
    referencia := to_char(r, 'YYYY-MM-DD');
    resumo := rt_aplicar_orse(referencia, p_limpar_stg => false);
    RETURN NEXT;
  END LOOP;
  TRUNCATE stg_orse;
END $fn$;

CREATE OR REPLACE FUNCTION rt_migrar_seinfra_legado()
RETURNS TABLE(referencia text, resumo jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $fn$
DECLARE r text;
BEGIN
  FOR r IN SELECT DISTINCT s.referencia FROM seinfra_itens s ORDER BY s.referencia::int LOOP
    TRUNCATE stg_seinfra;
    INSERT INTO stg_seinfra (identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia, composicao)
    SELECT upper(btrim(identificacao)), codigo, descricao, unidade, preco_unitario,
           rt_norm_encargo(tipo_encargo), referencia, composicao
    FROM seinfra_itens WHERE referencia = r;
    referencia := r;
    resumo := rt_aplicar_seinfra(referencia, p_limpar_stg => false);
    RETURN NEXT;
  END LOOP;
  TRUNCATE stg_seinfra;
END $fn$;

REVOKE ALL ON FUNCTION rt_migrar_sinapi_legado()  FROM public;
REVOKE ALL ON FUNCTION rt_migrar_orse_legado()    FROM public;
REVOKE ALL ON FUNCTION rt_migrar_seinfra_legado() FROM public;
