# Etapa A — Tema Claro/Escuro · Plano de Implementação

Módulo: **Mapa de Obras Fiscalizadas** (`gecope_mapa_obras.html`, `assets/js/mapa-obras.js`, `assets/css/mapa-obras.css`)
Spec de referência: [`docs/etapa-A-tema-spec.md`](etapa-A-tema-spec.md) — **aprovada em 2026-08-28**
Configuração dos revisores: [`docs/etapa-A-tema-revisores.md`](etapa-A-tema-revisores.md)

---

## Natureza deste documento

- **Nenhum código é alterado agora.** Esta é a fase de planejamento.
- Este documento é um **guia para a implementação futura**. Ele descreve, em ordem, o que será feito, o que cada passo toca no sistema, o resultado esperado e como conferir se o passo ficou correto.
- Cada bloco está explicado de forma que uma pessoa **não desenvolvedora** consiga entender o que será feito.
- Depois que este plano e o documento dos revisores estiverem prontos, **o usuário revisa e aprova**. Só então o plano é transformado em tarefas de implementação e o código começa a ser alterado.

## Como o acompanhamento vai funcionar

- A implementação segue os **8 blocos abaixo, na ordem**.
- **Ao terminar cada bloco importante**, é apresentado ao usuário, **em linguagem simples e de forma visual quando possível** (capturas de tela das partes afetadas nos dois temas, ou um antes/depois descrito quando a captura não fizer sentido para aquele bloco), **o que foi alterado e o resultado obtido no uso real**. O usuário pode pedir ajuste antes de seguir para o bloco seguinte — sem esperar o fim da etapa inteira.
- Ao terminar o **bloco 8**, os **4 revisores** (ver [`docs/etapa-A-tema-revisores.md`](etapa-A-tema-revisores.md)) são acionados para a **validação técnica**.
- **Encerramento da Etapa A — dois portões, ambos obrigatórios:**
  1. Os **4 revisores** com veredito `APROVADO` (validação técnica).
  2. A **validação prática e visual do usuário** — a percepção de que, no uso real, as mudanças produziram o resultado esperado.
  Só com os dois portões cumpridos a Etapa A é considerada concluída e passamos para a Etapa B (Modal).

## Glossário rápido (para leitura não técnica)

| Termo | Significado neste plano |
|---|---|
| **Token / atalho de cor** | Um "apelido" para uma cor, definido num lugar só. Trocar o valor do apelido troca a cor em todo o sistema de uma vez. |
| **`:root` / folha de estilo (CSS)** | O arquivo onde ficam todas as cores e o visual do módulo (`assets/css/mapa-obras.css`). |
| **Classe `theme-dark`** | Uma "etiqueta" colada na página quando o tema é escuro. Sem a etiqueta = tema claro. É colada em dois lugares: na raiz do documento (`<html>`) e no corpo (`<body>`) — ver "Adequação técnica AT-1" abaixo. |
| **`localStorage`** | Uma gavetinha do navegador onde a preferência do usuário fica guardada, mesmo fechando o navegador. |
| **Coroplético / "mapa de calor"** | O mapa colorido em que tons mais fortes indicam mais obras (ou mais valor) num distrito/município. |
| **Leaflet** | A biblioteca que desenha o mapa. Ela não troca de cor sozinha — o código precisa mandar redesenhar. |
| **Console** | A "área de diagnóstico" do navegador, onde erros técnicos aparecem. "Console limpo" = sem erros. |

---

## Adequação técnica AT-1 — marcação do tema na raiz do documento (autorizada em 2026-08-28)

Descoberta durante a preparação do Bloco 3. O JavaScript do módulo lê as cores da **raiz do documento** (`<html>`), uma vez no carregamento. Se as cores claras ficassem presas só ao corpo (`<body>`), o JavaScript continuaria lendo as cores escuras — deixando **invisíveis os nomes de distrito/região/município no painel lateral** (que são desenhados pelo JavaScript) e **sem ajuste os gráficos** "contratos por ano" e "situação das obras" no tema claro.

**Adequação:** a etiqueta `theme-dark` passa a ser colada **na raiz do documento (`<html>`) e no corpo (`<body>`)** — no script de decisão do Bloco 1, na ação do botão e no "sensor" do sistema operacional. As cores do tema claro são definidas sob `:root:not(.theme-dark)` (a raiz), acessível tanto ao CSS quanto ao JavaScript. A convenção `body.theme-dark` continua existindo, sem impacto para o resto do GECOPE.

