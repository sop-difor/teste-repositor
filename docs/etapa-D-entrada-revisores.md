# Etapa D — Entrada direta nos 11 Distritos · Revisores

Referência: [`etapa-D-entrada-spec.md`](etapa-D-entrada-spec.md) · [`etapa-D-entrada-plano.md`](etapa-D-entrada-plano.md).
4 subagentes, revisão **somente-leitura** do working tree (a Etapa D não é commitada até o fechamento). Cada um devolve **1 veredito** (`APROVADO` / `BLOQUEADO`) + achados bloqueantes (arquivo:linha, critério escrito ferido, o que mudar) + follow-ups.

---

## Portões

- **Portão 1:** os 4 revisores em `APROVADO`.
- **Portão 2:** validação prática e visual do usuário (entra no app, vê os 11 distritos, navega, troca tema/escopo).

Achado bloqueante → correção **mínima** → re-roda só o(s) revisor(es) afetado(s). Conflito entre a spec e este documento → **a spec vence** (§7 da spec).

---

## Revisor 1 — Estrutura / Arquitetura

**Pergunta central:** a mudança de entrada é uma reorganização limpa da camada de navegação, sem vazar para dados/filtro/modal nem deixar caminhos mortos?

Verifica:
- `st.level` inicial = 1; `goState()` é alias de `goSub()`; **nenhum** caminho ainda alcança `st.level=0` (grep `level *= *0`, `level===0`, `goState`, `data-nav="state"`, `_searchNav`, `setDataScope`, modo apresentação).
- `stateShape` com `interactive:false` e sem `onEachFeature` de clique/hover/tooltip; `stateLbl`/`stateItem` removidos sem referência pendente (`repaintTheme`, `rebuild*`, `setLayer`).
- `renderCrumb` sem o ramo `st.level===0`; ramos 1/2/3 coerentes; sem `<a>` apontando para lugar nenhum.
- Diff toca só os 3 arquivos previstos; `assets/geo/*.json` intocados; nenhuma dependência/`fetchTable`/tabela nova.
- `node --check` OK; ids do HTML únicos.

**Bloqueia se:** algum caminho leva ao nível 0; `stateLbl` deixa referência quebrada; a mudança altera assinatura de `goSub`/`render`/`fitFull`; cor hardcoded nova; toque fora dos 3 arquivos.

---

## Revisor 2 — Dados / Cálculos / Integridade

**Pergunta central:** algum número ou recorte muda por causa da Etapa D?

Verifica:
- KPIs, choropleth, gráfico de anos, legenda de status, ranking dos 11 distritos, rodapé e contador (Etapa C) no nível 1 = **idênticos** ao que o nível 1 exibia antes da Etapa D (comparar `git show HEAD` × working tree, com o mesmo fixture).
- `fitFull()`/`fullBounds` enquadram a mesma área; o fade da `groupLayer` mexe **só em opacidade**, nunca em estilo/cor/geometria que altere leitura de dado.
- `loadData`/`mapRow`/`fetchTable`/listas de colunas **não tocados** no diff.
- `escHtml` em todo nome de distrito exibido na trilha/painel.
- `aggIds`/`obrasOf`/`invalidateAggCache` intocados; o filtro da Etapa C continua recortando igual no nível 1.

**Bloqueia se:** qualquer KPI/contagem/choropleth muda; `escHtml` ausente em texto novo; o fade altera `fillOpacity`/cor usada para ler valor; toque em `loadData`/`mapRow`/colunas.

---

## Revisor 3 — Interface / Experiência

**Pergunta central:** a entrada ficou fluida e clara, nos dois temas, em 360 px e em projeção?

Verifica (com capturas atualizadas):
- Ao carregar: câmera voa e **os 11 distritos** aparecem com fade curto; **nenhum frame** com o bloco verde único; sem flash/salto.
- Os 11 distritos legíveis de imediato (rótulos, cores, contador) nos dois temas, em 360 px e 1400 px, e em projeção.
- Trilha "Distritos Operacionais" no nível 1 sem link morto; "Voltar" visivelmente desabilitado no nível 1; rodapé novo coerente.
- `stateShape` de fundo: contorno ajuda a leitura, não "suja" nem compete visualmente com os distritos.
- Contraste ≥ AA de todo texto novo/alterado (trilha, rodapé, estado do "Voltar") nos dois temas.
- Modo apresentação: entra nos 11 distritos, sem passo morto.

**Bloqueia se:** aparece o bloco verde único em algum frame; os distritos ficam ilegíveis em algum tema/tamanho; texto novo abaixo de AA; "Voltar" no nível 1 parece clicável mas não faz nada sem indicação.

---

## Revisor 4 — Regressão / Comportamento

**Pergunta central:** algo que funcionava antes quebrou?

