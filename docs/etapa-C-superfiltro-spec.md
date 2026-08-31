# Etapa C — Super filtro + integração mapa/painel/lista · Especificação e Critérios de Aceite

Módulo: **Mapa de Obras Fiscalizadas** (`gecope_mapa_obras.html`, `assets/js/mapa-obras.js`, `assets/css/mapa-obras.css`)
Status: **implementada — Portão 1 (4 revisores APROVADO) atingido em 2026-08-30. Aguardando Portão 2: validação prática/visual do usuário.** Aprovada pelo usuário em 2026-08-29.
Este documento é a rubrica contra a qual os 4 subagentes revisores julgam a entrega da Etapa C.
Etapa anterior: [`etapa-B-modal-spec.md`](etapa-B-modal-spec.md) — **encerrada em 2026-08-29**. Próxima: [`etapa-D-entrada-spec.md`](etapa-D-entrada-spec.md).
Resultado da revisão + lista de follow-ups não bloqueantes: [`etapa-C-superfiltro-revisores.md`](etapa-C-superfiltro-revisores.md) (seção "Registro de resultados").

---

## 0. Contexto — onde a Etapa C se encaixa

As melhorias do `gecope_mapa_obras` foram divididas em 4 etapas, uma por vez:

| Etapa | Escopo | Status |
|---|---|---|
| A. Tema | Tema claro/escuro; alternância imediata; limpeza de "Região". | ✅ encerrada 2026-08-28 |
| B. Modal | Janela "Dados do Contrato" em 5 abas. | ✅ encerrada 2026-08-29 |
| **C. Super filtro + integração** *(este documento)* | Novos campos de filtro; mapa/painel/lista reagindo ao filtro como um sistema só; áreas sem correspondência acinzentadas no mapa. | ← agora |
| D. Entrada | Eliminar a visão "Ceará inteiro"; entrar já nos 11 distritos com animação. | pendente |

### Processo de revisão (igual para todas as etapas)

- Antes da etapa: spec + critérios de aceite por escrito, **aprovados pelo usuário**. Sem código antes disso.
- Ao fim da etapa: 4 subagentes revisores independentes — mesmas 4 lentes da Etapa B (**Estrutura/Arquitetura · Dados/Cálculos/Integridade · Interface/Experiência · Regressão/Comportamento**). Cada um devolve `APROVADO` ou `BLOQUEADO + lista`.
- **Encerramento por 2 portões:** (1) os 4 revisores em `APROVADO`; (2) validação prática/visual do usuário. Só com os dois a Etapa D começa.
- Achado não bloqueante → lista de follow-up. Conflito revisor × spec → a spec vence. Revisor × revisor → o usuário arbitra.
- A cada bloco importante concluído: apresentação ao usuário em linguagem simples e visual + validação antes do bloco seguinte.

### Restrições globais (herdadas de A e B)

- **Sem novas dependências / bibliotecas.** Hoje: Leaflet (CDN) + Google Fonts. Nada além.
- **Nenhuma tabela nem coluna nova do Supabase.** Todos os campos de filtro saem de dados **já carregados** hoje (`o.*` / `o.raw.*` / `o.ficha`). Sem `app_users`, sem `fetchTable` novo.
- Página continua **estática e pública** (sem login). Todo texto de dado do banco na tela passa por `escHtml`/`fmtVal` — nenhum ponto novo de `innerHTML` sem escape.
- **Modo apresentação** continua funcionando.
- **Tema claro e escuro:** qualquer cor nova (inclusive o cinza de "sem correspondência") vem de `var(--...)` no CSS ou de `TOKENS`. **Nenhuma cor hardcoded em JS ou CSS.**
- **Não mudar:** dados, cálculos, o botão de métrica (`#segMetric`, Obra/Valor/Aditivo), o botão de escopo (Carteira ativa / Histórico completo), a navegação/zoom do mapa (3 níveis), o breadcrumb, a seleção combinada (Ctrl+clique), o modal da Etapa B, a tela de entrada (isso é a Etapa D).

