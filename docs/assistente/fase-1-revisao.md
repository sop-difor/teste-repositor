# F1 — Blindagem de segurança · Revisão

Revisão pelas 4 lentes (ver [`revisores.md`](revisores.md)). Subagentes independentes,
contexto limpo, em paralelo. Instrução: **não aplicar DDL em produção** — verificar por
raciocínio + sondagens de leitura via Supabase MCP.

## Vereditos

| Lente | R1 | R2 | R3 | R4 |
|---|---|---|---|---|
| `rev-seguranca` | **BLOQUEADO** (aspas/comentário) | **BLOQUEADO** (normalização não é sã) | **BLOQUEADO** (`schema_to_xml('net',…)` — schema como string, sem ponto) | **APROVADO** — allowlist é sã; nenhum caminho ao conteúdo de `net._http_response`. Follow-ups (`::reg*`, niládicas, falso-positivo `date()`/`regexp_replace()`) incorporados no commit seguinte. |
| `rev-correcao` | **APROVADO** | **APROVADO** (buraco G verificado em prod) | **APROVADO** (rejeição comentário/aspas, 0 falso-positivo) | — (allowlist só endurece / remove falso-positivo) |
| `rev-produto` | **APROVADO** | — | — | — |
| `rev-aderencia` | **APROVADO** | — | — | — |

**3× BLOQUEADO do `rev-seguranca` na F1 → escalonado ao usuário** (regra em
`revisores.md` §6). Ver "Escalonamento" abaixo.

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

**Correção — 2 rodadas.**

**R1→R2 (`d0ae360`):** normalização (tira `/* */`, `--`, `"`) antes dos regex. O
`rev-seguranca` re-bloqueou: normalizar por regex **não é são** — `/*/**/*/` (comentário
aninhado, que o Postgres lê como um só) deixa um `*/` órfão, e `--` dentro de literal de
string (`where x = 'a--' union select … from net._http_response`) esconde o resto da
linha. Bypasses confirmados ao vivo.

**R2→R3 (rejeição de saída):** a função e o `validarSqlGeminiOuFalhar` **rejeitam** —
antes de qualquer outra checagem — todo SQL cujo texto contenha `--`, `/*`, `*/` ou `"`.
SQL analítico gerado pelo modelo não usa nenhum dos três; `schema_prompt.ts` passou a
proibir explicitamente. Testado ao vivo contra a lista completa de bypasses do
`rev-seguranca` (comentário simples e aninhado, `--` em literal, aspas) + 5 consultas
legítimas — todos os ataques barrados, zero falso-positivo.

**R3→R4 (allowlist de funções):** o `rev-seguranca` bloqueou de novo — mesmo com
comentário/aspas rejeitados, `schema_to_xml('net', true, false, '')` passa (o schema vai
como **literal de string**, sem ponto qualificador) e **retornou o conteúdo real de
`net._http_response`** ao vivo. Idem `database_to_xml`, `table_to_xml`, `query_to_xml`. É
a mesma classe da R2: "existe mais uma forma de nomear um schema" — agora como argumento
de função. Correção: a guarda passou de **blocklist** para **allowlist de chamadas de
função** (default-deny) — rejeita qualquer `nome(` que não esteja numa lista fixa de
funções analíticas seguras. Testado: 10 consultas legítimas passam; `schema_to_xml`,
`database_to_xml`, `table_to_xml`, `query_to_xml`, `dblink`, `current_setting`,
`pg_read_file`, `generate_series` barram.

Guardas finais (função + `validarSqlGeminiOuFalhar`), em ordem:
1. **Rejeita comentário (`--` `/*` `*/`) e aspas (`"`)** — sã, não parseia SQL.
2. **Rejeita schema fora de `public`** e **qualquer `pg_*`** (qualificado ou não).
3. **ALLOWLIST de funções** (default-deny) — a contenção sã que o blocklist não deu.

**`REVOKE USAGE ON SCHEMA net FROM PUBLIC` é provado impossível para nós.** Testei ao vivo
(com restore): `postgres` executa o `REVOKE` **sem erro**, mas é **no-op silencioso** — o
`nspacl` de `net` fica intacto (`=U/supabase_admin`; o concedente é `supabase_admin`, e
`postgres` não é superuser/membro/concedente) e a role continua lendo `net._http_response`.
Só um chamado ao suporte Supabase fecha na origem. A migração ainda tenta (no-op inofensivo)
e o chamado fica registrado; a contenção real é a allowlist.

Verificações novas no `fase-1-seguranca.md` "Como verificar" (5b–5h, 10b, 12).

## Escalonamento (3× BLOQUEADO do `rev-seguranca`)

Conforme `revisores.md` §6, a decisão vai ao usuário. Situação apresentada:
- a cada rodada o `rev-seguranca` achou **um** novo jeito de nomear/alcançar `net.*`
  (qualificado → aspas → comentário aninhado / `--` em literal → `schema_to_xml`);
- a correção sã (allowlist de funções, default-deny) fecha a **classe** inteira, não só
  o caso da vez;
- o fecho na origem (`REVOKE … FROM PUBLIC`) **não é executável por nós** — só via suporte
  Supabase, sem prazo/garantia;
- o dado em risco: artefatos de chamadas HTTP de saída do `pg_net` (`net._http_response`
  / `http_request_queue`) — checar se o `pg_net` do GECOPE carrega segredo.

