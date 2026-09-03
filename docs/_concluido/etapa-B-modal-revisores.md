# Etapa B — Modal "Dados do Contrato" · Configuração dos 4 Revisores

Spec de referência: [`docs/etapa-B-modal-spec.md`](etapa-B-modal-spec.md)
Plano de implementação: [`docs/etapa-B-modal-plano.md`](etapa-B-modal-plano.md)

---

## Natureza deste documento

- **Nenhum código é alterado agora.** Define **como a Etapa B será revisada** depois de implementada.
- Ao final do Bloco 8 do plano, **4 revisores independentes** conferem o trabalho contra critérios escritos e devolvem `APROVADO` ou `BLOQUEADO + lista`.
- O usuário revisa e aprova este documento **antes** de o plano virar tarefas.

---

## Como a revisão funciona

1. **Quando roda:** ao final da Etapa B inteira (Bloco 8), não a cada bloco. O acompanhamento bloco a bloco é feito com o usuário em linguagem simples e visual; os revisores são a checagem técnica formal do conjunto.
2. **Quem roda:** 4 subagentes independentes, um por lente — **Estrutura/Arquitetura · Dados/Cálculos/Integridade · Interface/Experiência · Regressão/Comportamento**. Rodam em paralelo, sem ver o resultado um do outro.
3. **O que cada um recebe:** a spec aprovada, este documento, a lista de arquivos alterados + resumo em linguagem clara, e acesso de leitura ao repositório (código antes e depois — `git diff` contra o commit base).
4. **O que cada um devolve:** `APROVADO` **ou** `BLOQUEADO`, seguido de:
   - **Achados bloqueantes** (impedem o avanço): descrição, onde (`arquivo:linha`), qual critério escrito fere, o que precisa mudar.
   - **Achados não bloqueantes:** lista de follow-up anexada à spec, tratados depois sem travar a Etapa C.
5. **Decisão final da Etapa B — dois portões obrigatórios:** (a) os **4 revisores em `APROVADO`**; (b) a **validação prática e visual do usuário**. Só com os dois avança para a Etapa C.
6. **Ciclo de correção:** cada achado bloqueante → correção **apenas naquilo** → os revisores afetados rodam de novo → repete até os 4 aprovarem.
7. **Conflitos:** revisor × spec escrita → **a spec vence** (a divergência vira follow-up). Revisor × revisor → **o usuário arbitra**.
8. **Limite de alçada:** um revisor **não** pode bloquear por gosto pessoal fora dos critérios escritos, nem por algo que a spec marcou como fora de escopo (matrícula, filtros novos, tela de entrada, exportação). Isso vira "fora de escopo — Etapa C/D/futura", nunca bloqueio.

---

## O que é "bloqueante" e o que é "follow-up"

| Bloqueante (trava a Etapa B) | Follow-up (não trava) |
|---|---|
| Um critério de aceite da spec (§4) não cumprido | Um acabamento que a spec não exige |
| Um valor **de dinheiro** do modal **diferente** do que era antes (fontes: `total_aditivo`, `ficha_contrato`, Σ de valor já existentes) | Ajuste fino de espaçamento que ninguém notaria sem comparar |
| Um dado hoje visível que **sumiu** na reorganização (contratante, reajuste, realinhado etc. → conferir que foram para "Detalhes") | Ideia de melhoria para uma etapa futura |
| Cálculo de **dinheiro** novo / campo derivado novo introduzido | Sugestão de organização interna de código sem efeito visível |
| Agregação de **dias** de prazo (`Σ execucao_aprovado`/`prazo_aprovado`, "Prazo acumulado") — **autorizada** (spec §7 item 13); só bloqueia se a soma estiver **errada** | A rotulagem de "Pontos de atenção" (autorizada, spec §7 item 12) desde que não invente número |
| Dado do banco chegando à tela **sem `escHtml`** / `innerHTML` cru | Preferência estética sem base num critério escrito |
| "Localizar no mapa" alterando filtro, métrica, escopo ou limpando contexto a mais | — |
| Erro de console; `id` duplicado; `openModal` acumulando listeners | — |
| Contraste de texto abaixo de WCAG AA em qualquer superfície do modal | — |
| Qualquer coisa fora do modal mudando (mapa, painel, filtros, navegação) | — |
| Nova dependência; **qualquer** tabela nova além de `medicoes`; coluna nova em `CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS`; chamada a `app_users` | Colunas adicionais de `medicoes` (`nr_protocolo`/`total`/`status`) — são da própria tabela nova, **autorizadas** (spec §7 itens 14–15) |
| `fetchMedicoes` quebrar o `loadData` (falha da tabela derruba mapa/painel/outras abas) | Curva **ou tabela de Medições** vazias porque a RLS de `medicoes` não existe — é pendência de backend do usuário (spec §7 item 16), registrar |
| Curva do Resumo com número que não sai de `valor_medido/valor_atual` | Rótulo da curva ("Evolução da medição") — desde que honesto |
| Coluna STP / Glosa / Ajuste inventada na tabela de Medições (não existe na base) | Ausência dessas colunas (decisão do usuário, spec §7 item 15) |
| Tema escuro **ou** claro do modal com quebra perceptível | — |