---

## 1. Objetivo da Etapa C

Hoje o filtro do painel lateral tem 6 campos (busca livre + Ano, Contratada, Contratante, Fiscal, Status da obra) e **já** reflete no mapa (choropleth), nos KPIs, no gráfico de anos e na lista. A Etapa C:

1. **Amplia o filtro** para os atributos que o gestor de fato usa para recortar a carteira — distrito, município, tipo de contrato, faixa de valor, situação de prazo/vigência, obra paralisada, faixa de medição — todos derivados de dado já carregado.
2. **Fecha o "sistema"**: garante que **todo** elemento derivado (mapa, KPIs, gráfico de anos, legenda de status, ranking, lista, rodapé) reflita o filtro no mesmo instante e de forma consistente, com um **contador de resultados** sempre visível e um bloco de **filtros ativos** (chips com "×" + "limpar tudo").
3. **Acinzenta o que não tem correspondência**: com filtro ativo, distrito/município sem nenhum contrato que passe no filtro recebe um preenchimento **cinza inerte** no mapa (visível, mas claramente "vazio" e não navegável), distinguindo "0 correspondências" de "poucas correspondências".

Nada de dado, cálculo, métrica ou navegação muda. É reorganização e ampliação da camada de **filtro/apresentação**.

---

## 2. Escopo

### 2.1 Dentro do escopo

**2.1.1 — Novos campos de filtro.** Acrescentados a `FILTER_DEFS` (ou à estrutura que a substituir), todos **multi-seleção**, todos combinando entre si por **E** (um contrato precisa passar em todos os grupos ativos) e por **OU** dentro de cada grupo — exatamente o comportamento atual de `passF`:

| Campo | Origem (dado já carregado) | Tipo |
|---|---|---|
| **Distrito Operacional** | `gidOf(id)` → `grpById(gid).nome` (o distrito da obra) | valores (11 distritos) |
| **Município** | `o.municipioTxt` | valores |
| **Tipo de contrato** | `o.raw.descricao_tipo_contrato` (fallback `o.tipo`) | valores |
| **Faixa de valor** | `o.valor` | faixas fixas: até R$ 1 mi · R$ 1–5 mi · R$ 5–20 mi · acima de R$ 20 mi |
| **Prazo de execução** | `prazoCalc(o.raw.data_inicio_real, o.raw.data_fim_previsto)` | derivado: No prazo · A vencer (≤ 30 dias) · Vencido · Sem data |
| **Vigência do contrato** | `prazoCalc(o.raw.data_inicio_real, o.raw.data_fim_vigencia_contrato)` | derivado: Vigente · A vencer (≤ 30 dias) · Vencida · Sem data |
| **Obra paralisada** | `o.raw.dias_paralisado > 0` | Sim · Não |
| **Medição (% executado)** | `o.ficha?.percentual_total_medido` | faixas: 0–25% · 25–50% · 50–75% · 75–100% · acima de 100% · Sem ficha |

Os campos atuais (Ano, Contratada, Contratante, Fiscal, Status da obra, busca livre) **permanecem inalterados** no comportamento.

**2.1.2 — Filtro como sistema (integração).**
- **Auditoria + garantia:** todo caminho que agrega/lista obras — choropleth dos 3 níveis (`styleFeature`, `groupStyle`), KPIs (`setKPIs`/`aggIds`), gráfico de anos (`renderYearChart`), legenda/breakdown de status (`statusBreakdown`), ranking do painel (`rankRows`), lista de contratos (`obrasCards`), rodapé (`renderFoot`) — passa a usar **exclusivamente** `obrasOf(id)` / `aggIds(ids)` (que já aplicam `passF`). Nenhum desses caminhos pode ler `DB.municipios[id].obras` cru quando existe filtro ativo.
- **Contador de resultados sempre visível:** "N contrato(s) encontrado(s)" no topo do painel, em **todos** os níveis (hoje só aparece no nível Estado/Distritos com filtro ativo). Some ou vira "N contratos" quando não há filtro.
- **Bloco "Filtros ativos":** abaixo dos campos, uma faixa de **chips** — um por valor/faixa selecionada, com "×" para remover aquele valor — e um botão **"Limpar tudo"** (já existe um "Limpar filtros"; consolidar). Enquanto não há filtro, o bloco não aparece.
- **Lista de contratos com filtro ativo em qualquer nível:** hoje a lista direta de contratos encontrados só aparece com `st.level ≤ 1`. Passa a ser possível também nos níveis 2 (distrito aberto) e 3 (município aberto) — o filtro recorta a lista daquele escopo, sem trocar o nível.

