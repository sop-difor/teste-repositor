-- Rollback da E1 — remove as tabelas novas (só faz sentido enquanto estão vazias).
-- NÃO afeta sinapi_itens / orse_itens / seinfra_itens (as tabelas atuais).
BEGIN;
DROP TABLE IF EXISTS
  public.sinapi_composicao, public.sinapi_preco, public.sinapi_descricao,
  public.sinapi_item_presenca, public.sinapi_item,
  public.orse_preco, public.orse_descricao, public.orse_item_presenca, public.orse_item,
  public.seinfra_composicao, public.seinfra_preco, public.seinfra_descricao,
  public.seinfra_item_presenca, public.seinfra_item,
  public.referencia_carregada
CASCADE;
COMMIT;
