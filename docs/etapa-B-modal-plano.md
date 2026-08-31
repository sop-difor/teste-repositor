# Etapa B — Modal "Dados do Contrato" · Plano de Implementação

Módulo: **Mapa de Obras Fiscalizadas** (`gecope_mapa_obras.html`, `assets/js/mapa-obras.js`, `assets/css/mapa-obras.css`)
Spec de referência: [`docs/etapa-B-modal-spec.md`](etapa-B-modal-spec.md) — re-emendada em 2026-08-29 a partir do modelo `janela_contrato_melhorado/`
Configuração dos revisores: [`docs/etapa-B-modal-revisores.md`](etapa-B-modal-revisores.md)

---

## Natureza deste documento

- **Nenhum código é alterado agora.** Esta é a fase de planejamento.
- É um **guia para a implementação futura**: descreve, em ordem, o que será feito, o que cada passo toca, o resultado esperado e como conferir.
- Cada bloco está explicado de forma que uma pessoa **não desenvolvedora** entenda.
- Depois que este plano e o documento dos revisores estiverem prontos, **o usuário revisa e aprova**. Só então o plano vira tarefas e o código começa a mudar.

## Como o acompanhamento vai funcionar

- A implementação segue os **8 blocos abaixo, na ordem**.
- **Ao terminar cada bloco importante**, é apresentado ao usuário, **em linguagem simples e visual quando possível** (capturas do modal antes/depois, nos dois temas), o que mudou e o resultado no uso real. O usuário pode pedir ajuste antes do bloco seguinte.
- Ao terminar o **Bloco 8**, os **4 revisores** (ver [`docs/etapa-B-modal-revisores.md`](etapa-B-modal-revisores.md)) são acionados para a validação técnica.
- **Encerramento da Etapa B — dois portões, ambos obrigatórios:**
  1. Os **4 revisores** com veredito `APROVADO`.
  2. A **validação prática e visual do usuário**.
  Só com os dois a Etapa B é concluída e passamos para a Etapa C (Super filtro).

> **✅ Etapa B ENCERRADA em 2026-08-29** — Portão 1 (4 revisores `APROVADO`) + Portão 2 (validação do usuário) cumpridos. Blocos 1–8 concluídos. Ver a tabela no fim deste documento e `etapa-B-modal-revisores.md`.

## Glossário rápido (leitura não técnica)

| Termo | Significado neste plano |
|---|---|
| **Modal / janela** | A janela "Dados do Contrato" que abre ao clicar numa obra da lista. |
| **Aba** | Cada uma das divisões no topo da janela. Depois da Etapa B: Resumo, Aditivos de valor, Aditivos de prazo, Medições, Fiscalização (5). |
| **Pane** | O conteúdo de uma aba. |
| **`openModal`** | A função que monta a janela inteira de uma vez, com os dados de **um** contrato. |
| **KPI / indicador** | Um número-chave com rótulo (ex.: "Total medido — R$ 1,2 mi"). |
| **Bloco recolhível / toggle** | Um trecho que começa fechado e abre ao clicar (como "Comissão completa" hoje). |
| **`escHtml`** | Função que neutraliza HTML vindo do banco antes de mostrar na tela (a página é pública). |
| **Token / `var(--...)`** | "Apelido" de cor definido no CSS. O JS só lê; nunca crava cor. |
| **`st` (estado)** | O objeto que guarda o estado do mapa: nível, filtros (`st.f`), métrica (`st.metric`), escopo (`st.dataScope`), seleção (`st.sel`). |
| **Nível 3** | A visão de **um município** aberto no mapa. |
| **Console** | Área de diagnóstico do navegador. "Console limpo" = sem erros. |

---

## Invariáveis de toda a Etapa B (valem em todos os blocos)

Nenhum bloco pode violar isto — é a base contra a qual os revisores julgam:

