# Rotina: falha → intenção ou caso de eval

Processo **manual**, sem automação — quem cuida do assistente decide a frequência (ex.:
uma vez por semana durante o piloto). Usa o painel (`assistente-painel.html`, F7) como
fonte.

## Passo a passo

1. Abrir `assistente-painel.html`, seção "Perguntas com falha ou 👎".
2. Para cada pergunta da lista, perguntar:
   - **É uma pergunta razoável, dentro do escopo do assistente (`escopo-dados.md`), que
     um gestor faria de novo?** Se não — pergunta fora do escopo genuína, ou confusa —
     não faz nada. A degradação amigável já é a resposta certa.
   - **Se sim: ela devia ter uma resposta rápida (motor de intenções) e não teve?**
     Vira uma intenção nova em `motor_intencoes.ts`, seguindo o padrão da F5
     (`docs/assistente/fase-5-intencoes.md`): SQL fixo e parametrizado, `filtrosSuportados`
     declarado, testar contra o banco real antes de escrever o código.
   - **Se não precisa ser tão rápida assim, mas o caminho IA errou ou travou nela?**
     Vira um caso novo em `docs/assistente/eval/casos.jsonl` (padrão da F3), com o
     gabarito certo — assim uma mudança futura no prompt não regride essa pergunta sem
     ninguém perceber.
3. Rodar `deno task eval` (motor) e, se tiver a chave do Gemini à mão,
   `deno task eval:llm` (caminho IA) antes de publicar qualquer mudança feita a partir
   deste passo — mesmo processo de revisão das fases anteriores (portão dos 4 revisores
   quando a mudança for grande o suficiente para justificar).

## O que NÃO fazer

- Não "consertar" uma pergunta isolada direto no banco ou por fora do código — o
  objetivo é que a próxima pessoa que perguntar algo parecido também seja bem atendida.
- Não tratar um 👎 isolado como prova de bug — pode ser a pessoa não gostando do
  formato da resposta, não do conteúdo. Ler a pergunta e, se possível, o que a IA
  respondeu (via `sql_gerado` no log, se for o caminho IA) antes de agir.
- Não prometer nada ao usuário sobre quando a correção sai — isso é F8/operação do
  piloto, fora do escopo desta rotina.
