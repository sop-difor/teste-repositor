# F5 — Expandir o motor de intenções · Revisão

4 lentes, subagentes independentes, contexto limpo. Processo bem mais longo que as fases
anteriores: **8 rodadas de correção** ao longo da fase, quase todas concentradas num único
ponto — como reconhecer quando uma pergunta pede um **valor em R$** em vez de uma
**contagem**. Ver `fase-5-intencoes.md` para o relato completo rodada a rodada; este
documento registra só o veredito final.

## Vereditos (revisão final, fase inteira — commit `f3a1ad8`)

| Lente | Veredito | Resumo |
|---|---|---|
| `rev-seguranca` | **APROVADO** | Zero mudança em Edge Function/`executar_consulta_ia`/grants/RLS nesta fase. As 34 intenções usam só métodos parametrizados do supabase-js; nenhuma tabela fora do escopo. A extensa lógica nova (filtros/valor/contagem) é comprovadamente só sobre roteamento (qual intenção responde, ou nenhuma), nunca sobre montagem de SQL — confirmado lendo o arquivo inteiro e conferindo grants ao vivo em produção. |
| `rev-correcao` | **APROVADO** | Testou ativamente por furos de adjacência no mecanismo final (vírgula, ordem invertida, 10 substantivos de dinheiro com e sem cópula) e não achou nenhum. Reconfirmou 16 casos do gabarito real sem regressão. |
| `rev-produto` | **APROVADO** | Confirmou a cópula ("quantos são os X") funcionando com frases novas em 5 das 13 intenções ancoradas; revisão ponta a ponta de 10 perguntas variadas com respostas claras e a fronteira "resposta imediata"/"gerada — confira" intacta. |
| `rev-aderencia` | **APROVADO** | Conferiu por grep que não sobrou código morto das 8 rodadas (`mencionaFiltroNaoSuportado`/`TEM_MARCADOR_DE_CONTAGEM`/`exigeMarcadorDeContagem` — zero ocorrências); documentação das 8 rodadas coerente entre si; nenhum `.sql` novo. |

**F5: 4/4 APROVADO.** Sem sign-off de usuário exigido (só F1 e F8).

## O caminho até aqui — por que 8 rodadas

Rodada 1-2: achados "clássicos" de recorte ignorado (distrito/empresa mencionados na
pergunta, mas a intenção respondia o total nacional) — a mesma classe que já tinha aparecido
em fases anteriores, resolvida com uma checagem central de filtros declarativa
(`filtrosSuportados`).

Rodadas 3-8: uma única sub-classe recorrente — reconhecer quando a pergunta pede um **valor
em R$** disfarçado de contagem ("quanto custam os contratos...", "qual o total/montante/
despesa/empenho..."). Cada tentativa de listar palavras-chave fechava a leva relatada e uma
rodada depois os revisores achavam outra leva igualmente coerente (verbos → substantivos
orçamentários → substantivo colado no plural "quantos/quantas"). Depois de 2 rodadas de
bloqueio consecutivo pela mesma classe (rodadas 6-7), a decisão foi levada ao usuário, que
escolheu fechar a classe estruturalmente: em vez de reconhecer toda forma de **pedir**
dinheiro (vocabulário aberto, nunca converge), cada intenção passou a declarar qual
substantivo ela sabe **contar** (`marcadorContagemPara(["contrato"])` etc.) — um conjunto
fechado, do próprio domínio — e a checagem central exige essa palavra colada, cedendo para o
caminho LLM em qualquer outra coisa. A rodada 8 (com um ataque ativo de adjacência do
`rev-correcao`) não achou mais nenhum furo nessa classe.

## Achados follow-up consolidados (não bloqueiam, registrados para depois)

| # | Origem | Item | Quando tratar |
|---|---|---|---|
| FU-F5-1 | `rev-produto` | `obras_sem_fiscal` não reconhece "**quais** obras não têm fiscal designado?" (só "quantas...") — a própria frase-exemplo do plano original desta intenção não bate; cede pro LLM (nunca erra), só perde a resposta rápida | Ajuste de 1 padrão regex; F5.2 ou F8 |
| FU-F5-2 | `rev-produto` | Concordância singular/plural pré-existente ("1 contratos...", "1 aditivos...") — cosmético, não introduzido pela F5 | Passe de polimento textual, sem urgência |
| FU-F5-3 | `rev-seguranca` | `escopo-dados.md` diz "13 objetos" no cabeçalho, mas são 15 (9 tabelas + 6 views) — pré-existente | Correção de 1 linha na documentação |
| FU-F5-4 | `rev-seguranca` | Risco residual **restrito e documentado**: `contratos_vencendo`/`obras_prazo_execucao_encerrando` seguem protegidas só por lista de vocabulário (não pelo mecanismo fechado) — um sinônimo de "pede dinheiro" ainda não catalogado pode fazer essas 2 intenções (só essas 2) responderem uma contagem quando a pergunta pedia valor | Decisão consciente do usuário; revisitar se o log do piloto (F8) mostrar uso real dessas 2 perguntas combinado com pedido de valor |
| FU-F5-5 | `rev-aderencia` | `motor_intencoes.ts` cresceu para 1314 linhas ao longo da fase — considerar dividir em módulos (mecanismo de filtros/contagem vs. array de intenções), no mesmo espírito em que a F2 extraiu `guards.ts`/`schema_prompt.ts` | Antes da 2ª leva de intenções guiada pelo log real (pós-F8) |
| FU-F5-6 | `rev-aderencia` | Nit de nomenclatura: a documentação da rodada 5 usa `exigeMarcadorDeContagem`, a rodada 7 renomeia para `marcadorDeContagem`/`marcadorContagemPara` sem dizer explicitamente "renomeado de X" | Cosmético de documentação, sem urgência |

## Situação

**F5 concluída, 4/4 APROVADO.** Motor de intenções em 34 perguntas (de 20), com um
mecanismo declarativo central (`filtrosSuportados` + `marcadorDeContagem`) que resolveu, de
forma estrutural, a classe inteira de "responder um recorte diferente do pedido sem avisar"
— tanto para filtros ignorados (distrito/empresa/status) quanto para contagem-vs-valor.
Nenhuma mudança em banco, Edge Function ou segurança nesta fase.

Próximo: **F6** — isolar `gerarSql()`, prompt com as views largas da F4, exibir o SQL
gerado, marcar confiança, degradar para sugestões. Ver `README.md` para o roteiro completo.