**2.1.3 — Áreas sem correspondência acinzentadas.**
- **Quando:** `hasActiveFilter()` verdadeiro **e** `aggIds([id]).obras === 0` para um município (nível 2/3) ou `aggIds(idsOfGroup(gid)).obras === 0` para um distrito (nível 1).
- **Como:** preenchimento com uma cor **cinza dedicada de "sem correspondência"** (`--nomatch-fill` / `--nomatch-border`, definidas no CSS nos dois temas — não é a paleta de choropleth nem a cor `BASE`), `fillOpacity` fixo e baixo, borda esmaecida; o rótulo do distrito/município fica esmaecido (ou some, se ilegível).
- **Interação:** o polígono "sem correspondência" **não** responde a hover destacado nem a clique de navegação (não há o que abrir). `Esc`/seleção combinada seguem como estão.
- **Sem filtro ativo:** o mapa é **idêntico** ao de hoje — nada de cinza.
- O choropleth normal (com filtro ativo mas `obras > 0`) continua como hoje: intensidade proporcional a `mval(aggIds(...))` sobre o máximo do nível.

**2.1.4 — UI do painel de filtros.**
- Os campos novos entram no mesmo padrão visual dos atuais (dropdown multi-seleção `.msel` com contador `(N)`), na ordem: busca livre → Distrito → Município → Tipo de contrato → Ano → Status da obra → Prazo de execução → Vigência → Obra paralisada → Faixa de valor → Medição (%) → Contratada → Contratante → Fiscal. *(Ordem: navegação primeiro, depois atributos do contrato, depois pessoas/empresas.)*
- Campos cujo domínio fica vazio no escopo carregado (ex.: nenhuma obra com ficha ⇒ "Medição (%)" sem opções) aparecem **desabilitados** com dica, não somem.
- O painel de filtros continua recolhível (`#ctrlToggle`); com filtro ativo, um selo no botão indica "filtros aplicados".

### 2.2 Fora do escopo (não é regressão se não estiver aqui)

- Buscar campo/tabela/coluna nova do Supabase. Tudo sai de dado já carregado.
- Mudar a métrica (`#segMetric`), o escopo (Carteira/Histórico), a navegação/zoom, o breadcrumb, a seleção combinada, o modal da Etapa B.
- Persistir filtro em URL, `localStorage` ou permalink; filtros salvos/nomeados; histórico de filtros.
- Exportar/imprimir o recorte filtrado.
- A tela de entrada / "Ceará inteiro" → **Etapa D**.
- Filtro por texto dentro de campos que hoje são multi-seleção (ex.: buscar "constru" na lista de Contratadas) — melhoria de UI para outra etapa.
- Mudança de tipografia/layout estrutural da página.

---

## 3. Abordagem técnica (proposta — revisores podem contestar)

### 3.1 Onde mexe

