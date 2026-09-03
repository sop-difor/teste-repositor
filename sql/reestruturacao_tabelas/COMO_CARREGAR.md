# Alimentar o banco — SINAPI / ORSE / SEINFRA

O sistema lê **views** (`sinapi_itens`, `orse_itens`, `seinfra_itens`) montadas sobre um
modelo enxuto. Para adicionar um mês/versão novo:

1. Gerar um **CSV** no formato desta pasta (ver abaixo).
2. Jogar o CSV numa **área de recebimento** (`stg_sinapi` / `stg_orse` / `stg_seinfra`).
3. Rodar **um comando** que grava só o que mudou e limpa a área de recebimento.

Cada fonte tem sua pasta com o passo a passo:

| Pasta | O que tem |
|---|---|
| **`SINAPI/`** | Extrator que lê a planilha `.xlsx` da Caixa e gera o CSV, + script que sobe e carrega. |
| **`ORSE/`** | Passo a passo para carregar o CSV do ORSE (o CSV vem do seu programa). |
| **`SEINFRA/`** | Passo a passo para carregar o CSV da SEINFRA (idem). |
| `_migracao_inicial/` | Scripts da reestruturação de 2026-09 — **já aplicados**, só referência/rollback. |

---

## Formato do CSV (área de recebimento)

Cabeçalho + uma linha por item. Colunas por fonte:

| Fonte | Colunas |
|---|---|
| **SINAPI** | `identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia, composicao, origem_preco` |
| **ORSE** | `identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia` |
| **SEINFRA** | `identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia, composicao` |

- `identificacao`: `C` (composição/serviço) ou `I` (insumo).
- `tipo_encargo`: `onerada` ou `desonerada` (aceita `onerado`/`desonerado`/`não desonerada`
  e normaliza). ORSE: sempre `onerada`.
- `referencia`: SINAPI/ORSE = `AAAA-MM-01` (ex. `2026-07-01`); SEINFRA = número da
  tabela (ex. `29`).
- `composicao`: JSON (texto) do "abre" analítico. Formas aceitas:
  - array: `[{"codigo_item","descricao_item","tipo_item","coeficiente","unidade"}, ...]`
  - objeto: `{"itens":[{"codigo","descricao","tipo","coeficiente","unidade"}, ...]}`
  - insumo (`I`) ou item sem analítica: **vazio**.
- `origem_preco` (só SINAPI): `CE` / `SP` / vazio. O extrator do SINAPI já preenche.
- **Linhas sem preço** (nem CE nem SP): não coloque no CSV — o extrator do SINAPI já
  as descarta.
- **Preço igual em onerada e desonerada**: o banco grava **uma linha só** (`'ambas'`) e
  a fachada devolve os dois; você não precisa fazer nada, o CSV manda as duas linhas.

---

## Regras e travas

- **Ordem cronológica** — carregue do mês mais antigo para o mais novo. Um mês anterior a
  um já carregado dá erro (`carga fora de ordem`).
- **Sem repetir** — a mesma referência duas vezes dá erro (`referencia ... ja foi carregada`).
- Erro no meio → nada é gravado (transação volta atrás). Corrija e rode de novo.

---

## Conferir depois

No módulo **Tabelas** do sistema (escolher a versão, buscar, abrir uma composição) ou:

```sql
SELECT count(*) FROM sinapi_itens WHERE referencia = '2026-07-01';
SELECT referencia_label FROM referencia_carregada WHERE fonte='SINAPI' ORDER BY referencia_ord;
```

---

## Funções no banco

| Função | Para quê |
|---|---|
| `rt_aplicar_sinapi(ref)` / `rt_aplicar_orse(ref)` / `rt_aplicar_seinfra(ref)` | Carga completa de um mês a partir da `stg_*` |
| `rt_aplicar_composicao_sinapi(ref)` / `rt_aplicar_composicao_seinfra(ref)` | Completar só a analítica de um mês já carregado (sem mexer em preço/descrição) |

### Recomeçar do zero (uma fonte)

```sql
TRUNCATE sinapi_composicao, sinapi_preco, sinapi_descricao, sinapi_item_presenca, sinapi_item;
DELETE FROM referencia_carregada WHERE fonte='SINAPI';
TRUNCATE stg_sinapi;
-- depois recarregue mês a mês desde o 1º (troque 'sinapi' por 'orse' / 'seinfra' conforme a fonte)
```
