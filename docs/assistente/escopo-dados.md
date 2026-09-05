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

### Views (6)

| Objeto | Papel |
|---|---|
| `vw_processos_financeiro` | Recorte financeiro de `processos` |
| `vw_gecope_revisao_anual` | Revisão consolidada por ano |
| `vw_gecope_revisao_consolidado` | Revisão consolidada geral |
| `vw_gecope_revisao_detalhe` | Detalhe por processo do impacto da revisão GECOPE |
| `vw_assistente_obra_completa` (**F4**) | Uma linha por obra — contrato + ficha financeira + fiscal(is) + resumo de processos, sem `JOIN` manual (evita o fan-out de `id_contrato`/`comissao_fiscalizacao`) |
| `vw_assistente_processo_completo` (**F4**) | Uma linha por processo de replanilhamento — todos os campos de negócio + contexto da obra vinculada quando existir (a maioria ainda não tem) |

Definição completa em [`sql/assistente/f4_views.sql`](../../sql/assistente/f4_views.sql).

**Convenção de nome (F4)**: views criadas para o assistente usam o prefixo `vw_assistente_*`
— distinto de `vw_gecope_*` (domínio "revisão GECOPE × fiscal") e `vw_processos_financeiro`
(painel financeiro pré-existente, anterior ao assistente).

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

**Nota (rev-seguranca, F4)**: `information_schema.role_table_grants` mostra `anon` e
`authenticated` com `SELECT` (e mais) em qualquer view **nova** do schema `public` —
inclusive as duas da F4 — por causa de um `ALTER DEFAULT PRIVILEGES` já configurado no
banco, não por nada que este projeto concedeu. **O gate real não é esse `GRANT` de
catálogo — é a RLS das tabelas-fonte.** Testado ao vivo (`SET ROLE anon`): o resultado das
views novas para `anon` é idêntico ao de consultar as tabelas-fonte direto como `anon`
(RLS zera exatamente do mesmo jeito). Rodar `select ... from information_schema.role_table_grants
where grantee in ('anon','authenticated')` numa view e ver `SELECT` ali **não** significa
exposição — confirmar sempre com uma leitura real (`SET ROLE` + `SELECT`), não só o
catálogo de grants.

1. **Grant** — `gecope_ia_readonly` recebeu `GRANT SELECT` **direcionado** apenas nos 13
   objetos do domínio (+ futuras views largas). Uma consulta a qualquer outra tabela do
   schema `public` falha com "permission denied".

   **Ressalva conhecida (a fechar na F1):** além desses 13, a role ainda enxerga alguns
   objetos por `GRANT ... TO PUBLIC` de extensões — `net._http_response`,
   `net.http_request_queue` (podem conter `Authorization` de chamadas HTTP de saída),
   `extensions.pg_stat_statements` / `_info` (texto SQL de toda a atividade do banco),
   `cron.job` / `cron.job_run_details` (efetivamente vazias para a role por RLS). Como
   `executar_consulta_ia` roda como essa role e o validador só checa "é `SELECT`?", um
   `select * from net._http_response` gerado (ou induzido pelo texto da pergunta) passaria
   hoje. É estado de produção pré-existente, não algo aberto por este projeto. A F1
   trata: `REVOKE SELECT ON ... FROM PUBLIC` em `net.*`, `extensions.pg_stat_statements*`,
   `cron.*`, e — como rede de segurança — restringir o `search_path` / lista branca de
   schemas alcançáveis.
2. **Função** — `executar_consulta_ia` roda como essa role (`SECURITY DEFINER`), aceita só
   `SELECT`, uma instrução, injeta `LIMIT`.
3. **Edge Function** — valida o SQL do LLM antes de executar (só-`SELECT`, sem DDL/DML,
   instrução única).
4. **Prompt** — o dicionário injetado no LLM lista **apenas** estes objetos e manda não
   inventar colunas. **Não** é barreira de segurança (o texto da pergunta pode tentar
   induzir SQL fora do dicionário) — as camadas 1–3 é que contêm.

Qualquer proposta de ampliar o escopo passa por: atualizar este documento → `GRANT SELECT`
→ atualizar `schema_dicionario.md` e `schema_prompt.ts` → nova rodada dos 4 revisores.

## Dado pessoal e o log de perguntas (LGPD)

`consultas_ia_log` registra o **texto da pergunta**, que pode conter nome de fiscal,
analista ou outra pessoa. Controles (F1):

- RLS **on**; só o `service_role` escreve direto na tabela. Até a F6, também só ele lia.
  **A partir da F7**, a função `gecope-assistant-painel` (usa `service_role` por trás,
  exige sessão real do GECOPE) devolve o **texto** de pergunta/erro de qualquer usuário
  para qualquer pessoa autenticada, sem checar cargo — decisão consciente do usuário
  (`fase-7-feedback.md`, 05/09/2026; achado do rev-seguranca nessa revisão), a revisitar
  quando o piloto (F8) definir quem administra o assistente. Continua valendo: nenhum
  usuário/admin lê a tabela **direto** (sem passar pela Edge Function).
- `usuario` no log = e-mail da sessão, derivado do JWT (não do corpo da requisição).
- Retenção: purga de registros com mais de **180 dias** — job `pg_cron`
  (`gecope-assistente-purga-log`, diário às 3h), implementado na F7
  (`sql/assistente/f7_feedback.sql`).
- O texto da pergunta **é** enviado ao provedor LLM (junto do schema, nunca linhas do
  banco) — ver [`provedor-llm.md`](provedor-llm.md).
