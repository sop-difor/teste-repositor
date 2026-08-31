# Etapa C — Super filtro + integração · Configuração dos 4 Revisores

Spec de referência: [`docs/etapa-C-superfiltro-spec.md`](etapa-C-superfiltro-spec.md)
Plano de implementação: [`docs/etapa-C-superfiltro-plano.md`](etapa-C-superfiltro-plano.md)

---

## Natureza deste documento

- **Nenhum código é alterado agora.** Define **como a Etapa C será revisada** depois de implementada.
- Ao final do Bloco 7 do plano, **4 revisores independentes** conferem o trabalho contra critérios escritos e devolvem `APROVADO` ou `BLOQUEADO + lista`.
- O usuário revisa e aprova este documento **antes** de o plano virar tarefas.

---

## Como a revisão funciona

1. **Quando roda:** ao final da Etapa C inteira (Bloco 7), não a cada bloco. O acompanhamento bloco a bloco é feito com o usuário em linguagem simples e visual; os revisores são a checagem técnica formal do conjunto.
2. **Quem roda:** 4 subagentes independentes, um por lente — **Estrutura/Arquitetura · Dados/Cálculos/Integridade · Interface/Experiência · Regressão/Comportamento**. Rodam em paralelo, sem ver o resultado um do outro.
3. **O que cada um recebe:** a spec aprovada, este documento, a lista de arquivos alterados + resumo em linguagem clara, e acesso de leitura ao repositório (`git diff` contra o estado pré-Etapa C).
4. **O que cada um devolve:** `APROVADO` **ou** `BLOQUEADO`, seguido de:
   - **Achados bloqueantes:** descrição, `arquivo:linha`, qual critério escrito fere, o que precisa mudar.
   - **Achados não bloqueantes:** lista de follow-up, tratada depois sem travar a Etapa D.
5. **Decisão final da Etapa C — dois portões:** (a) os **4 revisores em `APROVADO`**; (b) a **validação prática e visual do usuário**. Só com os dois avança para a Etapa D.
6. **Ciclo de correção:** cada achado bloqueante → correção **apenas naquilo** → os revisores afetados rodam de novo → repete até os 4 aprovarem.
7. **Conflitos:** revisor × spec escrita → **a spec vence** (a divergência vira follow-up). Revisor × revisor → **o usuário arbitra**.
8. **Limite de alçada:** um revisor **não** pode bloquear por gosto pessoal fora dos critérios escritos, nem por algo que a spec marcou como fora de escopo (filtros salvos/URL, export, métrica, tela de entrada). Isso vira "fora de escopo — Etapa D/futura", nunca bloqueio.

---

## O que é "bloqueante" e o que é "follow-up"

| Bloqueante (trava a Etapa C) | Follow-up (não trava) |
|---|---|
| Um critério de aceite da spec (§4) não cumprido | Um acabamento que a spec não exige |
| **Sem filtro ativo**, algo diferente do estado pré-Etapa C (mapa, KPIs, gráfico, ranking, lista, navegação, tema) | Ajuste fino de espaçamento que ninguém notaria sem comparar |
| **Com os mesmos 6 filtros de hoje**, qualquer número/lista diferente do de antes | Ideia de melhoria para uma etapa futura |
| Um campo de filtro novo recortando **errado** (contrato que não satisfaz o predicado aparecendo, ou o contrário) | Preferência estética sem base num critério escrito |
| Contrato na borda de faixa (R$ 5 mi, 25,0%) caindo em duas faixas ou nenhuma | Sugestão de organização interna de código sem efeito visível |
| Caminho derivado (KPI, gráfico, ranking, rodapé) lendo `.obras` cru sob filtro → número inconsistente | — |
| Cinza de "sem correspondência" aparecendo **sem** filtro ativo, ou polígono cinza ainda navegável | — |
| Cor hardcoded (cinza de "sem match", chips) em JS ou CSS; token fora do bloco de tema | — |
| Rótulo de opção/chip do banco chegando à tela **sem `escHtml`** | — |
| `passF` com alocação por chamada ou `prazoCalc` recalculado por `passF` → regressão de pan/zoom | Micro-otimização sem efeito medível |
| Nova dependência; tabela/coluna nova do Supabase; `fetchTable` novo; chamada a `app_users` | — |
| Erro de console ao aplicar/limpar/combinar filtro ou navegar entre níveis com filtro ativo | — |
| Contraste de texto/elemento novo abaixo de WCAG AA em qualquer tema | — |
| Filtro "fantasma" (valor selecionado que sumiu do escopo) alterando o recorte após troca Carteira↔Histórico | — |

