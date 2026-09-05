# `sql/assistente/` — migrações do Assistente de Dados

Pasta **viva** (mesmo modelo de `sql/reestruturacao_tabelas/`): os `.sql` ficam aqui,
**não** são movidos para `sql/_aplicados/`. A fonte de verdade é o banco de produção
(`qexdnxqmiaarzwwwrcor`); estes arquivos são o histórico versionado de cada fase.

## Ordem e estado

| Arquivo | Fase | Estado | O que faz |
|---|---|---|---|
| `f1_seguranca.sql` | F1 | **aplicado 03/09/2026** | `REVOKE EXECUTE` de anon/authenticated; recria `executar_consulta_ia` com as guardas de segurança; 9 policies `ia_ro_select`; `consultas_ia_log` FORCE RLS |
| `f2_nucleo.sql` | F2 | **aplicado 03/09/2026** | **Recria `executar_consulta_ia` por completo** — guardas da F1 intactas + corrige o bug do LIMIT, cap externo 500, aceita `WITH`, `statement_timeout 15s` |
| `f4_views.sql` | F4 | **aplicado 04/09/2026** | Cria `vw_assistente_obra_completa` e `vw_assistente_processo_completo` (`security_invoker`); `GRANT SELECT` para `gecope_ia_readonly`. Não toca `executar_consulta_ia` |
| `f7_feedback.sql` | F7 | pendente de aplicação | Coluna `veredito` em `consultas_ia_log` (check positivo/negativo) + índice parcial; job `pg_cron` (`gecope-assistente-purga-log`) apagando diariamente registros com mais de 180 dias (LGPD, prometido na F1). Não toca `executar_consulta_ia`, RLS nem grants |

## Regra importante

`executar_consulta_ia` tem **duas** definições no git (`f1` e `f2`). A **`f2` é a atual.**

- **NÃO re-execute `f1_seguranca.sql`** depois da F2 — regride o bug do LIMIT e perde
  `statement_timeout` / `WITH` / cap externo. Os `REVOKE`/grants/policies/RLS da F1
  continuam valendo (`create or replace` não os toca); não precisam ser reaplicados.
- Cada nova fase que mexer na função **recria o corpo inteiro** num `f<n>_*.sql` novo e
  atualiza esta tabela. O arquivo mais recente é sempre a verdade.

## Espelhamento com a Edge Function

As guardas de `executar_consulta_ia` (allowlist `funcoes_ok`, blocklist de comandos,
rejeição de comentário/aspas/schema/`pg_*`/`::reg*`/identidade) têm uma **cópia em JS** em
`supabase/functions/gecope-assistant/guards.ts` (`FUNCOES_OK` + `validarSqlGeminiOuFalhar`),
como defesa em profundidade. Ao editar uma, editar a outra. `guards_test.ts` cobre a versão JS.
