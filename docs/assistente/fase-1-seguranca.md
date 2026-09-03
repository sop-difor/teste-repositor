# F1 — Blindagem de segurança

**Objetivo:** fechar os buracos de acesso do assistente antes de qualquer usuário do
piloto ter o link. Encerra com **sign-off do usuário** (aplica o SQL em produção).

## Buracos que a F1 fecha

| ID | Buraco | Onde |
|---|---|---|
| **A** | `executar_consulta_ia` é executável por `anon` / `authenticated` via PostgREST (`/rest/v1/rpc/`). Qualquer um com a anon key pública (está em `config.js`) roda `SELECT` nas 13 tabelas sem passar pela Edge Function. | Banco |
| **B** | O blocklist de palavras-chave dentro de `executar_consulta_ia` usa `\b`, que no regex do Postgres é o caractere **backspace**, não borda de palavra (`\y`). `'select 1; drop table x'` **não** é barrado pelo blocklist — só pelas outras duas checagens. Defesa em profundidade furada. Verificado ao vivo. | Banco |
| **C** | `gecope_ia_readonly` tem `USAGE` no schema `net` (herdado de `PUBLIC`) e `net._http_response` / `net.http_request_queue` têm `ALL` para `PUBLIC`. Um `select ... from net._http_response` (gerado, ou induzido pelo texto da pergunta) passaria — e essa tabela guarda corpos/headers de respostas HTTP de saída (`pg_net`), que podem conter tokens. `search_path='public'` cobre nomes não qualificados, não `net.x` qualificado. | Banco |
| **D** | `usuario` vem do corpo da requisição — falsificável. A anon key é aceita como `Authorization` (é um JWT válido), então o `verify_jwt` do painel não garante um usuário real. | Edge Function |
| **E** | `assistente.html` embute a `SUPABASE_ANON_KEY` crua e a envia como `Authorization`. Sem exigir sessão do GECOPE. | Front-end |
| **F** | `consultas_ia_log` guarda a pergunta do usuário, que pode conter nome de fiscal/analista (LGPD). | Banco / processo |
| **G** | `executar_consulta_ia` roda como `gecope_ia_readonly` (SECURITY DEFINER), mas as 9 tabelas do escopo têm RLS ligada com policies só para `anon`/`authenticated` — **nenhuma** para essa role. RLS nega tudo: `select count(*) from contratos_edificacao` devolve **0** (a tabela tem 352). As 4 views são `security_invoker=true` e herdam o bloqueio. Sem isto, **todo** o caminho LLM responde "Nenhum resultado". Achado do `rev-correcao` na revisão da F1. | Banco |

## O que muda

### 1. Banco — `sql/assistente/f1_seguranca.sql` (o usuário aplica)

Transacional e idempotente. Contém:

- **A** — `REVOKE EXECUTE ON public.executar_consulta_ia(text) FROM public, anon, authenticated`.
  Sobram `service_role` (a Edge Function, re-concedido explicitamente) e o owner
  `gecope_ia_readonly`. Verificado: pós-`REVOKE`, `proacl` = `{gecope_ia_readonly=X, service_role=X}`.
- **B** — `CREATE OR REPLACE FUNCTION executar_consulta_ia` com o blocklist usando `\y`
  (mesma lista de palavras, só o operador de borda muda). Corpo base = `pg_get_functiondef`
  da função em produção em 2026-09-03; diffs listados no cabeçalho do `.sql`.
- **C** — três guardas, nas duas camadas (função + `validarSqlGeminiOuFalhar`), nesta
  ordem:
  1. **Rejeita de saída** qualquer SQL com comentário (`--`, `/*`, `*/`) ou aspas de
     identificador (`"`). Normalizar por regex **não é são** (comentário aninhado
     `/*/**/*/`, `--` dentro de literal furam — as rodadas 1–2 do `rev-seguranca`
     vazaram por aí). O modelo é instruído a não usá-los (`schema_prompt.ts`).
  2. Rejeita referência a schema fora de `public` e **qualquer** identificador `pg_*`
     (qualificado ou não).
  3. **ALLOWLIST de chamadas de função (default-deny)** — rejeita qualquer `nome(` que
     não esteja numa lista fixa de funções analíticas seguras (agregações, janelas,
     texto, data, `cast`/`coalesce`/…). Fecha, de uma vez, `schema_to_xml` /
     `database_to_xml` / `table_to_xml` / `query_to_xml` (que a rodada 3 do
     `rev-seguranca` usou para dumpar `net._http_response` passando o schema como
     **string**, sem ponto), `dblink`, `current_setting`, `set_config`, `lo_import`,
     `lo_export`, `pg_read_file`, `generate_series` — e qualquer função futura. É a
     contenção sã que o blocklist não deu (furado 3×). Testado: consultas analíticas
     legítimas passam, todos os vetores de ataque das 4 rodadas barram.
  4. **(R4)** rejeita cast `::reg*` (revela nome/OID a partir de string construída, ex.
     `(concat('n','et'))::regnamespace`) e as funções niládicas de identidade
     (`current_user`, `current_catalog`, `session_user`, …).