É uma **adequação técnica necessária** para o tema claro funcionar em todos os elementos, especialmente textos e gráficos controlados por JavaScript. **Não muda o objetivo nem o comportamento já aprovado do Bloco 1** (botão, persistência, ausência de "piscada") — as verificações do Bloco 1 foram reexecutadas após a mudança.

Onde este documento diz "etiqueta `theme-dark` no `<body>`" ou "condição `theme-dark` ausente", leia-se conforme a AT-1: etiqueta em `<html>` e `<body>`; condição `:root:not(.theme-dark)`.

---

## Bloco 1 — Base de tema (mecânica + botão)

**O que será feito, em linguagem simples**
Montar o "encanamento" do tema, sem ainda mudar as cores. Isso inclui:
- Um pequeno trecho que roda logo no início do carregamento e decide o tema: se o usuário já escolheu antes, usa a escolha dele; se nunca escolheu, usa a configuração de claro/escuro do computador.
- O **botão sol/lua** no cabeçalho, do lado direito, junto dos botões que já existem.
- Ao clicar, a página passa a etiqueta `theme-dark` de presente para ausente (ou vice-versa) e **guarda a escolha** na gavetinha do navegador (`gecope_theme`, com valor `dark` ou `light` — a mesma que o resto do GECOPE usa).
- Um "sensor" que observa a configuração do computador **só enquanto o usuário ainda não fez uma escolha manual**.

**Partes do sistema que podem ser afetadas**
- `gecope_mapa_obras.html` — trecho de decisão no topo do arquivo; novo botão no cabeçalho (área `.top-meta`).
- `assets/js/mapa-obras.js` — ação do botão, gravação da preferência, o "sensor" da configuração do computador.
- `assets/css/mapa-obras.css` — visual do botão (mínimo).

**Resultado esperado**
O botão existe e funciona: alterna a etiqueta `theme-dark`, guarda a escolha, e a escolha sobrevive a fechar e reabrir a página. Sem "piscada" de tema no carregamento. **Neste ponto as cores ainda não mudam** — o tema claro só ganha aparência nos blocos 3 a 5. A conferência aqui é do mecanismo, não do visual.

**Ponto de verificação**
- Limpar a preferência guardada, colocar o computador em modo escuro e abrir → abre no escuro. Colocar o computador em modo claro e abrir → a etiqueta `theme-dark` fica ausente (o visual ainda não é o do tema claro final, e tudo bem neste bloco).
- Clicar no botão → a etiqueta alterna, a escolha é guardada, e continua valendo depois de recarregar.
- Com uma escolha já guardada, mudar a configuração do computador → o módulo **não** muda.
- Abrir a página e observar: nenhuma "piscada" do tema errado.

---

## Bloco 2 — Reorganização dos atalhos de cor

**O que será feito, em linguagem simples**
Hoje a folha de estilo usa alguns atalhos de cor de um jeito que só faz sentido em fundo escuro (por exemplo: "clarear um pouco esta superfície" e "jogar uma sombra escura"). Para o tema claro funcionar, esses atalhos precisam virar conceitos que sabem se virar conforme o tema ("elevar uma superfície" e "lançar uma sombra", com valores diferentes no claro e no escuro).

Neste bloco esses atalhos são reorganizados. **Aplicados ao tema escuro, eles resultam exatamente nas mesmas cores de hoje** — a mudança é só na forma de escrever, não no resultado visível.

**Partes do sistema que podem ser afetadas**
- `assets/css/mapa-obras.css` — introdução dos atalhos novos e substituição dos usos antigos. Sem alterar os valores das cores do tema escuro.

**Resultado esperado**
O tema escuro continua **idêntico ao atual, pixel a pixel**. A folha de estilo passa a expressar "elevação de superfície" e "sombra" de um jeito que o tema claro poderá reaproveitar.

**Ponto de verificação**
- Comparação lado a lado do tema escuro (antes x depois) em todas as telas: mapa nos 3 níveis, painel lateral, janela do contrato nas 3 abas atuais, painel de filtros, trilha de navegação, menuzinho de "outros distritos", tela de erro. **Nenhuma diferença perceptível.**
- A lista de mudanças mostra só a folha de estilo, sem alteração nos valores reais das cores escuras.

