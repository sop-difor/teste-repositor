# F4 — Views largas para Q&A · Revisão

4 lentes, subagentes independentes, contexto limpo. Rodada 1 sobre o commit `5a84bb3`;
`rev-correcao` bloqueou; correção no commit `1a9bbcb`; `rev-correcao` reconferiu (rodada 2)
só o que motivou o bloqueio, conforme `revisores.md` §6.

## Vereditos

| Lente | Rodada 1 | Rodada 2 |
|---|---|---|
| `rev-seguranca` | **APROVADO** — `security_invoker` confirmado real (não `security_definer`); `executar_consulta_ia` intacta; as 4 tabelas-fonte já estavam no escopo; achou e investigou a fundo um alarme falso (`anon`/`authenticated` aparecem no catálogo de grants por `ALTER DEFAULT PRIVILEGES` pré-existente do schema — testado ao vivo com `SET ROLE anon`, RLS das tabelas-fonte zera igual às 4 views antigas, zero exposição nova) | — (achado não era de segurança, não precisou rodar de novo) |
| `rev-correcao` | **BLOQUEADO** — `fiscais`/`fiscais_matriculas` eram 2 `string_agg(distinct...)` independentes; nome e matrícula saíam emparelhados **trocados** em 7 das 9 obras reais com 2 fiscais (78%) | **APROVADO** — reconferiu as 9 obras uma a uma (9/9 corretas), testou `EXPLAIN`, obra sem fiscal, e um caso sintético de homônimo (nenhum existe hoje, mas o comportamento seria seguro mesmo assim) |
| `rev-produto` | **APROVADO** — nomes de coluna majoritariamente claros; campos em branco (sem ficha/fiscal/processo) é a postura certa | — |
| `rev-aderencia` | **APROVADO** — `.sql` no padrão de F1/F2; docs consistentes; `STATUS_PROCESSO_FORA_TRAMITACAO` idêntico caractere-a-caractere entre SQL e TS (conferido por hexdump) | — |

**F4: 4/4 APROVADO.** Sem sign-off de usuário exigido (só F1 e F8).

## O achado bloqueante — e por que a rodada 1 não pegou sozinha

`string_agg(distinct cf.nome_completo, ', ')` e `string_agg(distinct cf.matricula, ', ')`
são duas agregações que cada uma ordena **pelo próprio valor**. Ordem alfabética de nome
não tem relação com ordem lexicográfica de matrícula — o número de itens bate (por isso a
verificação C original, que testou só 1 obra, passou por coincidência), mas a posição N-ésima
de uma lista não corresponde à posição N-ésima da outra. Achado real, silencioso, do tipo
mais perigoso: parece certo e não é.

**Lição incorporada**: a verificação C virou "cruzar as 9 obras com 2 fiscais, não citar 1
exemplo" (ver `sql/assistente/f4_views.sql`, bloco de verificação). Um exemplo único nunca
prova ausência de bug de pareamento — só a mesma coincidência que escondeu o problema.

## Follow-ups incorporados (commit `1a9bbcb`)

| # | Origem | Item | Resolução |
|---|---|---|---|
| — | `rev-correcao` (bloqueante) | fiscal/matrícula trocados | `string_agg` sobre subselect deduplicado único, ordenado pela mesma chave |
| FU-1 | `rev-correcao` | Filtro de exclusão de `processos` divergia da convenção (`data_exclusao` vs `excluido_por` que `vw_gecope_revisao_*` usa) | Alinhado a `excluido_por is null` |
| FU-seg-1 | `rev-seguranca` | `escopo-dados.md` não avisava sobre o catálogo de grants vs. RLS real | Nota acrescentada em "Como o escopo é imposto" |
| — | `rev-aderencia` | Convenção `vw_assistente_*` sem registro explícito | Registrada em `escopo-dados.md` |
| — | `rev-aderencia` | Cabeçalho do `.sql` menos formal que F1/F2 | Alinhado (projeto/produção/aplicar manualmente/idempotente/transacional) |
| — | `rev-aderencia` | Bloco de verificação comentado incompleto (só A/B/G/H/J) | Completo: C (agora cruzando as 9 obras), D, E, F |

## Follow-ups para fases futuras

| # | Origem | Item | Fase |
|---|---|---|---|
| FU-2 | `rev-produto` | `delta_reperc` é nome técnico; renomear ou explicar no prompt/apresentação | F6 |
| FU-3 | `rev-produto` | Assimetria de nome entre as duas views para o mesmo dado de obra (`descricao_obra` vs `obra_descricao`) | F6 (ao documentar as views no prompt) |
| FU-4 | `rev-produto` | Coluna `obra_vinculada: boolean` explícita em `vw_assistente_processo_completo`, em vez de inferir pelo campo em branco | F5/F6 |
| FU-5 | `rev-produto` | `fiscais` como string com vírgula pode confundir dentro de uma lista formatada — considerar manter estruturado se a F6 mudar a formatação da resposta | F6 |
| FU-6 | `rev-produto` | Falta campo tipo `dias_desde_abertura` em `vw_assistente_processo_completo` (existe `dias_a_vencer`/`dias_paralisado` na view de obra) | F5/F6 |
| FU-7 | `rev-seguranca` | Considerar `ALTER DEFAULT PRIVILEGES ... REVOKE ALL FROM anon, authenticated` no schema `public`, para não depender silenciosamente da RLS estar sempre certa em objetos futuros | decisão do usuário, sem pressa |
| FU-8 | `rev-aderencia` (achado incidental) | `contratos_edificacao` tem 2 índices `UNIQUE` redundantes sobre `codigo_obra` | limpeza de schema, sem urgência |

## Situação

**F4 concluída, 4/4 APROVADO** (após 1 ciclo de correção). Duas views em produção,
conferidas com dados reais: `vw_assistente_obra_completa` (352 linhas) e
`vw_assistente_processo_completo` (416 linhas). Nenhuma mudança na Edge Function nem no
banco de segurança (`executar_consulta_ia` intocada).

Próximo: **F5** — expandir o motor de intenções (~20 → ~40-60), "guiado pelo log". Ver
nota de atenção: o log de uso real (`consultas_ia_log`) ainda tem pouquíssimos registros
reais (o piloto ainda não começou — F8) — vale decidir com o usuário se a F5 espera mais
uso real acumular, ou se avança com as perguntas mais óbvias do domínio já conhecidas
pela equipe, sem esperar o log.
