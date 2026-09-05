# F5 — Expandir o motor de intenções (primeira leva)

**Objetivo:** cobrir mais perguntas comuns no caminho determinístico (rápido, sem custo,
sem depender da cota do Gemini), reduzindo o quanto o caminho LLM precisa ser acionado.

## Desvio do plano original — e por quê

O README previa esta fase "guiada pelo log" de uso real do piloto. **O piloto ainda não
começou** (é a F8) — `consultas_ia_log` tem pouquíssimos registros reais, não o suficiente
para apontar quais perguntas priorizar. Decisão do usuário: avançar mesmo assim, guiado
por **conhecimento de domínio** (perguntas óbvias que a própria equipe GECOPE já sabe que
vai fazer) em vez de esperar o log acumular. Por isso "primeira leva": não é a expansão
final de 20→40-60 prevista, é um passo guiado por outra fonte de sinal — uma segunda leva,
guiada pelo log de verdade, fica para depois que o piloto (F8) gerar uso real.

## O que muda

### `supabase/functions/gecope-assistant/motor_intencoes.ts`

**14 intenções novas** (de 20 para 34) + 1 padrão novo numa intenção existente:

| # | Intenção | Gatilho (exemplo) | Fonte |
|---|---|---|---|
| 26 | `total_obras_execucao` | "quantas obras estão em execução?" | conversão de `llm-01` |
| 27 | `total_processos_geral` | "quantos processos existem no total?" | conversão de `llm-07` |
| 28 | `total_aditivos_geral` | "quantos aditivos existem no total?" | conversão de `llm-03` |
| 29 | `tipos_aditivo_resumo` | "quais os tipos de aditivo e quantos de cada?" | conversão de `llm-15` |
| 30 | `aditivos_por_tipo` | "quantos aditivos são do tipo Reajuste de Preço?" | conversão de `llm-04/05/16` |
| 31 | `municipio_mais_contratos` | "qual o município com mais contratos?" | conversão de `llm-18` |
| 32 | `obras_sem_fiscal` | "quais obras não têm fiscal designado?" | **novo** — habilitado pela F4 (mesmo anti-join da view) |
| 33 | `contratos_vigencia_status` | "quantos contratos estão vigentes / com vigência vencida?" | **novo** |
| 34 | `total_distritos` | "quantos distritos operacionais diferentes existem?" | conversão de `llm-09` |
| 35 | `total_contratadas` | "quantas empresas contratadas diferentes existem?" | conversão de `llm-10` |
| 36 | `total_fichas_contrato` | "quantas fichas de contrato existem?" | conversão de `llm-08` |
| 37 | `total_medicoes` | "quantas medições foram registradas no total?" | conversão de `llm-06` |
| 38 | `valor_total_contratos` | "qual o valor total dos contratos?" | **novo** |
| 39 | `distrito_mais_contratos` | "qual distrito tem mais contratos?" | **novo** |
| — | `contratos_por_contratante` (existente) ganha padrão `/quantas?\s+obras?.*contratou/i` | "quantas obras a SOP contratou?" | conversão de `llm-13` |

**`TIPOS_ADITIVO`** (lista fixa, os 8 valores confirmados em `schema_dicionario.md`) +
**`encontrarTipoAditivo()`** — mesma lógica de "mais específico primeiro" de
`encontrarMencionado`, mas contra a lista fixa em vez de valores carregados do banco.

### Cuidado com colisão de regex (ordem = prioridade)