---

## Bloco 3 — Paleta clara: superfícies (tudo, menos o mapa)

> **Andamento (2026-08-28):**
> - **Rodada 3.0** — 1ª paleta clara completa das superfícies. *Reprovada visualmente* (achatada, "escuro pintado de branco").
> - **Rodada 3.0-v2** — direção "mapa escuro / chrome claro". *Reprovada* (não era tema claro).
> - **Rodada 3.1 — CONCLUÍDA E APROVADA.** Refinamento só em CSS a partir da v1: fundo quase branco (`#F4F6F5`), painel `#FCFDFD`, cartões sem borda + sombra levíssima (menos "encaixotado"), mais respiro entre seções, cabeçalho refinado ("Carteira ativa" discreto), verde de acento institucional `#0C8A5C`, gráficos com mais folga, botão "Limpar" vira ação secundária (ícone ↺), **token novo `--map-field`** (campo do mapa distinto da página, claro), e **1ª passada nos rótulos e cores do mapa** (rótulos peso 500 / grafite-esverdeado / opacidade 0,8 / halo-sussurro via `--shadow-ink` claro; bordas brancas entre distritos; verdes `--map-*` mais encorpados). Nenhuma mudança em JS/HTML.
> - **Rodada 3.2 — CONCLUÍDA E APROVADA (2026-08-28).** *Parte A (CSS):* painel de filtros mais limpo — títulos discretos, campos brancos com filete, segmentados sem a calha cinza, mais ar entre grupos. *Parte B (HTML: classes `k-*` nos KPIs + CSS):* 3 níveis de hierarquia — Nível 1 (Obras, Valor total) em faixa cheia com acento; Nível 2 (Paralisadas, Valor médio, Municípios, Aditivos) compactos 2×2; Nível 3 (análises + ranking) sem caixas, ranking com filetes.
>   - **Correção (2026-08-28):** a Parte B foi 1ª feita só no tema claro; a pedido do usuário passou a valer para **os dois temas** — a *disposição* dos cards é idêntica no claro e no escuro, só as cores mudam por tema (dos tokens). As classes antigas `wide`/`alert` foram **removidas** dos KPIs; toda a hierarquia é feita pelas classes `k-*`. Isso **muda o layout de KPI do tema escuro** em relação ao original (Obras vira faixa cheia; Valor médio deixa de ser faixa; Paralisadas perde a barra vermelha, mantém só o número em vermelho) — mudança deliberada, pedida pelo usuário para os dois temas ficarem iguais. Verificado: `order`/`grid-column`/tamanho de valor idênticos entre claro e escuro.
> - **Deferido para o Bloco 4:** o *contraste entre distritos* (a fórmula de opacidade `0,10 + 0,62 × intensidade` vive no JS) e o ajuste-fino visual dos estados do mapa (normal / hover / aberto / selecionado) e valores finais dos verdes — a serem validados com o usuário.
> - **Refinamentos adicionais pedidos pelo usuário (2026-08-28), todos concluídos e aprovados** — em cima da 3.1/3.2, sempre preservando o tema escuro e sem tocar em dados/JS (exceto onde indicado):
>   - Gráfico "Contratos por ano": SVG esticado → barras HTML/flex, com valor acima de cada barra, trilho de fundo e ano de pico destacado (mexeu em `renderYearChart`, mesmos dados). Vale para os dois temas.
>   - Cards do ranking "Distritos Operacionais": de filetes para **cartões compactos elevados** (sombra no claro, gradiente+borda no escuro), hover com elevação de 1px.
>   - **Ícones nos 6 KPIs** (HTML: 6 SVGs + CSS): ícone à direita em círculo (verde claro; vermelho em Paralisadas). Layout interno do card virou **grade de 2 colunas** (texto | ícone) para o ícone nunca sobrepor o valor; nos cards compactos o valor passou de 19→17px (só a fonte).
>   - "Situação das obras": barra empilhada → **3 mini-cards verticais** (mexeu em `renderStatusChart`, mesmos dados/cálculos); `#statBar` oculto.
>   - **Profundidade "premium"** em todos os cards do painel direito: sombra em camadas no claro, fio de luz na borda superior + sombra suave no escuro; acento verde lateral dos 2 KPIs principais restaurado.

