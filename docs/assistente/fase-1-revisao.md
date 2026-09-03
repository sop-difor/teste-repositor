# F1 — Blindagem de segurança · Revisão

Revisão pelas 4 lentes (ver [`revisores.md`](revisores.md)). Subagentes independentes,
contexto limpo, em paralelo. Instrução: **não aplicar DDL em produção** — verificar por
raciocínio + sondagens de leitura via Supabase MCP.

## Vereditos

| Lente | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-seguranca` | **BLOQUEADO** (bypass da guarda de schema) | _(re-submissão — commits `d0ae360` + `c0d37cd`)_ |
| `rev-correcao` | **APROVADO** (0 bloqueantes) | _(re-submissão — buraco G, commit `c0d37cd`)_ |
| `rev-produto` | **APROVADO** | — |
| `rev-aderencia` | **APROVADO** | — |

`rev-correcao` aprovou sem bloqueios, mas um dos seus follow-ups é grave o bastante para
virar item de fase: **buraco G** (a RLS bloqueia a role de leitura → o caminho LLM
devolve 0 linhas para tudo). Tratado na F1 (é configuração de acesso); re-submetido às
duas lentes.

## Achado bloqueante (rev-seguranca, rodada 1) — CORRIGIDO

**Buraco C fechado só na aparência.** A guarda de schema (`\y(net|cron|…)\s*\.`), idêntica
na função e no validador da Edge (então falham juntas, não é defesa em profundidade), é
contornável — testado ao vivo:

| Entrada | Antes |
|---|---|
| `select * from "net"."_http_response"` (aspas) | **passava** |
| `select 1 from net/**/._http_response` (comentário) | **passava** |
| `select ... from pg_roles` (catálogo não-qualificado) | **passava** |

E `gecope_ia_readonly` continua com `USAGE` em `net` + `SELECT` em `net._http_response`
(que guarda corpos/headers de respostas HTTP de saída do `pg_net` — pode conter tokens).
A afirmação do doc de que "a guarda da função já contém sem o `REVOKE`" era **falsa**.

**Correção aplicada:**

1. **Normalização antes das checagens** — a função e o `validarSqlGeminiOuFalhar` removem
   comentários (`/* */`, `--`) e aspas de identificador (`"`) e só então aplicam os regex.
   Mata os bypasses por aspas e por comentário.
2. **Bloqueio de qualquer `pg_*`** (qualificado ou não) — `pg_roles`, `pg_stat_activity`,
   `pg_read_file`, `pg_sleep`, etc.
3. **Bloqueio de `dblink` / `current_setting` / `set_config` / `lo_import` / `lo_export`.**
4. **`REVOKE USAGE ON SCHEMA net FROM PUBLIC`** entra na migração, rodando por padrão num
   bloco que não aborta se falhar. O SQL Editor roda como `postgres`, que **não** é
   superuser nem membro de `supabase_admin` (concedente do grant a `PUBLIC`) — confirmado
   via `pg_auth_members` — então provavelmente falha, com `RAISE NOTICE`. Se falhar, a
   guarda normalizada (itens 1–3) é a contenção; para fechar na origem, chamado no
   suporte Supabase. `pg_stat_statements`/`cron` saíram da migração: `gecope_ia_readonly`
   não tem `USAGE` nesses schemas (não alcançáveis).

Verificações novas no `fase-1-seguranca.md` "Como verificar" (5b–5e, 10b, 12).

## Buraco G (rev-correcao, follow-up promovido a item de fase) — CORRIGIDO

`executar_consulta_ia` roda como `gecope_ia_readonly`. As 9 tabelas do escopo têm RLS com
policies só para `anon`/`authenticated` — nenhuma para essa role. Provado ao vivo: a role
lê **0 linhas** em 12 dos 13 objetos (`processos` 427→0, `contratos_edificacao` 352→0,
`medicoes` 2944→0, …; as 4 views `security_invoker` herdam o bloqueio). Sem isto o caminho
LLM responde "Nenhum resultado" para tudo — o item 6 do "Como verificar" (v1) passava com
0, checagem fraca.

**Correção (F1):** 9 policies `PERMISSIVE FOR SELECT TO gecope_ia_readonly USING (true)`,
uma por tabela-base, em laço idempotente no `f1_seguranca.sql`. Rejeitada a alternativa
`ALTER ROLE ... BYPASSRLS` (atributo amplo, menos auditável). Verificações 3, 3b e 6/6b do
doc reforçadas para exigir contagem real (> 0).

## Follow-ups

### rev-seguranca

| # | Item | Resolução |
|---|---|---|
| FU-26 | `consultas_ia_log` — `anon`/`authenticated` tinham `GRANT` de tabela; só a RLS (sem `FORCE`) protegia o texto das perguntas (LGPD) | **Feito na F1**: `REVOKE ALL ... FROM anon, authenticated` + `ALTER TABLE ... FORCE ROW LEVEL SECURITY` no `.sql` |
| FU-27 | Rate limit TOCTOU (conta antes do insert; rajada concorrente passa) + fail-open em erro de query | Registrado como dívida; aceitável para piloto; doc explicita |
| FU-28 | `^select` rejeita CTE (`WITH x AS (…) SELECT …`) | Correção/robustez — **F2** (a camada de limit/validação será retrabalhada lá) |
| FU-29 | `revisores.md` lente 1: acrescentar "guardas por regex testadas contra identificador entre aspas e comentário SQL, não só a forma canônica" | **Feito**: item adicionado à lente 1 |
| FU-30 | `pg_stat_statements`/`cron` no `.sql` opcional eram no-op (sem `USAGE`) | Removidos do `.sql`; nota no doc |