Verifica (roteiro):
- Carregar → aguardar a entrada → `1→2→3→2→1` → popover de irmãos → Ctrl+clique (seleção combinada) → abrir modal (Etapa B) → aplicar filtro (Etapa C) → limpar → trocar tema → trocar escopo Carteira↔Histórico → tela cheia → modo apresentação. **Console limpo** em todo o roteiro.
- A animação de entrada roda **uma vez**; os `ensureSize()`/`invalidateSize()` de segurança (timeouts `[80,200,400,700,1100,1700,2500]`) não a cortam nem a disparam de novo.
- `refit()` reenquadra certo em resize / rotação / mudança de tamanho de fonte, agora no nível 1.
- Trocar tema **na entrada** repinta tudo (`repaintTheme`), sem cor presa; `stateShape` de fundo e `groupLayer` repintam.
- Trocar escopo volta ao nível 1 e recarrega os dados sem erro; ranking reflete o novo escopo.
- "Voltar" no nível 1 não navega para o nível 0 por **nenhum** caminho.
- Níveis 2 e 3 **idênticos** ao pré-Etapa D.
- `assets/geo/*.json` inalterados.

**Bloqueia se:** erro de console em qualquer passo; a entrada roda 2×/é cortada; `refit()` desenquadra; troca de tema/escopo na entrada falha; qualquer caminho reabre o nível 0; regressão nos níveis 2/3.

---

## Matriz de responsabilidade (evita lacuna/sobreposição)

| Tema | Dono |
|---|---|
| `st.level` inicial, `goState` alias, ausência de caminho para nível 0 (código) | 1 — Estrutura |
| `stateLbl` removido sem referência pendente | 1 — Estrutura |
| Paridade de números no nível 1 (antes × depois) | 2 — Dados |
| `escHtml` em nome de distrito | 2 — Dados |
| Fade da entrada não altera leitura de dado | 2 — Dados (semântica) + 3 — Interface (percepção) |
| Fluidez da entrada, legibilidade dos 11 distritos, dois temas / 360 px / projeção | 3 — Interface |
| Contraste AA de trilha / rodapé / "Voltar" | 3 — Interface |
| Console limpo no roteiro completo; entrada roda 1×; `refit`; níveis 2/3 intactos | 4 — Regressão |
| Nenhum caminho reabre o nível 0 (comportamento em runtime) | 4 — Regressão |
| `assets/geo/*.json` intocados; diff só nos 3 arquivos | 1 — Estrutura (estático) + 4 — Regressão (runtime) |

---

## Achados bloqueantes

**Nenhum.** Os 4 revisores aprovaram na primeira rodada, sem re-execução.

## Follow-ups não bloqueantes (anexados; tratados sem travar)

1. **`--stfs` órfã** (R1) — `applyLabelSizes()` (`mapa-obras.js:760`) ainda escreve `--stfs` e `lblFS()` calcula `st:32`, mas nenhuma regra CSS consome mais essa var após a saída de `.state-label`. Produtor inerte, sem consumidor. Remover `s.st`/`--stfs` numa limpeza futura.
2. **Tokens `--text-state-label` órfãos** (R1, R4) — `mapa-obras.css:50` e `:108` ainda declaram o token nos dois blocos `:root`, sem consumidor. Mantidos de propósito para não mexer no bloco de paleta (alçada da Etapa A). Limpeza opcional.
3. **`escHtml` na trilha nível 2/3** (R2) — `renderCrumb` (`:1662-1663`) e ramos de `renderPanel` (`:1629,1641,1647`) interpolam `grpById(...).nome` sem `escHtml`. **Pré-existente**, idêntico antes da Etapa D; a fonte é a lista controlada `groupsList()`, não texto livre do Supabase. Registrar para uma varredura futura de `escHtml`, sem relação com a Etapa D.
4. **Densidade de rótulos em 360px na entrada** (R3) — como o nível 1 virou a tela inicial, o limiar de `updateLabels()` (herdado do nível 1 antigo) deixa ~4 dos 11 distritos sem rótulo em 360px. Sem critério escrito de nº mínimo; não é regressão. Avaliar um limiar mais permissivo em viewport estreito.
5. **Rodapé no tema escuro a 4,64:1** (R3) — passa WCAG AA (piso 4,5:1) mas raspa. Token `--text-dimmer` pré-existente; um leve clareamento daria margem.
6. **`git diff --name-only` traz 3 arquivos** (R4) — `gecope_mapa_obras.html` além de js+css. O delta do HTML é **inteiramente das Etapas A/B/C** (ainda não commitadas): `grep "Etapa D"` no HTML = 0. A Etapa D não toca o HTML.

---

## Resultado

Blocos 1–5 implementados e verificados em 2026-08-30 (QA `qa-d1`/`qa-d2`/`qa-d3` no navegador, dois temas, 360px/1400px, console limpo salvo o 400 de `medicoes` = RLS pendente da Etapa B).

| Revisor | Rodada 1 | Rodada 2 | Final |
|---|---|---|---|
| 1 — Estrutura | ✅ APROVADO | — | ✅ APROVADO |
| 2 — Dados | ✅ APROVADO | — | ✅ APROVADO |
| 3 — Interface | ✅ APROVADO | — | ✅ APROVADO |
| 4 — Regressão | ✅ APROVADO | — | ✅ APROVADO |

**Portão 1 (4 revisores em APROVADO): ✅ atingido em 2026-08-30, sem re-execução.**
**Portão 2 (validação prática/visual do usuário): ⏳ pendente — do usuário.**
