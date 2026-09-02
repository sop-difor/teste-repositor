-- =====================================================================
-- E1 — Tabelas novas (VAZIAS) da reestruturação SEINFRA / SINAPI / ORSE
-- Ver gecope/tabelas.md §4.  NÃO altera nada existente.
-- Rollback: E1_rollback.sql
-- =====================================================================
-- Modelo por fonte:
--   <fonte>_item            catálogo (1 linha por código)
--   <fonte>_item_presenca   intervalos de referências em que o código existe
--   <fonte>_descricao       histórico de descrição/unidade (linha só quando muda)
--   <fonte>_preco           histórico de preço por tipo_encargo (linha só quando muda)
--   <fonte>_composicao      estrutura da receita (versão só quando muda) — SINAPI e SEINFRA
-- Comum:
--   referencia_carregada    referências já carregadas, por fonte
--
-- referencia_ord: inteiro monotônico. SINAPI/ORSE = AAAAMM (ex. 202512).
--                 SEINFRA = número da tabela (27, 28, ...).
-- tipo_encargo:   normalizado — só 'onerada' | 'desonerada'.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- Referências carregadas (comum às 3 fontes)
-- ---------------------------------------------------------------------
CREATE TABLE public.referencia_carregada (
  fonte            text        NOT NULL CHECK (fonte IN ('SINAPI','ORSE','SEINFRA')),
  referencia_ord   integer     NOT NULL,
  referencia_label text        NOT NULL,
  carregada_em     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referencia_carregada_pkey PRIMARY KEY (fonte, referencia_ord),
  CONSTRAINT referencia_carregada_label_uk UNIQUE (fonte, referencia_label)
);
COMMENT ON TABLE public.referencia_carregada IS
  'Reestruturação (tabelas.md §4.5): referências (mês/versão) já carregadas por fonte.';

-- =====================================================================
-- SINAPI
-- =====================================================================
CREATE TABLE public.sinapi_item (
  codigo        varchar(20) NOT NULL,
  identificacao char(1)     NOT NULL CHECK (identificacao IN ('C','I')),
  categoria     text,
  CONSTRAINT sinapi_item_pkey PRIMARY KEY (codigo)
);

CREATE TABLE public.sinapi_item_presenca (
  codigo      varchar(20) NOT NULL REFERENCES public.sinapi_item(codigo) ON DELETE CASCADE,
  ref_ord_ini integer     NOT NULL,
  ref_ord_fim integer     NOT NULL,
  CONSTRAINT sinapi_item_presenca_pkey PRIMARY KEY (codigo, ref_ord_ini),
  CONSTRAINT sinapi_item_presenca_ordem_ck CHECK (ref_ord_fim >= ref_ord_ini)
);

CREATE TABLE public.sinapi_descricao (
  codigo            varchar(20) NOT NULL REFERENCES public.sinapi_item(codigo) ON DELETE CASCADE,
  vigente_desde_ord integer     NOT NULL,
  descricao         text        NOT NULL,
  unidade           varchar(10),
  CONSTRAINT sinapi_descricao_pkey PRIMARY KEY (codigo, vigente_desde_ord)
);

CREATE TABLE public.sinapi_preco (
  codigo            varchar(20) NOT NULL REFERENCES public.sinapi_item(codigo) ON DELETE CASCADE,
  tipo_encargo      text        NOT NULL CHECK (tipo_encargo IN ('onerada','desonerada')),
  vigente_desde_ord integer     NOT NULL,
  preco_unitario    numeric,
  CONSTRAINT sinapi_preco_pkey PRIMARY KEY (codigo, tipo_encargo, vigente_desde_ord)
);

-- composicao: estrutura verificada IDÊNTICA entre onerada/desonerada na SINAPI
-- (tabelas.md §1) -> sem dimensão tipo_encargo aqui.
-- codigo_item (filho) NÃO tem FK: durante a migração pode ainda não existir no catálogo
-- (órfãos são sintetizados na E3 — tabelas.md §10-G).
CREATE TABLE public.sinapi_composicao (
  codigo            varchar(20) NOT NULL REFERENCES public.sinapi_item(codigo) ON DELETE CASCADE,
  vigente_desde_ord integer     NOT NULL,
  ordem             smallint    NOT NULL,
  codigo_item       varchar(20) NOT NULL,
  tipo_item         text,
  categoria         text,
  coeficiente       numeric,
  CONSTRAINT sinapi_composicao_pkey PRIMARY KEY (codigo, vigente_desde_ord, ordem)
);