1. **Sem novas dependências / bibliotecas.** (Gráficos = SVG inline, como os que já existem no modal.)
2. **Uma única tabela nova do Supabase: `medicoes`** (exceção autorizada — spec §7 itens 7, 9, 14). Usada pela curva do Resumo **e** pela tabela mensal da aba Medições, via `fetchMedicoes` no padrão de `fetchAditivos`, com `.catch`. Colunas lidas: `id_obra, nr_medicao, periodo, nr_protocolo, valor_medicao, valor_medido, valor_atual, total, status` — todas da própria tabela nova. Fora `medicoes`, usa só `CONTRATOS_COLS` / `COMISSAO_COLS` / `ADITIVOS_COLS` / `FICHA_COLS` **sem coluna nova**. Sem `app_users`. Matrícula fica para depois. A RLS anônima de `medicoes` é pendência de backend do usuário (spec §7 item 16).
3. **Dinheiro idêntico ao de hoje nas abas de Aditivos/Medições/Fiscalização.** Os valores em R$ vêm das mesmas fontes de hoje: `total_aditivo` (coluna autoritativa), `ficha_contrato` (total medido / %), e as Σ de acréscimo/supressão/repercussão **que o código já faz hoje** para as barras divergentes. No Resumo, os % são razões de valores existentes (`valor_medido/valor_atual`, `total_aditivo/valor_original`, `percentual_total_medido`). **Única agregação nova permitida:** somar **dias** de prazo dos aditivos (`Σ execucao_aprovado` / `Σ prazo_aprovado` e a coluna "Prazo acumulado") — não há coluna pré-calculada de dias, e a soma é auditável linha a linha (spec §7 item 13). "Pontos de atenção" **não** calcula número novo — rotula valores já exibidos (spec §7 item 12). Nenhuma informação hoje visível é removida.
4. **`escHtml()` (ou `fmtVal`/`fmtCNPJ`/`fmtDateBR`) em todo dado do banco.** Zero `innerHTML` novo com valor cru.
5. **Sem cor hardcoded** em JS ou CSS. Cor de status vem de `TOKENS.status*`; qualquer outra vem de `var(--...)`.
6. **Nada fora do modal muda:** mapa, painel lateral, filtros, navegação, `#segMetric`, Carteira/Histórico, breadcrumb, modo apresentação, tela de erro.
7. **Tema claro e escuro continuam funcionando**, inclusive a repintura do modal aberto na troca de tema (`repaintTheme` da Etapa A — os panes novos são reconstruídos por `openModal`, herdam a repintura).
8. **`openModal` continua sendo uma construção de `innerHTML` + religamento de listeners locais.** Sem `addEventListener` acumulando; sem laço sobre todos os contratos/municípios dentro do modal; sem requisição de rede ao abrir/trocar de aba.
9. **Não reestruturar o HTML** sem necessidade — o modal é 100% gerado por `openModal`.
10. **`loadData`/`mapRow`:** a única mudança permitida é acrescentar `fetchMedicoes` (paralelo aos outros fetches) e anexar `o.medicoes` (com as colunas da tabela mensal). `fetchFiscais`/`fetchAditivos`/`fetchFichas` e as funções de agregação/cálculo ficam **intocadas**. O `.catch` de `medicoes` degrada para `[]` — o resto do módulo carrega igual se a tabela falhar.
11. **Todo o desenho segue o modelo `janela_contrato_melhorado/`.** 5 abas. `divergingBars` e `donutGauge` deixam de ser chamados pelo modal (o modelo não os usa) — ficam no arquivo, sem remoção. Tabelas largas rolam no próprio contêiner; o corpo do modal não rola na horizontal.

---

## Bloco 1 — Estrutura das 5 abas + botão "Localizar no mapa"

> **Re-aberto em 2026-08-29.** A versão de 4 abas foi entregue e aprovada em 2026-08-28. O modelo `janela_contrato_melhorado/` divide "Aditivos" em duas → agora são **5 abas**. Este bloco passa a: acrescentar a 5ª aba e renomear.