- **C — `REVOKE ... FROM PUBLIC` no schema `net`** (buraco na origem): **testado
  (2026-09-03, com restore) — não é executável por nós.** Rodando como `postgres` (não
  superuser, não membro de `supabase_admin`, que é o concedente), o `REVOKE` roda **sem
  erro** mas é **no-op silencioso**: o `nspacl` de `net` fica intacto e a role continua
  lendo `net._http_response`. A migração tenta assim mesmo e o bloco `DO` **detecta o
  no-op** (`has_schema_privilege`) e emite `RAISE NOTICE` "NO-OP". **Item de fase (não
  opcional):** abrir chamado no suporte Supabase pedindo, com a conta `supabase_admin`,
  `REVOKE USAGE ON SCHEMA net FROM PUBLIC` + `REVOKE ALL ON net._http_response,
  net.http_request_queue FROM PUBLIC` — defesa em profundidade além da allowlist. `anon`,
  `authenticated`, `service_role`, `postgres`, `supabase_functions_admin` têm `USAGE`
  próprio e **não** são afetados — só `gecope_ia_readonly`. `anon`, `authenticated`, `service_role`, `postgres`,
  `supabase_functions_admin` têm `USAGE` próprio em `net` e **não** são afetados — só
  `gecope_ia_readonly` (que é o alvo). `pg_stat_statements` e `cron` **não** entram:
  `gecope_ia_readonly` não tem `USAGE` nesses schemas (não alcançáveis).
- **G** — 9 policies `PERMISSIVE FOR SELECT TO gecope_ia_readonly USING (true)`, uma por
  tabela-base do escopo, aplicadas num laço idempotente (`drop policy if exists` antes).
  Dá à role a leitura da lista branca que a RLS negava. Visível em `pg_policies`; não
  toca policies de outros papéis (permissive = OR); as 4 views (`security_invoker`)
  resolvem via as tabelas-base. Alternativa não adotada: `ALTER ROLE gecope_ia_readonly
  BYPASSRLS` (mais curto, menos auditável, atributo amplo no papel).
  **Consequência de produto a registrar (`rev-seguranca`):** `USING (true)` em `processos`
  ignora a restrição por `fiscal_matricula` que vale para `authenticated` — um usuário
  "fiscal" do piloto passaria a ver **todos** os processos pelo assistente, não só os
  dele. Para o piloto (equipe GECOPE + gestores, que já veem tudo) é aceitável; se um
  fiscal de campo entrar no piloto, decidir: aceitar, ou filtrar por identidade no
  assistente (F5, com `usuario` do JWT). **A confirmar no sign-off.**
- **O guard de `LIMIT` (`\blimit\s+\d+`) fica INTOCADO de propósito.** O `LIMIT`
  duplicado é bug de **comportamento** — corrigido e testado na **F2**. A F1 só mexe na
  camada de segurança / acesso.
- Bloco de `ROLLBACK` comentado + bloco de verificação ao final (rodar fora da transação).

Limitação assumida: rejeitar `--` / `/*` / `"` de saída pode recusar uma consulta legítima
que use um literal de string contendo `--` (raro em dados de obra; falha fechada, o
usuário reformula). O modelo é instruído a não gerar comentário/aspas. As barreiras de
`net.*` são: (1) `REVOKE EXECUTE` (A) — sem caminho direto por RPC; (2) Edge Function
autenticada (D); (3) a guarda de rejeição da função; (4) o `REVOKE ... FROM PUBLIC`
(quando aplicável, via suporte Supabase).

