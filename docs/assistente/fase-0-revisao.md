# F0 — Fundação · Revisão

Revisão pelas 4 lentes (ver [`revisores.md`](revisores.md)). Subagentes independentes,
contexto limpo, em paralelo, sobre o commit `782e86c`.

## Vereditos

| Lente | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-seguranca` | **APROVADO** | — |
| `rev-correcao` | **BLOQUEADO** | _(re-submissão após correção)_ |
| `rev-produto` | **APROVADO** | — |
| `rev-aderencia` | **APROVADO** | — |

`rev-correcao` e `rev-aderencia` caíram por erro de conexão (ECONNRESET) na primeira
tentativa e foram re-disparados; os vereditos acima são das execuções válidas.

## Achado bloqueante (rev-correcao, rodada 1) — RESOLVIDO

**Descrição do "bug do limit" no `README.md` estava factualmente errada quanto ao
mecanismo.** O texto atribuía o erro a `;` final / comentário `--` / quebra de linha no
SQL do modelo. Testado ao vivo no projeto `qexdnxqmiaarzwwwrcor`, o mecanismo real é:

1. `executar_consulta_ia` só anexa `' limit 200'` quando `sql_consulta !~* '\blimit\s+\d+'`.
2. No regex do Postgres (ARE), **`\b` é o caractere backspace (0x08)**, não borda de
   palavra (borda é `\y`). Logo o guard **nunca casa** e `' limit 200'` é anexado
   **sempre**.
3. `schema_prompt.ts` instrui o modelo a "sempre incluir `LIMIT 200`". O modelo obedece.
4. `select row_to_json(t) from (select ... limit 200 limit 200) t` →
   `ERROR: 42601: syntax error at or near "limit"`.

O strip de `;` final (`regexp_replace(trim(...), ';\s*$', '')`) **funciona** e não é o
gatilho. Risco: um dev seguindo o `README.md` endureceria a limpeza de `;` (já
funcional) e não atacaria a causa-raiz.

**Correção aplicada:** `README.md`, seção "Diagnóstico", item 3 reescrito com o mecanismo
correto (`\b` vs `\y`, `LIMIT` duplicado, prompt manda incluir `LIMIT`), deixando
explícito que o strip de `;` não é o problema e apontando as 4 abordagens possíveis de
correção para a F2. Re-submetido ao `rev-correcao`.

## Follow-ups (não bloqueiam; rastreados)

### Acurácia de documento — corrigidos já na F0

| # | Origem | Item | Resolução |
|---|---|---|---|
| FU-1 | rev-seguranca | `escopo-dados.md` afirmava "consulta a qualquer outra tabela falha" — não confere: a role alcança `net._http_response` (pode ter tokens), `pg_stat_statements`, `cron.*` via `GRANT TO PUBLIC` | `escopo-dados.md` item 1 ganhou a "Ressalva conhecida (a fechar na F1)"; `fase-0-fundacao.md` detalha o `REVOKE ... FROM PUBLIC` no escopo da F1 |
| FU-2 | rev-seguranca | Lente Segurança sem linha para injeção via prompt e para "confirmar alcance real da role em todos os schemas" | `revisores.md` lente 1: dois itens novos |
| FU-3 | rev-correcao | `deno check` (verificação 7) impossível — `deno` não instalado | Verificação 7 reescrita: o código é o da v12 publicada (compila em produção); `deno check` vira item de ambiente da F2 |
| FU-4 | rev-correcao | Métrica "19 intenções" vs "10/10 corretas" podia ler como contradição | `README.md`: frase de nota distinguindo intenções definidas × perguntas do teste |
| FU-5 | rev-aderencia | Troca `REPROVADO`→`BLOQUEADO` não registrada | `revisores.md`: "Nota de terminologia" no topo. Posição do revisor: `BLOQUEADO` é o certo (casa com Etapas A–D) |
| FU-6 | rev-aderencia | `fase-0-fundacao.md` "Riscos conhecidos" omitia a divergência de tema (`gecope-tema`/`escuro` vs `gecope_theme`/`theme-dark`) | Item novo em "Riscos conhecidos", apontado para a F8 |
| FU-7 | rev-aderencia | Lente Aderência sem item para reuso dos tokens CSS `--sop-*`/`--slate-*` (cronograma faz, assistente não) | `revisores.md` lente 4: item novo + item novo em "Riscos conhecidos" da F0 |

### Direção de produto — para as fases indicadas (rev-produto)

| # | Item | Fase |
|---|---|---|
| FU-8 | Rótulo de confiança na UI está invertido: "análise gerada" (LLM) soa melhor que "resposta imediata" (intenção). O terreno firme deve comunicar verificação; o LLM, cautela literal ("resposta gerada — confira antes de usar") | F6 (critério de aceite) |
| FU-9 | "Confira" apoiado só no SQL cru é fraco — gestor/fiscal não lê SQL. Acompanhar de reformulação em linguagem natural do que foi consultado + contagem de linhas | F6 |
| FU-10 | Nenhuma das 19 intenções é drill-down de contrato único ("como está o contrato 123?", "aditivos do contrato X", "medições do contrato X", "checklist do processo X") — padrão que não emerge do log sozinho | F5 (garantir a família) |
| FU-11 | `medicoes`, `checklist_documentacao_aditivo`, `curva_abc_*` estão no escopo mas sem nenhuma intenção. "Medições pendentes", "obra sem medir há N meses", "processos parados há mais de X dias" são perguntas diárias | F5 (priorizar explicitamente) |
| FU-12 | Perguntas com recorte de identidade ("quais obras eu fiscalizo?", "meus contratos") ficam viáveis com `usuario` do JWT (F1) + `comissao_fiscalizacao` no escopo | F5 (candidato) |
| FU-13 | Listas truncadas em `.slice(0, 10)` sem avisar que são parciais ("40 contratos vencem" + 10 linhas parece lista completa) | F2/F5 — mostrar "(10 primeiros de 40)"; lente rev-produto ganha "honestidade de truncamento" |
| FU-14 | Cronograma fora do escopo deixa "obras atrasadas / paradas há mais de 90 dias" capenga | F8 — setar expectativa explícita no piloto de que o assistente ainda não sabe de cronograma |
| FU-15 | Log só cresce no piloto (F8), mas F5/F7 dependem dele. ~25 registros até lá | Considerar checkpoint de exposição a 2–3 usuários amigáveis (só caminho de intenções) após a F2 |
| FU-16 | Lente rev-produto sem critérios de: latência percebida do caminho LLM (retry+backoff pode passar de 10 s com só três pontinhos na UI); onboarding além dos 6 chips fixos; UX do feedback 👍/👎 da F7 | Acrescentar antes de F6/F7 |

### Aderência — decisões adiadas (rev-aderencia)

| # | Item | Fase |
|---|---|---|
| FU-17 | `sql/assistente/` como subpasta dedicada (padrão de projetos recentes: `sql/reestruturacao_tabelas/`) em vez de soltar `.sql` na raiz de `sql/` | Decidir na F1 |
| FU-18 | `README.md` vs convenção `LEIA-ME.md` das pastas do GECOPE | **Decisão F0:** manter `README.md` — é índice vivo da iniciativa, não marcador de pasta arquivada. Registrado aqui |
| FU-19 | `schema_dicionario.md` sem prefixo `fase-`/`assistente-` | Aceitável dentro da pasta dedicada; sem ação |
| FU-20 | Estrutura de doc por fase (`fase-N-*` + `fase-N-revisao`) mais enxuta que o trio `plano`+`spec`+`revisores` das Etapas A–D | Justificado em `revisores.md`; F4/F6 reavaliam `spec` separada |

### Correção — pré-existentes, revisar quando o código for tocado (rev-correcao)

| # | Item | Fase |
|---|---|---|
| FU-21 | Log tem 1 registro `erro = "[object Object]"` (12:45) apesar de `paraTextoSeguro` | F2/F6 — verificar se chega ao usuário |
| FU-22 | `schema_prompt.ts:98` usa `curva_abc_versoes.id` mas a lista de colunas (linha 81) não mostra `id` | F6 — quando o prompt for retrabalhado |

## Confirmações das 4 lentes (o que passou)

- **Código movido, não alterado** — `diff -q` + `md5sum` de todos os 5 arquivos: byte a
  byte idênticos à origem. `config.toml`, `.temp/`, `.agents/`, `skills-lock.json`
  corretamente não trazidos.
- **Commit** `782e86c`: 10 arquivos, só do assistente, 0 remoções, sem segredos no diff
  (única chave é a `SUPABASE_ANON_KEY` já pública em `config.js`). Estilo de mensagem
  compatível com o repo. `Co-Authored-By` conforme CLAUDE.md.
- **Escopo × banco**: `information_schema.role_table_grants` para `gecope_ia_readonly` =
  exatamente os 13 objetos, só `SELECT`, todos existem. Role sem `LOGIN`/`SUPERUSER`/
  `BYPASSRLS`.
- **Governança**: `index.ts` envia ao Gemini só `SCHEMA_PROMPT` + pergunta; resultado
  formatado 100% local, sem 2ª chamada de IA. Nenhum caminho passa linha ao modelo.
- **Claim de segurança do diagnóstico**: `EXECUTE` de `executar_consulta_ia` para `anon`/
  `authenticated` confirmado (`has_function_privilege`). Correção é F1.
- **Modelos Gemini** (web, set/2026): free tier = Flash + Flash-Lite; candidatos atuais
  incluem `gemini-3.8/3.7/3.6/3.5-flash` e lites. Premissa de `provedor-llm.md` (existe
  flash gratuito atual; cadeia primário/secundário/terciário viável) se sustenta. Fixar
  IDs é F2/F6.
- **Decisões de produto** da F0 (fronteira explícita, escopo congelado, LLM com direito a
  falhar) — honestas e coerentes com o objetivo.
- **Aderência**: pasta `docs/assistente/` no padrão das Etapas A–D; fluxo de migração
  (`.sql` avulso → `sql/_aplicados/`) alinhado; arquivos no lugar certo; `provedor-llm.md`
  codifica o padrão de comentário datado que já está no `index.ts`.

## Situação

F0 **não liberada** até `rev-correcao` devolver `APROVADO` na re-submissão. Follow-ups
FU-8..FU-22 rastreados para as fases indicadas.
