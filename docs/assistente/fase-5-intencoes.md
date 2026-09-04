# F5 — Expandir o motor de intenções (primeira leva)

**Objetivo:** cobrir mais perguntas comuns no caminho determinístico (rápido, sem custo,
sem depender da cota do Gemini), reduzindo o quanto o caminho LLM precisa ser acionado.

## Desvio do plano original — e por quê

O README previa esta fase "guiada pelo log" de uso real do piloto. **O piloto ainda não
começou** (é a F8) — `consultas_ia_log` tem pouquíssimos registros reais, não o suficiente
para apontar quais perguntas priorizar. Decisão do usuário: avançar mesmo assim, guiado
por **conhecimento de domínio** (perguntas óbvias que a própria equipe GECOPE já sabe que
vai fazer) em vez de esperar o log acumular. Por isso "primeira leva": não é a expansão
final de 20→40-60 prevista, é um passo guiado por outra fonte de sinal — uma segunda leva,
guiada pelo log de verdade, fica para depois que o piloto (F8) gerar uso real.

## O que muda

### `supabase/functions/gecope-assistant/motor_intencoes.ts`

**14 intenções novas** (de 20 para 34) + 1 padrão novo numa intenção existente:

| # | Intenção | Gatilho (exemplo) | Fonte |
|---|---|---|---|
| 26 | `total_obras_execucao` | "quantas obras estão em execução?" | conversão de `llm-01` |
| 27 | `total_processos_geral` | "quantos processos existem no total?" | conversão de `llm-07` |
| 28 | `total_aditivos_geral` | "quantos aditivos existem no total?" | conversão de `llm-03` |
| 29 | `tipos_aditivo_resumo` | "quais os tipos de aditivo e quantos de cada?" | conversão de `llm-15` |
| 30 | `aditivos_por_tipo` | "quantos aditivos são do tipo Reajuste de Preço?" | conversão de `llm-04/05/16` |
| 31 | `municipio_mais_contratos` | "qual o município com mais contratos?" | conversão de `llm-18` |
| 32 | `obras_sem_fiscal` | "quais obras não têm fiscal designado?" | **novo** — habilitado pela F4 (mesmo anti-join da view) |
| 33 | `contratos_vigencia_status` | "quantos contratos estão vigentes / com vigência vencida?" | **novo** |
| 34 | `total_distritos` | "quantos distritos operacionais diferentes existem?" | conversão de `llm-09` |
| 35 | `total_contratadas` | "quantas empresas contratadas diferentes existem?" | conversão de `llm-10` |
| 36 | `total_fichas_contrato` | "quantas fichas de contrato existem?" | conversão de `llm-08` |
| 37 | `total_medicoes` | "quantas medições foram registradas no total?" | conversão de `llm-06` |
| 38 | `valor_total_contratos` | "qual o valor total dos contratos?" | **novo** |
| 39 | `distrito_mais_contratos` | "qual distrito tem mais contratos?" | **novo** |
| — | `contratos_por_contratante` (existente) ganha padrão `/quantas?\s+obras?.*contratou/i` | "quantas obras a SOP contratou?" | conversão de `llm-13` |

**`TIPOS_ADITIVO`** (lista fixa, os 8 valores confirmados em `schema_dicionario.md`) +
**`encontrarTipoAditivo()`** — mesma lógica de "mais específico primeiro" de
`encontrarMencionado`, mas contra a lista fixa em vez de valores carregados do banco.

### Cuidado com colisão de regex (ordem = prioridade)

`tentarIntencao` testa os padrões na ordem do array e para na primeira intenção cujo
`executar` devolver não-nulo. Cada padrão novo foi desenhado para **não** casar
acidentalmente com perguntas que já tinham intenção própria (ex.: `total_processos_geral`
exige "processos" seguido **imediatamente** de "existem"/"há" — não casa com "processos
**de replanilhamento** temos em tramitação", que tem intenção própria). Verificado:
- Rodando o eval completo — nenhuma das intenções antigas regrediu.
- Rodando `tentarIntencao` diretamente contra as 10 perguntas de `llm_nao_sei`/`ambigua`
  do eval — nenhuma foi "sequestrada" por uma regra nova (deveriam continuar caindo no
  caminho LLM, sem intenção nenhuma batendo). Confirmado: as 10 continuam sem intenção.

## `docs/assistente/eval/casos.jsonl`

- **13 casos reclassificados** de `llm_dado`/`intencao_formato` para `intencao_exata`
  (agora respondidos pelo motor de regras, não pelo Gemini): `llm-01, 03, 04, 05, 06, 07,
  08, 09, 10, 13, 15, 16, 18`. `llm-18` também passou de `formato` (precisava conferência
  manual) para `contem` (valor determinístico e estável: FORTALEZA/48).
- **5 casos novos**: `int-19` (obras sem fiscal, 72), `int-20`/`int-21` (contratos
  vigentes/vencidos, 337/15), `int-22` (valor total dos contratos), `int-23` (distrito com
  mais contratos, RM Fortaleza/103).

## Como verificar a F5

| # | Verificação | Esperado | Resultado (04/09/2026) |
|---|---|---|---|
| A | `deno check motor_intencoes.ts index.ts` | compila | ✅ |
| B | `deno task eval` | `intencao_exata` ≥95%, `seguranca` 100% | ✅ **32/32 (100%) intenções, 8/8 (100%) segurança** |
| C | `tentarIntencao` direto contra as 10 perguntas `llm_nao_sei`/`ambigua` | nenhuma intenção bate | ✅ **10/10 sem intenção** (nenhum sequestro) |
| D | Valores conferidos contra produção antes de escrever o código (não depois) | bater | ✅ todos os 14 valores de referência vieram de SQL só-leitura rodada antes do código (ver commit) |

## Fora do escopo desta leva

- Chegar aos 40–60 previstos no README — ficou em 34 (+70% sobre as 20 originais).
  Registrar como aberto: uma segunda leva, guiada pelo log real do piloto (F8), fecha a
  diferença com as perguntas que a equipe realmente fizer.
- Cruzar processo↔obra por nome/número (`vw_assistente_processo_completo`/
  `vw_assistente_obra_completa` da F4) como intenção de regras — decisão desta leva:
  deixar para o caminho LLM usar essas views diretamente quando a F6 as citar no prompt,
  em vez de duplicar a lógica de busca em regex agora.
- Intenção parametrizada por gestor (`"quantos contratos o gestor X tem"`) — exigiria um
  novo cache de valores conhecidos (como `contratadas`/`contratantes`) só para nomes de
  gestor; adiado para não aumentar o escopo desta leva.