- **`assets/js/mapa-obras.js`:**
  - `st.f` — acrescentar as chaves novas (`distrito`, `municipio`, `tipo`, `faixaValor`, `prazoExec`, `vigencia`, `paralisada`, `medicao`) como `Set` (busca `q` intocada).
  - `FILTER_DEFS` — generalizar: cada def passa a poder ser **de valores** (`get:o=>string|null`, opções derivadas dos dados, como hoje) **ou de categorias fixas** (`opts:[{key,label}]` + `match:(o,key)=>bool`, para faixas e derivados). `fillFilters()` monta as opções de valores; as de categoria fixa vêm da própria def.
  - `passF(o)` — um laço sobre `FILTER_DEFS` que trata os dois tipos; a busca `q` continua um caso à parte. **Uma passada só, sem custo por-campo perceptível** (`passF` roda dezenas de milhares de vezes por frame — ver comentário em `obrasOf`).
  - `styleFeature` / `groupStyle` — acrescentar o ramo "sem correspondência" (cor `--nomatch-*`) quando `hasActiveFilter()` e agregado zero; `applyInteractivity()` desliga hover/click nesses polígonos.
  - `renderPanel` — contador de resultados em todos os níveis; bloco "Filtros ativos" (chips); lista de contratos filtrada também nos níveis 2/3.
  - `render()` — nada estrutural; só passa a repintar o novo estado (já chama tudo).
  - `clearFilters()` — limpar todas as chaves novas também.
  - Auditar `setKPIs`, `renderYearChart`, `statusBreakdown`, `rankRows`, `obrasCards`, `renderFoot` — trocar qualquer leitura crua de `.obras` por `obrasOf`/`aggIds`.
- **`assets/css/mapa-obras.css`:** tokens `--nomatch-fill` / `--nomatch-border` / `--nomatch-label` nos dois temas; estilo dos chips de "filtros ativos"; ajuste do painel de filtros para caber ~14 campos (rolagem interna se preciso).
- **`gecope_mapa_obras.html`:** nada, ou o mínimo (o painel de filtros é gerado por `fillFilters()`).

### 3.2 Regras que não podem ser quebradas

- **`passF` continua barato.** Nenhuma alocação por chamada; opções e faixas pré-computadas fora do laço; `prazoCalc` por obra é calculado **uma vez no `mapRow`/`loadData`** e guardado em `o` (ex.: `o.prazoExecBucket`, `o.vigenciaBucket`), não a cada `passF`.
- **Choropleth e navegação idênticos sem filtro ativo.** O ramo "sem correspondência" só existe sob `hasActiveFilter()`.
- **`escHtml` em todo rótulo de opção** (nomes de contratada, município, tipo de contrato vêm do banco).
- **Sem cor hardcoded.** Cinza de "sem match" e chips por `var(--...)`.
- **Tema claro/escuro:** os tokens novos entram no bloco `:root` e no `:root:not(.theme-dark)` como os demais; `repaintTheme` não precisa de mudança (lê `getComputedStyle` ao vivo) — confirmar.
- **`invalidateAggCache()`** continua sendo chamado a cada mudança de `st.f` (qualquer campo novo) e a cada `loadData`.

### 3.3 Campos disponíveis (sem buscar nada novo)

De `o` (via `mapRow`): `ano`, `valor`, `valor_original`, `aditivo`, `paralisado` (dias), `statusObra`, `municipioTxt`, `tipo`, `contratada`, `contratante`, `fiscal`, `id_obra`, `assinatura`, `fim_prev`, `raw`.
De `o.raw`: `descricao_tipo_contrato`, `data_inicio_real`, `data_fim_previsto`, `data_fim_vigencia_contrato`, `dias_paralisado`, e todo o `CONTRATOS_COLS`.
De `o.ficha`: `percentual_total_medido`, `total_medido`.
Distrito da obra: `grpById(gidOf(id)).nome` para cada obra do município `id`.
`prazoCalc(inicio, fim)` já existe (extração da Etapa B) e devolve `{overdue, remainingDays, ...}` — base dos buckets de prazo/vigência.

---

## 4. Critérios de aceite — por lente de revisor

### 4.1 Objetivo / Spec