---

## Revisor 1 — Estrutura / Arquitetura

**Pergunta que ele responde:** "A janela foi construída conforme a spec, e o código está organizado de forma sã?"

**Confere (base: spec §2.1, §3, §4.1):**
- O modal tem **5 abas** (`resumo` · `aditivos-valor` · `aditivos-prazo` · `medicoes` · `fiscalizacao`), nessa ordem; "Resumo" abre por padrão; `wireModalTabs` trata as 5 com `role`/`aria-selected`/`aria-controls`/`hidden` corretos.
- A aba **Resumo** segue o **dashboard do modelo** (§2.1.2) na ordem certa: cartão de identificação único (objeto + grade Município/Distrito/Contratada/Fiscal) → 2 cartões de status (Situação da obra / do contrato) → faixa de 4 indicadores (Valor atual · Aditivos · Total medido · Saldo a medir) → curva "Evolução da medição" com linhas de grade → "Pontos de atenção" → "Detalhes do contrato" recolhível. Ícones = SVG inline `aria-hidden`. Cabeçalho com subtítulo "Resumo executivo do contrato". **Não há** anel nem cartão "comparativo".
- A aba **Fiscalização** existe como aba própria, com fiscal titular / suplente / comissão completa; **sem** campo/placeholder de matrícula.
- As abas **Aditivos de valor** e **Aditivos de prazo** existem separadas e seguem o modelo (valor: 5 cartões → tabela → barra art. 125; prazo: 2 cartões exec/vig → mini-cartões → tabela → barra empilhada). A aba **Medições** tem faixa de indicadores → tabela mensal de `o.medicoes` → rodapé → legendas STM (sem anel).
- O botão **"📍 Localizar no mapa"** está no cabeçalho do modal e chama o caminho de navegação existente (`goCity`), não uma rota nova.
- **Arquitetura do código:** `openModal` continua **uma** construção de `innerHTML` + religamento de listeners locais (`.onclick`), **sem** `addEventListener` acumulando entre aberturas; helpers reaproveitados (`mSection`, `mkpi`, `adToggle`, `prazoCalc`) — **sem duplicar marcação**; a função de gráfico de linha é **SVG inline** (sem lib); `buildResumoPane`/`buildFiscalizacaoPane`/`buildAdValorPane`/`buildAdPrazoPane` no mesmo padrão dos existentes. `divergingBars`/`donutGauge` podem deixar de ser chamados pelo modal (o modelo não os usa) — ficam no arquivo, sem remoção.
- **Sem nova dependência.** A **única** tabela nova é **`medicoes`** (autorizada — spec §2.2/§7): `fetchMedicoes` no padrão de `fetchAditivos`, no `Promise.all` do `loadData`, `.catch → []`; lê `id_obra, nr_medicao, periodo, nr_protocolo, valor_medicao, valor_medido, valor_atual, total, status` (todas da própria tabela nova). Nenhuma outra tabela; nenhuma chamada a `app_users`; `CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS` inalterados.
- **HTML não reestruturado** sem necessidade; `mapRow`/`fetchFiscais`/`fetchAditivos`/`fetchFichas` **intocados**; a mudança em `loadData` é só o `fetchMedicoes` + anexar `o.medicoes` (+ bump de `cacheKey`).
- `node --check` sem erro; sem `id` duplicado (os `id` internos do modal não colidem com os 41 `id` estáticos).