Opções para o usuário: (a) aceitar a allowlist como contenção + abrir o chamado Supabase
em paralelo, seguir para F2; (b) travar a F1 até o chamado Supabase concluir; (c) pedir
mais uma rodada do `rev-seguranca` sobre a allowlist antes de decidir.

**Decisão do usuário (03/09/2026): (a)** — allowlist aceita como contenção; chamado ao
suporte Supabase aberto em paralelo (não bloqueante). E **(i)** para o buraco G: o piloto
(equipe GECOPE + gestores) aceita `USING (true)`; filtro por identidade fica para a F5.

**Rodada R4 (conferência) do `rev-seguranca`: APROVADO.** A allowlist é sã — nenhum
caminho ao **conteúdo** de `net._http_response` sobrevive. Follow-ups FU-55..59 (vazamento
só de metadados + falso-positivos) incorporados. **F1: 4/4 APROVADO — pronta para o
sign-off do usuário.**

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
| FU-29 | `revisores.md` lente 1: acrescentar "guardas por regex testadas contra identificador entre aspas e comentário SQL, não só a forma canônica" | **Feito**: item adicionado à lente 1 (R2: ampliar para "normalização tem de ser sã, ou rejeitar o token") |
| FU-30 | `pg_stat_statements`/`cron` no `.sql` opcional eram no-op (sem `USAGE`) | Removidos do `.sql`; nota no doc |
| FU-48 (R2) | Normalização por regex não é sã — comentário aninhado `/*/**/*/` e `--` em literal furam | **Feito (R3)**: guarda passou a **rejeitar de saída** `--`/`/*`/`*/`/`"`; `schema_prompt.ts` proíbe o modelo de gerá-los |
| FU-49 (R2) | Chamado ao suporte Supabase (`REVOKE … FROM PUBLIC` no `net`) deve ser **item de fase**, não comentário opcional | **Feito**: passo 3 da "Ordem de aplicação", marcado como não-opcional |
| FU-50 (R2) | Policy `USING (true)` do buraco G em `processos` dá a um "fiscal" do piloto visão de todos os processos (ignora `fiscal_matricula`) | **Registrado** em `fase-1-seguranca.md` §G — a confirmar no sign-off; filtro por identidade é F5 |
| FU-51 (R2) | `revisores.md` lente 1: trocar "testar contra" por "normalização sã (tokenizer-aware) OU rejeitar o token"; citar comentário aninhado e `--` em literal | **Feito**: lente 1 atualizada |
| FU-54 (R3) | `schema_to_xml('net',…)` / `database_to_xml` / `table_to_xml` / `query_to_xml` — schema como string, sem ponto → dumpava `net._http_response` | **Feito (R4)**: guarda virou **allowlist de funções** default-deny; essas e qualquer futura barram |
| FU-55 (R4) | Cast `::reg*` sobre string construída revela nome/OID de objeto arbitrário (metadado) | **Feito**: guarda `::\s*reg[a-z]+` / `\yreg(class\|role\|namespace\|…)\y` nas duas camadas |
| FU-56 (R4) | Niládicas `current_user`/`current_catalog`/`session_user` revelam role/db/schema (metadado) | **Feito**: guarda de identidade nas duas camadas |
| FU-57 (R4) | Allowlist recusava `date()`, `regexp_replace()` e ~35 funções seguras comuns | **Feito**: `funcoes_ok`/`FUNCOES_OK` ampliada (regexp\_\*, casts em forma de função, json\_\*, array\_\*, encode/md5, …); testado sem falso-positivo |
| FU-58 (R4) | Doc "REVOKE … provavelmente falha" desatualizado (é no-op silencioso testado) | **Feito**: `fase-1-seguranca.md` §C e passo 2 reescritos |
| FU-59 (R4) | `revisores.md` lente 1 sem linha sobre allowlist vs blocklist | **Feito** |

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
| FU-52 (R3) | Alias entre aspas (`as "Total de Contratos"`) é recusado pela guarda `~ '"'` | Mitigado por `schema_prompt.ts` (proíbe aspas) + falha fechada. **Monitorar** os logs do piloto por rejeições "Comentário SQL ou identificador entre aspas"; se o modelo insistir em aliases amigáveis, liberar só o `"` (manter `--`/`/*`/`*/`) |
| FU-53 (R3) | Bloco de verificação inline do `.sql` desalinhado da tabela de `fase-1-seguranca.md` | **Feito**: mensagens e casos (aninhado, `--` em literal) alinhados |

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

## Situação — F1 PRONTA PARA SIGN-OFF

**4/4 revisores `APROVADO`** (`rev-seguranca` após 3 bloqueios + escalonamento + R4 de
conferência; `rev-correcao` R1–R3; `rev-produto` e `rev-aderencia` R1). Falta:
1. usuário aplica `sql/assistente/f1_seguranca.sql` no projeto `qexdnxqmiaarzwwwrcor`;
2. usuário autoriza o deploy da Edge Function (`supabase functions deploy gecope-assistant`);
3. usuário abre o chamado ao suporte Supabase (`REVOKE … FROM PUBLIC` no `net`) — em
   paralelo, não bloqueia F2;
4. sign-off registrado → F1 concluída, segue para **F2**.

Follow-ups para fases futuras: FU-28/44/45/46 (F2), FU-35 (F2/F5/F6), FU-50 (F5 — filtro
por identidade), FU-39 (F8 — tema/paleta).