-- =====================================================================
-- ORSE  (sem composição — tabelas.md decisão #11)
-- =====================================================================
CREATE TABLE public.orse_item (
  codigo        varchar(20) NOT NULL,
  identificacao char(1)     NOT NULL CHECK (identificacao IN ('C','I')),
  categoria     text,
  CONSTRAINT orse_item_pkey PRIMARY KEY (codigo)
);

CREATE TABLE public.orse_item_presenca (
  codigo      varchar(20) NOT NULL REFERENCES public.orse_item(codigo) ON DELETE CASCADE,
  ref_ord_ini integer     NOT NULL,
  ref_ord_fim integer     NOT NULL,
  CONSTRAINT orse_item_presenca_pkey PRIMARY KEY (codigo, ref_ord_ini),
  CONSTRAINT orse_item_presenca_ordem_ck CHECK (ref_ord_fim >= ref_ord_ini)
);

CREATE TABLE public.orse_descricao (
  codigo            varchar(20) NOT NULL REFERENCES public.orse_item(codigo) ON DELETE CASCADE,
  vigente_desde_ord integer     NOT NULL,
  descricao         text        NOT NULL,
  unidade           varchar(10),
  CONSTRAINT orse_descricao_pkey PRIMARY KEY (codigo, vigente_desde_ord)
);

CREATE TABLE public.orse_preco (
  codigo            varchar(20) NOT NULL REFERENCES public.orse_item(codigo) ON DELETE CASCADE,
  tipo_encargo      text        NOT NULL CHECK (tipo_encargo IN ('onerada','desonerada')),
  vigente_desde_ord integer     NOT NULL,
  preco_unitario    numeric,
  CONSTRAINT orse_preco_pkey PRIMARY KEY (codigo, tipo_encargo, vigente_desde_ord)
);

-- =====================================================================
-- SEINFRA
-- =====================================================================
CREATE TABLE public.seinfra_item (
  codigo        varchar(20) NOT NULL,
  identificacao char(1)     NOT NULL CHECK (identificacao IN ('C','I')),
  categoria     text,
  CONSTRAINT seinfra_item_pkey PRIMARY KEY (codigo)
);

CREATE TABLE public.seinfra_item_presenca (
  codigo      varchar(20) NOT NULL REFERENCES public.seinfra_item(codigo) ON DELETE CASCADE,
  ref_ord_ini integer     NOT NULL,
  ref_ord_fim integer     NOT NULL,
  CONSTRAINT seinfra_item_presenca_pkey PRIMARY KEY (codigo, ref_ord_ini),
  CONSTRAINT seinfra_item_presenca_ordem_ck CHECK (ref_ord_fim >= ref_ord_ini)
);

CREATE TABLE public.seinfra_descricao (
  codigo            varchar(20) NOT NULL REFERENCES public.seinfra_item(codigo) ON DELETE CASCADE,
  vigente_desde_ord integer     NOT NULL,
  descricao         text        NOT NULL,
  unidade           varchar(10),
  CONSTRAINT seinfra_descricao_pkey PRIMARY KEY (codigo, vigente_desde_ord)
);

CREATE TABLE public.seinfra_preco (
  codigo            varchar(20) NOT NULL REFERENCES public.seinfra_item(codigo) ON DELETE CASCADE,
  tipo_encargo      text        NOT NULL CHECK (tipo_encargo IN ('onerada','desonerada')),
  vigente_desde_ord integer     NOT NULL,
  preco_unitario    numeric,
  CONSTRAINT seinfra_preco_pkey PRIMARY KEY (codigo, tipo_encargo, vigente_desde_ord)
);

-- composicao SEINFRA: 3/8850 pares divergem entre encargos (tabelas.md §1)
-- -> mantém a dimensão tipo_encargo.
CREATE TABLE public.seinfra_composicao (
  codigo            varchar(20) NOT NULL REFERENCES public.seinfra_item(codigo) ON DELETE CASCADE,
  tipo_encargo      text        NOT NULL CHECK (tipo_encargo IN ('onerada','desonerada')),
  vigente_desde_ord integer     NOT NULL,
  ordem             smallint    NOT NULL,
  codigo_item       varchar(20) NOT NULL,
  tipo_item         text,
  categoria         text,
  coeficiente       numeric,
  CONSTRAINT seinfra_composicao_pkey PRIMARY KEY (codigo, tipo_encargo, vigente_desde_ord, ordem)
);

-- ---------------------------------------------------------------------
-- Índices (além das PKs)
--   trigram: alcança o .or('codigo.ilike.%t%,descricao.ilike.%t%') do front-end
--            através da fachada (tabelas.md §4.6 camada plana).
-- ---------------------------------------------------------------------
CREATE INDEX sinapi_item_codigo_trgm  ON public.sinapi_item      USING gin (codigo   gin_trgm_ops);
CREATE INDEX orse_item_codigo_trgm    ON public.orse_item        USING gin (codigo   gin_trgm_ops);
CREATE INDEX seinfra_item_codigo_trgm ON public.seinfra_item     USING gin (codigo   gin_trgm_ops);

CREATE INDEX sinapi_descricao_trgm    ON public.sinapi_descricao  USING gin (descricao gin_trgm_ops);
CREATE INDEX orse_descricao_trgm      ON public.orse_descricao    USING gin (descricao gin_trgm_ops);
CREATE INDEX seinfra_descricao_trgm   ON public.seinfra_descricao USING gin (descricao gin_trgm_ops);

CREATE INDEX sinapi_presenca_ord      ON public.sinapi_item_presenca  (ref_ord_ini, ref_ord_fim);
CREATE INDEX orse_presenca_ord        ON public.orse_item_presenca    (ref_ord_ini, ref_ord_fim);
CREATE INDEX seinfra_presenca_ord     ON public.seinfra_item_presenca (ref_ord_ini, ref_ord_fim);

-- ---------------------------------------------------------------------
-- RLS + grants: espelham as *_itens de hoje
--   (RLS ligado; 1 política SELECT p/ anon+authenticated USING true; sem escrita)
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'referencia_carregada',
    'sinapi_item','sinapi_item_presenca','sinapi_descricao','sinapi_preco','sinapi_composicao',
    'orse_item','orse_item_presenca','orse_descricao','orse_preco',
    'seinfra_item','seinfra_item_presenca','seinfra_descricao','seinfra_preco','seinfra_composicao'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true);',
      'Leitura pública ' || t, t);
    EXECUTE format('GRANT SELECT ON public.%I TO anon, authenticated;', t);
    -- addendum E1b (revisor S1): sem escrita para anon/authenticated na raiz
    -- (o padrão do Supabase concede tudo; RLS já bloqueava, isto remove de vez).
    EXECUTE format(
      'REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON public.%I FROM anon, authenticated;', t);
  END LOOP;
END $$;

COMMIT;
