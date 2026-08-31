# Etapa D — Entrada direta nos 11 Distritos · Especificação e Critérios de Aceite

Módulo: **Mapa de Obras Fiscalizadas** (`gecope_mapa_obras.html`, `assets/js/mapa-obras.js`, `assets/css/mapa-obras.css`)
Status: **implementada — Portão 1 (4 revisores APROVADO, sem re-execução) atingido em 2026-08-30. Aguardando Portão 2: validação prática/visual do usuário.** Escrita a partir do resumo de escopo da §0 sob a autorização "avançar todas as etapas restantes".
Rubrica dos 4 revisores. Etapa anterior: [`etapa-C-superfiltro-spec.md`](etapa-C-superfiltro-spec.md). Resultado da revisão + follow-ups: [`etapa-D-entrada-revisores.md`](etapa-D-entrada-revisores.md).

---

## 0. Contexto

| Etapa | Escopo | Status |
|---|---|---|
| A. Tema | Claro/escuro; limpeza de "Região". | ✅ encerrada 2026-08-28 |
| B. Modal | Janela "Dados do Contrato" em 5 abas. | ✅ encerrada 2026-08-29 |
| C. Super filtro | Novos filtros; integração; áreas sem match acinzentadas. | ✅ encerrada 2026-08-30 |
| **D. Entrada** *(este documento)* | Eliminar a visão "Ceará inteiro"; abrir já nos 11 Distritos Operacionais, com animação de entrada. | ← agora |

### Processo (igual às anteriores)
- Spec + plano + revisores aprovados **antes** de qualquer código.
- Ao fim: 4 subagentes revisores (Estrutura/Arquitetura · Dados/Cálculos/Integridade · Interface/Experiência · Regressão/Comportamento). 2 portões: (1) os 4 em `APROVADO`; (2) validação prática/visual do usuário.
- A cada bloco: apresentação em linguagem simples + validação.

### Restrições globais (herdadas)
- **Sem novas dependências.** Sem tabela/coluna nova do Supabase. Sem `fetchTable` novo.
- Página **estática e pública**; `escHtml` em todo dado do banco na tela.
- **Modo apresentação** e **tela cheia** continuam funcionando.
- **Tema claro e escuro:** qualquer cor nova vem de `var(--...)`/`TOKENS`. Sem cor hardcoded.
- **Não mudar:** dados, cálculos, o filtro (Etapa C), o modal (Etapa B), a métrica (`#segMetric`), o escopo (Carteira/Histórico), a seleção combinada (Ctrl+clique), os 3 arquivos `assets/geo/*.json`.

---

## 1. Objetivo

Hoje o app abre no **nível 0** — o "Ceará inteiro" como um bloco verde único (`stateShape`), com o rótulo "CEARÁ" e o tooltip "Clique para dividir". Só depois de um clique o usuário vê os **11 Distritos Operacionais** (nível 1). A Etapa D **elimina esse passo**: o app abre já no nível 1, com os 11 distritos, e a animação de câmera de entrada termina enquadrando-os — sem exigir o clique intermediário.

Nada de dado, cálculo, filtro, métrica ou navegação para dentro (níveis 2/3) muda. É a **camada de entrada e de navegação até o topo** que é reorganizada.

---

## 2. Escopo

### 2.1 Dentro do escopo

**2.1.1 — Nível inicial = 1 (Distritos).**
- `st.level` inicial passa de `0` para `1`. O nível 0 deixa de ser um destino navegável.
- Na carga: `render()` roda com `st.level===1` → `groupLayer` (os 11 polígonos de distrito) visível; `layer` (municípios) escondido (`HID`), como já é no nível 1 hoje.

**2.1.2 — Fim da "visão Ceará inteiro".**
- O polígono do estado (`stateShape`) **não é mais uma camada navegável**: sem clique, sem hover destacado, sem o tooltip "Clique para dividir". Passa a `interactive:false`.
- **[decisão de implementação, 2026-08-30]** `stateShape` **deixa de ser exibido em qualquer nível** (`setLayer(stateShape,false)` fixo). Os 11 polígonos de distrito são os **municípios dissolvidos** (`GRP.do`) — cobrem exatamente a mesma área do estado, sem vãos na borda. Manter uma silhueta de fundo (a) não tem função (não há vão a tapar) e (b) a `.5` de opacidade dos distritos, tingiria o mapa de verde e quebraria a paridade com o nível 1 de hoje (que não tem `stateShape` atrás). O objeto `stateShape` continua **criado** (inerte) só para `repaintTheme` não quebrar.
- O rótulo "CEARÁ" (`stateLbl`) e o tooltip "Clique para dividir" **saem** (o "CEARÁ" já era follow-up de watermark da Etapa A §8). O `stateLbl`/`stateItem`/`stateC` e as regras CSS `.state-label` são removidos.