### rev-produto

| # | Item | Resolução |
|---|---|---|
| FU-31 | Sessão que expira no meio / `401` → balão vermelho sem link, entrada segue habilitada | **Feito na F1**: `fecharPorSessao()` re-fecha a porta em token nulo no envio e em `401`/`origem:"sessao"`; mensagem única com link |
| FU-32 | Chips não desabilitados pela porta de sessão | **Feito**: `.chip-off` aplicado/removido junto com a entrada |
| FU-33 | "Flash" de UI funcional antes da porta fechar | **Feito**: entrada/botão/chips começam desabilitados; abrem só após confirmar sessão |
| FU-34 | 429 e mensagens de sessão renderizavam como `.erro` vermelho; tom do 429 | **Feito na F1**: estilo `.aviso` (neutro); 429 = "Limite de 40 perguntas por hora atingido. Aguarde alguns minutos e continue." |
| FU-35 | Lente rev-produto: para F2 checar contadores "N resultado(s)" após o fix do LIMIT; para F5/F6 "todo texto de parada com próximo passo acionável" e "vocabulário de badge compreensível" | Registrado para F2/F5/F6 (ainda não aplicado à `revisores.md` — anexar na abertura da F5) |

### rev-correcao

| # | Item | Resolução |
|---|---|---|
| FU-41 | **Buraco G** — RLS bloqueia a role de leitura (0 linhas em 12/13 objetos) | **Feito na F1**: 9 policies `PERMISSIVE FOR SELECT TO gecope_ia_readonly` (ver seção "Buraco G" acima) |
| FU-42 | Guarda de schema contornável por aspas/comentário; `pg_class` não-qualificado passa | **Feito** (mesmo que o bloqueante do rev-seguranca): normalização + bloqueio de `pg_*` sem exigir `.` |
| FU-43 | Drift entre a lista de schemas no `.sql` (`_analytics\|_realtime`) e no espelho JS | **Feito** no commit `d0ae360`: listas alinhadas |
| FU-44 | `\blimit` duplicado reproduzido ao vivo (`... limit 3 limit 200` → 42601) | **F2** — escopo declarado |
| FU-45 | `^select` rejeita CTE (`WITH ... SELECT`) | **F2** — quando a camada de validação for retrabalhada |
| FU-46 | Log grava `pergunta=""`, `origem:"gemini"` quando `req.json()` falha (ruído) | **F2** — cosmético |
| FU-47 | Rate limit TOCTOU + fail-open; item 6 do "Como verificar" passava com 0 (checagem fraca) | Registrado (piloto); "Como verificar" reforçado para exigir contagem > 0 |

### rev-aderencia

| # | Item | Resolução |
|---|---|---|
| FU-36 | Cabeçalho do `.sql` não dizia a origem do corpo-base da função | **Feito**: cabeçalho cita `pg_get_functiondef` em 2026-09-03 + lista os diffs intencionais |
| FU-37 | FU-17 ficou "a confirmar" sem default | **Feito**: `sql/assistente/` como pasta viva (modelo `sql/reestruturacao_tabelas/`), não mover para `_aplicados/` |
| FU-38 | `.sql` sem snippet de rollback | **Feito**: bloco `ROLLBACK` comentado no `.sql` |
| FU-39 | Tema (`gecope-tema`/`escuro`) e paleta (`--accent` vs `--sop-*`) divergentes | **F8** — a F1 já adicionou `config.js`/`database.js` ao `<head>`; a F8 soma `style.css` + troca chave/classe/valores |
| FU-40 | `f1_seguranca.sql` passa a ser a fonte de verdade do DDL de `executar_consulta_ia` (nunca versionado antes) | Reconhecido; cabeçalho do `.sql` documenta a linha de base |

## Confirmações das lentes que aprovaram

- **rev-produto**: caminho autenticado (intenção → Gemini → gráfico → esclarecimento)
  não regride; toda mensagem de parada nomeia a causa real (login / limite), não "defeito".
- **rev-aderencia**: auth = padrão `approve-user`; front = `fetchComTimeout` do
  `whatsapp.js`; `<head>` = `cronograma.html`; `.sql` no estilo de `sql/_aplicados/`
  (cabeçalho `-- ===`, `begin/commit`, verificação comentada); corpo da função idêntico à
  produção salvo os deltas intencionais; commit só toca arquivos do assistente;
  `git grep "eyJ" assistente.html` limpo.

## Situação

F1 **não liberada**. `rev-produto` e `rev-aderencia` aprovaram a rodada 1. `rev-correcao`
aprovou sem bloqueios (rodada 1) mas expôs o buraco G, agora corrigido. `rev-seguranca`
bloqueou (bypass da guarda), corrigido. Re-submissão de `rev-seguranca` **e** `rev-correcao`
sobre o commit da correção. Encerra com **sign-off do usuário** (aplica o SQL).