`tentarIntencao` testa os padrões na ordem do array e para na primeira intenção cujo
`executar` devolver não-nulo. Cada padrão novo foi desenhado para **não** casar
acidentalmente com perguntas que já tinham intenção própria (ex.: `total_processos_geral`
exige "processos" seguido **imediatamente** de "existem"/"há" — não casa com "processos
**de replanilhamento** temos em tramitação", que tem intenção própria). Verificado:
- Rodando o eval completo — nenhuma das intenções antigas regrediu.
- Rodando `tentarIntencao` diretamente contra as 10 perguntas de `llm_nao_sei`/`ambigua`
  do eval — nenhuma foi "sequestrada" por uma regra nova (deveriam continuar caindo no
  caminho LLM, sem intenção nenhuma batendo). Confirmado: as 10 continuam sem intenção.

## `docs/assistente/eval/casos.jsonl`

- **13 casos reclassificados** de `llm_dado`/`intencao_formato` para `intencao_exata`
  (agora respondidos pelo motor de regras, não pelo Gemini): `llm-01, 03, 04, 05, 06, 07,
  08, 09, 10, 13, 15, 16, 18`. `llm-18` também passou de `formato` (precisava conferência
  manual) para `contem` (valor determinístico e estável: FORTALEZA/48).
- **5 casos novos**: `int-19` (obras sem fiscal, 72), `int-20`/`int-21` (contratos
  vigentes/vencidos, 337/15), `int-22` (valor total dos contratos), `int-23` (distrito com
  mais contratos, RM Fortaleza/103).

## Como verificar a F5

| # | Verificação | Esperado | Resultado (04/09/2026) |
|---|---|---|---|
| A | `deno check motor_intencoes.ts index.ts` | compila | ✅ |
| B | `deno task eval` | `intencao_exata` ≥95%, `seguranca` 100% | ✅ **32/32 (100%) intenções, 8/8 (100%) segurança** |
| C | `tentarIntencao` direto contra as 10 perguntas `llm_nao_sei`/`ambigua` | nenhuma intenção bate | ✅ **10/10 sem intenção** (nenhum sequestro) |
| D | Valores conferidos contra produção antes de escrever o código (não depois) | bater | ✅ todos os 14 valores de referência vieram de SQL só-leitura rodada antes do código (ver commit) |

## Correção pós-revisão (rodada 2) — 3 dos 4 auditores bloquearam

**`rev-produto` bloqueou**: `total_obras_execucao`, `valor_total_contratos` e
`obras_sem_fiscal` tinham regex sem âncora — "quantas obras estão em execução **no
distrito de Crato**?" batia no padrão e devolvia o total **nacional** (221) como se fosse
o recorte, sem avisar que o distrito foi ignorado. Número errado apresentado como certo.

**`rev-correcao` bloqueou** (achado independente, mesma classe de bug, via leitura
estática + testes reais):
1. `contratos_vencendo` (`/contratos?.*venc/i`, intenção pré-existente, posição 2 do
   array) casa em "venc**ida**" — sequestrava toda pergunta sobre "vigência vencida"
   **antes** de `contratos_vigencia_status` (posição 33) ser alcançada. Os dois números
   coincidiam em 15 por acaso hoje, escondendo que a intenção **errada** respondia (o eval
   só confere o número, não qual intenção respondeu — achado à parte, ver FU-9).
2. `contratos_por_distrito` (`/contratos?.*distrito/i`, pré-existente) casa "contrato"
   como **prefixo** de "contrat**ou**" (sem `\b`) — "quantas obras a SOP **contratou** no
   distrito de Crato?" batia essa intenção e devolvia o total do distrito **inteiro** (46),
   ignorando o filtro por SOP.

**`rev-aderencia` bloqueou** o mesmo achado do `rev-correcao` (item 1 acima), encontrado
de forma independente por leitura estática do array.

### Correção

- `contratos_vencendo`: `/contratos?\b.*venc(?!id)/i` — exige borda de palavra e exclui
  "vencid[ao]" (que agora é só de `contratos_vigencia_status`).
- **Todo padrão do arquivo com `contratos?` sem borda de palavra** ganhou `\b` (achado do
  `rev-correcao`: "padrões antigos e largos são ímã de colisão estrutural" — em vez de
  corrigir só o caso relatado, apertei os ~8 padrões que tinham o mesmo risco).
- `total_obras_execucao`: passou a aceitar filtro de distrito de verdade (mesma lógica de
  `contratos_paralisados`) em vez de ignorá-lo.
- Nova função `mencionaFiltroNaoSuportado(supabase, pergunta)`: `true` se a pergunta cita
  um distrito/contratada/contratante conhecido. Intenções de "total geral" que não
  implementam esse filtro (`total_processos_geral`, `total_aditivos_geral`,
  `total_fichas_contrato`, `total_medicoes`, `total_distritos`, `total_contratadas`,
  `valor_total_contratos`, `obras_sem_fiscal`, `contratos_vigencia_status`,
  `tipos_aditivo_resumo`, `aditivos_por_tipo`) passaram a chamá-la primeiro e devolver
  `null` (cede para o LLM) em vez de responder o total nacional como se fosse o recorte.
  `municipio_mais_contratos`/`distrito_mais_contratos` usam uma checagem parcial (só
  contratada/contratante — mencionar um distrito ali É a própria pergunta, não deveria
  bloquear).
- `contratos_por_contratante`: ganhou a mesma checagem específica para distrito (mantém a
  checagem de contratante, que é o filtro que ela sabe aplicar).
- `encontrarTipoAditivo` passou a reaproveitar `encontrarMencionado` (elimina a duplicação
  que o `rev-aderencia` apontou como follow-up, e ganha de brinde o `.sort()` defensivo).
- Comentário de `TIPOS_ADITIVO` corrigido (não é "comprimento decrescente" estrito — é
  "cada valor antes de qualquer superstring sua na lista").

**Reverificado**: `deno check` limpo; `deno task eval` → `intencao_exata` 32/32 (100%),
`seguranca` 8/8 (100%); as 10 perguntas de recusa/ambíguas continuam sem intenção nenhuma
batendo; e um script à parte testando as 8 perguntas exatas dos 3 achados (não só o
número — o `intencaoId` que respondeu) — 8/8 corretas, incluindo o valor real de "obras em
execução no distrito de Crato" = **23** (era 221 antes da correção).

## Correção de causa raiz (rodada 3) — 4 de 4 auditores bloquearam de novo

A correção pontual da rodada 2 resolveu os 2 casos relatados, mas cada um dos 4 revisores,
de forma independente, achou **outra intenção com o mesmo tipo de bug** que a correção não
cobriu — o padrão de "consertar um caso e achar outro na rodada seguinte" já tinha se
repetido uma vez (rodada 1 → rodada 2) e se repetiu de novo (rodada 2 → rodada 3). Pelo
processo combinado com o usuário (`revisores.md` §6: 2 rodadas de `BLOQUEADO` na mesma fase
escalam para o usuário decidir), essa decisão subiu — o usuário escolheu **resolver a causa
raiz** em vez de continuar corrigindo caso a caso.

**Achados da rodada 3** (todos a mesma classe de bug: uma intenção aplica só PARTE dos
qualificadores que a pergunta pede, e responde um recorte mais amplo/errado sem avisar):

| Revisor | Achado |
|---|---|
| `rev-seguranca` | `total_obras_execucao` (corrigida na rodada 2 para distrito) ainda ignorava contratada/contratante — "quantas obras a Forteks tem em execução?" respondia o total nacional |
| `rev-correcao` | `obras_por_contratada` ignorava distrito — "quantos contratos a SEDUC tem no distrito de Crato?" responderia 158 em vez de 23 (conferido com SQL real); `contratos_por_distrito` ignorava status de vigência — "vigência vencida no distrito de Crato" responderia 46 em vez de 9 |
| `rev-produto` | `contratos_por_distrito` também sequestrava "valor total dos contratos no distrito de X" e respondia uma **contagem** em vez do valor em R$ — a correção da rodada 2 em `valor_total_contratos` nunca era alcançada nessa frase; `contratos_por_contratante` ainda tinha 2 padrões sem `\b` (a alegação da rodada 2 de "todo padrão ganhou `\b`" não era verdade) |
| `rev-aderencia` | os mesmos 2 padrões sem `\b` em `contratos_por_contratante`, achados por leitura estática |

### A correção: checagem central de filtros, não mais uma guarda por intenção

Em vez de continuar corrigindo intenção por intenção, cada intenção agora **declara**
(`filtrosSuportados: TipoFiltro[]`) quais qualificadores ela sabe de fato aplicar —
`distrito`, `contratada`, `contratante`, `statusVigencia` (vencida/vigente) ou `valor`
(pede R$, não contagem — restrito à frase "valor total" para não colidir com o tipo de
aditivo "Valor"). Uma função central, `detectarFiltrosMencionados()`, roda uma vez por
pergunta em `tentarIntencao()` e cede automaticamente (nem chama `executar()`) sempre que a
pergunta menciona um qualificador fora da lista declarada da intenção que bateu o regex —
tenta a próxima intenção do array, ou por fim cai no caminho LLM.

Isso substitui as ~11 chamadas manuais espalhadas de `mencionaFiltroNaoSuportado()`
(removida) por uma única checagem que **não depende de lembrar de instrumentar cada
intenção nova** — inclusive fechou, de graça, casos que nenhum revisor tinha relatado ainda
(ex.: `contratos_vigencia_status` nunca soube filtrar por distrito). Também corrigidos os 2
padrões sem `\b` remanescentes em `contratos_por_contratante`.

### Verificação

Sem credenciais de produção nesta sessão para rodar `deno task eval` (precisa de
`SUPABASE_SERVICE_ROLE_KEY`, mantida só em memória em sessões anteriores, não persistida).
Em vez disso:
- `deno check motor_intencoes.ts index.ts` — compila limpo.
- Script contra um Supabase falso chamando a função **real** `tentarIntencao()` (não uma
  reimplementação): os 5 casos que os 4 revisores relataram na rodada 3 agora cedem
  (`null`) corretamente, e as 7 perguntas mais próximas de regredir (do gabarito da F3/F5)
  continuam respondendo pela mesma `intencaoId` de antes.
- Segundo script, mais amplo, rodando as 34 perguntas `intencao_exata`/`intencao_formato`
  do gabarito completo (`casos.jsonl`) mais as `llm_nao_sei`/`ambigua` (que devem continuar
  sem bater intenção nenhuma) contra a função real: **48/48 corretas**. Achado incidental,
  não relacionado a esta correção: `llm-14`/`llm-17` (categoria `llm_dado` no gabarito) já
  batem em `contratos_aguardando_os`/`contratos_percentual_aditivo_alto` mesmo antes da F5
  — os padrões dessas duas intenções não exigem a palavra "contratos" — mesma situação
  pré-existente já observada em `llm-11`. Não é regressão desta correção; registrado como
  observação para o gabarito refletir a categoria certa, sem prioridade.
- `deno task eval` completo com credenciais reais (números do banco) fica pendente de
  quem tiver a `service_role` à mão — recomendado antes do sign-off final da fase, embora
  a checagem central não altere nenhum valor numérico dentro dos `executar()`, só a decisão
  de QUAL intenção (ou nenhuma) responde.

### Correção pós-revisão da rodada 3 — 3 de 4 auditores bloquearam

A checagem central resolveu a classe de bug relatada, mas 3 dos 4 revisores acharam furos na
própria mecânica nova (a checagem central só é tão boa quanto a declaração/detecção por trás
dela):

| Revisor | Achado |
|---|---|
| `rev-seguranca` + `rev-correcao` (independentes) | `obras_por_contratada` declarava suportar `contratada` **e** `contratante`, mas só aplicava um dos dois — achar uma contratada descartava a busca por contratante em silêncio ("Forteks com a SEDUC" respondia o total da Forteks, ignorando a SEDUC) |
| `rev-seguranca` + `rev-correcao` (independentes) | `statusVigencia` só reconhecia a forma feminina "vencida" — "contratos **vencidos**" (concordando com "contratos", a forma mais natural) não era detectado, reabrindo o achado original de vigência ignorada |
| `rev-produto` | `valor` só disparava na frase exata "valor total" — "quanto **custam**...", "qual o **valor dos** contratos...", "quanto **vale**..." escapavam da proteção |
| `rev-correcao` (follow-up) | "valores totais" (plural) também não disparava `valor` |

Corrigido: `obras_por_contratada` agora busca contratada e contratante de forma independente
e aplica os dois como filtro (AND) quando ambos aparecem, em vez de descartar o segundo;
`statusVigencia` passou a reconhecer "vencido(s)" além de "vencida(s)"; `valor` passou a
cobrir "valor de/dos/da/das X", "quanto custam/vale(m)/foi gasto" e o plural "valores
totais", mantendo o cuidado de não colidir com o tipo de aditivo "Valor" (script de teste
próprio confirma "quantos aditivos são do tipo Valor?" continua respondendo direto).