**NÃO é a alçada dele:** exatidão dos números (Revisor 2), contraste/estética (Revisor 3), regressão fora do modal e desempenho (Revisor 4).

**Aprova se:** as 5 abas e os panes existem conforme a spec (Resumo = dashboard do modelo, §2.1.2; Aditivos split em valor/prazo; Medições = tabela mensal), o código está organizado no padrão do arquivo, `medicoes` é a única tabela nova e no padrão certo, sem reestruturação de HTML.
**Bloqueia se:** aba/bloco/cartão faltando ou fora de ordem; `openModal` acumulando listeners; marcação duplicada em vez de helper; dependência nova, tabela nova além de `medicoes`, coluna nova em `CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS`, ou chamada a `app_users`; gráfico com biblioteca; HTML reestruturado sem motivo; `node --check` falhando; `id` duplicado.

---

## Revisor 2 — Dados / Cálculos / Integridade

**Pergunta que ele responde:** "Todo número continua correto e todo dado do banco continua tratado?"

**Confere (base: spec §2.1.2–§2.1.6, §3.2, §4.1, §4.2, e invariáveis 3–5 do plano):**
- **Paridade de valores de dinheiro — comparação antes × depois, contrato a contrato.** Para uma amostra que cubra: contrato com muitos aditivos de valor; com aditivos de prazo; com "outros"; sem aditivo; com ficha de medição (% baixo, ~100%, >100% por arredondamento); sem ficha; obra Paralisada; obra vencida. **Cada valor em R$ exibido no modal novo é idêntico ao do modal atual** — mesmas fontes: `total_aditivo`, `ficha_contrato` (total medido / %), e as Σ de acréscimo/supressão/repercussão que o código já faz hoje.
- **Nenhum cálculo de dinheiro novo / campo derivado de valor novo.** "Restante a medir" / "Saldo a medir" = `max(0, valor_atual − total_medido)`, como hoje. "Total em aditivos %" = `total_aditivo/valor_original`. Barra "art. 125" = `Σ valor_aprovado / valor_original` vs a constante legal 25% (a razão já existe; 25% não é dado). "Falta para encerrar" / "Prazo decorrido" saem de `prazoCalc` sem alterar a fórmula.
- **Agregação de dias — autorizada, conferir a soma.** `Σ execucao_aprovado` / `Σ prazo_aprovado`, "Prorrogado", "Original = Vigente − Prorrogado" e a coluna "Prazo acumulado" (Aditivos de prazo) somam linha a linha (spec §7 item 13). Não é bloqueio por existir; **bloqueia se a soma estiver errada** ou não fechar com a tabela.
- **"Pontos de atenção" não inventa número.** Confere que os textos só rotulam `dias_paralisado`, `total_aditivo/valor_original` e a saída de `prazoCalc`, com os limiares fixos (25% / 10% / 60 dias) — nenhum valor calculado novo.
- **Resumo — curva:** = `valor_medido / valor_atual` por `periodo` de `o.medicoes` — `valor_medido` já vem acumulado da origem, **não** se soma medição a medição. Conferir que a curva bate com os pontos de `o.medicoes` e que `o.medicoes` vazio ⇒ estado vazio, não erro/NaN.
- **Medições — tabela vs totais:** as linhas vêm de `o.medicoes` (Nr/STM/Período/Protocolo/Medido/Total); a faixa e o rodapé de totais vêm de `ficha_contrato` (**não** de somar a tabela). Sem coluna STP/Glosa/Ajuste (não existe na base).
- **`fetchMedicoes` não altera número nenhum das outras abas** — só popula `o.medicoes`. `ficha_contrato` e `aditivos_contrato` seguem intocados.
- **Regra do "dias paralisado" no Resumo:** aparece no cartão "Situação da obra" e, se `> 0`, também como ponto de atenção — o mesmo dado, sem duplicação de layout.
- **`escHtml` / `fmtVal` / `fmtCNPJ` / `fmtDateBR` em TODO campo do banco** exibido no modal — inclusive os campos novos no Resumo (`descricao_tipo_contrato`, `nr_contrato_sic`, `cnpj_*`, razão social) e os nomes/funções da comissão. **Nenhum `innerHTML` novo com valor cru** (varredura de código do diff).
- **"Localizar no mapa" não altera dado de navegação:** após o clique, `st.f` (todos os filtros), `st.metric` e `st.dataScope` **inalterados**; a limpeza de contexto é exatamente a de um clique manual no município (só o que `goCity` já faz), nada a mais.
- Campos nulos aparecem como "—", não como `null`/`undefined`/`NaN`.