### 2. Edge Function — `supabase/functions/gecope-assistant/index.ts`

- **D** — antes de qualquer processamento: extrai o `Bearer` do header, chama
  `supabase.auth.getUser(token)`, rejeita com `401` se não houver usuário real. `usuario`
  passa a ser `user.email` (fallback `user.id`) — **nunca** do corpo. Mesmo padrão da
  função `approve-user`.
- **Rate limit** — `40` perguntas por usuário por hora (conta `consultas_ia_log` na
  janela). Excedeu → `429`, `origem: "limite"`, mensagem "Limite de 40 perguntas por hora
  atingido. Aguarde alguns minutos e continue." Aproximado (TOCTOU: o log só grava ao fim
  — rajada concorrente passa); suficiente para o piloto; limitador exato é dívida.
- **B/C espelhados** — `validarSqlGeminiOuFalhar` normaliza (tira comentários e aspas) e
  aplica as mesmas rejeições de schema / `pg_*` / funções perigosas (regex JS).
- Mensagens de sessão passam a `origem: "sessao"` (não `"erro"`) para o front tratar sem
  balão vermelho.
- `verify_jwt: true` no painel continua.

### 3. Front-end — `assistente.html`

- **E** — carrega `@supabase/supabase-js`, `config.js`, `database.js` (como
  `cronograma.html`). `SUPABASE_URL` / anon key vêm de `window.*`, não mais hardcoded.
- Envia `Authorization: Bearer <access_token da sessão>`; `apikey` = anon key (exigido
  pelo gateway). `usuario` **sai** do corpo.
- **Porta de sessão** (`travarEntrada` / `fecharPorSessao` / `abrirPorSessao`):
  - a entrada e o botão **começam desabilitados**; só abrem depois de confirmar a sessão
    (sem "flash" de UI funcional para quem está deslogado);
  - os **chips de sugestão** também são desabilitados (`.chip-off`) sem sessão;
  - a porta **re-fecha** quando o token está nulo no envio **ou** a Edge Function
    responde `401` / `origem: "sessao"` — não só na carga. Mensagem única com link para o
    Painel Principal;
  - avisos de sessão e de limite usam estilo `.aviso` (neutro), não o `.erro` vermelho.
- Integração completa (link no `index.html`, tema unificado, nome do usuário no
  cabeçalho) continua sendo **F8**.

### 4. LGPD — `consultas_ia_log` (buraco F)

- Estado atual conferido: RLS **on**, 1 policy (`ALL USING auth.role() = 'service_role'`).
  Mas `anon` / `authenticated` ainda tinham `GRANT` de tabela — só a RLS (sem `FORCE`)
  separava o texto das perguntas do público. A F1 fecha a folga:
  `REVOKE ALL ON public.consultas_ia_log FROM anon, authenticated` +
  `ALTER TABLE ... FORCE ROW LEVEL SECURITY`.
- A pergunta é mantida (é insumo da F5/F7 — transformar falha em intenção/eval).
- **Retenção**: purga de registros com mais de **180 dias** — job `pg_cron` na **F7**
  (junto do painel de observabilidade). Registrado como decisão; não construído na F1.
- `escopo-dados.md` ganhou a seção "Dado pessoal e o log de perguntas (LGPD)".

## Decisão da F0 resolvida

**FU-17** — migrações do assistente vão em **`sql/assistente/`** como **pasta viva**, no
mesmo modelo de `sql/reestruturacao_tabelas/` (que também não foi movida para
`sql/_aplicados/`). Não mover para `sql/_aplicados/` ao aplicar; só registrar exceção se o
usuário preferir mover.

## Ordem de aplicação (o usuário faz)

1. Revisar `sql/assistente/f1_seguranca.sql`.
2. Aplicar no SQL Editor do projeto `qexdnxqmiaarzwwwrcor`. Esperado: `NOTICE` do bloco
   do `net` dizendo **"NO-OP (concedente = supabase_admin)"** — isso é o esperado, não um
   erro. Rodar o bloco de verificação.