**2.1.3 — Animação de entrada.**
- Mantém o padrão de hoje: a câmera parte afastada (`fitBounds(fullBounds, {padding:[220,220], animate:false})`) e **voa** (`flyToBounds(fullBounds, ~2.8 s)`) até enquadrar a área — que é a mesma `fullBounds`, agora mostrando os 11 distritos.
- Acréscimo: a `groupLayer` entra com um **fade rápido** (opacidade 0 → 1, ~350 ms via classe CSS `.grp-enter`/`.grp-enter-in` no `<path>`, disparado logo no **início** do voo — não no `moveend`, para os distritos não ficarem 2,8 s invisíveis). Sem stagger por polígono (risco/custo desnecessário com Leaflet). Classes retiradas ~420 ms depois; o Leaflet volta a mandar no estilo.
- O reveal do `#mapWrap` (`.in`, fade/scale) continua como está.
- A animação roda **uma vez** (guarda `_firstFit`/`_entranceDone` como hoje).

**2.1.4 — Navegação até o topo.**
- `goState()` (nível 0) deixa de existir como destino: vira **alias de `goSub()`** (nível 1). Todos os pontos que hoje chamam `goState()` — troca de escopo Carteira↔Histórico (`setDataScope`), o `data-nav="state"` da trilha, o reset de `_searchNav` — passam a levar ao **nível 1**.
- O reset de `_searchNav` que hoje faz `st.level=0` passa a `st.level=1`.
- `goSub()` continua sendo o nível 1 e é a "casa" do app.

**2.1.5 — Breadcrumb (trilha).**
- Raiz = **"Distritos"** (ou "Distritos Operacionais"), representando o nível 1.
  - Nível 1: `<span class="cur">Distritos Operacionais</span>` (sem link acima).
  - Nível 2: `Distritos › <Distrito>` — "Distritos" linka para o nível 1.
  - Nível 3: `Distritos › <Distrito> › <Município>`.
- Some o item "Ceará" isolado que hoje precede "Distritos" (eram dois passos; viram um).

**2.1.6 — Navegação para o topo / painel.**
- **[verificado, 2026-08-30]** Não existe botão "Voltar" no mapa — subir de nível é **só pela trilha**. O `#btnVoltar` do HTML é "Sair do módulo → Painel Principal" (`index.html`), não tem a ver com nível. Logo, nada a "desabilitar": no nível 1 a trilha é só `<span class="cur">Distritos</span>`, sem link acima — não há ação de subir.
- O painel lateral no nível 1 mostra o **ranking dos 11 Distritos** (ramo `st.level<=1` de hoje). O texto de escopo do nível 0 ("Visão geral do estado — clique no mapa para dividir…") **sai**; fica o do nível 1 ("Estado dividido por Distritos Operacionais — passe o mouse ou clique para entrar").
- O rodapé (`renderFoot`) troca "Fluxo: Ceará → Distritos Operacionais → cidades" por **"Fluxo: Distritos Operacionais → cidades"**.

**2.1.7 — Modo apresentação / tela cheia.**
- **[verificado, 2026-08-30]** O "modo apresentação" é só uma classe de layout fixo (`body.presentation`) + o toggle de tela cheia real do navegador — **não há ciclo automático de níveis**. Entra no nível 1, como o resto.

### 2.2 Fora do escopo (não é regressão se não estiver aqui)

- Mudar a navegação para dentro (níveis 2 e 3), o zoom, a seleção combinada, o popover de irmãos.
- Mudar o filtro (Etapa C), o modal (Etapa B), a métrica, o escopo.
- Animação por polígono (stagger), transição de "morphing" do estado para os 11 distritos, partículas, etc.
- Tabela/coluna nova do Supabase; qualquer `fetchTable` novo.
- Permalink de nível; lembrar o último nível entre sessões.
- Mudança de tipografia/layout estrutural da página.

---

## 3. Abordagem técnica (proposta — revisores podem contestar)

### 3.1 Onde mexe

