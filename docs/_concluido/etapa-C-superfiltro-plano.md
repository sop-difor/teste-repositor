# Etapa C — Super filtro + integração · Plano de Implementação

Módulo: **Mapa de Obras Fiscalizadas** (`gecope_mapa_obras.html`, `assets/js/mapa-obras.js`, `assets/css/mapa-obras.css`)
Spec de referência: [`docs/etapa-C-superfiltro-spec.md`](etapa-C-superfiltro-spec.md) — **aprovada pelo usuário em 2026-08-29**
Configuração dos revisores: [`docs/etapa-C-superfiltro-revisores.md`](etapa-C-superfiltro-revisores.md)

---

## Natureza deste documento

- **Nenhum código é alterado agora.** É a fase de planejamento.
- Descreve, em ordem, o que será feito em cada bloco, o que toca, o resultado esperado e como conferir — em linguagem que uma pessoa não desenvolvedora entenda.
- Depois que este plano e o documento de revisores estiverem prontos, **o usuário revisa e aprova**. Só então o código começa a mudar.

## Como o acompanhamento vai funcionar

- A implementação segue os **7 blocos abaixo, na ordem**.
- **Ao terminar cada bloco**, é apresentado ao usuário, em linguagem simples e visual quando possível (capturas antes/depois, nos dois temas), o que mudou. O usuário pode pedir ajuste antes do bloco seguinte.
- Ao terminar o **Bloco 7**, os **4 revisores** são acionados.
- **Encerramento da Etapa C — dois portões:** (1) os 4 revisores em `APROVADO`; (2) validação prática/visual do usuário. Só com os dois passamos para a Etapa D.

## Glossário rápido

| Termo | Significado |
|---|---|
| **`st.f`** | O objeto de estado do filtro (um `Set` por campo + a busca `q`). |
| **`FILTER_DEFS`** | A lista que define cada campo de filtro (rótulo, como extrair o valor de uma obra). |
| **`passF(o)`** | Função que diz se uma obra passa no filtro atual. Roda dezenas de milhares de vezes por frame de mapa. |
| **`obrasOf(id)`** | Obras de um município **já filtradas** (com cache por "época" de filtro). |
| **`aggIds(ids)`** | Soma/conta obras filtradas de uma lista de municípios. |
| **Choropleth** | O preenchimento gradiente do mapa por intensidade (nº de obras / valor). |
| **Nível 0/1/2/3** | Estado inteiro / Distritos / um distrito aberto / um município aberto. |
| **"Sem correspondência"** | Distrito/município que, com o filtro atual, não tem nenhum contrato. |

---

## Invariáveis de toda a Etapa C (valem em todos os blocos)

1. **Sem dependência nova.** Sem tabela/coluna nova do Supabase. Todo campo de filtro sai de dado já carregado (`o.*` / `o.raw.*` / `o.ficha`).
2. **Sem filtro ativo, tudo é idêntico ao de hoje** — mapa, KPIs, gráfico de anos, ranking, lista, rodapé, navegação, seleção combinada, breadcrumb, modal, tema, modo apresentação, Carteira/Histórico. O ramo "sem correspondência" (cinza) só existe sob `hasActiveFilter()`.
3. **Nenhum número muda** com o mesmo filtro. Aplicar só os 6 filtros de hoje produz KPIs/choropleth/gráfico/ranking/lista **iguais** aos de antes da Etapa C.
4. **`passF` continua barato.** Sem alocação por chamada; opções/faixas pré-computadas fora do laço; `prazoCalc` por obra calculado **uma vez** no `mapRow`/`loadData` e guardado em `o` (buckets), nunca por `passF`.
5. **`aggIds`/`obrasOf` são a única fonte de contagem/soma** em todos os caminhos derivados. Nenhuma leitura crua de `DB.municipios[id].obras` sob filtro.
6. **Sem cor hardcoded** em JS ou CSS. Cinza de "sem correspondência" e chips vêm de `var(--...)`/`TOKENS`.
7. **`escHtml`/`fmtVal` em todo rótulo** de opção e de chip vindo do banco. Zero `innerHTML` novo com dado cru.
8. **Tema claro e escuro** continuam funcionando, inclusive com filtro ativo (cinza e chips repintam).
9. **`invalidateAggCache()`** disparado por toda mudança de `st.f` (campo novo incluído) e por `loadData`.
10. **Nada fora do painel de filtros e da camada de render muda.** Métrica (`#segMetric`), escopo (Carteira/Histórico), zoom/navegação, breadcrumb, seleção combinada, modal da Etapa B — intocados.