**O que será feito, em linguagem simples**
O esqueleto da janela passa a ter **5 abas** — **Resumo · Aditivos de valor · Aditivos de prazo · Medições · Fiscalização** —, com "Resumo" abrindo primeiro. O botão **"📍 Localizar no mapa"** no topo já existe (Bloco 1 v1). Neste bloco:
- Renomear a aba "Aditivos" → "Aditivos de valor" e acrescentar "Aditivos de prazo" (`data-tab` = `aditivos-valor` / `aditivos-prazo`), com `wireModalTabs` tratando as 5.
- Provisoriamente, "Aditivos de prazo" reaproveita o bloco de prazo do `buildAditivosPane` atual (o desenho final é o Bloco 5); "Aditivos de valor" fica com o bloco de valor atual (final é o Bloco 4). Assim nada quebra entre blocos.
- Fiscalização e o botão "Localizar" permanecem como entregues no Bloco 1 v1.

**Arquivos**
- `assets/js/mapa-obras.js` — `openModal` (marcação das 5 abas + 5 panes), `wireModalTabs` (5 abas), split do `buildAditivosPane` em `buildAdValorPane` / `buildAdPrazoPane` (provisórios).
- `assets/css/mapa-obras.css` — ajuste da `.mtabs` para 5 abas (já rola na horizontal); nada mais.
- `gecope_mapa_obras.html` — nada.

**Invariáveis específicas**
- O botão "Localizar" continua **mantendo filtros, métrica e escopo**; sem regressão em relação ao Bloco 1 v1.
- O split de Aditivos não muda **nenhum número** — só distribui os blocos que já existem em duas abas.
- `data-tab` da aba de medições segue `medicoes`; Fiscalização segue `fiscalizacao`.

**Resultado esperado**
Janela com 5 abas navegáveis; "Resumo" abre primeiro; "Aditivos de valor" e "Aditivos de prazo" mostram, cada uma, o respectivo bloco de hoje; Medições e Fiscalização intactas.

**Ponto de verificação**
- `node --check` sem erro; sem `id` duplicado.
- Abrir o modal de vários contratos (com/sem aditivo de valor, com/sem aditivo de prazo), nos dois temas: as 5 abas trocam; `aria-selected`/`hidden` corretos; console limpo.
- Comparar Aditivos antes × depois: cada número exibido é o mesmo, apenas repartido em duas abas.
- As 5 abas cabem/rolam em 360px sem cortar a aba ativa.
- "Localizar" e troca de tema com o modal aberto seguem funcionando (não regrediram do Bloco 1 v1).

---

## Bloco 2 — Aba "Resumo" (dashboard executivo, conforme o modelo)

> **Re-emendado em 2026-08-29** a partir de `janela_contrato_melhorado/Resumo do Contrato.dc.html`. A versão v2 já entregue (objeto+mini-cartões / contratado+contratante / hero+total+anel+comparativo / curva+2 timelines / faixa fiscal / Detalhes) é **reorganizada** conforme o modelo. Ver spec §2.1.2 e §7 itens 12–16.