Reverificado: `deno check` limpo; os dois scripts de teste (o dos 5+4 casos-alvo e o de
48 perguntas do gabarito completo) rodados de novo — 16/16 e 48/48.

### Correção pós-revisão da rodada 4 — detector de "valor" trocado por palavra + verbos

`rev-produto` bloqueou de novo (a 3ª vez seguida no mesmo ponto): a lista de frases exatas
para `valor` ("valor total", "valor de/dos/da/das X", "quanto custam/vale(m)/gasto") ainda
deixava passar "quanto foi **investido**..." — e nem "**valor** investido..." batia, porque
exigia uma preposição específica logo depois de "valor" que "investido" não é.

Trocado o método: em vez de continuar enumerando frases exatas (que sempre deixava faltar
mais uma variação), agora a checagem é **a palavra "valor(es)" sozinha, mais uma lista de
verbos do campo semântico de "pedir dinheiro"** (custar, gastar, investir, valer, preço) —
não depende mais de acertar a preposição ou a ordem das palavras. A exceção continua sendo
só para os 2 contextos reais de colisão: "valor"/"preço" como nome de um `tipo_aditivo`
("...do tipo Valor", "...tipo Reajuste de Preço" — 2 dos 8 valores fixos de
`TIPOS_ADITIVO`), detectada por exigir a palavra "tipo" também presente (não só
"valor"/"preço" isolados); e a frase fixa "supressão de valor".