**NÃO é a alçada dele:** existência/ordem das abas e organização do código (Revisor 1); contraste e aparência (Revisor 3); o que acontece fora do modal e desempenho (Revisor 4).

**Aprova se:** todo valor de dinheiro bate com o de hoje (mesmas fontes); a agregação de dias fecha com a tabela; "Pontos de atenção" não inventa número; `escHtml` em tudo; "Localizar" preserva filtros/métrica/escopo.
**Bloqueia se:** qualquer valor de dinheiro diferente do atual; informação hoje visível que sumiu (sem ir para "Detalhes"); cálculo de dinheiro / campo derivado de valor novo; soma de dias errada; coluna de medição inventada; dado do banco sem escape; `innerHTML` cru; "Localizar" mexendo em `st.f`/`st.metric`/`st.dataScope`.

---

## Revisor 3 — Interface / Experiência visual

**Pergunta que ele responde:** "A janela ficou legível, coerente e melhor de usar — nos dois temas, inclusive projetada?"

**Confere (base: spec §4.3):**
- A aba **Resumo** (dashboard do modelo) é **escaneável**: um gestor identifica valor, situação da obra e do contrato, avanço de medição e fiscal em segundos; a curva com grade, os 2 cartões de status e a faixa de 4 indicadores são **leves e legíveis**, sem poluir; hierarquia visual clara entre cartões, rótulos e valores.
- **Contraste ≥ WCAG AA** (texto normal 4,5:1; grande 3:1) de **todo** texto do modal, em **ambos os temas**, em todas as superfícies — incluindo **texto sobre o cartão de destaque (fundo verde)**, **a palavra do status na cor do status**, **as pílulas de % das tabelas de aditivos** e **rótulos de eixo/legenda da curva**. Razões calculadas para os pares principais.
- A **curva de medição** é legível: grade/eixo/pontos claros nos dois temas; estado vazio ("sem medições") limpo, não erro.
- As **5 abas** cabem sem quebra feia em **360px** de largura e em **projeção** (tipografia do modo apresentação); `.mtabs` rola na horizontal sem cortar a aba ativa. As **tabelas largas** (Aditivos de valor/prazo, Medições) rolam dentro do próprio contêiner — o corpo do modal **não** rola na horizontal; o cabeçalho da tabela de Medições continua legível ao rolar.
- O bloco **"Detalhes do contrato"** comunica que é expansível (cursor, ícone ▾/▴, `aria-expanded`); recolhido não deixa "buraco".
- O botão **"📍 Localizar no mapa"** é reconhecível (ícone + rótulo curto), com `title`/`aria-label`; estados hover/focus/disabled coerentes com os outros botões do modal, nos dois temas.
- **Estados vazios** (sem aditivo de valor / de prazo / sem ficha / sem medição / sem comissão) limpos e informativos, não com cara de erro.
- As abas **Aditivos de valor**, **Aditivos de prazo** e **Medições** ficaram **escaneáveis** (cartões/indicadores primeiro, tabela depois); a barra "art. 125" e as barras empilhadas de prazo são claras nos dois temas.
- Coerência: as 5 abas parecem a mesma peça; o modal conversa com o resto do módulo nos dois temas; **sem `flash`/salto** ao abrir ou ao trocar de aba.