---

## Bloco 1 — Motor de filtro orientado a dados (refactor invisível)

**O que será feito, em linguagem simples**
Reescrever "por dentro" como o filtro funciona, sem nada mudar na tela. Hoje `passF` tem uma linha `if` cravada por campo. Passa a ser um laço sobre `FILTER_DEFS`, onde cada campo pode ser de **dois tipos**: "de valores" (lista de opções tirada dos dados, como Contratada hoje) ou "de categoria fixa" (faixas e derivados, com opções próprias e uma regra de match). Os 6 campos atuais são reexpressos nesse formato e continuam funcionando exatamente igual.

**Arquivos**
- `assets/js/mapa-obras.js` — `FILTER_DEFS` (formato generalizado), `passF` (laço), `st.f` (chaves novas já declaradas como `Set` vazio), `clearFilters` (limpa tudo), `fillFilters` (monta opções dos dois tipos). Buckets por obra (`o.prazoExecBucket`, `o.vigenciaBucket`, `o.medicaoBucket`, `o.faixaValorBucket`, `o.paralisada`) calculados no `mapRow`/`loadData`.

**Invariáveis específicas**
- Comportamento na tela **idêntico**: mesmos 6 campos, mesmas opções, mesmos resultados.
- `passF` sem regressão de custo (medir pan/zoom).

**Resultado esperado**
Nada visível muda. O código do filtro fica pronto para receber campos novos sem tocar em `passF`.

**Ponto de verificação**
- `node --check` OK.
- Aplicar cada um dos 6 filtros atuais e combinações: KPIs, choropleth, gráfico de anos, ranking, lista — **iguais** ao estado pré-bloco (comparação lado a lado).
- Pan/zoom do mapa com filtro ativo sem lentidão perceptível.
- `clearFilters` zera tudo; console limpo.

---

## Bloco 2 — Os 8 campos novos de filtro

**O que será feito, em linguagem simples**
Acrescentar os 8 campos da spec §2.1.1 ao painel, cada um como um dropdown multi-seleção igual aos de hoje:
**Distrito Operacional · Município · Tipo de contrato · Ano** (já existe, só muda de lugar) **· Status da obra** (idem) **· Prazo de execução · Vigência do contrato · Obra paralisada · Faixa de valor · Medição (%) · Contratada · Contratante · Fiscal** — na ordem da §2.1.4 (navegação → atributos do contrato → pessoas/empresas), com a busca livre no topo.
- Distrito/Município/Tipo: opções tiradas dos dados carregados.
- Prazo/Vigência/Paralisada/Faixa de valor/Medição: opções fixas (as faixas e buckets da spec).
- Campo cujo domínio está vazio no escopo (ex.: nenhuma obra com ficha) aparece **desabilitado com dica**, não some.

**Arquivos**
- `assets/js/mapa-obras.js` — os 8 `FILTER_DEFS`; `fillFilters` (opções + ordem + estado desabilitado); revalidação de `st.f` contra o domínio ao trocar de escopo / recarregar.
- `assets/css/mapa-obras.css` — só se o painel precisar de rolagem interna para caber ~14 campos.

**Invariáveis específicas**
- Regra de faixa: **limite inferior inclusivo, superior exclusivo** (R$ 5.000.000,00 cai em "5–20 mi"; 25,0% cai em "25–50%").
- Buckets de prazo/vigência batem com `prazoCalc`: `overdue` → vencido; `remainingDays ≤ 30` e não overdue → a vencer; senão → no prazo/vigente; sem data → "Sem data".
- Nulos: sem `data_fim_previsto` → "Sem data"; sem `ficha` → "Sem ficha"; sem tipo de contrato → não vira opção.

