-- ============================================================
-- Carga SEINFRA — comandos para o SQL Editor do Supabase
-- Troque '29' pelo número da tabela que está carregando.
-- Ordem crescente de número; não repita.
-- ============================================================

-- PASSO 1 — esvaziar a área de recebimento
TRUNCATE stg_seinfra;

-- PASSO 2 — (na tela) Table Editor -> stg_seinfra -> Import data from CSV

-- PASSO 3 — gravar o delta (limpa a stg_seinfra no fim)
SELECT rt_aplicar_seinfra('29');

-- PASSO 4 — conferir
SELECT count(*) AS linhas_na_fachada FROM seinfra_itens WHERE referencia = '29';
SELECT referencia_label FROM referencia_carregada WHERE fonte = 'SEINFRA' ORDER BY referencia_ord;

-- ------------------------------------------------------------
-- RECOMEÇAR A SEINFRA DO ZERO (se precisar)
-- ------------------------------------------------------------
-- TRUNCATE seinfra_composicao, seinfra_preco, seinfra_descricao, seinfra_item_presenca, seinfra_item;
-- DELETE FROM referencia_carregada WHERE fonte='SEINFRA';
-- TRUNCATE stg_seinfra;
