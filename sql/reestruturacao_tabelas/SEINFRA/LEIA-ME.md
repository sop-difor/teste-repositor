# SEINFRA — carga de uma tabela nova

Formato do CSV e regras gerais: ver `../COMO_CARREGAR.md`.

O CSV da SEINFRA vem do **seu programa** que lê as planilhas da SEINFRA (Planos de
Serviços + Tabela de Insumos). Colunas: `identificacao, codigo, descricao, unidade,
preco_unitario, tipo_encargo, referencia, composicao`.

- `tipo_encargo`: `onerada` / `desonerada` (aceita `não desonerada` → vira `onerada`).
- `referencia`: **o número da tabela** (ex. `29`), não uma data.
- `composicao`: JSON do "abre" analítico (array), ou vazio para insumo / item sem analítica.

## Carregar

1. **Supabase → SQL Editor:** `TRUNCATE stg_seinfra;`
2. **Supabase → Table Editor** → `stg_seinfra` → *Insert → Import data from CSV*.
3. **SQL Editor:** `SELECT rt_aplicar_seinfra('29');`
4. Confira: `SELECT count(*) FROM seinfra_itens WHERE referencia = '29';`

Comandos prontos em `carga_seinfra_manual.sql`.

> Carregue as tabelas em ordem crescente de número; não repita.

Se um dia quiser um extrator automático das planilhas da SEINFRA (como o do SINAPI),
dá para montar aqui.