**Resultado esperado**
O painel passa a ter 14 campos; cada campo novo recorta a carteira corretamente e combina com os demais.

**Ponto de verificação**
- Um valor de cada campo novo, isolado, e combinações (ex.: Distrito X + paralisada = Sim + faixa 5–20 mi): os contratos exibidos são exatamente os que satisfazem.
- Contratos na borda das faixas (valor e %): caem numa faixa só.
- Obra sem data de fim → aparece só no bucket "Sem data"; obra sem ficha → só em "Sem ficha".
- Trocar Carteira ↔ Histórico: as opções refletem o novo conjunto; nenhum filtro "fantasma" de valor que sumiu.
- Console limpo; `node --check` OK.

---

## Bloco 3 — Integração: filtro reflete em todo o painel e em todos os níveis

**O que será feito, em linguagem simples**
Garantir que **tudo** que mostra números derivados de obras reaja ao filtro no mesmo instante:
- Auditar `setKPIs`, `renderYearChart`, `statusBreakdown`, `rankRows`, `obrasCards`, `renderFoot` — trocar qualquer leitura de `DB.municipios[id].obras` crua por `obrasOf`/`aggIds`.
- **Contador de resultados sempre visível:** "N contrato(s) encontrado(s)" no topo do painel, em **todos** os níveis (hoje só no nível Estado/Distritos com filtro). Sem filtro, some ou vira "N contratos".
- **Lista de contratos filtrada nos níveis 2 e 3:** com filtro ativo, mostrar os contratos do distrito/município aberto que passam no filtro, sem trocar de nível.

**Arquivos**
- `assets/js/mapa-obras.js` — `renderPanel` (contador em todos os níveis, lista nos níveis 2/3), e os auxiliares auditados acima.

**Invariáveis específicas**
- Com os **mesmos 6 filtros de hoje**, todos os números e listas continuam **idênticos**.
- Nenhum caminho novo de agregação — só troca de fonte para `aggIds`/`obrasOf` onde ainda não era.

**Resultado esperado**
O painel inteiro é um espelho fiel do recorte filtrado, em qualquer nível do mapa.

**Ponto de verificação**
- Comparação antes × depois com os 6 filtros de hoje: KPIs, gráfico de anos, legenda de status, ranking, lista, rodapé — iguais.
- Filtro ativo no nível 2 e no nível 3: a lista mostra só o recorte daquele escopo; o nível do mapa não muda.
- Contador visível e correto nos 4 níveis.
- Console limpo.

---

## Bloco 4 — Bloco "Filtros ativos" (chips) + limpar tudo

**O que será feito, em linguagem simples**
Abaixo dos campos, uma faixa de **chips** — um por valor/faixa selecionada, com "×" para tirar só aquele valor — e um botão **"Limpar tudo"** que zera todos os campos e a busca. Enquanto não há filtro, o bloco não aparece. Um selo no botão de recolher o painel (`#ctrlToggle`) indica "filtros aplicados".

**Arquivos**
- `assets/js/mapa-obras.js` — montagem dos chips em `renderPanel`/`fillFilters`; handler do "×" (remove um valor, `render()`); "Limpar tudo" (consolida o "Limpar filtros" atual); selo no `#ctrlToggle`.
- `assets/css/mapa-obras.css` — estilo dos chips (`var(--...)`), do "Limpar tudo", do selo.

**Invariáveis específicas**
- O "×" de um chip remove **só aquele valor** (não o campo inteiro, se houver outros valores marcados nele).
- "Limpar tudo" = comportamento do `clearFilters` (todas as chaves + `q`).
- Chip com rótulo do banco passa por `escHtml`.

**Resultado esperado**
O usuário vê num relance o que está filtrando e remove item a item ou tudo de uma vez.

