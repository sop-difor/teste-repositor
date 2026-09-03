# Escopo de dados do Assistente — v1 (congelado na F0)

Este documento define **exatamente** quais objetos do banco o assistente enxerga no v1.
Nada fora desta lista pode ser lido pelo assistente — nem pelo motor de intenções, nem
pelo caminho LLM. Ampliar é decisão de v2.

Fonte de verdade do significado de cada coluna: [`schema_dicionario.md`](schema_dicionario.md).

## Dentro do escopo — 13 objetos (todos só-leitura)

Confirmados como `GRANT SELECT` para a role `gecope_ia_readonly` em 03/09/2026.

### Tabelas (9)

| Objeto | Papel |
|---|---|
| `processos` | Processos de **replanilhamento** — núcleo do trabalho da GECOPE |
| `contratos_edificacao` | Cadastro + financeiro de cada obra/contrato de edificação |
| `aditivos_contrato` | Cada linha = um aditivo contratual |
| `ficha_contrato` | Visão financeira consolidada por contrato |
| `medicoes` | Medições físico-financeiras por obra |
| `comissao_fiscalizacao` | Pessoas designadas para a comissão de fiscalização por obra |
| `checklist_documentacao_aditivo` | Checklist de documentos por processo |
| `curva_abc_versoes` | Versões da curva ABC vinculada a um processo |
| `curva_abc_itens` | Itens de cada versão da curva ABC |

### Views (4)

| Objeto | Papel |
|---|---|
| `vw_processos_financeiro` | Recorte financeiro de `processos` |
| `vw_gecope_revisao_anual` | Revisão consolidada por ano |
| `vw_gecope_revisao_consolidado` | Revisão consolidada geral |
| `vw_gecope_revisao_detalhe` | Detalhe por processo do impacto da revisão GECOPE |

### A acrescentar na F4 — views largas para Q&A

1–2 views desnormalizadas que já unem **contrato + obra + ficha + fiscal + distrito**, para
o caminho LLM não precisar acertar `JOIN`. Especificação e nomes na F4; entram nesta lista
e recebem `GRANT SELECT` para `gecope_ia_readonly` quando criadas.

## Fora do escopo — explicitamente proibido no v1

| Domínio / objeto | Por quê está fora |
|---|---|
| `metas`, histórico de metas, produtividade da análise fiscal | Módulo próprio; regras de negócio distintas; entra no v2 se o piloto pedir |
| `cronograma` e tabelas de cronograma | Idem |
| WhatsApp — `whatsapp_logs`, `whatsapp_jobs`, `config_whatsapp` | Operacional/integração; contém números de telefone; nada a ver com consulta de dados de obra |
| `app_users`, autenticação, aprovação de usuários | Dados de conta; sensível; nunca exposto ao assistente |
| Tabelas de auditoria / log (`consultas_ia_log` inclusive) | O assistente não responde sobre si mesmo nem sobre outros logs |
| Tabelas SINAPI / ORSE / SEINFRA (preços de referência) | Volume grande, modelo delta recém-reestruturado; v2 se houver demanda |
| Qualquer objeto **não** listado em "Dentro do escopo" | Regra geral: lista branca, não lista negra |

## Como o escopo é imposto (defesa em profundidade)

1. **Grant** — `gecope_ia_readonly` só tem `SELECT` nos 13 (+ futuras views largas). Uma
   consulta a qualquer outra tabela falha com "permission denied".
2. **Função** — `executar_consulta_ia` roda como essa role (`SECURITY DEFINER`), aceita só
   `SELECT`, uma instrução, injeta `LIMIT`.
3. **Edge Function** — valida o SQL do LLM antes de executar (só-`SELECT`, sem DDL/DML,
   instrução única).
4. **Prompt** — o dicionário injetado no LLM lista **apenas** estes objetos e manda não
   inventar colunas.

Qualquer proposta de ampliar o escopo passa por: atualizar este documento → `GRANT SELECT`
→ atualizar `schema_dicionario.md` e `schema_prompt.ts` → nova rodada dos 4 revisores.