Dois bugs próprios pegos e corrigidos durante esta correção, antes de submeter para revisão
(script de teste ampliado apontou os dois):
- Meu primeiro regex para o plural ("totais") estava errado — "totais" não é "total" + "s",
  é uma forma irregular; a regra `total(is)?` fazia o SINGULAR parar de bater. Corrigido para
  `tota(l|is)`.
- `normalizar()` (função já existente no arquivo) remove acento **e cedilha** — "preço" vira
  "preco". Meu primeiro regex tinha um "ç" literal, que nunca bateria contra o texto já
  normalizado. Corrigido para comparar contra "preco" (sem cedilha), com cuidado extra para
  não confundir com "preciso"/"precisar" (que também começam com "prec" depois de perder o
  acento, mas não têm nada a ver com dinheiro).

Reverificado: `deno check` limpo; os dois scripts de teste — agora com 20 casos-alvo
(incluindo "investido", "preço" e o caso adversarial "preciso") e as 48 perguntas do
gabarito completo — **20/20 e 48/48**.

### Correção pós-revisão da rodada 4 (parte 2) — "total"/"montante"/"soma"

`rev-correcao` bloqueou de novo, testando contra o commit anterior mesmo (achado
independente do `rev-produto`, no mesmo veredito): "qual o **total**/**montante**/**soma**
dos contratos no distrito de Crato?" (sem a palavra "valor") ainda escapava. Recomendação do
revisor: parar de listar sinônimos e inverter a lógica (allowlist do formato "conta", não
blocklist do formato "pede valor"). Avaliado e não adotado nesta rodada — o vocabulário de
"pedir um total em R$" em português formal de governo é razoavelmente fechado (valor, custar,
gastar, investir, valer, preço, montante, soma, "o total de X"), e trocar a estratégia agora
significaria reescrever o gatilho de várias das 34 intenções (risco maior de regressão do que
adicionar mais 3 palavras a uma lista já testada). Registrado como decisão a revisitar se uma
5ª rodada achar mais um sinônimo.

