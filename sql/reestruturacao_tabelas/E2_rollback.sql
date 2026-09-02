-- Rollback da E2 / E2b..E2e — remove funções e área de recebimento.
-- NÃO afeta as tabelas *_itens atuais. Se quiser desfazer também os DADOS migrados na E3,
-- rode antes:  TRUNCATE <tabelas novas de dados>; DELETE FROM referencia_carregada;
BEGIN;

DROP FUNCTION IF EXISTS rt_migrar_sinapi_legado();
DROP FUNCTION IF EXISTS rt_migrar_orse_legado();
DROP FUNCTION IF EXISTS rt_migrar_seinfra_legado();
DROP FUNCTION IF EXISTS rt_aplicar_composicao_sinapi(text, boolean);
DROP FUNCTION IF EXISTS rt_aplicar_composicao_seinfra(text, boolean);
DROP FUNCTION IF EXISTS rt_aplicar_sinapi(text, boolean);
DROP FUNCTION IF EXISTS rt_aplicar_orse(text, boolean);
DROP FUNCTION IF EXISTS rt_aplicar_seinfra(text, boolean);
DROP FUNCTION IF EXISTS rt__comp_sinapi(int);
DROP FUNCTION IF EXISTS rt__comp_seinfra(int);
DROP FUNCTION IF EXISTS rt_comp_canon(jsonb);
DROP FUNCTION IF EXISTS rt_pick_desc(text);
DROP FUNCTION IF EXISTS rt_tok(text, numeric, text, text);
DROP FUNCTION IF EXISTS rt_ord_de_data(date);
DROP FUNCTION IF EXISTS rt_norm_encargo(text);

DROP TABLE IF EXISTS public.stg_sinapi, public.stg_orse, public.stg_seinfra;

COMMIT;
