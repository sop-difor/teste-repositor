# ORSE — carga mensal

Formato do CSV e regras gerais: ver `../COMO_CARREGAR.md`.

O CSV do ORSE vem do **seu programa** que lê a planilha do ORSE. Ele deve gerar as
colunas: `identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo,
referencia`. É a mesma planilha achatada de antes, **sem a coluna `id`** e **sem
composição** (ORSE não guarda o "abre" — a receita fica no link externo).

- `tipo_encargo`: sempre `onerada`.
- `referencia`: `AAAA-MM-01` (ex. `2026-07-01`).

## Carregar

1. **Supabase → SQL Editor:** `TRUNCATE stg_orse;`
2. **Supabase → Table Editor** → `stg_orse` → *Insert → Import data from CSV* → escolha o arquivo.
3. **SQL Editor:** `SELECT rt_aplicar_orse('2026-07-01');`
4. Confira: `SELECT count(*) FROM orse_itens WHERE referencia = '2026-07-01';`

Os comandos prontos estão em `carga_orse_manual.sql`.

> Ordem cronológica e sem repetir referência (ver `../COMO_CARREGAR.md`).

Se um dia quiser um extrator automático da planilha do ORSE (como o do SINAPI),
dá para montar aqui.
