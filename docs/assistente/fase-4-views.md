# F4 — Views largas para Q&A

**Objetivo:** dar ao caminho LLM (e, mais tarde, à F5, ao motor de intenções) uma visão
**pronta e sem JOIN** de obra + contrato + ficha financeira + fiscal + distrito — o Gemini
erra menos gerando `SELECT` de uma view larga do que compondo `JOIN`s entre 4 tabelas a
cada pergunta.

## Diagnóstico que motivou a fase

O `rev-correcao`, revisando a F3, tentou confirmar dois números do gabarito com um `JOIN`
manual entre `contratos_edificacao` e `aditivos_contrato`/`ficha_contrato` e bateu num
**fan-out clássico**: `id_contrato` não é a chave de `contratos_edificacao` (é
`id_obra`) — um mesmo `id_contrato` pode aparecer em até **14** linhas de
`contratos_edificacao` (obras diferentes do mesmo contrato guarda-chuva). Um `JOIN` ingênuo
multiplica linhas. Confirmei outras duas armadilhas de cardinalidade na mesma checagem:

| Junção | Cardinalidade | Risco |
|---|---|---|
| `contratos_edificacao.id_contrato` → `ficha_contrato.id_contrato` | **1:1** (máx. 1) | nenhum — `JOIN` direto é seguro |
| `contratos_edificacao.id_obra` → `comissao_fiscalizacao` (`tipo='Fiscal'`) | **1:até 2** (média 1,03) | `JOIN` direto duplica a obra quando há 2 fiscais |
| 72 obras não têm nenhum fiscal cadastrado | — | `INNER JOIN` apagaria essas obras da view |

O Gemini (ou um usuário compondo SQL à mão) tropeçaria exatamente nisso. A view absorve a
armadilha uma vez só, no lugar certo, em vez de cada pergunta correr o risco de novo.

## O que muda

### 1. Banco — duas views (o Claude aplica via Supabase MCP, com sua confirmação)

**Por que duas, não uma.** Pedido do usuário: incluir `processos` (o núcleo do trabalho —
processos de replanilhamento/aditivo em análise). Conferido antes de desenhar:
**352 dos 427 processos têm `codigo_obra` NULO** — não estão vinculados a nenhuma obra em
`contratos_edificacao` ainda (só 72 têm vínculo válido; 3 apontam para um `codigo_obra`
que não existe mais na tabela de obras). Colocar `processos` dentro da view de obra (via
`LEFT JOIN`) esconderia esses 352 processos de qualquer pergunta feita a partir da view de
obra. Solução: uma view por grão.

#### `vw_assistente_obra_completa` — uma linha por obra (`id_obra`)

`security_invoker` (mesmo padrão das 4 views existentes — roda com o privilégio de quem
consulta; `gecope_ia_readonly` já tem `GRANT SELECT` nas tabelas-fonte, só falta `GRANT`
na view).

| Origem | Colunas |
|---|---|
| `contratos_edificacao` | `id_obra`, `codigo_obra`, `id_contrato`, `nr_contrato_sop`, `descricao_obra`, `contratada`, `contratante`, `municipio`, `distrito_operacional`, `status_obra`, `status_contrato`, `valor_original`, `total_aditivo`, `valor_atual`, `prazo_execucao`, `dias_aditivado`, `dias_paralisado`, `data_assinatura`, `data_fim_previsto`, `data_fim_vigencia_contrato` |
| `ficha_contrato` (`LEFT JOIN` por `id_contrato` — 1:1, seguro) | `gestor_nome`, `total_medido`, `saldo_contrato`, `percentual_aditivo`, `percentual_total_medido`, `dias_a_vencer` |
| `comissao_fiscalizacao` (`tipo='Fiscal'`, agregado via `LATERAL` por `id_obra`) | `fiscais` (nomes, `string_agg` — nunca duplica a obra), `fiscais_matriculas` |
| `processos` (agregado via `LATERAL` por `codigo_obra`) | `processos_total`, `processos_em_tramitacao`, `processos_numeros` (lista) |

`LEFT JOIN`/`LATERAL` em tudo (nunca `INNER`) — obra sem ficha, sem fiscal ou sem processo
vinculado continua aparecendo, só com essas colunas em branco/zero. "Não tem fiscal
cadastrado" ou "nenhum processo vinculado ainda" é informação, não motivo para sumir da
lista.

**Fora desta view** (deliberado): `medicoes` — fan-out pior ainda (uma obra pode ter
dezenas de medições) e `ficha_contrato.total_medido` já dá o total sem precisar somar.

#### `vw_assistente_processo_completo` (nova) — uma linha por processo

Todas as colunas de negócio de `processos` (status, fiscal, analista, datas, valores de
acréscimo/supressão/repercussão fiscal × GECOPE, `em_tramitacao` calculado, `delta_reperc`
calculado) **+**, quando existir vínculo (`LEFT JOIN` por `codigo_obra`, direção seguro —
`codigo_obra` é único em `contratos_edificacao`, confirmado: 0 grupos duplicados), o
contexto da obra: `obra_descricao`, `obra_status`, `obra_nr_contrato_sop`,
`obra_valor_atual`. Exclui processos com `data_exclusao` preenchida (soft-delete) — a view
é para responder sobre processos válidos, não apagados.

### 2. Documentação

- `escopo-dados.md`: `vw_assistente_obra_completa` entra na lista de objetos no escopo.
- `schema_dicionario.md`: nova seção descrevendo a view e por que existe (o fan-out
  evitado).
- `schema_prompt.ts`: **não muda nesta fase** — citar a view no prompt do Gemini para ele
  preferi-la a `JOIN`s manuais é trabalho da F6 ("prompt com as views largas"). A F4
  entrega a view; a F6 ensina o modelo a usá-la.

## Como verificar a F4 — rodado ao vivo em 04/09/2026, todos OK

| # | Verificação | Esperado | Resultado |
|---|---|---|---|
| A | `select count(*) from vw_assistente_obra_completa` | = `contratos_edificacao` | **352 = 352** ✅ |
| B | `... where fiscais is null` | 72 | **72** ✅ |
| C | Obra com 2 fiscais | 1 linha, nomes combinados | **`06582025SEDUC01` → "FABIO PEREIRA BONFIM, HENRIQUE DIAS DA SILVA"** ✅ |
| D | Linhas por `id_contrato` (o de 14 obras) | 14, não 14×14 | **máx. 14 por `id_contrato` na view — igual à tabela-fonte, sem fan-out extra** ✅ |
| E | `gecope_ia_readonly` tem `SELECT` nas 2 views | `true`/`true` | **`has_table_privilege` = true nas duas** ✅ |
| F | `executar_consulta_ia('select count(*) from vw_assistente_obra_completa')` | 352, sem erro de guarda | **`{"n": 352}`** ✅ — view passa pelas guardas como qualquer tabela |
| G | `select count(*) from vw_assistente_processo_completo` | = `processos where data_exclusao is null` | **416 = 416** ✅ (11 dos 427 processos têm `data_exclusao` preenchida) |
| H | `... where obra_descricao is null` | ≈ 352 | **344** ✅ (dos 416 processos válidos, 344 sem `codigo_obra` vinculado) |
| J | Obras com `processos_total > 1` | 3 | **3** ✅ |

## Fora do escopo da F4 (fases futuras)

- Citar a view no prompt do Gemini / preferi-la a `JOIN`s manuais → **F6**.
- Views adicionais (ex.: uma central em `aditivos_contrato` com o mesmo cuidado de
  cardinalidade) → se o log do piloto (F5+) mostrar necessidade.
- Expandir o motor de intenções para usar a view → **F5**.
