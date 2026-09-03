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

## O que muda

### 1. Banco — `sql/assistente/f1_seguranca.sql` (o usuário aplica)

Transacional e idempotente. Contém:

- **A** — `REVOKE EXECUTE ON public.executar_consulta_ia(text) FROM anon, authenticated, public`.
  Sobram `service_role` (a Edge Function) e o owner `gecope_ia_readonly`.
- **B** — `CREATE OR REPLACE FUNCTION executar_consulta_ia` com o blocklist usando `\y`
  (mesma lista de palavras, só o operador de borda muda).
- **C** — na mesma recriação, guarda nova: rejeita referência explícita a qualquer schema
  fora de `public` (`net`, `cron`, `extensions`, `auth`, `storage`, `vault`, `pg_catalog`,
  `information_schema`, …) e o prefixo `pg_*`.
- **C (opcional, comentado)** — `REVOKE USAGE ON SCHEMA net FROM PUBLIC` + `REVOKE ALL ON
  net.*  FROM PUBLIC` + `REVOKE SELECT ON extensions.pg_stat_statements* FROM PUBLIC`.
  Fecha o buraco na origem, mas mexe em schema compartilhado da plataforma —
  `anon`/`authenticated`/`service_role`/`postgres` têm `USAGE` próprio e **não** são
  afetados; só perde acesso quem dependia de `PUBLIC` (que é o objetivo). Deixado
  comentado para o usuário decidir; a guarda da função já contém o assistente sem isto.
- **O guard de `LIMIT` (`\blimit\s+\d+`) fica INTOCADO de propósito.** O `LIMIT`
  duplicado é bug de **comportamento** — corrigido e testado na **F2**. A F1 só mexe na
  camada de segurança.
- Bloco de verificação ao final (rodar fora da transação).

Limitação assumida: as guardas de blocklist/schema são regex sobre o texto do SQL, então
um literal de string contendo `'... net.'` ou `'drop'` pode gerar falso-positivo
("consulta não permitida"). É aceitável para uma guarda de segurança e as colunas dos 13
objetos não têm URL/e-mail. As barreiras primárias são o `REVOKE EXECUTE` (A) e a Edge
Function autenticada (D).

### 2. Edge Function — `supabase/functions/gecope-assistant/index.ts`

- **D** — antes de qualquer processamento: extrai o `Bearer` do header, chama
  `supabase.auth.getUser(token)`, rejeita com `401` se não houver usuário real. `usuario`
  passa a ser `user.email` (fallback `user.id`) — **nunca** do corpo. Mesmo padrão da
  função `approve-user`.
- **Rate limit** — `40` perguntas por usuário por hora (conta `consultas_ia_log` na
  janela). Excedeu → `429` com mensagem amigável. Aproximado; suficiente para o piloto.
- **B/C espelhados** — `validarSqlGeminiOuFalhar` ganha a mesma rejeição de schema fora
  de `public` e `pg_*` (regex JS, onde `\b` funciona como borda).
- `verify_jwt: true` no painel continua.

### 3. Front-end — `assistente.html`

- **E** — carrega `@supabase/supabase-js`, `config.js`, `database.js` (como
  `cronograma.html`). `SUPABASE_URL` / anon key vêm de `window.*`, não mais hardcoded.
- Envia `Authorization: Bearer <access_token da sessão>`; `apikey` = anon key (exigido
  pelo gateway). `usuario` **sai** do corpo.
- **Porta de sessão**: sem sessão do GECOPE, desabilita a entrada e mostra "Entre no
  GECOPE para usar o assistente" com link para `index.html`. Trata `401` da função com a
  mesma mensagem.
- Integração completa (link no `index.html`, tema unificado, nome do usuário no
  cabeçalho) continua sendo **F8**.

### 4. LGPD — `consultas_ia_log` (buraco F)

- Estado atual conferido: RLS **on**, 1 policy (`ALL USING auth.role() = 'service_role'`)
  — só o `service_role` lê e grava. Nenhum usuário nem admin lê pela API. **Suficiente
  para o controle de acesso.**
- A pergunta é mantida (é insumo da F5/F7 — transformar falha em intenção/eval).
- **Retenção**: purga de registros com mais de **180 dias** — implementar como job
  `pg_cron` na **F7** (junto do painel de observabilidade). Registrado aqui como decisão;
  não construído na F1.
- Documentar no `escopo-dados.md` que a pergunta pode conter dado pessoal e o log é
  restrito ao `service_role`.

## Decisão da F0 resolvida

**FU-17** — migrações do assistente vão em **`sql/assistente/`** (subpasta dedicada,
padrão dos projetos recentes tipo `sql/reestruturacao_tabelas/`), não soltas em `sql/`.
Ao aplicar, o usuário move para `sql/_aplicados/` como de praxe — ou mantemos
`sql/assistente/` como pasta viva do assistente. **A confirmar no sign-off.**

## Ordem de aplicação (o usuário faz)

1. Revisar `sql/assistente/f1_seguranca.sql`.
2. Aplicar no SQL Editor do projeto `qexdnxqmiaarzwwwrcor`. Conferir o bloco de
   verificação.
3. (Opcional) rodar a seção comentada do `net`/`pg_stat_statements` se nada legítimo
   depender do acesso de `PUBLIC` a `net`.
4. Autorizar o deploy da Edge Function (`supabase functions deploy gecope-assistant`).
   Rollback = redeploy da v12 (código em git no commit `782e86c`).

## Como verificar a F1

| # | Verificação | Esperado |
|---|---|---|
| 1 | `has_function_privilege('anon', 'public.executar_consulta_ia(text)', 'execute')` | `false` |
| 2 | idem `authenticated` | `false` |
| 3 | idem `service_role` | `true` |
| 4 | `select ('select 1; drop x' ~* '\y(insert\|update\|delete\|drop\|alter\|truncate\|grant\|revoke\|create)\y')` | `true` |
| 5 | `select * from executar_consulta_ia('select 1 from net._http_response')` | ERRO "schema fora de public" |
| 6 | `select * from executar_consulta_ia('select count(*) from contratos_edificacao')` | retorna número |
| 7 | `POST` na Edge Function com `Authorization: Bearer <anon key>` | `401` "Sessão inválida" |
| 8 | `POST` com `Bearer <access_token de usuário>` | responde normalmente; `consultas_ia_log.usuario` = e-mail do usuário |
| 9 | 41ª pergunta do mesmo usuário em 1 h | `429` com mensagem amigável |
| 10 | Abrir `assistente.html` sem sessão | entrada desabilitada + aviso de login |
| 11 | `git grep -n "eyJ" assistente.html` | sem JWT hardcoded (anon key vem de `config.js`) |
| 12 | `deno check supabase/functions/gecope-assistant/index.ts` | compila (rodar onde houver Deno) |

## Fora do escopo da F1 (fases futuras)

- Corrigir o `LIMIT` duplicado (`\b`→`\y` no guard de limit) → **F2**.
- Job `pg_cron` de retenção do log → **F7**.
- Link no `index.html`, tema unificado, nome do usuário no cabeçalho → **F8**.
- Rate limit exato (tabela dedicada / transacional) — o aproximado basta no piloto.