---

## Revisor 1 — Estrutura / Arquitetura

**Pergunta que ele responde:** "O filtro foi ampliado conforme a spec, e o código está organizado de forma sã?"

**Confere (base: spec §2.1, §3, §4.1):**
- Os **8 campos novos** existem (`FILTER_DEFS` + `st.f`), multi-seleção, na ordem da §2.1.4; os 6 campos atuais preservados. `FILTER_DEFS` foi **generalizado** para tratar defs "de valores" e "de categoria fixa" num laço, sem `if` cravado por campo em `passF`.
- Buckets por obra (`prazoExecBucket`, `vigenciaBucket`, `medicaoBucket`, `faixaValorBucket`, `paralisada`) computados **uma vez** no `mapRow`/`loadData`, não em `passF`.
- **Integração:** `setKPIs`, `renderYearChart`, `statusBreakdown`, `rankRows`, `obrasCards`, `renderFoot` usam `obrasOf`/`aggIds` — nenhuma leitura crua de `DB.municipios[id].obras` sob filtro. Contador de resultados em `renderPanel` para todos os níveis; lista filtrada nos níveis 2/3.
- **"Sem correspondência":** ramo em `styleFeature`/`groupStyle` **só** sob `hasActiveFilter()` e agregado zero; `applyInteractivity()` desliga hover/click no polígono cinza. Tokens `--nomatch-*` no CSS, nos dois temas.
- **Bloco de chips** montado em `renderPanel`/`fillFilters` no padrão do arquivo; "Limpar tudo" consolida `clearFilters`; selo no `#ctrlToggle`.
- **Sem dependência nova**; nenhum `fetchTable` novo; nenhuma coluna nova em `CONTRATOS_COLS`/etc.; nenhuma chamada a `app_users`. `assets/geo/*.json` intocados. `gecope_mapa_obras.html` não reestruturado.
- `node --check` sem erro; sem `id` duplicado; `clearFilters` zera **todas** as chaves (novas e antigas) + `q`.

**NÃO é a alçada dele:** exatidão dos recortes/números (Revisor 2), contraste/estética (Revisor 3), regressão de comportamento e desempenho (Revisor 4).

**Aprova se:** os 8 campos e a integração existem conforme a spec; `FILTER_DEFS`/`passF` orientados a dados; "sem correspondência" isolado sob filtro; sem dependência/tabela nova.
**Bloqueia se:** campo faltando ou fora de ordem; `passF` ainda com `if` por campo; buckets recalculados em `passF`; caminho derivado sem `aggIds`/`obrasOf`; cinza fora de `hasActiveFilter()`; dependência/tabela/coluna nova; `node --check` falhando; `id` duplicado.

---

## Revisor 2 — Dados / Cálculos / Integridade

**Pergunta que ele responde:** "Cada filtro recorta exatamente o que deveria, e nada que não deveria mudou de número?"

**Confere (base: spec §2.1.1, §3.2, §4.1, §4.2 e invariáveis 3–5, 9 do plano):**
- **Paridade — comparação antes × depois.** Com **apenas** os 6 filtros de hoje (e combinações), KPIs, choropleth (3 níveis), gráfico de anos, legenda de status, ranking e lista são **idênticos** ao estado pré-Etapa C.
- **Cada campo novo recorta certo.** Amostra por campo (um valor isolado + combinações): os contratos exibidos são **exatamente** os que satisfazem o predicado; nenhum a mais, nenhum a menos.
- **Buckets de prazo/vigência** = `prazoCalc`: `overdue` → vencido(a); `remainingDays ≤ 30` e não overdue → a vencer; senão → no prazo/vigente; datas ausentes → "Sem data".
- **Faixas de valor / % medido:** regra **inferior inclusivo / superior exclusivo**; contrato exatamente na borda (R$ 5.000.000,00; 25,0%) cai numa faixa só, de forma consistente. Faixa de % > 100 e "Sem ficha" tratadas.
- **`aggIds`/`obrasOf` como única fonte** de contagem/soma em todos os caminhos derivados; nenhuma leitura crua de `.obras` sob filtro.
- **`passF` barato:** sem alocação por chamada; opções/faixas fora do laço; buckets pré-computados por obra; `invalidateAggCache()` em toda mudança de `st.f`.
- **`escHtml`/`fmtVal`** em todo rótulo de opção e de chip vindo do banco (município, contratada, tipo de contrato). Nenhum `innerHTML` novo com valor cru.
- **Revalidação de escopo:** ao trocar Carteira↔Histórico ou recarregar, as opções refletem o novo conjunto e nenhum valor selecionado "fantasma" (que sumiu do escopo) continua recortando.
- Nulos: sem `data_fim_previsto` → só "Sem data"; sem `ficha` → só "Sem ficha"; sem tipo de contrato → não vira opção.

