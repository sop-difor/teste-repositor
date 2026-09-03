# Etapa D — Entrada direta nos 11 Distritos · Plano de Implementação

Referência: [`etapa-D-entrada-spec.md`](etapa-D-entrada-spec.md). Status: **proposta — aguardando aprovação.**
Mesma disciplina das etapas B/C: blocos pequenos, verificação por bloco, 4 revisores + 2 portões ao fim.

---

## Invariáveis (valem em todos os blocos)

1. **Sem filtro/dado/cálculo alterado.** KPIs, choropleth, gráficos, legenda, ranking, rodapé no nível 1 = idênticos ao que o nível 1 exibia antes da Etapa D.
2. **Níveis 2 e 3 intocados** — navegação para dentro, popover de irmãos, Ctrl+clique, modal (Etapa B), filtro (Etapa C), troca de tema.
3. **Nenhum caminho leva a `st.level=0`** depois desta etapa (trilha, botão "Voltar", `setDataScope`, `_searchNav`, modo apresentação, atalhos).
4. **A animação de entrada roda uma vez** — guardas `_firstFit`/`_entranceDone` mantidas; os `ensureSize()`/`invalidateSize()` de segurança não a cortam.
5. **`fullBounds`** continua sendo o enquadramento de referência (mesma área do estado).
6. **Sem cor hardcoded** em JS ou CSS; transição/estados via `var(--...)`/opacidade.
7. **Sem dependência nova, sem tabela/coluna/`fetchTable` novos, `assets/geo/*.json` intocados.**
8. **`escHtml`** em todo texto de dado do banco na trilha/painel.
9. **Modo apresentação, tela cheia, `repaintTheme`, `refit()`** continuam corretos com nível inicial 1.
10. Verificação por bloco: `node --check` + contagem de chaves CSS + captura no navegador (patchright) nos dois temas e em 360 px.

---

> **Blocos 1–5 concluídos e verificados em 2026-08-30** (QA no navegador `qa-d1`/`qa-d2`, dois temas, console limpo). Ajustes de rota registrados: (2.x) `stateShape` **não é exibido** em vez de virar silhueta de fundo — ver spec §2.1.2; (3.2) **não há botão "Voltar" no mapa** — subir é só pela trilha; (4.1) o fade dos distritos dispara no **início** do voo, não no `moveend`. Falta o Bloco 6 (revisores + portões).

## Bloco 1 — Nível inicial = 1 e fim do nível 0 como destino

**Objetivo:** o app passa a nascer no nível 1; nada mais navega para o nível 0.

- 1.1 `const st={… level:0 …}` → `level:1`.
- 1.2 `goState()` → `function goState(){ goSub(); }` (alias). Conferir que `goSub()` faz `render()` + `fitFull()` e seta `st.level=1`.
- 1.3 Reset de `_searchNav`: a linha que faz `st.level=0` → `st.level=1`.
- 1.4 `setDataScope` (troca Carteira↔Histórico): a chamada `goState()` continua no lugar, agora resolvendo para nível 1 — só confirmar, sem novo código.
- 1.5 Varredura: `grep -n "level *= *0\|level===0\|level==0\|goState"` — cada ocorrência classificada (some, vira alias, ou é leitura legítima de comparação). Anexar a lista ao relatório do bloco.

**Verificação:** carrega direto nos 11 distritos; trocar escopo volta aos 11 distritos; busca que cai fora e reseta volta ao nível 1; `node --check` OK; console limpo.

---

## Bloco 2 — `stateShape` vira silhueta de fundo; "CEARÁ" sai

**Objetivo:** o polígono do estado deixa de ser clicável e o rótulo some; fica só o contorno de fundo.

- 2.1 `stateShape` (init): `L.geoJSON(ESTADO, { style:{…}, interactive:false })` — remover `onEachFeature` com os `l.on('click'/'mouseover'/'mouseout')` e o tooltip "Clique para dividir".
- 2.2 Visibilidade: `setLayer(stateShape, st.level<=2)` (fundo nos níveis 1 e 2); garantir `stateShape` **atrás** da `groupLayer` (`bringToBack()` após `addTo`, ou ordem de inserção).
- 2.3 Estilo de fundo: `fillOpacity` baixo (reusar `--map-state-fill` já existente; sem cor nova). Conferir nos dois temas que o contorno aparece sem "vazar" sobre os distritos.
- 2.4 `stateLbl` / `stateItem` (o marker de rótulo "CEARÁ"): remover a criação e as chamadas `setLayer(stateLbl, …)`. Se `stateLbl` for referenciado em `repaintTheme`/`rebuild*`, limpar essas referências.
- 2.5 `tipHtml`: remover o ramo `st.level===0` (tooltip do bloco único).

**Verificação:** nenhum tooltip "Clique para dividir"; sem rótulo "CEARÁ"; contorno do estado visível como fundo nos dois temas; clicar na área "fora" dos distritos não faz nada; `node --check` OK.

---

## Bloco 3 — Trilha, "Voltar", painel e rodapé

**Objetivo:** a navegação até o topo reflete que o nível 1 é a "casa".

