# F2 — Núcleo determinístico

**Objetivo:** fazer o caminho LLM **executar** de forma confiável. Corrige o bug do
`LIMIT` duplicado, dá cadeia de fallback de modelo + retry/backoff, saneia a saída do
modelo e garante degradação amigável. Sem tocar na camada de segurança da F1.

## Diagnóstico (F0, confirmado ao vivo na F1)

`executar_consulta_ia` tem o guard `if sql_consulta !~* '\blimit\s+\d+' then sql_consulta
:= sql_consulta || ' limit 200'`. No regex do Postgres, **`\b` é o caractere backspace**,
não borda de palavra (`\y`) — o guard **nunca casa**, então `' limit 200'` era anexado
**sempre**. Como o `schema_prompt.ts` mandava "Sempre inclua LIMIT 200", o SQL virava
`... limit 200 limit 200` → `ERROR 42601: syntax error at or near "limit"`. Toda pergunta
do caminho LLM com LIMIT quebrava (a maioria).

## O que muda

### 1. Banco — `sql/assistente/f2_nucleo.sql` (o usuário aplica)

`CREATE OR REPLACE FUNCTION executar_consulta_ia` — as guardas de segurança da F1
reproduzidas **sem alteração**; muda só o núcleo:

| # | Mudança | Por quê |
|---|---|---|
| 1 | `\b` → `\y` no guard de `LIMIT` | agora **detecta** um `LIMIT` existente e não anexa outro |
| 2 | wrapper com `LIMIT 500` externo fixo: `select row_to_json(t) from (%s) t limit 500` | cap absoluto de linhas, qualquer que seja o `LIMIT` interno |
| 3 | aceita `with` (CTE) no início, além de `select` | o modelo às vezes usa CTE para agregações; blocklist + timeout contêm |
| 4 | `SET statement_timeout = '15s'` na função | consulta que trava (CTE recursiva, produto cartesiano) não segura a Edge Function |

Corpo base: a versão da F1 aplicada em produção em 03/09/2026.

### 2. Edge Function — `supabase/functions/gecope-assistant/`

- **`guards.ts` (novo)** — `validarSqlGeminiOuFalhar`, `limparSql`,
  `interpretarRespostaModelo`, `FUNCOES_OK` extraídos de `index.ts` para serem
  **testáveis** (o `index.ts` chama `Deno.serve` no load). `index.ts` importa de lá.
- **`guards_test.ts` (novo)** — `deno test`: 16 ataques barram, 10 consultas legítimas
  passam, `limparSql` e `interpretarRespostaModelo` cobertos.
- **`index.ts` — cadeia de fallback de modelo**:
  `GEMINI_MODELOS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"]`
  (IDs conferidos em ai.google.dev/gemini-api/docs/models, set/2026). `gerarSqlComGemini`
  percorre a cadeia: `503` → backoff `1200ms`, `2400ms`, 2 tentativas no mesmo modelo,
  depois próximo; `404`/`400` → próximo modelo direto; rede/`401`/`429`/`500` → próximo.
  Todos falharam → lança.
- **`index.ts` — saneamento**: `interpretarRespostaModelo` tolera cerca de markdown
  (```` ```json ````), SQL cru sem JSON, `;` final. `limparSql` remove cercas e `;`.
- **`index.ts` — degradação**: falha na cadeia de modelos, no `validarSqlGeminiOuFalhar`
  ou na execução → resposta `origem: "degradado"`, `200`, mensagem "Não consegui
  responder… tente reformular ou use uma sugestão." Logada `sucesso: false`,
  `origem: "gemini_degradado"`. Nunca erro cru, nunca número inventado.
- **`index.ts` — log**: o `catch` externo passa a gravar `origem: "erro"` (era `"gemini"`,
  enganoso) — só erro inesperado cai lá.
- **`schema_prompt.ts`**: "Sempre inclua LIMIT 200" → "**NÃO inclua LIMIT nem OFFSET** — o
  sistema aplica um limite automaticamente" (LIMIT só para "top N" explícito). Também
  cita `WITH ... SELECT` como forma válida.

### 3. Front-end — `assistente.html`

- Trata `origem: "degradado"` como `.aviso` (neutro, não vermelho). Os chips de sugestão
  já estão visíveis.

## Como verificar a F2

### Banco (bloco de verificação no fim do `.sql`)
| # | Verificação | Esperado |
|---|---|---|
| A1 | `executar_consulta_ia('select descricao_obra from contratos_edificacao limit 3')` | **3 linhas** (era `42601`) |
| A2 | `executar_consulta_ia('select codigo_obra from processos limit 1000')` | ≤ 500 (cap externo) |
| B | `executar_consulta_ia('select descricao_obra from contratos_edificacao')` (sem limit) | 200 linhas |
| C | `executar_consulta_ia` com `WITH x AS (…) SELECT …` | retorna linhas |
| D | `executar_consulta_ia('select schema_to_xml(''net'',true,false,'''')')` | ERRO "Função não permitida" (segurança F1 intacta) |
| E | `executar_consulta_ia` com CTE recursiva infinita | erro de timeout em ~15 s |

### Edge Function
| # | Verificação | Esperado |
|---|---|---|
| F | `deno test supabase/functions/gecope-assistant/guards_test.ts` | todos passam |
| G | `deno check supabase/functions/gecope-assistant/index.ts` | compila |
| H | `GET https://generativelanguage.googleapis.com/v1beta/models` com a `GEMINI_API_KEY` | os 3 IDs de `GEMINI_MODELOS` aparecem e suportam `generateContent` |
| I | pergunta livre real após deploy (ex.: "quantos contratos por distrito?") | responde com número real (não `42601`, não "Nenhum resultado") |
| J | derrubar o 1º modelo (ID inválido temporário) | cai no 2º; resposta normal; log registra o fallback |
| K | pergunta impossível ("qual a cor favorita do fiscal?") | `origem: "degradado"` ou `precisaEsclarecimento`, mensagem amigável — nunca stack trace |

## Deploy

A F1 deixou o deploy da Edge Function pendente (para não deployar duas vezes). Após a F2
revisada e o `.sql` da F2 aplicado: **um** `supabase functions deploy gecope-assistant`
cobre F1+F2. Rollback = redeploy da v12 (código em git no `782e86c`).

## Fora do escopo da F2 (fases futuras)

- Harness de avaliação (40–60 perguntas + gabarito + metas) → **F3**.
- Views largas para Q&A → **F4**.
- Expandir o motor de intenções → **F5**.
- Prompt com as views largas, exibir SQL, marcar confiança → **F6**.
- Contadores "N resultado(s)" / "(10 primeiros de N)" honestos (FU-13, FU-35) → **F5/F6**.
- `WITH` no `validarSqlGeminiOuFalhar` já aceito (FU-28 resolvido aqui).