- [ ] O painel de filtros tem os 8 campos novos (§2.1.1), multi-seleção, na ordem da §2.1.4; os 6 campos atuais inalterados.
- [ ] Faixas de valor: até 1 mi / 1–5 mi / 5–20 mi / 20 mi+. Faixas de % medido: 0–25 / 25–50 / 50–75 / 75–100 / >100 / sem ficha. Buckets de prazo e vigência: no prazo/vigente · a vencer (≤30 dias) · vencido(a) · sem data. "Obra paralisada": Sim/Não (`dias_paralisado > 0`).
- [ ] Combinação: **E** entre campos, **OU** dentro do campo — idêntico ao `passF` atual.
- [ ] Contador "N contrato(s) encontrado(s)" visível em **todos** os níveis quando há filtro ativo.
- [ ] Bloco "Filtros ativos": um chip por valor selecionado, "×" remove só aquele valor, "Limpar tudo" zera tudo (busca inclusive). Sem filtro, o bloco não aparece.
- [ ] Com filtro ativo, a **lista de contratos filtrada** aparece também nos níveis 2 e 3 (recorte do escopo, sem trocar de nível).
- [ ] Com filtro ativo, distrito/município com **0 correspondências** fica **cinza inerte** no mapa (cor `--nomatch-*`), não responde a hover destacado nem a clique. Sem filtro ativo, o mapa é idêntico ao de hoje.
- [ ] Nenhuma tabela/coluna nova do Supabase; nenhuma métrica/navegação/escopo alterada.

### 4.2 Dados / Cálculos / Integridade

- [ ] **Nenhum número muda** com o mesmo filtro que hoje: aplicar só os 6 filtros atuais produz KPIs, choropleth, gráfico de anos, ranking e lista **idênticos** aos de antes da Etapa C (comparar).
- [ ] Cada campo novo recorta corretamente: amostra manual por campo (um valor de cada, e combinações) — os contratos exibidos são exatamente os que satisfazem o predicado.
- [ ] Buckets de prazo/vigência batem com `prazoCalc` (overdue → vencido; `remainingDays ≤ 30` e não overdue → a vencer; senão → no prazo/vigente; datas ausentes → "sem data").
- [ ] Faixas de valor / % medido: contratos exatamente na borda (ex.: R$ 5.000.000,00; 25,0%) caem numa faixa só, de forma consistente e documentada (proponho: limite inferior inclusivo, superior exclusivo).
- [ ] `aggIds`/`obrasOf` são a **única** fonte de contagem/soma em todos os caminhos derivados (nenhuma leitura crua de `.obras` sob filtro).
- [ ] `passF` sem alocação por chamada; buckets por obra pré-computados no `mapRow`/`loadData`; `invalidateAggCache()` disparado por toda mudança de `st.f`.
- [ ] `escHtml` em todo rótulo de opção e de chip vindo do banco.
- [ ] Campos nulos: obra sem `data_fim_previsto` cai em "Sem data"; sem `ficha` cai em "Sem ficha"; sem tipo de contrato não aparece como opção (como as contratadas "—" hoje).

### 4.3 Interface / Experiência

- [ ] O painel com ~14 campos continua utilizável: rola internamente se preciso, sem empurrar o mapa; recolhível; selo de "filtros aplicados" no `#ctrlToggle`.
- [ ] Chips de "filtros ativos" legíveis nos dois temas, com alvo de clique ≥ 24px no "×"; "Limpar tudo" evidente.
- [ ] O cinza de "sem correspondência" é **distinguível** do choropleth mais fraco em ambos os temas (contraste da borda/preenchimento) e não parece "erro"; o mapa filtrado comunica de relance onde há e onde não há carteira.
- [ ] Contraste AA de todo texto novo (opções, chips, contador) nos dois temas.
- [ ] Sem `flash`/salto perceptível ao marcar/desmarcar um filtro; a repintura do mapa acompanha (como hoje).
- [ ] Estados vazios claros: "Nenhum contrato encontrado com estes filtros" quando o recorte global zera; campo de filtro sem opções aparece desabilitado com dica.
- [ ] Funciona em 360px de largura e em projeção (modo apresentação).

### 4.4 Regressão / Comportamento

