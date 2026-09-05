# F6 — LLM + prompt

**Objetivo:** o caminho LLM (Gemini) — hoje "caixa preta" para o usuário — passa a mostrar o
SQL que gerou, o prompt ganha as views largas da F4 (evita `JOIN` manual arriscado), e a
degradação por falha aponta perguntas concretas em vez de um texto genérico.

## Escopo desta fase (README: `gerarSql()` isolado; prompt com as views largas; exibir SQL;
marcar confiança; degradar para sugestões)

### 1. `construirPromptSql()` isolado (`llm.ts`)

O texto exato enviado ao Gemini (schema + pergunta) estava montado inline dentro do laço de
fallback de `gerarSqlComGemini`. Extraído para uma função pura `construirPromptSql(pergunta)`
— testável sem rede, e permite `eval_run.ts --llm` (F3) imprimir o prompt exato se precisar
depurar por que um caso falhou.

### 2. Views largas da F4 no prompt (`schema_prompt.ts`)

`vw_assistente_obra_completa` e `vw_assistente_processo_completo` (aplicadas em produção na
F4) nunca tinham sido citadas em `SCHEMA_PROMPT` — o caminho LLM não sabia que existiam e
continuava fazendo `JOIN` manual entre `contratos_edificacao`/`ficha_contrato`/
`comissao_fiscalizacao`/`processos`, arriscando o fan-out que a F4 documentou (`id_contrato`
não é chave de `contratos_edificacao`; até 14 obras por contrato). Adicionadas com as
colunas completas e uma instrução explícita: preferir a view larga a montar o `JOIN` na mão
quando a pergunta cruzar esses dados. Resolve os FU-2/FU-3 da revisão da F4 (nomes
assimétricos entre as duas views — `descricao_obra` vs `obra_descricao` — documentados no
prompt para o modelo não se confundir).

### 3. SQL gerado exibido ao usuário (`index.ts`, `assistente.html`)

A Edge Function já gerava e validava o SQL, mas nunca devolvia no JSON de resposta — o
"sempre mostrando o SQL gerado" do `README.md` não estava implementado. Agora a resposta do
caminho `gemini` inclui `sql`; o front-end mostra num bloco recolhível "Ver SQL gerado" sob
a resposta, mono-espaçado.

### 4. Rótulo de confiança consistente com o `README.md`

O badge dizia "análise gerada"; o contrato documentado com o usuário é **"resposta gerada —
confira"**. Alinhado. A fronteira "resposta imediata" (motor de intenções, terreno firme) x
"resposta gerada — confira" (LLM, tem direito a falhar) continua binária, como decidido na
F0 — sem nota de confiança numérica, que o projeto nunca prometeu.

### 5. Degradação aponta perguntas concretas (`index.ts`, `assistente.html`)

Antes: ao degradar (`fora_do_escopo` ou falha total da cadeia de modelos), o texto dizia
"use uma das perguntas sugeridas" mas não anexava nenhuma — o usuário tinha que rolar até os
chips estáticos do rodapé, que não mudam. Agora a Edge Function devolve `sugestoes: string[]`
(3 perguntas fixas e curadas, já cobertas pelo motor de intenções — nunca aleatórias, para o
comportamento ficar previsível e testável) junto da mensagem de degradação, e o front-end
mostra chips clicáveis grudados naquela mensagem específica.

`esclarecimento` (pergunta ambígua) não muda — já pede o detalhe que falta, comportamento
correto, fora do escopo desta fase.

## Fora do escopo desta fase

- Confidence score numérico do modelo — o projeto nunca prometeu isso (F0: fronteira
  binária terreno-firme/gerada-confira).
- Reescrever a cadeia de fallback de modelo ou os `guards.ts` — já corretos desde F2/F3,
  não tocados aqui.
- 👍/👎 e painel de observabilidade — isso é F7.