**O que será feito, em linguagem simples**
Desenhar e aplicar a versão clara das cores de tudo que **não** é o mapa: fundo geral, cabeçalho, painel lateral, cartões de indicador, lista de contratos, rankings, a janela do contrato, o painel de filtros e suas listas de seleção, a trilha de navegação, o menuzinho de "outros distritos", a tela de erro e a animação de "carregando".

**Partes do sistema que podem ser afetadas**
- `assets/css/mapa-obras.css` — bloco de cores claras que só age quando a etiqueta `theme-dark` está ausente. Inclui os valores claros dos atalhos criados no bloco 2.

**Resultado esperado**
Com o tema claro ativo, todas essas áreas aparecem numa paleta clara **desenhada**: textos legíveis (com contraste dentro do padrão de acessibilidade AA), e os efeitos de passar o mouse / clicar / selecionar coerentes com o que o tema escuro já faz.

**Ponto de verificação**
- No tema claro, percorrer cabeçalho, painel lateral, cada aba da janela do contrato, o painel de filtros: tudo legível, sem texto "sumindo".
- Conferir contraste dos textos.
- Conferir que o que "salta aos olhos" no claro é o mesmo que salta no escuro (a hierarquia visual foi preservada).

---

## Bloco 4 — Paleta clara: o mapa

> **Ajuste de escopo (2026-08-28):** a Rodada 3.1 do Bloco 3 já fez a **1ª passada** nas cores do mapa (`--map-*`, `--map-field`, bordas brancas) e nos **rótulos** (peso, cor, opacidade, halo claro via `--shadow-ink`). O Bloco 4 fica com: **(a)** o *contraste entre distritos* — ajustar a fórmula de opacidade da coroplética, que está no **JavaScript** (`0,10 + 0,62 × intensidade`); **(b)** validar visualmente com o usuário os estados **normal / hover / aberto / selecionado** e travar os valores finais dos verdes; **(c)** conferir tooltip e botões de zoom no tema claro; **(d)** os contornos de hover/seleção do mapa que ainda usam `--text-brightest` como cor de linha (trocar por cor própria do mapa). É a única parte do Bloco 4 que toca JS.

**O que será feito, em linguagem simples**
Desenhar e aplicar a versão clara das cores do mapa: o fundo atrás do mapa, o "mapa de calor" nos 3 níveis (distritos / municípios de um distrito / município aberto), a silhueta do estado, as linhas de divisão, as caixinhas de informação (tooltip) e os botões de zoom.

**Partes do sistema que podem ser afetadas**
- `assets/css/mapa-obras.css` — valores claros das cores do mapa (`--map-*`), do fundo, e das partes do Leaflet que já usam atalhos de cor (caixinha de informação, botões de zoom).

**Resultado esperado**
No tema claro, o mapa aparece numa paleta clara desenhada, e o "mapa de calor" continua **distinguível**: dá para diferenciar um distrito com muitas obras de um com poucas.

**Ponto de verificação**
- No tema claro, em cada nível do mapa: dá para ver a diferença de intensidade entre as áreas; as linhas de divisão são visíveis; a caixinha de informação é legível; os botões de zoom aparecem.

---

## Bloco 5 — Rótulos do mapa no tema claro