**NÃO é a alçada dele:** exatidão de número (Revisor 2); existência de aba e estrutura de código (Revisor 1); regressão fora do modal e desempenho (Revisor 4). Preferência estética sem critério escrito **não** é bloqueio.

**Aprova se:** Resumo escaneável; AA nos dois temas; 5 abas cabem (360px + projeção); tabelas rolam no contêiner; afordâncias claras; estados vazios limpos; as abas de Aditivos e Medições legíveis.
**Bloqueia se:** contraste abaixo de AA; texto/rótulo/pílula ilegível; Resumo que não dá para ler de relance; aba cortada em tela estreita/projeção; corpo do modal rolando na horizontal; `flash` ao abrir.

---

## Revisor 4 — Regressão / Comportamento geral

**Pergunta que ele responde:** "Quebrou, mudou ou ficou mais lento algo que já funcionava — dentro ou fora da janela?"

**Confere (base: spec §4.2, §4.4, e invariáveis 6–8 e 10 do plano):**
- `openModal` abre e renderiza corretamente nos **dois temas**, para contratos **com e sem** aditivos, **com e sem** ficha, **com e sem** comissão, **com e sem** medições.
- **`fetchMedicoes` não regride o `loadData`:** com a tabela OK, `o.medicoes` chega; forçando falha (RLS/rede), o `.catch` devolve `[]`, e o mapa, o painel e as outras abas carregam **exatamente** como hoje — só um `console.warn` no padrão dos outros fetches (não é "erro de console" para esse critério). O fetch é **paralelo** no `Promise.all`, não serializa a carga. Cache `sessionStorage` consistente (bump de `cacheKey`).
- **Trocar entre as 5 abas** funciona; `hidden`/`aria-selected` corretos; nenhum elemento hoje visível some na reorganização; os toggles internos ("Detalhes do contrato", "comissão", e o que restar recolhível) abrem/fecham.
- **Fechar:** `Esc`, clique no fundo e `✕` fecham — como hoje. Foco ao abrir vai para um elemento focável.
- **Troca de tema com o modal aberto** redesenha o modal nos dois sentidos, sem cor presa (herda `repaintTheme` da Etapa A). O reset de aba para "Resumo" na troca é o follow-up já conhecido — não é regressão nova.
- **Nada fora do modal mudou:** mapa (3 níveis), painel lateral, filtros, navegação, breadcrumb, popover de irmãos, seleção combinada, `#segMetric`, Carteira/Histórico, tela cheia, modo apresentação, tela de erro — idênticos. `git diff` não toca nada fora de `openModal`/helpers do modal/CSS do `.modal`/o botão "Localizar".
- **"Localizar no mapa"** leva ao **município** da obra pelo mesmo caminho de um clique manual (comparar os dois); `render()` chamado **uma vez**, sem redesenho repetido; modal fecha.
- **Desempenho:** nenhuma requisição de rede ao abrir o modal / trocar de aba / clicar "Localizar" (as medições já vêm no `loadData`); `openModal` continua **uma** construção de `innerHTML`; o dashboard do Resumo (curva com grade + 2 cartões de status + 4 indicadores + "pontos de atenção" + ícones) e as tabelas (percorrem só `o.medicoes` / `o.aditivos` de um contrato, poucas dezenas de linhas) não pioram de forma perceptível o tempo de abertura; sem leitura de layout em laço na montagem.
- Console sem erro em: abrir o modal (vários contratos), trocar entre as 5 abas, expandir "Detalhes do contrato", clicar "Localizar", trocar de tema com o modal aberto — nos dois temas.
- `assets/geo/*.json` inalterados.

**NÃO é a alçada dele:** se o Resumo está bonito/escaneável (Revisor 3); se os números estão certos (Revisor 2); se a estrutura de abas segue a spec (Revisor 1).

**Aprova se:** todas as interações do modal funcionam nos dois temas; nada fora do modal mudou; "Localizar" idêntico a um clique manual; sem requisição nova; sem piora perceptível de desempenho; console limpo.
**Bloqueia se:** qualquer interação do modal que parou; um dado/toggle hoje visível que sumiu; algo fora do modal alterado; "Localizar" com efeito diferente do clique manual; requisição de rede nova ao abrir; `openModal` mais lento de forma perceptível; erro de console.