**NÃO é a alçada dele:** existência/ordem dos campos e organização do código (Revisor 1); contraste e aparência (Revisor 3); o que acontece na navegação/tema e desempenho (Revisor 4).

**Aprova se:** paridade total com os 6 filtros de hoje; cada campo novo recorta exatamente o predicado; regras de borda consistentes; `aggIds`/`obrasOf` como única fonte; `escHtml` em tudo.
**Bloqueia se:** qualquer número/lista diferente com os filtros de hoje; campo novo recortando errado; contrato de borda em duas faixas ou nenhuma; caminho derivado com `.obras` cru; rótulo sem escape; filtro fantasma alterando o recorte.

---

## Revisor 3 — Interface / Experiência visual

**Pergunta que ele responde:** "O painel com 14 campos e o mapa filtrado ficaram legíveis e claros — nos dois temas, inclusive projetados?"

**Confere (base: spec §2.1.4, §4.3):**
- O painel com ~14 campos é **utilizável**: rola por dentro se preciso, sem empurrar/cortar o mapa; recolhível; selo de "filtros aplicados" no `#ctrlToggle` visível e claro.
- **Chips "Filtros ativos":** legíveis nos dois temas; alvo de clique do "×" ≥ 24px; "Limpar tudo" evidente; um chip por valor.
- **Contador de resultados** claro e sempre presente com filtro ativo.
- **Cinza de "sem correspondência":** distinguível do choropleth mais fraco em **ambos** os temas (contraste de borda/preenchimento); não parece "erro"; o mapa filtrado comunica de relance onde há e onde não há carteira.
- **Contraste ≥ WCAG AA** (texto normal 4,5:1; grande 3:1) de todo elemento novo — opções, chips, contador, rótulo esmaecido do "sem match" — nos dois temas. Razões calculadas para os pares principais.
- **Sem `flash`/salto** perceptível ao marcar/desmarcar um filtro.
- **Estados vazios:** "Nenhum contrato encontrado com estes filtros" quando o recorte global zera; campo de filtro sem opções aparece **desabilitado com dica**, não some.
- **360px e projeção** (modo apresentação): o painel e os chips cabem/rolam; o mapa filtrado continua legível.

**NÃO é a alçada dele:** exatidão de recorte/número (Revisor 2); existência de campo e estrutura de código (Revisor 1); regressão de comportamento e desempenho (Revisor 4). Preferência estética sem critério escrito **não** é bloqueio.

**Aprova se:** painel utilizável com 14 campos; chips e contador legíveis; cinza distinguível; AA nos dois temas; estados vazios claros; cabe em 360px/projeção.
**Bloqueia se:** painel cortando o mapa ou ilegível; cinza indistinguível do choropleth fraco; contraste abaixo de AA; `flash` ao filtrar; estado vazio com cara de erro; campo sem opções sumindo em vez de desabilitar.

---

## Revisor 4 — Regressão / Comportamento geral

**Pergunta que ele responde:** "Quebrou, mudou ou ficou mais lento algo que já funcionava — com ou sem filtro?"

