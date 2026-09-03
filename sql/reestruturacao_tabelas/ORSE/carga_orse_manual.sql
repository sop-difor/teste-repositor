-- ============================================================
-- Carga ORSE — comandos para o SQL Editor do Supabase
-- Troque a data '2026-07-01' pela referência que está carregando.
-- Ordem cronológica; não repita referência.
-- ============================================================

-- PASSO 1 — esvaziar a área de recebimento
TRUNCATE stg_orse;

-- PASSO 2 — (na tela) Table Editor -> stg_orse -> Import data from CSV

-- PASSO 3 — gravar o delta (limpa a stg_orse no fim)
SELECT rt_aplicar_orse('2026-07-01');

-- PASSO 4 — conferir
SELECT count(*) AS linhas_na_fachada FROM orse_itens WHERE referencia = '2026-07-01';
SELECT referencia_label FROM referencia_carregada WHERE fonte = 'ORSE' ORDER BY referencia_ord;

-- ------------------------------------------------------------
-- RECOMEÇAR O ORSE DO ZERO (se precisar)
-- ------------------------------------------------------------
-- TRUNCATE orse_preco, orse_descricao, orse_item_presenca, orse_item;
-- DELETE FROM referencia_carregada WHERE fonte='ORSE';
-- TRUNCATE stg_orse;