---

## Matriz de responsabilidade (para evitar sobreposição)

| Tema | Revisor responsável |
|---|---|
| Existência/ordem das 5 abas; blocos do dashboard do Resumo; split Aditivos valor/prazo; tabela mensal de Medições; "Detalhes" recolhível | **1 — Estrutura** |
| Organização do código (`openModal` único, helpers reusados, gráfico de linha SVG sem lib, listeners) | **1 — Estrutura** |
| `medicoes` é a única tabela nova e no padrão certo; sem `app_users`; HTML não reestruturado | **1 — Estrutura** |
| Paridade de **dinheiro** antes × depois (Aditivos/Medições/Fiscalização); curva = `valor_medido/valor_atual`; agregação de **dias** de prazo correta; "Pontos de atenção" sem número novo | **2 — Dados** |
| `fetchMedicoes` não regride `loadData` (falha degrada p/ curva **e tabela de Medições** vazias; paralelo; cache) | **2 — Dados** (integridade da carga) e **4 — Regressão** (não quebra o resto) |
| `escHtml`/escape em todo dado do banco (inclui tabelas de aditivos e de medições); `innerHTML` cru | **2 — Dados** |
| Regra "dias paralisado" (cartão "Situação da obra" + ponto de atenção) | **2 — Dados** |
| Tabela mensal de Medições sem STP/Glosa/Ajuste; totais da faixa/rodapé vindos da ficha | **2 — Dados** |
| "Localizar" preserva `st.f`/`st.metric`/`st.dataScope` | **2 — Dados** (efeito no estado) e **4 — Regressão** (efeito na navegação) |
| Resumo escaneável; contraste AA nos dois temas; 5 abas em 360px/projeção; tabelas rolam no contêiner | **3 — Interface** |
| Afordância de "Detalhes" e do botão "Localizar"; estados vazios; `flash` | **3 — Interface** |
| Aditivos/Medições ficaram mais legíveis | **3 — Interface** |
| Todas as interações do modal (trocar aba, fechar, toggles) nos dois temas | **4 — Regressão** |
| Troca de tema com o modal aberto | **4 — Regressão** |
| Nada fora do modal mudou | **4 — Regressão** |
| Desempenho: sem request nova, `openModal` não mais lento, `render()` 1× no "Localizar" | **4 — Regressão** |
| `node --check`, `id` duplicado | **1** (parse/estrutura) e **4** (regressão) conferem; basta um apontar |

---

## Registro de resultados (preenchido na revisão)

### Rodada 1 (2026-08-29)

| Revisor | Veredito | Achados bloqueantes | Follow-up |
|---|---|---|---|
| 1 — Estrutura/Arquitetura | 🔴 **BLOQUEADO** | **B1** — cabeçalho do modal sem o subtítulo "Resumo executivo do contrato" + ícone (spec §2.1.2, §4.1) | comentário do `cacheKey` ("v3") desatualizado; helpers `mSection`/`mkpi` órfãos; par `id`↔`aria-labelledby` das abas (opcional) |
| 2 — Dados/Cálculos/Integridade | ✅ **APROVADO** | — | limiar 30 vs 60 dias no ponto de atenção "encerra em N dias" (spec dizia 60; código reusa o âmbar do `prazoCalc` = 30); "Prazo acumulado" não fecha no "Vigente" só com data de contrato internamente inconsistente (guardas evitam NaN); `kpis` morto em `adCompute` |
| 3 — Interface/Experiência | ✅ **APROVADO** | — | `.mupd` e sub-texto do hero com folga de contraste pequena no tema escuro (pré-existentes); âmbar da barra empilhada de prazo pálido no tema claro; `aria-label` fixo no botão "Localizar" |
| 4 — Regressão/Comportamento | ✅ **APROVADO** | — | sem `.focus()` programático ao abrir o modal (pré-existente); RLS anônima de `medicoes` (pendência de backend já registrada, §7 item 16) |