**O que será feito, em linguagem simples**
Reorganizar a aba Resumo nos blocos do modelo:
1. **Cartão de identificação (um só)** — "OBJETO DO CONTRATO" + descrição; divisória tracejada; grade de 4 colunas: **Município** · **Distrito Operacional** · **Contratada** (+ CNPJ) · **Fiscalização** (fiscal + "Comissão de N membros"). Funde 4 blocos da v2 em um.
2. **Dois cartões de status** lado a lado — **Situação da obra** e **Situação do contrato**: ponto colorido + palavra do status em destaque (cor de `TOKENS.status*`) + mini-linha do tempo (datas + barra + "N dias restantes"/"Vencido há N dias"). Reusa `prazoCalc`. Substituem as 2 timelines laterais da v2.
3. **Faixa de 4 indicadores:** *Valor atual* (destaque verde, "Original: R$ …") · *Aditivos* (`total_aditivo` R$ + "+X,X% sobre o valor original" + barra) · *Total medido* (R$ + "X,X% do valor atual" + barra) · *Saldo a medir* (`max(0, valor_atual − total_medido)` + "% do valor atual" + barra). **Saem** o anel e o "comparativo" da v2.
4. **Cartão "Evolução da medição (%)"** — largura total, gráfico de linha **com linhas de grade** + "Última medição: {período} · Nª medição".
5. **Cartão "Pontos de atenção"** — lista (2 colunas) de alertas por severidade, **derivados dos valores já exibidos** (paralisada; prazo exec vencido/≤60d; vigência vencida; aditivo ≥25% art. 125/≥10%; ou "Nenhum ponto de atenção"). Sem número novo.
6. **"Detalhes do contrato"** — recolhível, fechado por padrão: código · tipo · SAC · data de assinatura · **contratante + CNPJ** · **total de reajuste** · **total realinhado**.
- Cabeçalho do modal com subtítulo "Resumo executivo do contrato" + ícone.

**Arquivos**
- `assets/js/mapa-obras.js`:
  - **`loadData` + `fetchMedicoes`** — já adicionado (Bloco 2 v2); agora as colunas incluem `nr_protocolo, total, status` (para a aba Medições, Bloco 6). Bump do `cacheKey` se o formato mudar.
  - **`buildResumoPane(o, raw)`** reorganizado nos 6 blocos acima; `prazoCalc` reaproveitado; `rsLineChart` ganha **linhas de grade**; novo helper de "cartão de status"; novo helper de "pontos de atenção" (só rótulos); ícones SVG inline; toggle "Detalhes" reusa `adToggle`. `donutGauge` deixa de ser chamado aqui.
- `assets/css/mapa-obras.css` — layout dos 6 blocos (cartão de identificação com grade 4-col, cartões de status, faixa de 4 indicadores, curva full-width, "pontos de atenção"), reusando classes existentes onde couber; remover as regras da v2 que ficarem órfãs (anel/comparativo no Resumo).

**Invariáveis específicas**
- **Gráficos/ícones = SVG inline**, sem biblioteca. Cor só de `TOKENS`/`var(--...)`.
- Números do Resumo = **razões de valores existentes**; a curva só plota `valor_medido/valor_atual` por `periodo`; **sem somar medição a medição**.
- Cor da palavra de status vem de `TOKENS.status*` (paralisada/vencida → stop; ≤60 dias → wait; senão → ok/exec — a mesma lógica de `statusBucket`/`prazoCalc` de hoje).
- "Pontos de atenção" **não** calcula número — rotula `dias_paralisado`, `total_aditivo/valor_original` e a saída de `prazoCalc`, com limiares fixos (25% / 10% / 60 dias).
- Sem `o.medicoes` → curva com estado vazio, nunca erro.
- "Dias paralisado" no cartão "Situação da obra" e, se `> 0`, também como ponto de atenção — mesmo dado.
- Todo dado do banco por `escHtml`/`fmtVal`/`fmtCNPJ`/`fmtDateBR`; "—" quando nulo.

**Resultado esperado**
A aba Resumo bate com o modelo: identificação, situação (obra e contrato), números-chave, curva, pontos de atenção e cadastro recolhido.

**Ponto de verificação**
- 5+ contratos variados (com/sem medição, com/sem aditivo, com/sem ficha, paralisada, vencida): cada número do Resumo bate com a origem; a curva reflete `o.medicoes`; os 2 cartões de status batem com `prazoCalc`; "Saldo a medir" = `max(0, valor_atual − total_medido)`.
- "Pontos de atenção" acende os alertas certos por contrato (paralisada, prazo, aditivo) e mostra "nenhum ponto de atenção" quando é o caso.
- "Detalhes do contrato" recolhido por padrão; abre/fecha; `aria-expanded` correto; contém reajuste e realinhado.
- "Ver detalhes da fiscalização" (se mantido) troca para a aba Fiscalização.
- Contraste AA nos dois temas (texto sobre o cartão verde; palavra de status; rótulos de eixo da curva); console limpo; troca de tema com o modal aberto redesenha o dashboard.
- `git diff` de `CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS` = vazio; nenhuma chamada a `app_users`.

