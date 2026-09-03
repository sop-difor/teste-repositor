# SINAPI — carga mensal

Formato do CSV e regras gerais: ver `../COMO_CARREGAR.md`.

## 1. Gerar o CSV a partir da planilha da Caixa

O extrator lê as abas **ISD, ICD, CSD, CCD, Analítico**, aplica a regra de preço
**CE → SP** (Ceará zerado → usa São Paulo, marcando `origem_preco = SP`), descarta o
que não tem preço em nenhum dos dois, e monta a coluna `composicao`.

**Dependência (uma vez):** `python -m pip install openpyxl`.

Três jeitos — escolha um:

| Como | O que fazer |
|---|---|
| **Arrastar** | Arraste o `SINAPI_Referência_AAAA_MM.xlsx` para cima de **`Gerar CSV SINAPI (arraste a planilha aqui).bat`**. |
| **Janela** | Dois cliques em **`gerar_stg_sinapi_janela.pyw`** → *Escolher planilha* → *Gerar CSV*. |
| **Terminal** | `python gerar_stg_sinapi.py "CAMINHO\SINAPI_Referência_2025_02.xlsx"` (o mês sai do nome; ou passe `2025-02` como 2º argumento). |

Saída: **`stg_sinapi_AAAA-MM.csv`** nesta pasta. Confira o resumo impresso
(itens, composições, quantos preços via SP, quantos descartados sem preço).

## 2. Subir o CSV e carregar

### Jeito recomendado (arquivo grande, ~25 MB)

Crie um **`db-url.local`** nesta pasta (ou na pasta acima) com a string de conexão do
banco — Supabase → Project Settings → Database → Connection string (modo *Session*, porta
5432), trocando `[YOUR-PASSWORD]` pela senha. Depois:

```
node subir_stg_sinapi.mjs "stg_sinapi_2025-02.csv"
```

Faz tudo: `TRUNCATE stg_sinapi` → `COPY` do CSV → `SELECT rt_aplicar_sinapi('2025-02-01')`
(a data sai do nome do arquivo) e imprime o resumo. `--so-carregar` para antes do
`rt_aplicar_sinapi`.

As dependências (`pg`) já estão em `../node_modules`.

### Alternativa (pela tela do Supabase)

`carga_sinapi_manual.sql` tem os comandos para colar no SQL Editor + os passos do
Table Editor. Pode engasgar com arquivo grande.

## Arquivos desta pasta

| Arquivo | O quê |
|---|---|
| `gerar_stg_sinapi.py` | Extrator: planilha `.xlsx` → `stg_sinapi_AAAA-MM.csv` |
| `Gerar CSV SINAPI (arraste a planilha aqui).bat` | Atalho: arrastar a planilha roda o extrator |
| `gerar_stg_sinapi_janela.pyw` | Atalho: janela para rodar o extrator sem terminal |
| `subir_stg_sinapi.mjs` | Sobe o CSV (`COPY`) e roda `rt_aplicar_sinapi` — precisa de `db-url.local` |
| `carga_sinapi_manual.sql` | Comandos SQL para carga manual pela tela do Supabase |
| `db-url.local` | (você cria) string de conexão do banco — **não versionado** |
| `stg_sinapi_*.csv` | (gerado) — **não versionado** |
