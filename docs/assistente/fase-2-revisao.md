# F2 — Núcleo determinístico · Revisão

4 lentes, subagentes independentes, contexto limpo, sobre o commit `a9c413a`.

## Vereditos

| Lente | Rodada 1 |
|---|---|
| `rev-correcao` | **APROVADO** — bug do LIMIT verificado resolvido ao vivo (`limit 3` → 3 linhas; sem limit → 200; `limit 1000` → cap 500; CTE ok; `statement_timeout` dispara). guards.ts: 16 ataques barram, 10 legítimas passam. |
| `rev-seguranca` | **APROVADO** — corpo F1×F2 comparado guarda a guarda: todas byte-idênticas exceto as 4 mudanças documentadas. Ataques via `WITH` barram; CTE recursiva DoS mitigada por `LIMIT 500` + `statement_timeout`. Sem vazamento na degradação. |
| `rev-produto` | **APROVADO** — degradação renderiza `.aviso` (neutro), chips visíveis, próximo passo acionável. Fim do balão vermelho para toda pergunta livre com LIMIT. |
| `rev-aderencia` | **APROVADO** — `guards.ts` no padrão de módulo do `motor_intencoes.ts`; `jsr:` consistente; listas `funcoes_ok`/`FUNCOES_OK` sem drift; commit só toca arquivos do assistente. |

**F2: 4/4 APROVADO.** Follow-ups incorporados no commit `<pós-revisão>`.

## Follow-ups incorporados

| # | Origem | Item | Resolução |
|---|---|---|---|
| FU-60 | rev-produto | `formatarResultado` diz "N resultado(s)" quando N é o cap (200/500) — enganoso | cabeçalho "Mais de N resultados (limite do sistema — refine…)" quando N ∈ {200, 500} |
| FU-61 | rev-produto | Duas aberturas de degradação + palavra "segurança" (errada quando é 503/rede) | `MSG_DEGRADADO` única, sem "segurança" |
| FU-62 | rev-produto | `fetch` ao Gemini sem timeout; cadeia de 3 modelos pode pendurar | `AbortController` 9s/requisição + `prazoFinal` ~24s no caminho todo |
| FU-63 | rev-produto | `insert` do log dentro do `catch` de degradação pode lançar → cai no erro vermelho | todos os `insert` via `logSeguro` (try/catch, best-effort) |
| FU-64 | rev-seguranca | `merge`/`call` fora do blocklist de comandos | acrescentados nas duas camadas (`f2_nucleo.sql` + `guards.ts`) |
| FU-65 | rev-seguranca | token `'with'` em `funcoes_ok` é morto | removido das duas listas |
| FU-66 | rev-aderencia | Duas versões do corpo de `executar_consulta_ia` no git, sem marcador de qual vale | `sql/assistente/LEIA-ME.md` novo + banner "SUPERSEDED" no `f1_seguranca.sql` + nota no cabeçalho do `f2` |
| FU-67 | rev-aderencia | `f2_nucleo.sql` sem bloco `ROLLBACK` | acrescentado |
| FU-68 | rev-aderencia | Cross-ref SQL↔TS só num sentido | linha no `.sql` perto de `funcoes_ok` apontando para `guards.ts`; LEIA-ME cita o espelhamento |
| FU-69 | rev-aderencia | `assert` não usado em `guards_test.ts` | removido do import |
| FU-70 | rev-correcao / rev-aderencia | verificação E do doc imprecisa (CTE recursiva com LIMIT é curto-circuitada, não dá timeout) | E reescrita com `select count(*) from r` |
| FU-71 | rev-correcao | doc dizia "só mudou `^select`" no guard JS — também `merge/call` e `-'with'` | doc corrigido |
| FU-72 | rev-correcao | comentário/doc do backoff prometia "1200/2400ms"; código só dorme 1200ms 1× | retry reestruturado (1×1000ms) + comentário/doc alinhados |

## Follow-ups para fases futuras

| # | Item | Fase |
|---|---|---|
| FU-73 | Sem `deno.json`/task/CI para `deno test`; `guards_test.ts` é peso morto no bundle deployado | fase futura — `supabase/functions/deno.json` com task de teste |
| FU-74 | `tipo: "fora_do_escopo"` renderiza como "análise gerada" (badge) | F5/F6 (FU-35 — vocabulário de badge) |
| FU-75 | CTE com lista de colunas (`WITH cte(a,b) AS …`) barrada pela allowlist | F5/F6 se o prompt sugerir CTEs |
| FU-76 | `schema_prompt` "NÃO inclua LIMIT" pode devolver 200 linhas quando o gestor queria um resumo — depende do modelo escolher `COUNT`/`GROUP BY` | F6 (prompt) + F5 (intenções de resumo) |
| FU-77 | Verificação H (bater no `/models` com a `GEMINI_API_KEY`) — pós-deploy | ao fazer o deploy F1+F2 |
| FU-78 | Lente rev-produto: honestidade de truncamento, latência percebida/teto, uma só voz de "não deu", vocabulário de badge | anexar na abertura da F5 (já em FU-35) |

## Situação

**F2 pronta**. Falta: usuário aplica `sql/assistente/f2_nucleo.sql` em produção +
autoriza **um** `supabase functions deploy gecope-assistant` (cobre F1+F2). Depois: F3.