---

## Bloco 3 — Aba "Fiscalização" (versão final)

**O que será feito, em linguagem simples**
Dar acabamento à aba Fiscalização (o conteúdo já entrou no Bloco 1): fiscal titular em destaque (nome + função), suplente quando houver, e a comissão completa em lista ordenada, cada linha com **função + nome**. Estado vazio limpo ("Sem dados de fiscalização para este contrato.") quando a comissão não veio.

**Arquivos**
- `assets/js/mapa-obras.js` — `buildFiscalizacaoPane` (acabamento).
- `assets/css/mapa-obras.css` — apresentação da lista da comissão, reusando `.mcomlist`/`.mcomrow`.

**Invariáveis específicas**
- **Sem matrícula** (nem "—"). Sem buscar `app_users`.
- Mesma ordenação/classificação de hoje.

**Resultado esperado**
A comissão de fiscalização deixa de ficar escondida atrás de um botão em "Dados Gerais" e passa a ter uma aba própria, legível.

**Ponto de verificação**
- Contratos com comissão de 1, 3 e 6+ membros: titular e suplente corretos; lista ordenada; sem matrícula.
- Contrato sem comissão: estado vazio limpo, não erro.
- Nomes com acento/caracteres especiais passam por `escHtml`.
- Contraste AA nos dois temas.

---

## Bloco 4 — Aba "Aditivos de valor" (conforme o modelo)

**O que será feito, em linguagem simples**
Desenhar a aba de valor como no modelo:
1. **Faixa de 5 cartões:** Valor original · Acréscimos (Σ `valor_aprovado` + % do original) · Supressões (Σ `valor_supressao` + %) · Repercussão líquida (Σ `valor_repercussao` + %) · Valor atual (`o.valor` + "N aditivos de valor").
2. **Tabela** (visível): por aditivo de valor — Nº · NUP/nº do processo (`nr_protocolo`) · Publicação (`data_assinatura`) · Acréscimo · Supressão · Repercussão, cada valor com **pílula de %** sobre o valor original.
3. **Widget "Limite legal · art. 125 da Lei 14.133/2021":** barra do acréscimo acumulado (`Σ valor_aprovado / valor_original`) contra 25%, cor por faixa (≥25% stop, ≥20% wait, senão ok), texto de margem/limite.
- **Sai** o gráfico de barras divergentes.

**Arquivos**
- `assets/js/mapa-obras.js` — `buildAdValorPane` (a partir do bloco de valor do `buildAditivosPane`). As Σ acréscimo/supressão/repercussão **já são feitas hoje** — reaproveitar, não recomputar de outro jeito.
- `assets/css/mapa-obras.css` — faixa de 5 cartões, tabela (com `overflow-x:auto` no contêiner), barra do art. 125. Reusa `.mkpi`/`.msec` onde couber.

**Invariáveis específicas**
- **Números de dinheiro idênticos aos de hoje.** A barra do art. 125 é `Σ acréscimo / valor_original` vs a constante legal 25% — não é dado novo.
- `escHtml`/`fmtVal`/`fmtDateBR` em todo campo; "—" quando nulo. Sem cor hardcoded.

**Ponto de verificação**
- **Comparação antes × depois, contrato a contrato** (muitos aditivos de valor; com supressão; repercussão negativa; sem aditivo de valor): cada número é o mesmo; as pílulas de % batem com `valor / valor_original`.
- Barra do art. 125: cor e largura corretas nos casos <20% / 20–25% / ≥25%.
- Tabela rola no contêiner, não no corpo do modal. Estado "sem aditivo de valor" limpo. Contraste AA nos dois temas. Console limpo.

---