**Confere (base: spec §4.2, §4.4 e invariáveis 2, 4, 6–10 do plano):**
- **Sem filtro ativo:** mapa (3 níveis), choropleth, KPIs, gráfico de anos, legenda de status, ranking, lista, rodapé, navegação/zoom, seleção combinada (Ctrl+clique), breadcrumb, popover de irmãos, modal da Etapa B, troca de tema, modo apresentação, Carteira↔Histórico — **idênticos** ao estado pré-Etapa C. **Nenhum cinza no mapa.**
- **`passF` não regride pan/zoom:** medir com a carteira ativa inteira + vários filtros ativos; `obrasOf` continua memoizado por época; `invalidateAggCache` disparado por toda mudança de `st.f`.
- **`clearFilters` / "Limpar tudo"** zera **todas** as chaves (novas e antigas) + `q`; o `render()` seguinte volta ao estado sem filtro (mapa sem cinza, contador some).
- **Troca Carteira↔Histórico / recarga** revalida as opções e não deixa filtro fantasma; a repintura acompanha.
- **Troca de tema com filtro ativo:** cinza de "sem correspondência" e chips repintam nos dois sentidos, sem cor presa.
- **Navegar entre níveis com filtro ativo:** subir/descer nível mantém o filtro; o polígono cinza continua inerte; a lista filtrada aparece no nível certo sem trocar de nível sozinha.
- **"Sem correspondência" não navegável:** clicar num distrito/município cinza não faz nada; clicar num com carteira abre normal.
- **Desempenho:** nenhuma requisição de rede nova (nenhum `fetchTable`); nenhuma leitura de layout em laço na montagem dos chips; a repintura do mapa ao filtrar não fica perceptivelmente mais lenta.
- Console sem erro ao: aplicar/limpar/combinar cada filtro, navegar entre níveis com filtro ativo, trocar tema/escopo com filtro ativo — nos dois temas.
- `assets/geo/*.json` inalterados.

**NÃO é a alçada dele:** se o painel está bonito/legível (Revisor 3); se os recortes estão certos (Revisor 2); se a estrutura dos campos segue a spec (Revisor 1).

**Aprova se:** sem filtro tudo idêntico ao de hoje; `passF` sem regressão de desempenho; `clearFilters` volta ao zero; sem requisição nova; cinza inerte; console limpo nos dois temas.
**Bloqueia se:** algo diferente sem filtro ativo; cinza aparecendo sem filtro; polígono cinza navegável; `passF` deixando o pan/zoom lento; `clearFilters` não zerando tudo; filtro fantasma após troca de escopo; requisição de rede nova; erro de console.

---

## Matriz de responsabilidade (para evitar sobreposição)

| Tema | Revisor responsável |
|---|---|
| Existência/ordem dos 8 campos novos; `FILTER_DEFS`/`passF` orientados a dados; buckets no `mapRow`/`loadData` | **1 — Estrutura** |
| Integração: caminhos derivados usando `aggIds`/`obrasOf`; contador em todos os níveis; lista nos níveis 2/3 | **1 — Estrutura** (existência) e **2 — Dados** (paridade dos números) |
| "Sem correspondência": ramo isolado sob `hasActiveFilter()`; `applyInteractivity` desliga o polígono; tokens `--nomatch-*` | **1 — Estrutura** (isolamento/tokens) e **4 — Regressão** (não navegável, some sem filtro) |
| Chips "Filtros ativos" + "Limpar tudo" + selo — montagem/código | **1 — Estrutura** |
| Paridade antes × depois com os 6 filtros de hoje | **2 — Dados** |
| Cada campo novo recorta exatamente o predicado; regras de borda de faixa; buckets = `prazoCalc` | **2 — Dados** |
| `passF` sem alocação; `invalidateAggCache` em toda mudança de `st.f`; revalidação de escopo (filtro fantasma) | **2 — Dados** (integridade) e **4 — Regressão** (comportamento após troca de escopo) |
| `escHtml` em rótulo de opção/chip | **2 — Dados** |
| Painel utilizável com 14 campos; chips/contador legíveis; cinza distinguível; AA; 360px/projeção; estados vazios | **3 — Interface** |
| `flash` ao filtrar; selo do `#ctrlToggle` | **3 — Interface** |
| Sem filtro ativo tudo idêntico; `clearFilters` volta ao zero; troca de tema/escopo com filtro; navegação entre níveis com filtro | **4 — Regressão** |
| Desempenho de pan/zoom com filtro; sem requisição nova | **4 — Regressão** |
| `node --check`, `id` duplicado | **1** (parse/estrutura) e **4** (regressão) conferem; basta um apontar |

---

## Registro de resultados (revisão — 2026-08-30)

| Revisor | Rodada 1 | Rodada 2 | Final |
|---|---|---|---|
| 1 — Estrutura/Arquitetura | 🔴 BLOQUEADO (B1) | ✅ APROVADO | ✅ APROVADO |
| 2 — Dados/Cálculos/Integridade | ✅ APROVADO | — | ✅ APROVADO |
| 3 — Interface/Experiência | ✅ APROVADO | — | ✅ APROVADO |
| 4 — Regressão/Comportamento | ✅ APROVADO | — | ✅ APROVADO |

**Portão 1 (4 revisores em APROVADO): ✅ atingido em 2026-08-30.**
**Portão 2 (validação prática/visual do usuário): ⏳ pendente — do usuário.**