- **`assets/js/mapa-obras.js`:**
  - `const st={... level:0 ...}` → `level:1`.
  - `goState()` → `function goState(){ goSub(); }` (alias). `_searchNav` reset: `st.level=0` → `st.level=1`.
  - `stateShape` (init, ~linha 2210): `L.geoJSON(ESTADO,{... interactive:false})` sem `onEachFeature` (ou com um `onEachFeature` vazio) — remove os `l.on('click'/'mouseover'/'mouseout')` e o tooltip "Clique para dividir".
  - `setLayer(stateShape, st.level===0)` → `setLayer(stateShape, st.level<=2)` (fundo nos níveis 1 e 2) e garantir que fica **atrás** da `groupLayer` (ordem de `addTo`/`bringToBack`).
  - `stateLbl` / `stateItem`: remover a criação e as chamadas `setLayer(stateLbl, ...)`.
  - `renderCrumb`: remover o ramo `st.level===0`; ajustar os ramos 1/2/3 conforme §2.1.5.
  - `renderPanel`: remover o ramo/texto do nível 0; o ramo `st.level<=1` cobre o nível 1.
  - `renderFoot`: novo texto.
  - `tipHtml`: remover o ramo `st.level===0`.
  - Botão "Voltar": desabilitar quando `st.level===1`.
  - Entrada: em `fitFull()`, no `map.once('moveend', ...)` do primeiro voo, disparar o fade da `groupLayer` (adicionar/remover uma classe no container SVG do groupLayer, ou animar via `setStyle` opacity).
- **`assets/css/mapa-obras.css`:** a transição de fade da `groupLayer` na entrada; estado desabilitado do "Voltar" no nível 1; nada estrutural.
- **`gecope_mapa_obras.html`:** nada, ou o mínimo.

### 3.2 Regras que não podem ser quebradas

- **Níveis 2 e 3 idênticos** — descer num distrito, abrir um município, o popover de irmãos, o Ctrl+clique, o modal, o filtro (Etapa C) — tudo igual.
- **A animação de entrada roda uma vez** (`_firstFit`/`_entranceDone`); os vários `ensureSize()` de segurança não a cortam.
- **`fullBounds`** continua sendo o enquadramento de referência (mesma área; agora nível 1).
- **Sem cor hardcoded**; a transição usa `var(--...)`/opacidade.
- **`repaintTheme`** (troca de tema ao vivo) continua funcionando no nível 1.
- **Modo apresentação / tela cheia / `refit()` / `ensureSize()`** continuam corretos com o novo nível inicial.

### 3.3 O que já existe e é reaproveitado

- `goSub()` — já leva ao nível 1, com `render()` + `fitFull()`.
- O ramo `st.level<=1` de `renderPanel` — já monta o ranking dos 11 distritos.
- `groupLayer` / `groupStyle` / `onGroup` — a camada dos 11 distritos, já pronta.
- `_firstFit` / `_entranceDone` / `#mapWrap.in` — a maquinaria da animação de entrada.
- `fullBounds` — os limites do estado (= área dos 11 distritos).

---

## 4. Critérios de aceite — por lente de revisor

### 4.1 Objetivo / Spec

- [ ] Ao carregar, o app mostra **os 11 Distritos Operacionais** (nível 1), sem passar pelo bloco verde único "Ceará inteiro" nem exigir clique.
- [ ] Não existe mais o rótulo "CEARÁ" nem o tooltip "Clique para dividir"; `stateShape` aparece só como **silhueta de fundo** não clicável.
- [ ] A animação de entrada (voo da câmera do afastado até enquadrar) termina nos 11 distritos, com um fade curto da camada de distritos; roda **uma vez**.
- [ ] `goState()` e o `data-nav="state"` da trilha levam ao **nível 1**; trocar Carteira↔Histórico volta ao **nível 1**.
- [ ] Breadcrumb: raiz "Distritos" (nível 1); níveis 2/3 = `Distritos › <Distrito> [› <Município>]`; sem o "Ceará" isolado.
- [ ] "Voltar" desabilitado no nível 1; funciona nos níveis 2/3.
- [ ] Rodapé: "Fluxo: Distritos Operacionais → cidades".
- [ ] Nenhuma tabela/coluna nova; nenhuma dependência nova; navegação para dentro inalterada.

### 4.2 Dados / Cálculos / Integridade

- [ ] **Nenhum número muda.** KPIs, choropleth, gráfico de anos, legenda de status, ranking, rodapé no nível 1 são os **mesmos** que o nível 1 exibia antes da Etapa D (comparar). O filtro (Etapa C) e os agregados (`aggIds`/`obrasOf`) intocados.
- [ ] `fullBounds` = `layer.getBounds()` como hoje; a câmera enquadra a mesma área.
- [ ] `escHtml` em todo texto de dado do banco que aparecer na trilha/painel do nível 1 (nomes de distrito).
- [ ] `loadData` / `mapRow` / `fetchTable` / listas de colunas — **não tocados**.

### 4.3 Interface / Experiência