## Bloco 5 — Aba "Aditivos de prazo" (conforme o modelo)

**O que será feito, em linguagem simples**
Dois cartões grandes — **Prazo de execução** e **Prazo de vigência** — cada um com:
1. **Cabeçalho:** Original · Prorrogado · Vigente, em dias. "Vigente" = dias de `prazoCalc` (início real → fim previsto / fim de vigência). "Prorrogado" = Σ `execucao_aprovado` (exec) / Σ `prazo_aprovado` (vig) dos aditivos de prazo. "Original" = Vigente − Prorrogado.
2. **3 mini-cartões:** Data-limite · Falta para encerrar (`prazoCalc.remainingDays`; "Vencido há N") · Prazo decorrido (`prazoCalc.pct` + barra).
3. **Tabela:** por aditivo de prazo — Nº · NUP · Publicação · Prorrogação (+N dias, +% do original) · Prazo acumulado (soma corrente).
4. **Barra empilhada** original × prorrogações + legenda + frase-resumo.
- Estado vazio por bloco: "Nenhum aditivo de prazo de execução/vigência registrado."

**Arquivos**
- `assets/js/mapa-obras.js` — `buildAdPrazoPane` (a partir do bloco de prazo do `buildAditivosPane`). Reusa `prazoCalc` **sem tocar na matemática**.
- `assets/css/mapa-obras.css` — os dois cartões, mini-cartões, tabela (`overflow-x:auto`), barra empilhada.

**Invariáveis específicas**
- **Agregação de dias autorizada** (spec §7 item 13): `Σ execucao_aprovado` / `Σ prazo_aprovado` e a coluna "Prazo acumulado" somam aditivo a aditivo. É a única agregação nova; auditável linha a linha na tabela.
- "Falta para encerrar" e "Prazo decorrido" saem de `prazoCalc` — os mesmos números das timelines de hoje.
- `escHtml`/`fmtDateBR` em todo campo; "—" quando nulo. Sem cor hardcoded.

**Ponto de verificação**
- Contratos com aditivos de prazo de execução, de vigência, de ambos, e sem nenhum: "Vigente" bate com `prazoCalc.totalDays`; "Prorrogado" = soma das linhas; "Original" = a diferença; "Prazo acumulado" cresce linha a linha e fecha no total.
- "Falta para encerrar" / "Prazo decorrido" batem com o que as timelines de hoje mostram.
- Estado vazio por bloco limpo. Tabela rola no contêiner. Contraste AA nos dois temas. Console limpo.

---

## Bloco 6 — Aba "Medições" (tabela mensal, conforme o modelo)

**O que será feito, em linguagem simples**
De anel para tabela mensal completa:
1. **Faixa de 4 indicadores** (da ficha): Total medido · Saldo da obra · Percentual executado · Última medição (último `periodo` de `o.medicoes`).
2. **Tabela mensal** de `o.medicoes`: Nr (`nr_medicao`) · STM (`status`) · Período (`periodo`) · Protocolo (`nr_protocolo`) · Medido (`valor_medicao`) · Total (`total`). **Sem STP, Glosa, Ajuste.**
3. **Rodapé:** Total Medido · Saldo da Obra · Percentual — da `ficha_contrato`, como hoje.
4. **Cartão "Legendas de status (STM)"** — referência estática dos códigos de `status`.
- **Sai** o anel `donutGauge`. Sem `o.medicoes` → tabela com estado vazio; sem `o.ficha` → faixa com "—".

**Arquivos**
- `assets/js/mapa-obras.js` — `buildMedicoesPane` reescrito (tabela). `fetchMedicoes` já traz `nr_protocolo, total, status`. `donutGauge` deixa de ser chamado aqui.
- `assets/css/mapa-obras.css` — faixa de indicadores, tabela mensal (`overflow-x:auto`, cabeçalho fixo visualmente), rodapé, cartão de legendas.