**Correções da rodada 1:**
- **B1** corrigido: subtítulo "Resumo executivo do contrato" + ícone `RS_ICO.chart` no cabeçalho, visível só na aba Resumo (`.mtop[data-tab]`, mesmo padrão da linha `.mobj`). CSS `.msub` (usa `--text-dim`, já validado pelo Revisor 3).
- Follow-up do Revisor 2 (limiar 30/60): spec §2.1.2 item 5 e §4.1 **emendadas para ≤30 dias** (alinha ao `prazoCalc` existente; nenhum limiar novo). Registrado no relatório do Bloco 2.
- Comentário do `cacheKey` atualizado para v4.
- Revisor 1 re-executado após a correção → ver rodada 2.

### Rodada 2 (2026-08-29)

| Revisor | Veredito | Achados bloqueantes | Follow-up |
|---|---|---|---|
| 1 — Estrutura/Arquitetura | ✅ **APROVADO** | — (B1 resolvido: subtítulo + ícone no cabeçalho, só na aba Resumo; comentário do `cacheKey` atualizado) | nada novo — seguem abertos: helpers `mSection`/`mkpi` órfãos; par `id`↔`aria-labelledby` das abas |

**Portão 1 fechado (2026-08-29): os 4 revisores em `APROVADO`.** (R2, R3, R4 na rodada 1; R1 na rodada 2 após corrigir B1.)

**Portão 2 fechado (2026-08-29): validação prática/visual do usuário — "sim".**

## ✅ Etapa B ENCERRADA (2026-08-29)

Os dois portões cumpridos. Follow-ups abaixo vão para uma passada futura, sem travar a Etapa C.

### Lista de follow-up anexa (não bloqueia a Etapa C — tratar depois)

1. **Helpers órfãos** — `mSection()`, `mkpi()` (e os gráficos legados `donutGauge`/`pieLegend`/`divergingBars`/`timelineGauge`) não são mais chamados; consolidar ou remover numa passada de limpeza. CSS pareado (`.divbars`, `.tl-*`, `.donut-*`, `.pie-*`) idem. `kpis` morto montado em `adCompute` a cada chamada.
2. **`kpis` em `adCompute`** — string montada e nunca usada pelos dois panes; custo desprezível, limpar.
3. **ARIA das abas** — adicionar `id` nos `.mtab` e `aria-labelledby` de volta nos `.mpane` (a spec §2.1.8 não exige, mas melhora leitores de tela).
4. **Contraste com folga pequena, tema escuro** — `.mupd` ("Atualizado em…", `--text-dimmer`) ~4,2–4,6:1 e `.rs-hero .rs-card-sub` (`--text-dim` sobre o gradiente verde) ~4,2–4,6:1. Ambos **pré-existentes** (tokens não alterados pela Etapa B). Clarear `--text-dimmer` no escuro ou trocar por `--text-dim`/`--text-muted` nesses dois pontos.
5. **Barra empilhada de prazo, tema claro** — o segmento "prorrogações" é só o trilho `rgba(--amber,.22)` atrás do verde; fica pálido contra o cartão branco. Usar um âmbar mais saturado nesse segmento no claro.
6. **`aria-label` fixo no botão "Localizar"** — abaixo de 520px o rótulo é escondido por `display:none` e o nome acessível vem só do `title`; um `aria-label="Localizar no mapa"` fixo no `<button>` é mais robusto.
7. **Foco ao abrir o modal** — não há `.focus()` programático (comportamento pré-existente; o primeiro focável passou de `#modalX` para `#modalLocate`, ambos focáveis). Se a validação do usuário pedir foco explícito, é ajuste de 1 linha.

### Pendência de backend (não é follow-up de código)

- **RLS anônima em `medicoes`** — política `for select using(true)`, como as demais tabelas do SIGSOP. Sem ela, a curva do Resumo e a tabela da aba Medições ficam com estado vazio em produção; o `.catch` mantém o resto do módulo intacto. Registrado na spec §7 item 16.

**Etapa B concluída quando:** os 4 vereditos = `APROVADO` **e** o usuário deu a validação prática/visual. Achados de follow-up migram para a spec como lista anexa e são tratados depois, sem travar a Etapa C.
