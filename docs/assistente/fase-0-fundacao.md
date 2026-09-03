# F0 — Fundação

**Objetivo:** preparar o terreno para as fases seguintes. Nenhuma mudança de
comportamento do assistente, nenhuma alteração de banco, nenhum deploy.

## O que a F0 entrega

1. **Código movido para o repositório do GECOPE** (`gecope/`, que já tem git e o projeto
   Supabase). Antes vivia em `../gecope-assistente/`, uma pasta solta sem versionamento.

   | De (`gecope-assistente/`) | Para (`gecope/`) |
   |---|---|
   | `assistente.html` | `assistente.html` (raiz, junto de `cronograma.html`, `gecope_mapa_obras.html`) |
   | `supabase/functions/gecope-assistant/index.ts` | `supabase/functions/gecope-assistant/index.ts` |
   | `supabase/functions/gecope-assistant/motor_intencoes.ts` | idem |
   | `supabase/functions/gecope-assistant/schema_prompt.ts` | idem |
   | `supabase/functions/gecope-assistant/schema_dicionario.md` | `docs/assistente/schema_dicionario.md` (documentação, não código de função) |

   Não veio: `supabase/config.toml` da pasta antiga (o GECOPE gerencia o projeto Supabase
   pelo painel/CLI; a Edge Function `gecope-assistant` já está publicada, versão 12);
   `.agents/` e `skills-lock.json` (ferramentas locais, não fazem parte do produto).

2. **Branch de trabalho:** `feat/gecope-assistente`, criada a partir de `main` limpo.
   Um commit por fase. Sem `push` até autorização do usuário.

3. **Escopo de dados congelado:** [`escopo-dados.md`](escopo-dados.md) — 13 objetos, lista
   branca, exclusões explícitas.

4. **Decisão de provedor/modelo:** [`provedor-llm.md`](provedor-llm.md) — estratégia
   LLM-minoritário-com-direito-a-falhar, Gemini free tier, cadeia de fallback de modelo
   (IDs a fixar na F2/F6), regra de governança "o LLM nunca vê linhas".

5. **Configuração dos revisores:** [`revisores.md`](revisores.md) — 4 lentes, cadência por
   fase, severidade, ciclo de correção, escalonamento.

6. **Índice da iniciativa:** [`README.md`](README.md).

## O que a F0 NÃO faz (é fase futura)

- Corrigir o bug do `LIMIT` duplicado (guard `\b` em vez de `\y`) → F2.
- Fixar IDs de modelo Gemini e a cadeia de fallback no código → F2/F6.
- Qualquer `GRANT` / `REVOKE` / RLS / JWT / rate limit → F1. Inclui, além do
  `REVOKE EXECUTE ON executar_consulta_ia FROM anon, authenticated`: enumerar **tudo** que
  `gecope_ia_readonly` lê em **todos os schemas** e dar `REVOKE SELECT ... FROM PUBLIC` em
  `net.*`, `extensions.pg_stat_statements*`, `cron.*` (ver ressalva em `escopo-dados.md`).
- Criar views largas → F4.
- Tocar em `index.html` ou na autenticação → F8.

## Como verificar a F0

| # | Verificação | Esperado |
|---|---|---|
| 1 | `git branch --show-current` (em `gecope/`) | `feat/gecope-assistente` |
| 2 | `git log main..feat/gecope-assistente --oneline` | 1 commit, só de arquivos do assistente |
| 3 | `git show --stat` do commit da F0 | Apenas `assistente.html`, `supabase/functions/gecope-assistant/*`, `docs/assistente/*` |
| 4 | `diff -r ../gecope-assistente/supabase/functions/gecope-assistant supabase/functions/gecope-assistant` (ignorando `schema_dicionario.md`, movido para `docs/`) | Sem diferenças — o código foi movido, não alterado |
| 5 | Ler `escopo-dados.md` × `information_schema.role_table_grants` para `gecope_ia_readonly` | As duas listas de 13 objetos coincidem |
| 6 | Buscar segredos no diff (`GEMINI_API_KEY`, `service_role`, chaves privadas) | Nenhum. A `SUPABASE_ANON_KEY` em `assistente.html` já é pública (está em `config.js`) e é substituída na F1/F8 pelo fluxo de sessão |
| 7 | Verificação de compilação | `deno` **não está instalado** nesta máquina. O código é byte a byte o da Edge Function publicada (v12), que compila e roda em produção. `deno check` fica como item de ambiente para a F2, quando o código passa a ser alterado |

## Riscos conhecidos que a F0 deixa para depois (não são bloqueios da F0)

- `assistente.html` ainda embute a `SUPABASE_ANON_KEY` e manda `usuario` do corpo — some
  na F1/F8.
- `supabase/functions/gecope-assistant/index.ts` ainda tem `GEMINI_MODEL` fixo; a função
  do banco tem o bug do `LIMIT` duplicado — F2.
- **Tema fora do padrão do GECOPE.** `assistente.html` usa `CHAVE_TEMA = "gecope-tema"`
  (hífen) e `html[data-theme="escuro"|"claro"]`; o resto do GECOPE (Etapas A–D) usa
  `gecope_theme` (underscore), classe `theme-dark` em `<html>`/`<body>`, valores
  `dark`/`light`. Alinhar na **F8** (integração) para que a escolha de tema seja a mesma
  em todo o sistema.
- **Paleta CSS independente.** `assistente.html` define cores próprias
  (`--bg-page`, `--accent:#4f46e5`, …) sem apontar para os tokens `--sop-*` / `--slate-*`
  do `style.css`, como `cronograma.html` faz. Revisar na **F6/F8**.
- `gecope_ia_readonly` alcança objetos de extensões via `GRANT TO PUBLIC` — fechar na F1
  (ver acima e `escopo-dados.md`).
- A Edge Function publicada (v12) continua a mesma; nada de deploy na F0.