**Invariáveis específicas**
- Faixa/rodapé de totais vêm de `ficha_contrato` (autoritativo) — **não** de somar a tabela.
- Colunas exibidas = só as que existem em `medicoes` (spec §7 item 15). Sem inventar STP/Glosa/Ajuste.
- `escHtml`/`fmtVal`/`fmtDateBR` em todo campo da tabela; "—" quando nulo. Sem cor hardcoded.

**Ponto de verificação**
- Contrato com muitas medições: a tabela lista todas na ordem de `nr_medicao`; os totais do rodapé continuam vindo da ficha e batem com hoje.
- `o.medicoes` vazio (RLS/rede) → faixa ainda funciona pela ficha; tabela com estado vazio limpo, não erro.
- `o.ficha` ausente → faixa com "—"; sem quebra.
- Tabela rola no contêiner, não no corpo do modal; cabeçalho legível ao rolar. Contraste AA nos dois temas. Console limpo.

---

## Bloco 7 — Coesão visual e acessibilidade

**O que será feito, em linguagem simples**
Passada de acabamento no visual do modal inteiro: garantir que Resumo, Aditivos de valor, Aditivos de prazo, Medições e Fiscalização falam a mesma língua visual; que tudo tem contraste suficiente nos dois temas; que as 5 abas cabem em telas estreitas e em projeção; que as tabelas rolam no próprio contêiner; que o botão "Localizar" e o toggle "Detalhes do contrato" comunicam bem o que fazem.

**Arquivos**
- `assets/css/mapa-obras.css` — só ajuste fino (espaçamento, tipografia de título de bloco, estados hover/focus/disabled), reusando as classes existentes.
- `assets/js/mapa-obras.js` — nada, ou mínimo (ex.: `aria-label` de um botão).

**Invariáveis específicas**
- Nenhuma mudança de conteúdo, número ou comportamento. Só apresentação.
- Sem cor hardcoded; tudo por `var(--...)`.

**Resultado esperado**
O modal parece uma peça só, coerente com o resto do módulo, legível de escritório e em projeção, nos dois temas.

**Ponto de verificação**
- Contraste de todo texto do modal ≥ WCAG AA (normal 4,5:1; grande 3:1), nos dois temas, medido nos pares texto/superfície principais.
- As 5 abas em 360px de largura e em modo apresentação: cabem, rolam na horizontal se preciso, sem cortar a aba ativa.
- As tabelas largas (Aditivos de valor/prazo, Medições) rolam dentro do próprio contêiner; o corpo do modal não rola na horizontal.
- "Detalhes do contrato" e "Localizar": afordância clara (cursor, ícone, `title`/`aria`), estados coerentes com os outros botões.
- Estados vazios (sem aditivo de valor / de prazo / sem ficha / sem medição / sem comissão) limpos.

---

## Bloco 8 — Fechamento e conferência final

**O que será feito, em linguagem simples**
Varredura final antes dos revisores: percorrer os critérios de aceite da spec (seção 4), rodar as verificações técnicas, e preparar o resumo das mudanças (arquivos + explicação simples + antes/depois visual) para os 4 revisores.

**Verificações**
- `node --check` em `assets/js/mapa-obras.js` sem erro; parse do HTML OK; **sem `id` duplicado** (os `id` internos do modal, recriados a cada `openModal`, não colidem com os 41 `id` estáticos da página).
- `escHtml`/`fmtCNPJ`/`fmtDateBR` em **todo** campo do banco no modal; nenhum `innerHTML` novo com dado cru (conferência de código).
- **Comparação antes × depois** dos valores de dinheiro de Aditivos e Medições, contrato a contrato, registrada. A agregação de **dias** de prazo (Bloco 5) conferida linha a linha.
- `fetchMedicoes` conferido: `medicoes` é a única tabela nova; falha da tabela degrada para curva/tabela vazias sem quebrar o resto; `git diff` das listas de colunas (`CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS`) = vazio; nenhuma chamada a `app_users`.
- Console limpo ao: abrir o modal (vários contratos), trocar entre as 5 abas, expandir "Detalhes do contrato", clicar "Localizar no mapa", trocar de tema com o modal aberto — nos dois temas.
- `Esc` / clique no fundo / `✕` fecham; foco ao abrir vai para um elemento focável.
- `assets/geo/*.json` inalterados; nada fora do modal alterado (`git diff` revisado).