- 3.1 `renderCrumb`: remover o ramo `st.level===0`. Nível 1 → `<span class="cur">Distritos Operacionais</span>`. Níveis 2/3 → `<a data-nav="sub">Distritos</a> › …` (sem o "Ceará" isolado antes). `data-nav="state"` que sobrar aponta para nível 1 (via `goState`→`goSub`).
- 3.2 Botão "Voltar": quando `st.level===1`, `disabled`/`aria-disabled` (ou `hidden`). Nos níveis 2/3, inalterado.
- 3.3 `renderPanel`: remover o texto/ramo do nível 0 ("Visão geral do estado — clique…"). O ramo `st.level<=1` já cobre o ranking dos 11 distritos e o texto "Estado dividido por Distritos…".
- 3.4 `renderFoot`: "Fluxo: Ceará → Distritos Operacionais → cidades" → **"Fluxo: Distritos Operacionais → cidades"**.
- 3.5 `escHtml` nos nomes de distrito exibidos na trilha (conferir; provavelmente já aplicado).

**Verificação:** trilha no nível 1 = "Distritos Operacionais" sem link morto; nos níveis 2/3 volta ao nível 1 num clique; "Voltar" desabilitado no nível 1 e funcional nos 2/3; rodapé novo; contraste AA nos dois temas; `node --check` OK.

---

## Bloco 4 — Animação de entrada (fade da camada de distritos)

**Objetivo:** a entrada "assenta" os 11 distritos em vez de exibi-los crus.

- 4.1 Em `fitFull()` (primeiro voo), no `map.once('moveend', …)`: disparar um fade da `groupLayer` — adicionar/remover uma classe no container SVG do `groupLayer` (`groupLayer.getPane()` / `._path`) com `transition: opacity .35s`, ou animar `setStyle({opacity, fillOpacity})` de 0 → valor final.
- 4.2 A classe/estilo inicial (opacidade 0) é posta **antes** do voo começar; removida no `moveend`; sem efeito nas entradas subsequentes (só quando `!_entranceDone`).
- 4.3 CSS: a regra de transição da `groupLayer` na entrada — sem cor, só `opacity`.
- 4.4 Conferir que `groupStyle` (Etapa C, `NOMATCH_STYLE`) não conflita: o fade mexe só na opacidade do grupo inteiro no `moveend`; depois disso `groupStyle` manda.

**Verificação:** ao carregar, a câmera voa e os distritos surgem com fade curto; roda **uma vez** (recarregar → sim; navegar 2→1 → sem novo fade, ou fade aceitável e consistente — decidir e documentar); sem flash do bloco verde único em nenhum frame; `node --check` OK.

---

## Bloco 5 — Modo apresentação / tela cheia / coesão final

**Objetivo:** fechar as pontas e revisar o conjunto.

- 5.1 Modo apresentação: se há ciclo automático de níveis, ajustar para começar/retornar ao nível 1; nunca encostar no nível 0.
- 5.2 Tela cheia: entra no nível 1; `ensureSize()`/`refit()` reenquadram certo.
- 5.3 `refit()` = `level>=3? fitCity : level===2? fitGroup : fitFull` — confirmar que o ramo `fitFull` cobre o nível 1 corretamente (já cobre; `fitFull` não lê `st.level`).
- 5.4 Passada de coesão: dois temas, projeção, 360 px / 1400 px; console limpo em: carregar → aguardar entrada → 1→2→3→2→1 → trocar tema → trocar escopo → abrir modal → aplicar filtro (Etapa C) → tela cheia → modo apresentação.
- 5.5 `git diff --stat` — só os 3 arquivos previstos; `assets/geo/*.json` fora do diff.

**Verificação:** roteiro 5.4 sem erro de console e sem regressão visual; `node --check` OK; contagem de chaves CSS bate.

---

## Bloco 6 — Revisores e portões  ✅ (2026-08-30)

- 6.1 ✅ 4 subagentes revisores rodados.
- 6.2 — nenhum achado bloqueante; nenhuma re-execução.
- 6.3 **Portão 1: ✅ atingido** (4 × `APROVADO`). **Portão 2:** ⏳ validação prática/visual do usuário — pendente.
- 6.4 ✅ tabela de resultados + 6 follow-ups não bloqueantes anexados em `etapa-D-entrada-revisores.md`.
- 6.5 Encerramento no `MEMORY.md` após o Portão 2.

---

## Mapa de toques por arquivo (estimado)

| Arquivo | Blocos | Natureza |
|---|---|---|
| `assets/js/mapa-obras.js` | 1–5 | `st.level` inicial; `goState` alias; `_searchNav`; `stateShape` não interativo + fundo; remove `stateLbl`; `renderCrumb`; "Voltar"; `renderPanel`; `renderFoot`; `tipHtml`; fade em `fitFull` |
| `assets/css/mapa-obras.css` | 2, 3, 4 | fundo do `stateShape` (token existente); "Voltar" desabilitado; transição de opacidade da `groupLayer` |
| `gecope_mapa_obras.html` | — | nada previsto (confirmar no Bloco 5) |

---

## Rollback

Cada bloco é um conjunto pequeno de linhas marcadas `// Etapa D`. Reverter = tirar as marcas e restaurar `level:0`, o `onEachFeature` de `stateShape`, `stateLbl` e os textos de trilha/rodapé. Sem migração de dado, sem estado persistido — rollback é puramente de código.
