# Assistente de Dados do GECOPE — iniciativa de aperfeiçoamento

O **Assistente de Dados** deixa o usuário perguntar, em linguagem natural, sobre os dados
do GECOPE (contratos de edificação, processos de replanilhamento, aditivos, medições) e
responde de forma estruturada. Já existe um protótipo funcional; esta iniciativa o leva a
um estado utilizável por um piloto interno.

## Contrato com o usuário (fronteira explícita)

- **Motor de intenções** (regras escritas à mão, SQL fixo e parametrizado) cobre as
  perguntas mais comuns — rápido, sem custo, determinístico, testável. É o terreno firme.
- **Caminho LLM** atende o resto, **restrito a um conjunto curado de views**, sempre
  mostrando o SQL gerado e marcando a resposta como "gerada — confira". Tem **direito a
  falhar**: quando não consegue, degrada para "não consegui responder; tente uma destas
  perguntas", nunca um erro cru nem um número inventado.
- O LLM **nunca recebe linhas do banco** — apenas o dicionário de schema e a pergunta. O
  SQL é executado localmente por uma função só-leitura e o resultado é formatado sem
  segunda chamada de IA. Ver [`provedor-llm.md`](provedor-llm.md).

## Público do piloto

Equipe GECOPE + gestores de contrato (~10–20 pessoas que vivem nesses dados e percebem
uma resposta errada na hora). Não é liberação geral.

## Escopo de dados

Congelado para o v1 — ver [`escopo-dados.md`](escopo-dados.md). Ampliar é decisão de v2,
guiada pelo que os usuários realmente perguntarem.

## Processo — 9 fases, cada uma com veredito dos 4 revisores

Cada fase só libera a seguinte após os **4 revisores** (ver [`revisores.md`](revisores.md))
devolverem `APROVADO`. `BLOQUEADO` volta para correção na mesma fase. Duas rodadas de
`BLOQUEADO` na mesma fase escalam para o usuário decidir.

| # | Fase | Entrega | Sign-off do usuário |
|---|---|---|---|
| **F0** | Fundação | Código movido para `gecope/`, branch, escopo congelado, provedor/modelo decidido | — |
| **F1** | Blindagem de segurança | JWT real; `usuario` do JWT; `REVOKE EXECUTE … FROM anon, authenticated`; rate limit; revisão de grants; LGPD no log | **sim** |
| **F2** | Núcleo determinístico | Corrigir bug do `limit`; retry/backoff; fallback de modelo; sanitização; testes | — |
| **F3** | Harness de avaliação | 40–60 perguntas com gabarito à mão + script + metas | — |
| **F4** | Views largas para Q&A | 1–2 views desnormalizadas (contrato+obra+ficha+fiscal+distrito) | — |
| **F5** | Expandir motor de intenções | De 20 para ~40–60 perguntas, guiado pelo log | — |
| **F6** | LLM + prompt | `gerarSql()` isolado; prompt com as views largas; exibir SQL; marcar confiança; degradar para sugestões | — |
| **F7** | Feedback + observabilidade | 👍/👎 + campo veredito no log; painel de uso/falhas; rotina "falha → intenção ou caso de eval" | — |
| **F8** | Integração + piloto | `assistente.html` atrás da auth do GECOPE; liberar para o piloto | **sim** |

## Estado atual

| Fase | Situação |
|---|---|
| F0 | **concluída** — 4/4 revisores `APROVADO` ([`fase-0-revisao.md`](fase-0-revisao.md)) |
| F1 | **pronta para sign-off** — 4/4 `APROVADO` ([`fase-1-revisao.md`](fase-1-revisao.md)); aguarda o usuário aplicar o `.sql` + deploy + chamado Supabase |
| F2–F8 | não iniciadas |

## Diagnóstico que motivou a iniciativa (03/09/2026)

Primeiro dia de teste real: 1 usuário, 25 perguntas, 14 falhas (11 sucessos). Das 14
falhas: 3× HTTP 404, 4× HTTP 503, 6× erro `42601` da família `limit`, 1× `[object Object]`.

- Motor de intenções: **todas as perguntas do teste que bateram uma intenção foram
  respondidas corretamente**. É a parte sólida. (Hoje são 20 intenções definidas —
  `motor_intencoes.ts`; a F5 leva a ~40–60.)
- Caminho LLM: praticamente inoperante. Três causas independentes de falha (1–3) e uma
  falha isolada de tratamento de erro (4):
  1. Modelo `gemini-2.5-flash` **descontinuado** (HTTP 404, "no longer available to new
     users") — o código já foi alterado para outro ID, mas sem cadeia de fallback nem
     verificação.
  2. Free tier **sobrecarregada** (HTTP 503, "model is currently experiencing high
     demand").
  3. **Bug local — `LIMIT` duplicado.** `executar_consulta_ia` tenta anexar `' limit 200'`
     só quando o SQL ainda não tem `LIMIT`, mas o guard `!~* '\blimit\s+\d+'` **nunca
     casa**: no regex do Postgres (ARE), `\b` é o caractere *backspace* (0x08), não borda
     de palavra — borda de palavra é `\y`. Então `' limit 200'` é anexado **sempre**.
     Como `schema_prompt.ts` instrui o modelo a "sempre incluir `LIMIT 200`", o SQL vira
     `... limit 200 limit 200` → `syntax error at or near "limit"`. O strip de `;` final
     (`regexp_replace(trim(...), ';\s*$', '')`) **funciona** e não é o gatilho. Causa
     dominante das falhas de execução — **corrigir na F2** atacando a raiz (`\b`→`\y`, ou
     remover `LIMIT` pré-existente antes de anexar, ou parar de instruir o modelo a
     incluir `LIMIT`, ou de-duplicar), não a limpeza de `;`.
  4. Um registro com `erro = "[object Object]"` no log (12:45) — serialização de erro
     falhou uma vez apesar de `paraTextoSeguro`. Verificar na F2/F6 se chega ao usuário.
- Segurança: `executar_consulta_ia` tem `EXECUTE` para `anon` e `authenticated` —
  qualquer pessoa com a anon key pública (está em `config.js`) roda `SELECT` arbitrário
  nas 13 tabelas via `/rest/v1/rpc/`, sem passar pela Edge Function. `usuario` vem do
  corpo da requisição (falsificável). A página não está integrada nem autenticada.

## Arquivos

| Caminho | O quê |
|---|---|
| `assistente.html` | Front-end do assistente (raiz do GECOPE) |
| `supabase/functions/gecope-assistant/index.ts` | Edge Function — orquestra intenções + LLM + log |
| `supabase/functions/gecope-assistant/motor_intencoes.ts` | Motor de intenções (regras) |
| `supabase/functions/gecope-assistant/schema_prompt.ts` | Dicionário condensado de schema, injetado no prompt do LLM |
| `docs/assistente/schema_dicionario.md` | Dicionário completo de schema (documentação legível) |
| `docs/assistente/*` | Planos, escopo, config de revisores, vereditos por fase |

Infra no Supabase (projeto `qexdnxqmiaarzwwwrcor` — produção):
- Role `gecope_ia_readonly` — `SELECT` em 13 objetos do domínio, sem `LOGIN`.
- Função `executar_consulta_ia(text)` — `SECURITY DEFINER` como `gecope_ia_readonly`,
  valida só-`SELECT`, instrução única, injeta `LIMIT`.
- Tabela `consultas_ia_log` — registro de toda pergunta (origem, sucesso, erro, linhas).