- [ ] A entrada é **fluida**: a câmera chega e os 11 distritos aparecem com um leve assentar; sem "pulo", sem flash, sem um frame com o bloco verde único.
- [ ] Os 11 distritos são legíveis de imediato (rótulos, cores) nos **dois temas** e em **projeção**; cabe em 360px.
- [ ] A trilha "Distritos" (raiz sem link) comunica claramente que o nível 1 é a "casa".
- [ ] Contraste ≥ WCAG AA de qualquer texto novo/alterado (trilha, rodapé) nos dois temas.
- [ ] Modo apresentação: entra nos 11 distritos, sem passo morto.

### 4.4 Regressão / Comportamento

- [ ] **Níveis 2 e 3 idênticos** ao pré-Etapa D: descer/subir, popover de irmãos, Ctrl+clique (seleção combinada), modal, filtro (Etapa C), troca de tema.
- [ ] A animação de entrada roda **uma vez**; `invalidateSize()`/`ensureSize()` de segurança não a cortam; `refit()` reenquadra certo em resize/rotação/mudança de fonte, agora no nível 1.
- [ ] Trocar tema **na entrada** (nível 1) repinta tudo, sem cor presa.
- [ ] Trocar Carteira↔Histórico volta ao nível 1 e recarrega os dados sem erro; o ranking dos distritos reflete o novo escopo.
- [ ] Não há `st.level=0` acessível por nenhum caminho (trilha, atalho, `setDataScope`, `_searchNav`, `onClick`).
- [ ] Console limpo ao: carregar, aguardar a entrada, navegar 1→2→3→2→1, trocar tema/escopo, abrir o modal, aplicar filtro, entrar/sair de tela cheia e do modo apresentação.
- [ ] `assets/geo/*.json` inalterados; nada fora da camada de entrada/navegação/trilha alterado.

---

## 5. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Um frame com o bloco verde único antes dos distritos aparecerem | `st.level=1` desde a 1ª `render()`; `stateShape` não navegável; fade da `groupLayer` no `moveend` |
| `stateShape` como fundo tapar/vazar sobre os distritos | `interactive:false` + `bringToBack()`; `fillOpacity` de fundo baixo; validação visual nos dois temas |
| Algum caminho ainda levando a `st.level=0` (atalho, `setDataScope`, popover) | `goState` vira alias de `goSub`; varredura de todos os `st.level=0`/`goState()`; critério 4.4 |
| A entrada "quebrar" (câmera cortada) por `ensureSize()` durante o voo | Guarda `_firstFit`/`_entranceDone` mantida; critério 4.4 |
| Modo apresentação com um passo morto (nível 0) no ciclo | Ajustar o ciclo para começar/voltar ao nível 1; critério 4.3/4.4 |
| Breadcrumb com rótulo ambíguo ("Ceará" vs "Distritos") | Decisão fixada: raiz = "Distritos" (§2.1.5) |
| `fitFull()` reusado para "voltar ao topo" agora significando nível 1 | `goSub()` já chama `fitFull()`; `fitFull` não depende de `st.level` — só enquadra `fullBounds` |

---

## 6. Definição de pronto

Todos os itens da seção 4 marcados, os 4 revisores em `APROVADO`, **e** a validação prática/visual do usuário. Follow-ups não bloqueantes vão para lista anexa.

---

## 7. Decisões tomadas nesta proposta (o usuário veta o que não servir)

1. **Nível inicial = 1** (11 Distritos). Nível 0 eliminado como destino.
2. **`stateShape` deixa de ser exibido** (revisado 2026-08-30 — ver §2.1.2): não vira silhueta de fundo, porque os 11 distritos são os municípios dissolvidos e já cobrem todo o estado; um fundo verde só tingiria o mapa e quebraria a paridade. O objeto fica criado, inerte, para `repaintTheme`.
3. **Rótulo "CEARÁ" e tooltip "Clique para dividir" removidos** (`stateLbl`/`stateItem`/`stateC` + CSS `.state-label` apagados).
4. **Animação = voo de câmera de hoje + fade curto (~350 ms) da camada de distritos no INÍCIO do voo** (revisado — não no `moveend`, para não ficarem 2,8 s invisíveis). Sem stagger, sem morphing.
5. **Breadcrumb raiz = "Distritos"** (nível 1, `<span class="cur">`, sem link). Painel/rodapé usam o nome longo "Distritos Operacionais". Sem "Ceará" isolado.
6. **`goState()` vira alias de `goSub()`**; trocar de escopo volta ao nível 1.
7. **Sem "Voltar" a tratar** (revisado — não existe botão de voltar no mapa; subir é só pela trilha, que no nível 1 não tem link acima).
8. **Sem permalink/persistência de nível.**