3. **Se o `REVOKE ... FROM PUBLIC` no `net` falhou** (o esperado): abrir chamado no
   suporte Supabase pedindo `REVOKE USAGE ON SCHEMA net FROM PUBLIC` +
   `REVOKE ALL ON net._http_response, net.http_request_queue FROM PUBLIC`. É item de fase
   (defesa em profundidade real), não opcional.
4. Autorizar o deploy da Edge Function (`supabase functions deploy gecope-assistant`).
   Rollback = redeploy da v12 (código em git no commit `782e86c`) + bloco `ROLLBACK` do `.sql`.

## Como verificar a F1

| # | Verificação | Esperado |
|---|---|---|
| 1 | `has_function_privilege('anon', 'public.executar_consulta_ia(text)', 'execute')` | `false` |
| 2 | idem `authenticated` | `false` |
| 3 | idem `service_role` | `true` |
| 4 | `select ('select 1; drop x' ~* '\y(insert\|update\|delete\|drop\|alter\|truncate\|grant\|revoke\|create)\y')` | `true` |
| 5 | `executar_consulta_ia('select 1 from net._http_response')` | ERRO "schema fora de public" |
| 5b | `executar_consulta_ia('select 1 from "net"."_http_response"')` (aspas) | ERRO "Comentário SQL ou identificador entre aspas" |
| 5c | `executar_consulta_ia('select 1 from net/**/._http_response')` (comentário) | ERRO "Comentário SQL ou identificador entre aspas" |
| 5c2 | `executar_consulta_ia('select 1 from net/*/**/*/._http_response')` (comentário aninhado) | ERRO "Comentário SQL ou identificador entre aspas" |
| 5c3 | `executar_consulta_ia($$select 1 where 'x'='--' union select 1 from net._http_response$$) ` (`--` em literal) | ERRO "Comentário SQL ou identificador entre aspas" |
| 5d | `executar_consulta_ia('select 1 from pg_roles')` (catálogo não-qualificado) | ERRO "catálogo do sistema" |
| 5e | `executar_consulta_ia($$select current_setting('is_superuser')$$)` | ERRO "Função não permitida na consulta: current_setting" |
| 5f | `executar_consulta_ia($$select schema_to_xml('net', true, false, '')$$)` | ERRO "Função não permitida na consulta: schema_to_xml" |
| 5g | `executar_consulta_ia($$select database_to_xml(true,false,'')$$)` | ERRO "Função não permitida na consulta: database_to_xml" |
| 5h | `executar_consulta_ia($$select query_to_xml('select 1 from net._http_response',true,false,'')$$)` | ERRO "Função não permitida na consulta: query_to_xml" |
| 6 | `executar_consulta_ia('select count(*) from contratos_edificacao')` | retorna ~352 — **não 0** (buraco G) |
| 6b | `executar_consulta_ia` com join contrato+ficha **sem `limit`** | retorna linhas |
| 6c | qualquer consulta **com `limit` explícito** | `syntax error at or near "limit"` — bug do LIMIT duplicado, **corrigido na F2** (não é regressão da F1) |
| 7 | `POST` na Edge Function com `Authorization: Bearer <anon key>` | `401`, `origem: "sessao"` |
| 8 | `POST` com `Bearer <access_token de usuário>` | responde normalmente; `consultas_ia_log.usuario` = e-mail |
| 9 | 41ª pergunta do mesmo usuário em 1 h | `429`, `origem: "limite"` |
| 10 | Abrir `assistente.html` sem sessão | entrada, botão e chips desabilitados desde a carga + aviso com link |
| 10b | Sessão expira no meio da conversa | balão neutro (`.aviso`) com link, porta re-fecha |
| 11 | `git grep -n "eyJ" assistente.html` | sem JWT hardcoded (anon key vem de `config.js`) |
| 12 | `has_table_privilege('anon','public.consultas_ia_log','select')` / `relforcerowsecurity` | `false` / `true` |
| 13 | `deno check supabase/functions/gecope-assistant/index.ts` | compila (rodar onde houver Deno) |

## Fora do escopo da F1 (fases futuras)

- Corrigir o `LIMIT` duplicado (`\b`→`\y` no guard de limit) → **F2**.
- Job `pg_cron` de retenção do log → **F7**.
- Link no `index.html`, tema unificado, nome do usuário no cabeçalho → **F8**.
- Rate limit exato (tabela dedicada / transacional) — o aproximado basta no piloto.
