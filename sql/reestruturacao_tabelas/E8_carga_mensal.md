# E8 — Como subir uma referência nova (carga mensal)

Depois da reestruturação, o sistema lê **views** (`sinapi_itens`, `orse_itens`,
`seinfra_itens`) montadas sobre um modelo enxuto. Para adicionar um mês novo você
**não** insere direto nessas tabelas — você despeja a planilha numa área de
recebimento e roda **um comando** que grava só o que mudou.

---

## 1. O que o seu programa deve gerar (CSV)

Um CSV com **cabeçalho**, uma linha por item, exatamente estas colunas:

| Fonte | Colunas do CSV |
|---|---|
| **SINAPI** | `identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia, composicao` |
| **ORSE** | `identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia` |
| **SEINFRA** | `identificacao, codigo, descricao, unidade, preco_unitario, tipo_encargo, referencia, composicao` |

Regras:

- `identificacao`: `C` (composição/serviço) ou `I` (insumo).
- `tipo_encargo`: `onerada` ou `desonerada` (o comando também aceita `onerado`/
  `desonerado`/`não desonerada` e normaliza). ORSE: sempre `onerada`.
- `referencia`: **SINAPI/ORSE** = data `AAAA-MM-01` (ex. `2026-07-01`);
  **SEINFRA** = número da tabela (ex. `29`).
- `composicao`: JSON (texto) — a composição analítica do item. Aceita as duas formas:
  - array: `[{"codigo_item","descricao_item","tipo_item","coeficiente","preco_unitario","unidade"}, ...]`
  - objeto: `{"itens":[{"codigo","descricao","tipo","coeficiente","preco_unitario","unidade"}, ...]}`
  - Insumo (linha `I`) ou item sem analítica: deixe **vazio**.
- É a mesma planilha achatada que o programa já produzia para as tabelas antigas —
  só **sem a coluna `id`**.

---

## 2. Subir o CSV na área de recebimento

No **Supabase Dashboard → Table Editor**:

1. Abra a tabela `stg_sinapi` (ou `stg_orse` / `stg_seinfra`).
2. Se tiver algo nela, **esvazie**: SQL Editor → `TRUNCATE stg_sinapi;`
3. Botão **Insert → Import data from CSV** → escolha o arquivo → **Import**.

---

## 3. Rodar o comando que grava só o delta

No **SQL Editor**:

```sql
SELECT rt_aplicar_sinapi('2026-07-01');   -- SINAPI: data AAAA-MM-01
-- ou
SELECT rt_aplicar_orse('2026-07-01');     -- ORSE: data AAAA-MM-01
-- ou
SELECT rt_aplicar_seinfra('29');          -- SEINFRA: número da tabela
```

O retorno mostra quantas linhas novas entraram em cada bloco, por exemplo:
`{"itens_novos": 12, "presencas": 12, "descricoes": 40, "precos": 8150, "composicoes_linhas": 320}`

O comando **limpa a `stg_*` sozinho** no fim.

### Regras e travas

- **Ordem cronológica:** carregue os meses do mais antigo para o mais novo. Tentar
  carregar um mês anterior a um já carregado dá erro (`carga fora de ordem`).
- **Sem repetir:** carregar a mesma referência duas vezes dá erro
  (`referencia ... ja foi carregada`).
- Se der erro no meio, nada é gravado (a transação inteira volta atrás). Corrija o
  CSV e rode de novo.

---

## 4. Conferir

- Módulo **Tabelas** do sistema: escolha a nova versão no dropdown, faça uma busca,
  abra uma composição.
- Ou no SQL Editor:
  ```sql
  SELECT count(*) FROM sinapi_itens WHERE referencia = '2026-07-01';
  SELECT * FROM referencia_carregada WHERE fonte='SINAPI' ORDER BY referencia_ord;
  ```

---

## 5. Completar a analítica de um mês antigo (opcional)

Alguns meses de 2025/2026 entraram só com a composição **sintética** (o item, sem o
"abre"). Quando você conseguir a analítica desse mês:

1. `TRUNCATE stg_sinapi;`
2. Importe um CSV **só com as linhas que têm `composicao`** daquele mês (mesmas
   colunas da seção 1).
3. Rode:
   ```sql
   SELECT rt_aplicar_composicao_sinapi('2026-02-01');   -- ou rt_aplicar_composicao_seinfra('27')
   ```
   Isso grava só a estrutura analítica naquela referência, sem mexer em preços/descrições.
   Rode **do mês mais antigo para o mais novo** se for completar vários.

---

## Referência rápida das funções

| Função | Para quê |
|---|---|
| `rt_aplicar_sinapi(ref)` / `rt_aplicar_orse(ref)` / `rt_aplicar_seinfra(ref)` | Carga mensal completa a partir da `stg_*` |
| `rt_aplicar_composicao_sinapi(ref)` / `rt_aplicar_composicao_seinfra(ref)` | Completar só a analítica de um mês já carregado |
| `rt_migrar_sinapi_legado()` etc. | (histórico — já usado na migração inicial; não usar de novo) |