> **CONCLUÍDO (2026-08-28).** O tratamento claro dos rótulos foi feito na Rodada 3.1 (texto grafite-esverdeado `#2C4139`, nome peso 500, número peso 700 a ~87% do nome, opacidade de repouso 0,8, halo-sussurro via `--shadow-ink` claro, "CEARÁ" como marca d'água). A **verificação final de legibilidade** foi feita no tema claro nos níveis 1 (11 D.O.) e 2 (municípios), inclusive após a remoção do "Região" (Bloco 7): nomes e contadores legíveis, bordas brancas nítidas; no escuro, mint + halo escuro. **Aprovado.**
> A *hierarquia dinâmica* opcional (destaque no hover/seleção via ~10 linhas de JS) **não foi implementada** — o usuário optou por avaliar só o resultado CSS; fica como possível follow-up futuro, fora da Etapa A.

**O que será feito, em linguagem simples**
Os nomes de distrito/município e o número de obras que aparecem **em cima** do mapa hoje são texto claro com um contorno escuro, para se destacar do mapa escuro. No tema claro isso se inverte: texto escuro com um contorno claro, para não sumirem no fundo claro.

**Partes do sistema que podem ser afetadas**
- `assets/css/mapa-obras.css` — cor do texto e do contorno desses rótulos, por tema.

**Resultado esperado**
No tema claro, todos os rótulos visíveis do mapa são legíveis sobre qualquer cor do mapa embaixo deles.

**Ponto de verificação**
- No tema claro, num distrito com muitos municípios (rótulos apertados): cada rótulo visível está legível; nenhum "lavado"; a lógica que esconde rótulos que colidem continua funcionando.

---

## Bloco 6 — Repintura do mapa na troca ao vivo

**O que será feito, em linguagem simples**
Garantir que, ao clicar no botão de tema, **o mapa também troca na hora**, junto com o resto. O mapa (desenhado pelo Leaflet) não troca de cor sozinho: o código precisa reler as cores do tema atual e mandar redesenhar o "mapa de calor", a silhueta do estado, as linhas e os rótulos — tudo numa ação só, sem recarregar a página.

**Partes do sistema que podem ser afetadas**
- `assets/js/mapa-obras.js` — a ação do botão de tema passa a: reler as cores atuais, remandar desenhar as camadas do mapa e os rótulos, e atualizar o painel/gráficos.

**Resultado esperado**
Clicar no botão troca **tudo ao mesmo tempo** — painel, gráficos, janela do contrato (se aberta) e o mapa com seus rótulos e a silhueta do estado. Sem recarregar, sem nenhum pedaço "preso" no tema anterior.

**Ponto de verificação**
- Em cada nível do mapa, com a janela do contrato aberta e com um filtro ativo: clicar no botão → tudo vira junto; nada fica com a cor do tema antigo.
- Alternar várias vezes seguidas: sem travar, sem lentidão perceptível.

---

## Bloco 7 — Limpeza da opção "Região"

> **CONCLUÍDO E APROVADO (2026-08-28).** HTML: removido "Dividir por" + o segmento `#segMethod`. JS: `st.method` e toda a ramificação Distrito/Região removidos (16 pontos, incl. o handler de `#segMethod` inteiro e a lógica de âncora); `groupsList`/`gidOf`/`buildGroupLayer`/rótulos passam a usar sempre `do`; `groupEntries` com ordem fixa dos D.O.; `REGIOES`/`DB.regioes` removidos do código; todos os textos de UI passam a usar só "Distrito(s)". **`assets/geo/ce-referencia.json` (REGIOES) e `ce-blocos.json` (reg) não foram modificados** (`git status` limpo). Verificado nos dois temas: navegação L0→L3, trilha, popover ("Outros distritos"), rodapé, métrica Obra/Valor, seleção combinada — tudo OK; `node --check` OK; console sem erros; sem id/listener órfão.

**O que será feito, em linguagem simples**
Remover da tela o botão que alterna entre "Distrito Operacional" e "Região", e simplificar o código para operar **sempre** por Distrito Operacional. Os **dados** de região (arquivos no disco) **ficam preservados**, intocados — dá para reverter no futuro se necessário.

**Partes do sistema que podem ser afetadas**
- `gecope_mapa_obras.html` — remoção do botão de alternância no painel de controles.
- `assets/js/mapa-obras.js` — remoção da ação desse botão; a divisão do mapa fica fixa em Distrito Operacional; simplificação das funções que hoje decidem "distrito ou região"; ajuste dos textos da trilha de navegação e do rodapé.
- `assets/css/mapa-obras.css` — remoção de regras de estilo que só serviam para esse botão, se houver.
- **Preservados sem alteração:** `assets/geo/ce-referencia.json` (a parte de regiões) e `assets/geo/ce-blocos.json`.

**Resultado esperado**
Não existe mais nenhum controle de "Região" na interface. O mapa é sempre por Distrito Operacional. O caminho é Distrito Operacional → Município → Obra. Nada quebrado. Os arquivos de dados de região continuam no repositório.

**Ponto de verificação**
- Navegação completa Distrito → Município → Obra, nos dois temas.
- Trilha de navegação, menuzinho de "outros distritos", seleção combinada (Ctrl+clique), botão "Obra/Valor", botão "Carteira ativa/Histórico", tela cheia e modo apresentação: tudo continua funcionando.
- Console limpo; nenhuma "ponta solta" (referência a algo que foi removido).
- Os arquivos de dados de região aparecem como **não modificados** na lista de mudanças.

---

## Bloco 8 — Fechamento e conferência final

**O que será feito, em linguagem simples**
Passar item por item pelos critérios de aceite da spec (seção 4), conferir que não há erros técnicos, e preparar um resumo do que mudou para entregar aos 4 revisores.

**Partes do sistema que podem ser afetadas**
- Nenhuma parte nova — é uma varredura de conferência sobre o que os blocos 1 a 7 fizeram.

**Resultado esperado**
Todos os itens da seção 4 da spec podem ser marcados. Verificação técnica básica sem erros (checagem de sintaxe dos scripts; nenhum identificador duplicado; "console" sem erros ao carregar, ao trocar de tema, ao abrir a janela do contrato, ao passar o mouse no mapa e ao buscar — nos dois temas). Resumo das mudanças pronto.

**Ponto de verificação**
- Checklist da seção 4 da spec percorrido (4.1 Objetivo/Spec, 4.2 Regressão, 4.3 Design/UX, 4.4 Performance).
- Em seguida, os **4 revisores** são acionados (ver [`docs/etapa-A-tema-revisores.md`](etapa-A-tema-revisores.md)).

---

## Resumo da ordem e das dependências

| # | Bloco | Depende de | Entrega |
|---|---|---|---|
| 1 | Base de tema (mecânica + botão) | — | Botão funciona; preferência persiste; sem "piscada" |
| 2 | Reorganização dos atalhos de cor | 1 | Escuro idêntico; base pronta para o claro |
| 3 | Paleta clara: superfícies | 2 | Tudo fora do mapa com aparência clara desenhada |
| 4 | Paleta clara: o mapa | 2 | Mapa com aparência clara; "mapa de calor" legível |
| 5 | Rótulos do mapa no claro | 4 | Nomes e contadores legíveis no fundo claro |
| 6 | Repintura na troca ao vivo | 3, 4, 5 | Clicar no botão troca tudo junto, sem recarregar — **feito no Bloco 8 (1ª rodada de revisão), via `repaintTheme()`** |
| 7 | Limpeza do "Região" | — (independente; feito aqui pela conveniência de já estar no arquivo) | "Região" fora da UI; dados preservados |
| 8 | Fechamento e conferência | 1–7 | Critérios da spec conferidos; revisores acionados |

---

## Detalhamento em tarefas

Cada bloco do plano vira a lista de tarefas abaixo. A implementação segue esta ordem. Ao fim de cada bloco, a linha **"Entrega ao usuário"** descreve o que será apresentado para o seu acompanhamento prático/visual.

### Bloco 1 — Base de tema (mecânica + botão)

- **1.1** Inserir, como primeiro elemento dentro do `<body>` de `gecope_mapa_obras.html` (antes de qualquer conteúdo visível), um script curto que coloca ou remove a etiqueta `theme-dark` **na raiz do documento (`<html>`) e no `<body>`** (ver AT-1), decidindo por: preferência guardada em `gecope_theme` (`dark`/`light`); na ausência dela, a configuração claro/escuro do sistema operacional.
- **1.2** Adicionar o botão sol/lua (`id="btnTheme"`) como primeiro item do grupo à direita do cabeçalho (`.top-meta`), somente ícone, com `title` e `aria-label` "Alternar tema claro/escuro".
- **1.3** Em `assets/js/mapa-obras.js`, ligar o botão: ao clicar, alterna a etiqueta `theme-dark` em `<html>` e `<body>` (ver AT-1), grava `gecope_theme` (`dark`/`light`), e troca o ícone + o texto de ajuda para refletir o estado atual. *(A repintura completa do mapa na troca vem no Bloco 6.)*
- **1.4** Adicionar o "sensor" da configuração do sistema operacional, que ajusta o tema ao vivo **apenas enquanto** `gecope_theme` não estiver definida.
- **1.5** Em `assets/css/mapa-obras.css`, estilo mínimo do `#btnTheme`, na mesma linguagem visual dos botões do cabeçalho.
- **1.6** Verificação do bloco (conforme ponto de verificação do Bloco 1 no plano).
- **Entrega ao usuário:** demonstração do botão alternando o tema e da preferência sobrevivendo ao recarregar; observação explícita de que **as cores ainda não mudam** neste bloco (isso vem nos blocos 3 a 5) — aqui valida-se só o funcionamento do botão e da memória da preferência.

### Bloco 2 — Reorganização dos atalhos de cor

- **2.1** Criar os atalhos semânticos ("elevar superfície", "sombra") em `assets/css/mapa-obras.css`, com valores que, no tema escuro, resultam **exatamente** nas cores de hoje.
- **2.2** Substituir os usos antigos (clareamentos e sombras escritos para fundo escuro) pelos atalhos novos, sem alterar nenhum valor de cor do tema escuro.
- **2.3** Verificação do bloco: comparação lado a lado do tema escuro (antes x depois) em todas as telas listadas no plano.
- **Entrega ao usuário:** antes/depois do tema **escuro** nas telas principais, para você confirmar que **nada mudou visualmente**. (Bloco propositalmente "invisível" — é preparação interna.)

### Bloco 3 — Paleta clara: superfícies (tudo, menos o mapa)

- **3.1** Definir os valores claros de: fundos, cabeçalho, painel lateral, cartões de indicador, lista de contratos, rankings, janela do contrato, painel de filtros e listas de seleção, trilha de navegação, menuzinho de "outros distritos", tela de erro, animação de "carregando".
- **3.2** Definir os valores claros dos atalhos semânticos do Bloco 2 e das cores de texto.
- **3.3** Aplicar tudo sob o seletor `:root:not(.theme-dark)` (ver AT-1) — "etiqueta `theme-dark` ausente".
- **3.4** Verificação: percorrer todas essas áreas no tema claro; conferir contraste (padrão AA) e coerência dos estados de mouse/foco/seleção.
- **Entrega ao usuário:** capturas do tema **claro** de cada área (cabeçalho, painel, janela do contrato, filtros), lado a lado com o escuro equivalente.

### Bloco 4 — Paleta clara: o mapa

- **4.1** Definir os valores claros das cores do mapa (`--map-*`), do fundo do mapa, da caixinha de informação e dos botões de zoom.
- **4.2** Ajustar a curva de intensidade do "mapa de calor" se necessário para o claro (manter os níveis distinguíveis).
- **4.3** Verificação: no tema claro, em cada nível do mapa, confirmar que dá para diferenciar áreas com muitas e poucas obras, que as linhas de divisão aparecem, e que caixinha e zoom estão legíveis.
- **Entrega ao usuário:** capturas do mapa no tema **claro** nos 3 níveis (distritos / municípios de um distrito / município aberto), ao lado do escuro.

### Bloco 5 — Rótulos do mapa no tema claro

- **5.1** Definir, por tema, a cor do texto e a cor do contorno dos rótulos do mapa (nome + contador).
- **5.2** Verificação: no tema claro, num distrito com muitos municípios, todos os rótulos visíveis legíveis; a lógica que esconde rótulos sobrepostos continua funcionando.
- **Entrega ao usuário:** captura de uma área com rótulos densos no tema **claro**, destacando a legibilidade.

### Bloco 6 — Repintura do mapa na troca ao vivo

- **6.1** Na ação do botão de tema (`assets/js/mapa-obras.js`): reler as cores do tema atual, remandar desenhar as camadas do mapa (o "mapa de calor" nos níveis, a silhueta do estado, as linhas), reconstruir os rótulos, e atualizar painel/gráficos — tudo numa ação só, sem recarregar.
- **6.2** Verificação: em cada nível, com a janela do contrato aberta e com um filtro ativo, clicar no botão troca tudo junto; nada preso no tema anterior; alternar várias vezes sem lentidão.
- **Entrega ao usuário:** demonstração da troca instantânea com o mapa e o painel virando juntos, em diferentes situações de uso.

### Bloco 7 — Limpeza da opção "Região"

- **7.1** Remover o botão de alternância "Distrito Operacional / Região" do painel de controles em `gecope_mapa_obras.html`.
- **7.2** Em `assets/js/mapa-obras.js`: remover a ação desse botão; fixar a divisão do mapa em Distrito Operacional; simplificar as funções que hoje decidem "distrito ou região"; ajustar os textos da trilha de navegação e do rodapé.
- **7.3** Remover de `assets/css/mapa-obras.css` regras que só serviam a esse botão, se houver.
- **7.4** Confirmar que `assets/geo/ce-referencia.json` (parte de regiões) e `assets/geo/ce-blocos.json` ficam **sem alteração**.
- **7.5** Verificação: navegação completa Distrito → Município → Obra nos dois temas; trilha, menuzinho de "outros distritos", seleção combinada, botões "Obra/Valor" e "Carteira ativa/Histórico", tela cheia e modo apresentação funcionando; console limpo; sem ponta solta.
- **Entrega ao usuário:** antes/depois do painel de controles (sem o botão "Região") e confirmação em vídeo/descrição de que o fluxo continua funcionando.

### Bloco 8 — Fechamento e conferência final

- **8.1** Percorrer, item por item, os critérios de aceite da spec (seções 4.1 a 4.4).
- **8.2** Verificação técnica: checagem de sintaxe dos scripts; nenhum identificador duplicado; console sem erros ao carregar, trocar de tema, abrir a janela do contrato, passar o mouse no mapa e buscar — nos dois temas.
- **8.3** Preparar o resumo das mudanças (lista de arquivos alterados + explicação em linguagem clara) para os 4 revisores.
- **8.4** Acionar os 4 revisores.
- **Entrega ao usuário:** o resumo consolidado da Etapa A (o que mudou, em linguagem simples, com o material visual dos blocos anteriores reunido) para a **sua validação prática/visual** — o segundo portão de encerramento, em paralelo aos revisores.

**Andamento (2026-08-28):**
- **1ª rodada de revisão:** R1 Objetivo/Spec `BLOQUEADO`, R2 Regressão `BLOQUEADO`, R3 Design/UX `BLOQUEADO`, R4 Performance `APROVADO`.
  - R1+R2: o **Bloco 6 (repintura na troca ao vivo) não tinha sido implementado** — `setTheme()` só trocava a classe. Corrigido: `readTokens()` + `repaintTheme()` (re-lê `TOKENS`, re-estiliza `stateShape`, redesenha o modal aberto, `render()` uma vez) em `setTheme()` e no sensor do SO. **Bloco 6 concluído.**
  - R3: rótulos do mapa no tema claro abaixo de WCAG AA. Corrigido em CSS (só no claro): sem `opacity:.8`; `.lbl-name` `#2C4139`→`#1C2B23`; `.lbl-count` `var(--ng)`→`#123024`.
  - Detalhe: [`etapa-A-tema-spec.md`](etapa-A-tema-spec.md) §7–§8 e tabela de [`etapa-A-tema-revisores.md`](etapa-A-tema-revisores.md).
- **2ª rodada de revisão:** R2, R3, R4 `APROVADO`. R1 `BLOQUEADO` — mesma classe do bloqueante anterior num ponto que faltou: `STATUS_STATES` (dots de "Situação das obras") copia as cores de `TOKENS` no load e não era re-derivado na troca. Corrigido: `syncStatusColors()` + `repaintTheme()` o chama; mesmo padrão corrigido em `setStatus` (dot de "Base de dados") via `_lastStatus`.
- **3ª rodada de revisão:** R1, R2, R4 `APROVADO` sem achados. Com R3 (`APROVADO` na 2ª rodada), **os 4 revisores aprovaram — Portão 1 concluído**.
- **Portão 2 (validação prática/visual do usuário):** ✅ **usuário aprovou em 2026-08-28.**
- **✅ ETAPA A ENCERRADA (2026-08-28)** — os dois portões cumpridos. Segue para a Etapa B (Modal "Dados do Contrato").

---

## Fora do escopo da Etapa A (não bloqueia esta etapa)

- Mudanças na janela "Dados do Contrato" (abas, conteúdo, Resumo executivo) → **Etapa B**.
- Novos filtros, integração mapa/painel/lista, áreas acinzentadas por filtro → **Etapa C**.
- Eliminar a tela inicial "Ceará inteiro", entrada já dividida nos 11 distritos, animação de entrada, painel aberto na entrada → **Etapa D**.
- Levar o botão de tema para outros módulos do GECOPE.
- Qualquer mudança em carga de dados, cache ou no escopo Carteira Ativa/Histórico.
