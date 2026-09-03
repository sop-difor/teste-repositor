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
- **C** — a guarda de schema **normaliza antes de checar**: remove comentários de bloco
  (`/* */`) e de linha (`--`) e aspas de identificador (`"`), e só então aplica os regex.
  Fecha os bypasses que o `rev-seguranca` achou: `select ... from "net"."_http_response"` e
  `net/**/._http_response`. Rejeita: schema fora de `public` (`net`, `cron`, `extensions`,
  `auth`, `storage`, `vault`, `information_schema`, …); **qualquer** identificador `pg_*`
  (qualificado ou não — `pg_roles`, `pg_stat_activity`, `pg_read_file`, `pg_sleep`);
  `dblink` / `current_setting` / `set_config` / `lo_import` / `lo_export`.
- **C — `REVOKE ... FROM PUBLIC` no schema `net`** (buraco na origem): tentado por padrão
  na migração, **dentro de um bloco que não aborta se falhar**. O SQL Editor roda como
  `postgres`, que **não** é superuser nem membro de `supabase_admin` (o concedente do
  grant a `PUBLIC`) — então este `REVOKE` provavelmente falha, com `RAISE NOTICE`
  explicando. Se falhar, a guarda normalizada da função (item C acima) é a contenção
  efetiva; para fechar na origem, abrir chamado no suporte Supabase. `anon`,
  `authenticated`, `service_role`, `postgres`, `supabase_functions_admin` têm `USAGE`
  próprio em `net` e **não** são afetados — só `gecope_ia_readonly` (que é o alvo).
  `pg_stat_statements` e `cron` **não** entram: confirmado que `gecope_ia_readonly` não
  tem `USAGE` nesses schemas, então não são alcançáveis (o `REVOKE` seria no-op).
- **G** — 9 policies `PERMISSIVE FOR SELECT TO gecope_ia_readonly USING (true)`, uma por
  tabela-base do escopo, aplicadas num laço idempotente (`drop policy if exists` antes).
  Dá à role a leitura da lista branca que a RLS negava. Visível em `pg_policies`; não
  toca policies de outros papéis (permissive = OR); as 4 views (`security_invoker`)
  resolvem via as tabelas-base. Alternativa não adotada: `ALTER ROLE gecope_ia_readonly
  BYPASSRLS` (mais curto, menos auditável, atributo amplo no papel).
- **O guard de `LIMIT` (`\blimit\s+\d+`) fica INTOCADO de propósito.** O `LIMIT`
  duplicado é bug de **comportamento** — corrigido e testado na **F2**. A F1 só mexe na
  camada de segurança / acesso.
- Bloco de `ROLLBACK` comentado + bloco de verificação ao final (rodar fora da transação).

Limitação assumida: mesmo com a normalização, as guardas são regex sobre o texto do SQL —
um literal de string contendo `'...pg_...'` ou `'drop'` pode gerar falso-positivo
("consulta não permitida"), e um `--` dentro de um literal quebra a consulta (erro, não
brecha). É aceitável para uma guarda de segurança; as colunas dos 13 objetos não têm
URL/e-mail. As barreiras primárias continuam sendo o `REVOKE EXECUTE` (A) + a Edge
Function autenticada (D); a guarda normalizada é a contenção de schema quando o `REVOKE`
de `PUBLIC` no `net` não pôde ser aplicado.

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
2. Aplicar no SQL Editor do projeto `qexdnxqmiaarzwwwrcor`. Ler as mensagens `NOTICE` do
   bloco do `net` (deve dizer se o `REVOKE FROM PUBLIC` passou ou falhou — falhar é
   esperado e ok). Rodar o bloco de verificação.
3. Se o `REVOKE ... FROM PUBLIC` no `net` falhou e você quer fechar na origem: abrir
   chamado no suporte Supabase (`REVOKE USAGE ON SCHEMA net FROM PUBLIC`).
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
| 5b | `executar_consulta_ia('select 1 from "net"."_http_response"')` (aspas) | ERRO "schema fora de public" |
| 5c | `executar_consulta_ia('select 1 from net/**/._http_response')` (comentário) | ERRO "schema fora de public" |
| 5d | `executar_consulta_ia('select 1 from pg_roles')` (catálogo não-qualificado) | ERRO "catálogo do sistema" |
| 5e | `executar_consulta_ia($$select current_setting('is_superuser')$$)` | ERRO "Função não permitida" |
| 6 | `executar_consulta_ia('select count(*) from contratos_edificacao')` | retorna número |
| 6b | `executar_consulta_ia` com join contrato+ficha (consulta legítima do assistente) | retorna linhas |
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