- [ ] Sem filtro ativo: mapa, KPIs, gráfico de anos, ranking, lista, rodapé, navegação (3 níveis), seleção combinada, breadcrumb, modal (Etapa B), troca de tema, modo apresentação, Carteira/Histórico — **idênticos** ao estado pré-Etapa C.
- [ ] `passF` não regride o desempenho de pan/zoom do mapa (medir com a carteira ativa inteira + vários filtros ativos); `obrasOf` continua memoizado por época de filtro.
- [ ] `clearFilters()` zera **todas** as chaves (novas e antigas) e a busca; o `render()` seguinte volta ao estado sem filtro (mapa sem cinza).
- [ ] Mudar de escopo (Carteira ↔ Histórico) ou recarregar dados revalida as opções dos filtros (as opções refletem o novo conjunto) e não deixa filtro "fantasma" de valor que não existe mais no escopo.
- [ ] Trocar o tema com filtro ativo: o cinza de "sem correspondência" e os chips repintam nos dois sentidos.
- [ ] Console limpo ao: aplicar/limpar cada filtro, combinar filtros, navegar entre níveis com filtro ativo, trocar tema/escopo com filtro ativo.
- [ ] `assets/geo/*.json` inalterados; nada fora do painel de filtros / camada de render muda.

---

## 5. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| `passF` com 14 campos ficar lento no pan/zoom | Buckets por obra pré-computados; laço sobre defs sem alocação; `obrasOf` memoizado; critério 4.4 mede |
| "Sem correspondência" cinza confundir com choropleth fraco | Token dedicado `--nomatch-*` distinto da paleta; borda própria; critério 4.3; validação visual do usuário |
| Algum caminho derivado ainda lendo `.obras` cru → número inconsistente sob filtro | Auditoria explícita na §3.1; critério 4.2 ("única fonte `aggIds`/`obrasOf`") |
| Painel com 14 campos ficar denso demais | Ordem por afinidade (§2.1.4); rolagem interna; recolhível; critério 4.3 |
| Filtro "fantasma" ao trocar de escopo (valor selecionado que sumiu) | Revalidar `st.f` contra o domínio novo em `fillFilters()`/`loadData`; critério 4.4 |
| Borda de faixa (R$ 5 mi exato, 25,0% exato) cair em duas faixas ou nenhuma | Regra fixa documentada (inferior inclusivo / superior exclusivo); critério 4.2 |
| Polígono "sem match" ainda clicável e abrindo um município vazio | `applyInteractivity()` desliga hover/click nele; critério 4.1/4.4 |

---

## 6. Definição de pronto

A Etapa C está pronta quando todos os itens da seção 4 estão marcados, os 4 subagentes revisores retornaram `APROVADO`, **e** o usuário deu a validação prática/visual. Achados não bloqueantes vão para uma lista de follow-up anexa, sem impedir o início da Etapa D.

---

## 7. Decisões tomadas nesta proposta (o usuário veta o que não servir)

Como não houve detalhamento prévio, estas são as escolhas que a spec fixa. Se alguma estiver errada, é só apontar antes de aprovar:

1. **8 campos novos** exatamente os da §2.1.1 — nem mais, nem menos.
2. **Faixas de valor:** até R$ 1 mi · 1–5 mi · 5–20 mi · 20 mi+ (limite inferior inclusivo, superior exclusivo).
3. **Faixas de % medido:** 0–25 · 25–50 · 50–75 · 75–100 · >100 · Sem ficha.
4. **"A vencer" = ≤ 30 dias restantes** (mesmo limiar do `prazoCalc`/timelines do resto do módulo).
5. **"Sem correspondência" = cinza inerte + não clicável** (não "cinza mas ainda navegável").
6. **Não há redesenho do componente de filtro** — os campos novos usam o mesmo dropdown `.msel` de hoje; o que é novo de UI é só o bloco de chips "Filtros ativos" + o contador sempre visível.
7. **"Super filtro" = amplitude + integração**, não filtros salvos/URL/permalink (esses ficam fora — §2.2).
8. **Sem persistência** de filtro entre sessões.
9. **Ordem dos campos** conforme §2.1.4 (navegação → atributos do contrato → pessoas/empresas).