**Ponto de verificação**
- Marcar 2 valores no mesmo campo + 1 em outro: 3 chips; "×" no primeiro tira só ele; o campo continua com o segundo valor.
- "Limpar tudo": mapa volta ao estado sem filtro (sem cinza), contador some.
- Alvo de clique do "×" ≥ 24px; contraste AA nos dois temas; 360px.
- Selo aparece/some com o filtro; console limpo.

---

## Bloco 5 — Áreas sem correspondência acinzentadas no mapa

**O que será feito, em linguagem simples**
Com filtro ativo, distrito (nível 1) ou município (níveis 2/3) que não tem **nenhum** contrato passando no filtro fica **cinza inerte** no mapa: cor própria (não é a paleta do choropleth nem a cor de base), preenchimento fraco e fixo, borda esmaecida, rótulo esmaecido. Esse polígono **não** responde a hover destacado nem a clique (não há o que abrir). Sem filtro ativo, o mapa é **exatamente** o de hoje.

**Arquivos**
- `assets/css/mapa-obras.css` — tokens `--nomatch-fill` / `--nomatch-border` / `--nomatch-label` nos dois temas.
- `assets/js/mapa-obras.js` — ramo "sem correspondência" em `styleFeature` e `groupStyle` (só sob `hasActiveFilter()` e agregado zero); `applyInteractivity()` desliga hover/click nesses polígonos; rótulo esmaecido em `updateLabels`.

**Invariáveis específicas**
- Sem `hasActiveFilter()`: zero mudança no mapa.
- Choropleth normal (filtro ativo, `obras > 0`) segue como hoje — intensidade proporcional ao máximo do nível.
- O cinza de "sem correspondência" é **distinguível** do choropleth mais fraco nos dois temas.

**Resultado esperado**
O mapa filtrado comunica de relance onde há carteira e onde não há, sem "sumir" com o desenho do estado.

**Ponto de verificação**
- Filtro que zera alguns distritos: eles ficam cinza; os com carteira seguem no gradiente; clicar num cinza não faz nada; clicar num com carteira abre normal.
- Mesmo teste no nível 2 (municípios de um distrito) e nível 3.
- Remover o filtro: o cinza some, tudo volta ao normal.
- Trocar o tema com filtro ativo: cinza repinta nos dois sentidos.
- Console limpo.

---

## Bloco 6 — Coesão visual, acessibilidade e responsivo

**O que será feito, em linguagem simples**
Passada de acabamento: o painel com ~14 campos continua utilizável (rola por dentro se preciso, sem empurrar o mapa); contraste AA de tudo que é novo (opções, chips, contador, cinza do mapa) nos dois temas; cabe em 360px e em projeção; estados vazios claros ("Nenhum contrato encontrado com estes filtros").

**Arquivos**
- `assets/css/mapa-obras.css` — ajuste fino (rolagem interna do painel, espaçamento, estados hover/focus).
- `assets/js/mapa-obras.js` — nada, ou mínimo (ex.: mensagem de estado vazio).

**Invariáveis específicas**
- Nenhuma mudança de conteúdo/número/comportamento — só apresentação.
- Sem cor hardcoded.

**Ponto de verificação**
- Painel com todos os campos em 360px e em modo apresentação: rola por dentro, não corta o mapa.
- Contraste ≥ WCAG AA (normal 4,5:1; grande 3:1) de todo texto/elemento novo, nos dois temas, medido nos pares principais; borda/preenchimento do cinza distinguível do choropleth fraco.
- Recorte global vazio → "Nenhum contrato encontrado com estes filtros" limpo, não erro.
- Campo sem opções → desabilitado com dica.

---

## Bloco 7 — Fechamento e conferência final

**O que será feito, em linguagem simples**
Varredura dos critérios de aceite da spec (seção 4), verificações técnicas, e preparo do resumo (arquivos + explicação simples + antes/depois visual) para os 4 revisores.