**Ponto de verificação**
- Checklist da seção 4 da spec percorrido (4.1 a 4.4).
- Em seguida, os **4 revisores** são acionados (ver [`docs/etapa-B-modal-revisores.md`](etapa-B-modal-revisores.md)).
- **Entrega ao usuário:** resumo consolidado da Etapa B para a **validação prática/visual** — o segundo portão.

---

## Resumo da ordem e das dependências

| # | Bloco | Depende de | Entrega |
|---|---|---|---|
| 1 | Estrutura das 5 abas + botão "Localizar" | — | ✅ **concluído (2026-08-29)** — 5 abas; split Aditivos → valor/prazo; `wireModalTabs` para 5; números idênticos. *(Bug pré-existente corrigido: `#mPaneResumo` vencia `[hidden]` → `:not([hidden])`.)* |
| 2 | Aba Resumo — **dashboard conforme o modelo** | 1 | ✅ **concluído (2026-08-29)** — identificação única · 2 cartões de status · 4 indicadores (Valor atual · Aditivos · Total medido · Saldo a medir) · curva com grade · "Pontos de atenção" · "Detalhes" recolhível. |
| 3 | Aba Fiscalização (final) | 1 | ✅ **concluído (2026-08-29)** — cartões fiscal responsável/suplente + comissão ordenada; sem matrícula. |
| 4 | Aba Aditivos de valor (modelo) | 1, 2 | ✅ **concluído (2026-08-29)** — faixa de 5 cartões → tabela com pílula de % → barra art. 125; dinheiro idêntico; barras divergentes removidas. |
| 5 | Aba Aditivos de prazo (modelo) | 1, 2 | ✅ **concluído (2026-08-29)** — 2 cartões (exec/vig) → mini-cartões → tabela "Prazo acumulado" → barra empilhada; agregação de dias (§7 item 13). |
| 6 | Aba Medições — tabela mensal (modelo) | 1, 2 | ✅ **concluído (2026-08-29)** — faixa (da ficha) → tabela mensal de `o.medicoes` → rodapé (da ficha) → legendas STM; anel removido; `MEDICOES_COLS` +`nr_protocolo/total/status`; `cacheKey` v3→v4. |
| 7 | Coesão visual + acessibilidade | 2–6 | ✅ **concluído (2026-08-29)** — `statusTextColor()` (texto AA nos dois temas); `scrollIntoView` da aba ativa em 360px; 8 regras CSS órfãs removidas; funções legadas mantidas com nota (spec §3.1). |
| 8 | Fechamento e conferência | 1–7 | ✅ **concluído (2026-08-29)** — verificações mecânicas OK; **os 4 revisores em `APROVADO`** (R2/R3/R4 rodada 1, R1 rodada 2 após corrigir B1 — subtítulo do cabeçalho). Portão 1 fechado. Follow-ups anexos em [`etapa-B-modal-revisores.md`](etapa-B-modal-revisores.md). **Falta o Portão 2 — validação prática/visual do usuário.** |

---

## Fora do escopo da Etapa B (não bloqueia esta etapa)

- Matrícula do fiscal (depende de vínculo confiável `comissao_fiscalizacao` ↔ `app_users`) → etapa futura.
- Novos filtros, integração mapa/painel/lista, áreas acinzentadas → **Etapa C**.
- Eliminar a tela "Ceará inteiro", entrada animada nos 11 distritos → **Etapa D**.
- Exportar/imprimir contrato; permalink por contrato; edição de dados.
- Fotos; documentos anexos; colunas de medição que não existem na base (STP, glosa, ajuste).
