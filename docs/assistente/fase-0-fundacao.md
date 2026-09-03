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

- Corrigir o bug do `limit` → F2.
- Fixar IDs de modelo Gemini e a cadeia de fallback no código → F2/F6.
- Qualquer `GRANT` / `REVOKE` / RLS / JWT / rate limit → F1.
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
| 7 | `deno check supabase/functions/gecope-assistant/index.ts` | Compila (código inalterado, era o que já rodava publicado) |

## Riscos conhecidos que a F0 deixa para depois (não são bloqueios da F0)

- `assistente.html` ainda embute a `SUPABASE_ANON_KEY` e manda `usuario` do corpo — some
  na F1/F8.
- `supabase/functions/gecope-assistant/index.ts` ainda tem `GEMINI_MODEL` fixo e o bug do
  `limit` na função do banco — F2.
- A Edge Function publicada (v12) continua a mesma; nada de deploy na F0.