**Verificações**
- `node --check` sem erro; parse do HTML OK; sem `id` duplicado.
- `escHtml`/`fmtVal` em **todo** rótulo de opção/chip do banco; nenhum `innerHTML` novo com dado cru.
- **Comparação antes × depois** com os 6 filtros de hoje: KPIs, choropleth, gráfico de anos, ranking, lista, rodapé — idênticos (registrada).
- Nenhuma tabela/coluna nova; nenhuma chamada de rede nova; `git diff` das listas de colunas do Supabase = vazio.
- `passF` conferido: sem alocação por chamada; buckets pré-computados; `invalidateAggCache` em toda mudança de `st.f`.
- Console limpo ao: aplicar/limpar cada filtro, combinar, navegar entre níveis com filtro ativo, trocar tema/escopo com filtro ativo.
- `assets/geo/*.json` inalterados; nada fora do painel de filtros / camada de render alterado (`git diff` revisado).

**Ponto de verificação**
- Checklist da seção 4 da spec percorrido (4.1 a 4.4).
- Os **4 revisores** são acionados (ver [`docs/etapa-C-superfiltro-revisores.md`](etapa-C-superfiltro-revisores.md)).
- **Entrega ao usuário:** resumo consolidado para a **validação prática/visual** — o segundo portão.

---

## Resumo da ordem e das dependências

| # | Bloco | Depende de | Entrega |
|---|---|---|---|
| 1 | Motor de filtro orientado a dados (refactor invisível) | — | `FILTER_DEFS` generalizado; `passF` em laço; buckets por obra; nada visível muda |
| 2 | Os 8 campos novos de filtro | 1 | 14 campos no painel; cada um recorta certo; opções revalidadas por escopo |
| 3 | Integração: filtro reflete em todo o painel e níveis | 1, 2 | Contador em todos os níveis; lista filtrada nos níveis 2/3; `aggIds`/`obrasOf` como única fonte |
| 4 | Bloco "Filtros ativos" (chips) + limpar tudo | 2, 3 | Chips com "×" por valor; "Limpar tudo"; selo no `#ctrlToggle` |
| 5 | Áreas sem correspondência acinzentadas | 2, 3 | Distrito/município sem match em cinza inerte, não clicável; idêntico sem filtro |
| 6 | Coesão visual + acessibilidade + responsivo | 2–5 | ✅ **concluído (2026-08-30)** — `fitCtrlHeight()` cabe o painel na tela a 360px; estado vazio "Nenhum contrato encontrado com estes filtros."; `#clearF` do rodapé oculto (o "Limpar tudo" dos chips assume); `.msel.is-empty` a .55 |
| 7 | Fechamento e conferência | 1–6 | ✅ **concluído (2026-08-30)** — `node --check` OK; 42 ids sem duplicado; listas de colunas do Supabase e `assets/geo/*.json` intocadas por C; nenhum `fetchTable`/`app_users` novo. **4 revisores: APROVADO** (Revisor 1 após 1 correção — achado B1, cor hardcoded removida). **Portão 1 atingido. Portão 2 (validação visual do usuário): pendente.** |

**Blocos 1–7 concluídos em 2026-08-29/30.** Bloco 1 (motor de filtro orientado a dados) · 2 (8 campos novos) · 3 (integração + contador em todos os níveis) · 4 (chips "Filtros ativos" + "Limpar tudo" + selo) · 5 (áreas sem correspondência acinzentadas) · 6 (coesão + AA + 360px) · 7 (revisão: 4 APROVADO, ver [`etapa-C-superfiltro-revisores.md`](etapa-C-superfiltro-revisores.md)).

---

## Fora do escopo da Etapa C (não bloqueia esta etapa)

- Tabela/coluna nova do Supabase; qualquer `fetchTable` novo.
- Filtros salvos/nomeados; filtro em URL/permalink; persistência entre sessões.
- Busca de texto dentro de um campo multi-seleção (ex.: filtrar a lista de contratadas).
- Exportar/imprimir o recorte filtrado.
- Mudança de métrica, escopo, navegação, breadcrumb, seleção combinada, modal.
- A tela de entrada / "Ceará inteiro" → **Etapa D**.