Adicionado: `montante`/`soma` (palavras sem ambiguidade neste domínio) e um padrão específico
para "o total de/dos/da/das X" — **não** a palavra "total" sozinha, porque isso colidiria com
"no total"/"ao todo" (usado por várias intenções de contagem já existentes, ex.: "quantos
processos existem **no total**?" precisa continuar respondendo direto). O padrão exige o
artigo "o"/"os" logo antes de "total(is)" e uma preposição partitiva logo depois — distingue a
forma substantiva ("o total dos contratos" = pedido de soma em R$) da forma adverbial ("no
total" = "ao todo", modificando uma pergunta de contagem).

Reverificado: `deno check` limpo; scripts de teste — 25/25 casos-alvo (incluindo os 3 casos
desta rodada e 2 casos adversariais confirmando que "no total" continua respondendo direto) e
48/48 no gabarito completo.

### Correção pós-revisão da rodada 5 — vira estrutural de vez

`rev-produto` e `rev-correcao` bloquearam de novo, **os dois pela 5ª vez seguida no mesmo
ponto**, e desta vez os dois concordaram explicitamente: o problema não é faltar mais um
sinônimo, é o método. `rev-produto` achou "despesa"/"dispêndio"/"pago" escapando —
"despesa" em especial é vocabulário central de execução orçamentária pública (empenho →
liquidação → pagamento/despesa), não um caso de canto. `rev-correcao` foi além: achou que o
mesmo vazamento se repete em **4 intenções diferentes** (`contratos_por_distrito`,
`total_aditivos_geral`, `total_processos_geral`, `total_obras_execucao`) sempre que um
sinônimo de "pede valor" ainda não catalogado aparece — e explicou por quê estruturalmente:
dos 5 tipos de filtro (`distrito`/`contratada`/`contratante`/`statusVigencia`/`valor`),
`valor` é o único detectado por **vocabulário aberto** (lista de sinônimos) em vez de um
**conjunto fechado** (os outros vêm do banco ou têm só 2 formas gramaticais) — por isso só
ele precisou de correção 5 vezes seguidas.

### A correção: marcador gramatical de contagem, não lista de palavras

Em português, "quant**os**/quant**as**" (plural) é a forma inequívoca de pedir uma
**contagem**; "quant**o**/quant**a**" (singular) é a forma de pedir um **valor** ("quanto
custa", "quanto foi gasto") — o oposto exato. Em vez de continuar tentando reconhecer toda
palavra que pede dinheiro, as intenções que só sabem **contar** (nunca somar em R$) e cujo
gatilho é amplo demais (ex.: só "contratos" + "distrito", sem exigir nenhuma palavra de
contagem) passam a exigir também "quantos"/"quantas"/"quais" na pergunta —
`exigeMarcadorDeContagem` no objeto `Intencao`, checado centralmente em `tentarIntencao()`,
no mesmo padrão de `filtrosSuportados`. Isso fecha qualquer sinônimo de "pede valor", **já
catalogado ou não**, porque deixa de depender de reconhecer a palavra específica.

Aplicada a 13 intenções cujo uso real no gabarito já inclui essa palavra (não regride nada
testado): `contratos_paralisados`, `obras_por_contratada`, `contratos_aguardando_os`,
`contratos_por_distrito`, `contratos_por_contratante`, `processos_em_tramitacao`,
`processos_por_empresa`, `total_obras_execucao`, `total_processos_geral`,
`total_aditivos_geral`, `aditivos_por_tipo`, `obras_sem_fiscal`,
`contratos_percentual_aditivo_alto`. Duas intenções ficaram de fora — `contratos_vencendo`
("Contratos vencendo no próximo mês", estilo tópico, sem "quantos/quantas/quais" no
gabarito) e `obras_prazo_execucao_encerrando` (mesmo estilo, sem cobertura de gabarito) —
essas continuam protegidas só pela lista de vocabulário (`PALAVRAS_PEDIDO_DE_VALOR`), que
permanece como segunda camada de defesa para os casos onde o marcador gramatical não é
aplicável e para as 13 intenções tocadas (nada foi removido, só adicionado).

Reverificado: `deno check` limpo; scripts de teste — **33/33** casos-alvo (incluindo os 8
vazamentos desta rodada, mais 2 sinônimos propositalmente NÃO catalogados — "quantia",
"recursos" — para confirmar que a proteção não depende mais de listar palavra por palavra) e
**48/48** no gabarito completo.

### Correção pós-revisão da rodada 6 — "quantos/quantas" + substantivo de dinheiro

`rev-produto` aprovou (testou 8 sinônimos novos — liquidado, desembolso, onerou, repasse,
custeio, verba, aporte, subvenção — todos cederam corretamente). `rev-correcao` bloqueou de
novo, com um achado genuinamente novo, não mais "faltou um sinônimo do jeito antigo": o
marcador gramatical (`TEM_MARCADOR_DE_CONTAGEM`) barra o singular "quanto" (pede valor), mas
não previa que o **substantivo depois do plural** "quantos/quantas" também pudesse ser sobre
dinheiro — "quant**os reais**", "quant**as** verbas/despesas/recursos" são plurais
gramaticalmente corretos, mas pedem uma soma em R$, não uma contagem de registros. Achado
reproduzido em 7 das 13 intenções ancoradas na rodada 5, mais o risco residual (já conhecido)
nas 2 intenções que ficaram de fora do marcador.

Correção: adicionados à lista de vocabulário (camada 1, `PALAVRAS_PEDIDO_DE_VALOR` —
compartilhada por **todas** as intenções, inclusive as 2 sem marcador de contagem) os
substantivos de dinheiro do domínio público que podem seguir "quantos/quantas": `reais`,
`verba(s)`, `recurso(s)`, `despesa(s)`, `dotação/dotações`, `orçamento(s)`. Isso fecha os 7
vazamentos confirmados e, de brinde, o risco residual das 2 exceções (que dependiam só desta
camada). Risco aceito conscientemente: "recursos" também pode significar "recurso
administrativo" (apelação de um processo) em vez de "recursos financeiros" — na dúvida, cede
para o LLM em vez de arriscar uma contagem errada, que é sempre o comportamento seguro aqui.

Reverificado: `deno check` limpo; scripts de teste — **40/40** casos-alvo (incluindo os 7
vazamentos desta rodada e os 2 casos das intenções-exceção) e **48/48** no gabarito completo.

### Correção pós-revisão da rodada 7 — fechamento definitivo (decisão do usuário)

`rev-correcao` bloqueou pela 7ª vez seguida, testando de propósito mais 10 substantivos de
dinheiro do serviço público não catalogados (empenho, liquidação, aporte, subsídio, provisão,
repasse, desembolso, subvenção, indenização, crédito orçamentário) — **as 10 vazaram**, com
um agravante: quando o vocabulário falha em reconhecer a palavra, o sistema não cede com
segurança — ele responde a contagem normalmente, como se a pergunta fosse sobre contagem
mesmo. A "rede de segurança" só existe quando a detecção funciona; 3 rodadas seguidas (5, 6,
7) mostraram que uma lista aberta de "palavras que pedem dinheiro" em português nunca
converge — cada tentativa fechava a leva anterior e abria espaço para a próxima.

**Decisão do usuário, apresentada com 3 caminhos** (continuar catalogando palavras / aceitar
o risco residual documentado e seguir / fechar de vez tecnicamente): **fechar de vez**.

### A correção definitiva

Troca de perspectiva: em vez de tentar reconhecer toda pergunta que PEDE dinheiro (vocabulário
aberto, nunca converge), cada intenção-de-contagem passa a declarar explicitamente **qual
substantivo ela sabe contar** (`marcadorContagemPara(["contrato"])`,
`marcadorContagemPara(["obra"])` etc. — conjunto FECHADO, o próprio vocabulário do domínio) e
exige que "quantos/quantas" (ou "quais") venha **colado** nesse substantivo específico — não
em qualquer lugar da pergunta. "Quantos **empenhos** os contratos do distrito de Crato
tiveram?" tem "quantos", mas colado em "empenhos", não em "contratos" — não bate mais em
`contratos_por_distrito`, cede para o LLM, seja qual for a palavra de dinheiro usada, mesmo
uma nunca vista antes.

Isso substitui o mecanismo da rodada 5 (`TEM_MARCADOR_DE_CONTAGEM`, que só checava se
"quantos/quantas/quais" apareciam em QUALQUER posição da pergunta — brecha que a rodada 6
explorou) pelo mesmo padrão declarativo já usado com sucesso em `filtrosSuportados` desde a
rodada 3: a intenção diz o que sabe fazer, a checagem central impõe isso, e não depende mais
de listar cada exceção. Aplicado às mesmas 13 intenções da rodada 5. A lista de vocabulário
(`PALAVRAS_PEDIDO_DE_VALOR`) foi mantida como segunda camada — não porque ainda seja
necessária para as 13 intenções ancoradas (o mecanismo fechado já cobre tudo, catalogado ou
não), mas porque é a única proteção das 2 intenções de estilo tópico
(`contratos_vencendo`/`obras_prazo_execucao_encerrando`), que não têm "quantos/quantas/quais"
no uso real e por isso não puderam receber o marcador fechado — risco residual restrito a
essas 2, documentado conscientemente, não uma alegação de cobertura total.

Reverificado: `deno check` limpo; scripts de teste — **50/50** casos-alvo (incluindo os 10
substantivos de dinheiro da rodada 7, testados sem cadastrar nenhum deles em
`PALAVRAS_PEDIDO_DE_VALOR`, para provar que o fechamento vem do mecanismo, não de mais uma
palavra na lista) e **48/48** no gabarito completo.

### Rodada 8 — os dois revisores que bloqueavam aprovam; melhoria de cobertura

`rev-produto` e `rev-correcao` aprovaram a correção da rodada 7. `rev-correcao` testou de
propósito por mais furos na adjacência (vírgula, ordem invertida, dois substantivos
ambíguos, os 10 substantivos da rodada 7 de novo) e não achou nenhum — considerou a classe
fechada para as 13 intenções ancoradas. `rev-produto` aprovou e trouxe um follow-up de
cobertura (não bloqueante, nunca dá resposta errada): "quantos **são os** contratos..."/
"quais **são as** obras..." (com cópula no meio) ainda caíam no LLM à toa, porque o marcador
exigia colamento direto. Corrigido no mesmo commit — `marcadorContagemPara` passou a aceitar
"é/são/estão" e o artigo entre a interrogativa e o substantivo, mantendo o cuidado de exigir
fronteira de palavra depois de cada uma (para "é" não absorver a primeira letra de palavras
como "empenhos").

Risco residual confirmado e mantido consciente (achado do `rev-correcao`, reproduzido de
propósito): as 2 intenções de estilo tópico (`contratos_vencendo`,
`obras_prazo_execucao_encerrando`) ainda ignoram um substantivo de dinheiro se a pergunta
não usar nenhuma das palavras já catalogadas em `PALAVRAS_PEDIDO_DE_VALOR` — ex.: "quantos
repasses os contratos vão vencer no próximo mês?" ainda responde a intenção errada. Restrito
a essas 2, documentado, não corrigido nesta leva.

Reverificado: `deno check` limpo; scripts de teste — **54/54** casos-alvo (incluindo a cópula
"são/estão" e reconfirmação de que "empenhos" continua cedendo) e **48/48** no gabarito
completo.

## Fora do escopo desta leva

- Chegar aos 40–60 previstos no README — ficou em 34 (+70% sobre as 20 originais).
  Registrar como aberto: uma segunda leva, guiada pelo log real do piloto (F8), fecha a
  diferença com as perguntas que a equipe realmente fizer.
- Cruzar processo↔obra por nome/número (`vw_assistente_processo_completo`/
  `vw_assistente_obra_completa` da F4) como intenção de regras — decisão desta leva:
  deixar para o caminho LLM usar essas views diretamente quando a F6 as citar no prompt,
  em vez de duplicar a lógica de busca em regex agora.
- Intenção parametrizada por gestor (`"quantos contratos o gestor X tem"`) — exigiria um
  novo cache de valores conhecidos (como `contratadas`/`contratantes`) só para nomes de
  gestor; adiado para não aumentar o escopo desta leva.