### Achado bloqueante e correção

| # | Revisor | Arquivo:linha | Critério ferido | Correção | Status |
|---|---|---|---|---|---|
| B1 | 1 — Estrutura (e ref. cruzada Revisor 4, follow-up 2) | `assets/js/mapa-obras.js:22` (`readTokens()`) | Spec "Restrições globais" / plano invariável 6: nenhuma cor hardcoded em JS ou CSS | Removidos os fallbacks hex literais `'#5C6B64'`/`'#7E8C85'`; ficou `nomatchFill:_tok('--nomatch-fill'), nomatchBorder:_tok('--nomatch-border')`. Tokens `--nomatch-*` existem nos dois temas → `_tok()` sempre resolve. `node --check` OK. | ✅ corrigido — Revisor 1 re-acionado |

### Follow-up não bloqueante (anexado à spec; tratado sem travar a Etapa D)

**Revisor 2 — Dados:**
1. `faixaValorBucket(0)` → `ate1m`: obra com valor 0/ausente cai em "Até R$ 1 mi". Determinístico e conforme a spec (4 faixas fixas, sem estado "sem valor"). Registrar se o usuário quiser um estado "sem valor informado".
2. `medicaoBucket` com `ficha` presente mas `percentual_total_medido` nulo → `num()`=0 → "0–25%". Uma ficha sem percentual não se distingue de 0% executado.
3. Filtro `paralisada=Sim` usa `dias_paralisado > 0`; o KPI "Paralisadas" usa `statusBucket==='stop'`. Definições diferentes (ambas conforme código atual) → a contagem de resultados pode não igualar o KPI. Divergência conceitual herdada, sem defeito.
4. "Sem data" de Prazo/Vigência também captura obras sem `data_inicio_real` (não só sem a data de fim), porque `prazoCalc` exige as duas pontas. Alinhado à semântica de `prazoCalc`.

**Revisor 3 — Interface:**
5. Rótulo `.nomatch` (`css:532-533`): contraste ~3,5:1 (dark) / ~1,6:1 (light), abaixo de AA. A §2.1.3 autoriza ocultar o rótulo — preferir `display:none`/`opacity:0` no `.nomatch .lbl` em vez de `opacity:.4` (um "0" fantasma lê como dado quebrado). Spec vence → não bloqueia.
6. `.fchip` sem `min-height`: cravar `min-height:24px` para o alvo de clique não depender da fonte/zoom (com Montserrat provavelmente já chega a 24px).
7. `.fchip-clear` ("Limpar tudo"): 10,5px / `--text-dim` / sublinhado. Considerar `--ng-light` e ~11,5px para a ação secundária ficar mais óbvia.
8. `--nomatch-fill` no dark a `fillOpacity:.16` sobre fundo quase-preto fica quase imperceptível; a leitura "vazio" se apoia na borda. Avaliar `fillOpacity` um pouco maior ou fill mais claro no tema escuro (projeção). Sujeito à validação visual do usuário.

**Revisor 4 — Regressão:**
9. `fill="#5C6B64"` do coroplético/`NOMATCH_STYLE` pode ficar preso como atributo em polígonos ocultos (`HID` força opacidade 0) — invisível, comportamento pré-existente do Leaflet, não introduzido pela Etapa C.
10. `hasActiveFilter()` passou a iterar `Object.keys(st.f)` e é chamado por feature em `styleFeature`/`noMatchCity` (~184×/`setStyle`). Custo medido irrelevante (`.some` curto-circuita, `aggIds` memoizado). Nota de completude.

### Observações para o portão visual do usuário (Revisor 3 — não são achados de código)

- As capturas de QA feitas durante os blocos estão **desatualizadas** em relação ao estado atual (mostram ainda o botão largo "Limpar busca e filtros" no rodapé do painel, que o CSS atual oculta). O código atual consolida corretamente numa única ação "Limpar tudo". **Recapturar antes da validação visual.**
- O contador "· N contrato(s) encontrado(s)" e o selo `.has-filters` no `#ctrlToggle` estão confirmados por código mas não aparecem em captura (painel lateral recolhido / toggle escondido com o painel aberto). Vale uma captura com o aside aberto e recorte global zero.

---

**Etapa C concluída quando:** os 4 vereditos = `APROVADO` **e** o usuário deu a validação prática/visual. Achados de follow-up migram para a spec como lista anexa e são tratados depois, sem travar a Etapa D.
