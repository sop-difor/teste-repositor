-- ============================================================
-- Carga mensal SINAPI — comandos para colar no SQL Editor do Supabase
-- (Supabase Dashboard -> projeto SOP.DIFOR -> SQL Editor)
--
-- Troque a data '2025-01-01' pelo mês que está carregando.
-- Rode em ORDEM CRONOLÓGICA (2025-01, depois 2025-02, ...).
-- ============================================================

-- PASSO 2 — esvaziar a caixa de entrada antes de importar o CSV
TRUNCATE stg_sinapi;

-- PASSO 3 — (feito na tela: Table Editor -> stg_sinapi -> Import data from CSV)

-- PASSO 4 — gravar o delta no modelo definitivo (registra a referência,
--           grava só o que mudou e limpa a stg_sinapi no fim)
SELECT rt_aplicar_sinapi('2025-01-01');

-- PASSO 5 — conferências
SELECT count(*) AS linhas_na_fachada
FROM sinapi_itens
WHERE referencia = '2025-01-01';

SELECT referencia_label
FROM referencia_carregada
WHERE fonte = 'SINAPI'
ORDER BY referencia_ord;

-- ------------------------------------------------------------
-- REFAZER A SINAPI DO ZERO (se precisar recomeçar a carga)
-- ------------------------------------------------------------
-- TRUNCATE sinapi_composicao, sinapi_preco, sinapi_descricao, sinapi_item_presenca, sinapi_item;
-- DELETE FROM referencia_carregada WHERE fonte='SINAPI';
-- TRUNCATE stg_sinapi;
-- depois recarregue mês a mês desde o 1º.

-- Amostra de uma composição remontada (opcional):
-- SELECT codigo, tipo_encargo, preco_unitario, origem_preco, jsonb_pretty(composicao)
-- FROM sinapi_itens
-- WHERE codigo = '104658' AND referencia = '2025-01-01' AND tipo_encargo = 'onerada';
