# Etapa A — Tema Claro/Escuro · Especificação e Critérios de Aceite

Módulo: **Mapa de Obras Fiscalizadas** (`gecope_mapa_obras.html`, `assets/js/mapa-obras.js`, `assets/css/mapa-obras.css`)
Status: **spec aprovada pelo usuário em 2026-08-28** — aguardando organização da fase de implementação (sem código até então)
Este documento é a rubrica contra a qual os 4 subagentes revisores julgam a entrega da Etapa A.

## Confirmações registradas na aprovação (2026-08-28)

1. **Preferência de tema compartilhada.** O módulo usa o mecanismo já existente no GECOPE, sem sistema paralelo: chave `localStorage['gecope_theme']`, valores `'dark'` / `'light'`, classe `body.theme-dark` (presente = escuro; ausente = claro). Nenhum outro módulo é alterado nesta etapa. Diferença intencional e acordada: quando a chave **nunca foi definida**, o Mapa de Obras consulta o `prefers-color-scheme` do sistema operacional (o app principal assume escuro fixo nesse caso). Isso é apenas a interpretação da *ausência* de escolha — assim que há qualquer escolha salva, ela vale para todo o GECOPE.
2. **Preservação do tema escuro.** Objetivo: tema escuro **visual e funcionalmente idêntico** ao atual. Reorganizações internas são aceitas desde que **imperceptíveis**. O revisor de Regressão compara o escuro lado a lado; qualquer diferença perceptível bloqueia a entrega. Plano B, se a reorganização de *helpers* de cor não chegar a zero diferença em algum ponto: manter o caminho do escuro literalmente intocado e restringir os tokens novos apenas ao tema claro.

## Adequações técnicas registradas durante a implementação

**AT-1 — Marcação do tema também na raiz do documento (autorizada em 2026-08-28, durante o Bloco 3).**
Motivo: o JavaScript do módulo lê as variáveis de cor via `getComputedStyle(document.documentElement)` (raiz `<html>`), uma vez no carregamento. Se as cores claras ficassem só sob `body:not(.theme-dark)`, o JS continuaria lendo a paleta escura — deixando invisíveis os textos grandes de nome de distrito/região/município no painel (desenhados por JS com `TOKENS.textBrightest`) e sem ajuste os gráficos "contratos por ano" e "situação das obras".
Adequação: a classe `theme-dark` passa a ser aplicada **tanto em `<html>` quanto em `<body>`** (script de boot, ação do botão e "sensor" do SO). As cores do tema claro são definidas sob **`:root:not(.theme-dark)`** (acessível ao CSS e ao `getComputedStyle(document.documentElement)`). A convenção `body.theme-dark` é preservada para compatibilidade com o restante do GECOPE.
É uma adequação técnica necessária para o tema claro funcionar em todos os elementos, especialmente textos e gráficos controlados por JavaScript. **Não altera o objetivo nem o comportamento observável já aprovado do Bloco 1** (botão, persistência, ausência de *flash*) — reverificado após a mudança.

**AT-2 — Token `--map-field` (Bloco 3 / Rodada 3.1, aprovado em 2026-08-28).**
Novo token para o **fundo da área do mapa**, separado do piso da página (`--bg-base`). No tema escuro resolve para `var(--bg-base)` (idêntico ao de sempre); no tema claro recebe um valor claro próprio, um passo mais fundo/verde que a página, para o "campo" do mapa se distinguir sutilmente do restante da tela sem virar escuro. `#map` e `.leaflet-container` passam a usá-lo. CSS apenas.

**AT-3 — Layout de KPI unificado entre os temas (Rodada 3.2 Parte B, corrigido em 2026-08-28).**
A confirmação nº 2 ("preservação do tema escuro") passou a ter **uma exceção explícita, pedida pelo usuário**: a *disposição* dos cards do painel direito (hierarquia de 3 níveis dos KPIs + ranking em filetes) deve ser **idêntica nos dois temas** — "o que diferencia é a questão do tema" (só as cores). Consequência: o layout de KPI do tema escuro **muda** em relação ao original (Obras vira faixa cheia; Valor médio deixa de ser faixa; Paralisadas perde a barra lateral vermelha, mantém o número em vermelho; ranking vira filetes em vez de cartões). As classes `wide`/`alert` foram removidas dos KPIs; a hierarquia é feita pelas classes `k-*` + regras não escopadas por tema. O revisor de Regressão deve tratar essa mudança de layout no escuro como **aprovada**, não como regressão; a paleta do escuro (cores/tokens) permanece intocada.

## Registro de execução do Bloco 3 (tema claro — superfícies)

Entregue em rodadas, todas **só em CSS**:
- **3.0 / 3.0-v2** — reprovadas (achatada; e "mapa escuro" não era tema claro).
- **3.1 — APROVADA (2026-08-28).** Refinamento a partir da v1: fundo quase branco, cartões sem borda + sombra levíssima, mais respiro, cabeçalho refinado, verde institucional `#0C8A5C`, botão "Limpar" como ação secundária, token `--map-field` (AT-2), e 1ª passada em cores/rótulos do mapa. Regressão do escuro reverificada (tokens idênticos). Contraste AA de interface: ok.
- **3.2 — APROVADA (2026-08-28).** Parte A (CSS): campos do painel de filtros mais limpos. Parte B (HTML: classes `k-*` + CSS): 3 níveis de hierarquia de KPI. **Correção:** originalmente só no claro; a pedido do usuário passou a valer para os **dois temas** — disposição dos cards idêntica, só as cores mudam por tema. As classes `wide`/`alert` foram removidas dos KPIs. Isso altera o layout de KPI do tema escuro vs. o original (decisão deliberada do usuário: "os dois temas devem ser iguais").
- **Deferido ao Bloco 4:** contraste entre distritos (fórmula de opacidade no JS) e ajuste-fino dos estados do mapa + valores finais dos verdes, a validar com o usuário. **Deferido ao Bloco 5:** verificação final de rótulos e a hierarquia dinâmica opcional (JS), ainda não aprovada.

---

## 0. Contexto — plano geral das melhorias do módulo

As melhorias do `gecope_mapa_obras` foram divididas em 4 etapas, executadas **uma por vez**, nesta ordem:

| Etapa | Escopo |
|---|---|
| **A. Tema** *(este documento)* | Tema claro profissional coexistindo com o escuro; alternância imediata; preferência persistente. Limpeza da UI de "Região". |
| B. Modal | Janela "Dados do Contrato" em 4 abas — Resumo (executivo) · Aditivos · Medições · Fiscalização. |
| C. Super filtro + integração | Evoluir os filtros existentes (novos campos Município e Distrito Operacional); mapa/painel/lista como sistema integrado; áreas sem match acinzentadas. |
| D. Entrada | Eliminar a visão "Ceará inteiro"; entrar já dividido nos 11 Distritos Operacionais com animação curta (~700 ms); painel lateral aberto com indicadores do Estado. |

### Processo de revisão (todas as etapas)

- Antes de cada etapa: spec + critérios de aceite por escrito, aprovados pelo usuário. **Sem código antes da aprovação da spec.**
- Ao fim de cada etapa: 4 subagentes revisores, lentes fixas — **Objetivo/Spec · Regressão · Design/UX · Performance**. Cada um devolve `APROVADO` ou `BLOQUEADO + lista`.
- **Avança só com os 4 = `APROVADO`.** Achado não-bloqueante → lista de follow-up, não trava a etapa.
- Conflito revisor × spec → a spec escrita vence. Conflito revisor × revisor → o usuário arbitra.

### Restrições globais

- Sem novas dependências / bibliotecas (hoje: apenas Leaflet via CDN unpkg + Google Fonts).
- Página continua **estática e pública** (sem login).
- **Modo apresentação** continua funcionando.

---

## 1. Objetivo da Etapa A

Adicionar ao módulo um **tema claro profissional e visualmente agradável** — uma paleta clara projetada de verdade, **não** um fundo branco por inversão — coexistindo com o tema escuro atual, com **alternância imediata** (sem reload) e **preferência persistente**. O tema claro serve tanto para uso de escritório / luz do dia quanto para projeção em reunião.

---

## 2. Escopo

### 2.1 Dentro do escopo

1. **Paleta clara completa** para todo o conjunto de tokens do `:root` de `assets/css/mapa-obras.css` (~50 tokens): acentos (verde/âmbar), status, paleta do mapa (`--map-*`), fundos, textos, cartões e os *helpers* RGB.

2. **Mecânica de tema:**
   - 1º acesso sem escolha salva → segue `prefers-color-scheme` do sistema operacional.
   - Alternância manual pelo toggle → grava em `localStorage['gecope_theme']` com os valores `'dark'` | `'light'`, **mesma chave e convenção de classe (`body.theme-dark`) do app principal**. Escolha explícita sempre vence o SO.
   - Reage a mudança do tema do SO em tempo real **apenas enquanto não houver escolha manual salva**.

3. **Troca imediata, sem reload:** o handler re-lê os tokens CSS para o objeto `TOKENS`, re-aplica `layer.setStyle`, `groupLayer.setStyle` e `stateShape`, reconstrói os marcadores de rótulo, e chama `render()` (que regenera KPIs, gráficos, painel e os `style="…"` inline derivados de `TOKENS`).

4. **Botão toggle:** ícone sol/lua, sem texto, discreto mas inequívoco (`title`/`aria-label` "Alternar tema claro/escuro"), como primeiro item do grupo `.top-meta` à direita do cabeçalho; visível também em tela cheia e modo apresentação.

5. **Superfícies cobertas:** mapa (coroplético nos 3 níveis, forma do estado, bordas de grupo), rótulos do mapa (nome + contador) com halo de texto adequado a fundo claro, tooltip e controles de zoom do Leaflet, cabeçalho, painel lateral (KPIs, 3 gráficos SVG, rankings, cards de contrato), modal (todas as abas atuais), popover de irmãos, painel de filtros / `msel`, breadcrumb, overlay `.data-error`, estados de foco (`:focus-visible`), skeleton `boot-loading`.

6. **Limpeza embutida nesta etapa:**
   - Remover **"Região"** da UI: o segmento `#segMethod` sai do HTML; `st.method` deixa de ramificar (fixo em `'do'`); `groupsList` / `gidOf` / `idsOfGroup` / `grpById` / `GRP[st.method]` / `buildGroupLayer` / `rebuildGroupLabels` passam a operar só em Distrito Operacional; a lógica de âncora na troca de método é removida; textos "Regiões" / "Distritos" no breadcrumb e no rodapé são ajustados.
   - **Preservar intactos** os arquivos `assets/geo/ce-blocos.json` e a chave `REGIOES` de `assets/geo/ce-referencia.json` (reversível; nada fora do módulo consome isso).
   - `#segMetric` (Obra/Valor) **permanece** inalterado. Revisitar na Etapa C se atrapalhar.
   - Fluxo principal após a limpeza: **Distrito Operacional → Município → Obra**.

### 2.2 Fora do escopo (não é regressão se não estiver aqui)

- Qualquer mudança nas abas do modal, no conteúdo do Resumo, nos filtros, na animação de entrada ou na eliminação do nível 0 — são as Etapas B, C e D.
- Retrofit do toggle de tema em outros módulos do GECOPE. (O app principal já lê `gecope_theme` por conta própria.)
- Mudança no modelo de carga de dados, no cache, ou no escopo Carteira Ativa / Histórico.
- Alteração de fontes, tipografia ou layout estrutural.

---

## 3. Abordagem técnica (proposta — revisores podem contestar)

- **`:root` permanece com os valores escuros atuais, sem alteração** (risco zero de regressão no tema escuro, que é o primário). As cores claras entram como bloco de override sob o seletor **`:root:not(.theme-dark)`** (ver AT-1).
- O tema escuro é marcado pela classe `theme-dark` aplicada **em `<html>` e em `<body>`** (ausência da classe = claro). `<html>` para o CSS (`:root:not(.theme-dark)`) e para o JS que lê cores via `getComputedStyle(document.documentElement)`; `<body>` para a convenção `body.theme-dark` compartilhada com o resto do GECOPE.
- Script de boot (inline como primeiro elemento do `<body>`, **antes** de qualquer conteúdo pintar, para evitar *flash* de tema errado):
  ```js
  var pref = localStorage.getItem('gecope_theme');            // 'dark' | 'light' | null
  var dark = pref ? (pref !== 'light')
                  : !(window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches);
  document.documentElement.classList.toggle('theme-dark', dark);
  document.body.classList.toggle('theme-dark', dark);
  ```
- **Refactor dos *helpers* de sobreposição:** o CSS atual usa `rgba(var(--white-rgb), …)` para "clarear" superfícies e `rgba(var(--ink-rgb), …)` para sombras, assumindo fundo escuro. Introduzir tokens semânticos (`--raise-rgb` = elevar superfície, `--shadow-rgb` = sombra) definidos por tema, e substituir os usos atuais. **Este é o maior ponto de esforço e de risco da etapa.**
- **Halos de rótulo do mapa:** `.lbl-name` / `.lbl-count` hoje são texto claro com halo escuro (`--shadow-ink`). No tema claro passam a texto escuro com halo claro — `--text-data` / `--text-brightest` e `--shadow-ink` precisam ambos virar por tema.
- **`stateShape`** (estilo calculado uma vez em `mapa-obras.js`, init): incluir no re-estilo do handler de troca, já que `render()` não o re-estiliza.
- **Nenhuma cor nova hardcoded em JS:** mantém-se a regra da Fase 2 — CSS é a fonte da verdade; o JS só lê `TOKENS`.

---

## 4. Critérios de aceite — por lente de revisor

### 4.1 Objetivo / Spec

- [ ] Existe um botão de alternância sol/lua no cabeçalho, no lugar especificado, com `aria-label` / `title` claros; funciona por clique e por teclado.
- [ ] 1º acesso sem `localStorage['gecope_theme']`: o módulo abre no tema que corresponde ao `prefers-color-scheme` do SO (testar nos dois).
- [ ] Após clicar no toggle, a escolha persiste ao sair e reabrir a página, e sobrepõe o tema do SO.
- [ ] Com escolha salva, mudar o tema do SO **não** altera o módulo. Sem escolha salva, mudar o tema do SO altera o módulo ao vivo.
- [ ] A troca é **imediata**, sem reload, e reestiliza mapa, rótulos, painel, gráficos, modal e tooltips numa única ação.
- [ ] `localStorage['gecope_theme']` usa exatamente os valores `'dark'` / `'light'`; a classe `theme-dark` é aplicada em `<html>` **e** em `<body>` (ver AT-1) — abrir depois o app principal reflete a mesma preferência.
- [ ] "Região" não aparece mais em nenhum lugar da UI; o fluxo é Distrito Operacional → Município → Obra. Os arquivos `ce-blocos.json` e a chave `REGIOES` continuam presentes no repositório.

### 4.2 Regressão

- [ ] Tema escuro visualmente **idêntico** ao atual (comparação lado a lado; `:root` inalterado).
- [ ] Navegação Distrito → Município → Obra, breadcrumb, popover de irmãos, seleção combinada (Ctrl+clique), `#segMetric`, toggle Carteira Ativa / Histórico, tela cheia, modo apresentação: todos funcionam nos dois temas.
- [ ] Modal (Dados Gerais, Aditivos, Medições) abre e renderiza corretamente nos dois temas, incluindo gráficos (donut, barras divergentes, timeline).
- [ ] `escHtml()` e todos os pontos de escape de dados do banco intactos (nada de novo `innerHTML` com dado não escapado).
- [ ] Cache `sessionStorage`, `loadData`, estados de erro (`showDataError`) e skeleton `boot-loading` inalterados em comportamento.
- [ ] `node --check` / parse do `<script>` inline sem erro; sem `id` duplicado; sem listener órfão deixado pela remoção do `#segMethod`.
- [ ] Sem erro de console em: carga fria, troca de tema, abertura de modal, hover no mapa, aplicação de busca — nos dois temas.

### 4.3 Design / UX

- [ ] O tema claro é uma paleta projetada: hierarquia visual preservada, contraste de texto ≥ WCAG AA (texto normal 4.5:1, texto grande 3:1) em todas as superfícies.
- [ ] Coroplético legível no claro: os níveis de intensidade (`.10 + .62·t`) continuam distinguíveis; borda de município / grupo visível sobre o preenchimento; base compatível com a área "apagada / acinzentada" que a Etapa C vai introduzir.
- [ ] Rótulos do mapa (nome + contador) legíveis sobre qualquer cor do mapa no tema claro, com halo adequado — sem "texto claro sumindo no fundo claro".
- [ ] Tooltip, controles de zoom, badge de status, botões do cabeçalho, chips e cards com estados hover / focus / on coerentes nos dois temas.
- [ ] Sem *flash* de tema errado no carregamento (o script de boot roda antes da primeira pintura).
- [ ] O ícone do toggle comunica o tema-alvo de forma óbvia (convenção consistente e com `title`).
- [ ] Aparência sólida em projeção: testar o tema claro em tela cheia, com a tipografia do modo apresentação.

### 4.4 Performance

- [ ] A troca de tema executa em tempo imperceptível; `layer.setStyle` / `groupLayer.setStyle` / `render()` chamados **uma vez** por troca, não em laço.
- [ ] O handler de `prefers-color-scheme` (`matchMedia` listener) só está ativo quando não há escolha salva, e não dispara `render()` redundante.
- [ ] Nenhuma regressão no custo de `render()`, no declutter de rótulos, nos debounces (busca 150 ms) ou no `_obrasOfCache`.
- [ ] O script de boot inline é mínimo (só a decisão de classe), sem dependência nova, sem bloquear o parse além do necessário.
- [ ] Sem *reflow* / *repaint* em cascata evitável na troca (ex.: não forçar leitura de layout dentro de laço de features).

---

## 5. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| `rgba(var(--white-rgb), …)` / `--ink-rgb` espalhados assumem fundo escuro | Refactor para tokens semânticos `--raise-rgb` / `--shadow-rgb` por tema; revisor de Regressão confere o escuro pixel a pixel |
| Halos de rótulo do mapa ilegíveis no claro | Tokens de texto **e** de halo virando por tema; teste explícito no critério 4.3 |
| `TOKENS` congelado no boot | Handler re-lê `TOKENS` e re-aplica estilos das camadas Leaflet + `stateShape` antes de `render()` |
| Remoção de "Região" deixar handler / rótulo órfão | Critério 4.2 cobre; `REGIOES` / `ce-blocos.json` preservados para reversão |
| *Flash* de tema no load | Script de boot inline como **primeiro elemento do `<body>`** (antes de qualquer conteúdo pintar); o CSS já está no `<head>`, parseado antes do boot rodar. (A menção a "`<head>`" na abordagem original foi ajustada aqui: a decisão de classe roda no topo do `<body>`, o efeito anti-*flash* é o mesmo.) |

---

## 6. Definição de pronto

A Etapa A está pronta quando todos os itens da seção 4 estão marcados e os 4 subagentes revisores retornaram `APROVADO`. Achados não-bloqueantes vão para a lista de follow-up (seção 8), sem impedir o início da Etapa B.

---

## 7. Registro da 1ª rodada de revisão (2026-08-28)

Os 4 revisores rodaram sobre os Blocos 1–7 (ver [`docs/etapa-A-tema-revisores.md`](etapa-A-tema-revisores.md), tabela de resultados).

| Revisor | 1ª rodada | Achado bloqueante |
|---|---|---|
| 1 — Objetivo/Spec | `BLOQUEADO` | Troca de tema não repinta o mapa nem os `style="…"` inline derivados de `TOKENS` — o **Bloco 6 (repintura ao vivo) não tinha sido implementado**. Fere §4.1 e §2.1.3. |
| 2 — Regressão | `BLOQUEADO` | Mesmo achado, confirmado em execução (silhueta do estado presa no verde escuro após a troca). |
| 3 — Design/UX | `BLOQUEADO` | Rótulos do mapa no tema claro abaixo de WCAG AA: contador (`var(--ng)`) verde-sobre-verde em toda a faixa do coroplético; nome (`#2C4139`) abaixo de AA nos preenchimentos fortes e abaixo de 3:1 no *hover*. Fere §4.3. |
| 4 — Performance | `APROVADO` | — (anotou o mesmo item do Bloco 6 como *follow-up* fora da sua alçada). |

### Correções aplicadas (só o que foi apontado)

- **Bloco 6 — repintura ao vivo (`assets/js/mapa-obras.js`).** `TOKENS` deixou de ser lido uma única vez: extraído `readTokens()`; na troca, `Object.assign(TOKENS, readTokens())` + `BASE` re-derivado. Novo `repaintTheme()`: re-lê tokens → `stateShape.setStyle(...)` (o `render()` não re-estiliza a silhueta) → redesenha o modal se estiver aberto (guardada a última obra em `_lastModalObra`) → `render()` **uma vez** (reaplica `styleFeature`/`groupStyle`, rótulos, KPIs, gráficos, painel). `setTheme()` e o sensor do SO passam a chamar `repaintTheme()`. O sensor do SO ganhou guarda: só repinta se o tema efetivo mudou (resolve *follow-up* do revisor 4). Verificado em navegador: silhueta e polígonos trocam de paleta e voltam sem resíduo, sem erro de console, ida e volta idênticas.
- **Contraste dos rótulos do mapa no tema claro (`assets/css/mapa-obras.css`, só sob `:root:not(.theme-dark)`).** Removida a redução `opacity:.8` dos rótulos (comprimia o contraste sobre o verde). `.lbl-name`: `#2C4139` → `#1C2B23`. `.lbl-count`: `var(--ng)` `#0C8A5C` → `#123024`. Halo claro (`--shadow-ink`) mantido/reforçado. Paleta do mapa (Bloco 4) e tema escuro intocados.

### 2ª rodada de revisão (2026-08-28)

R2 Regressão, R3 Design/UX e R4 Performance: `APROVADO`. R1 Objetivo/Spec: `BLOQUEADO` — a mesma classe do bloqueante anterior num ponto que faltou: `STATUS_STATES` (cores dos *dots* de "Situação das obras") é `const` com as cores copiadas de `TOKENS` no *load*, e `repaintTheme()` não as re-derivava.

**Correção:** novo `syncStatusColors()` re-deriva `STATUS_STATES[*].color` de `TOKENS`; `repaintTheme()` o chama após o `Object.assign`. O mesmo padrão foi corrigido em `setStatus()` (o *dot* de "Base de dados", que lê `TOKENS.ng`/`amber` inline): os últimos argumentos ficam em `_lastStatus` e são reexecutados na troca. Verificado em navegador com dados reais: *dots* de status e o *conn-dot* trocam de paleta e voltam sem resíduo, console limpo.

### 3ª rodada de revisão (2026-08-28) — Portão 1 concluído

R1 Objetivo/Spec, R2 Regressão e R4 Performance: `APROVADO`, sem achados bloqueantes. Com o R3 Design/UX (`APROVADO` na 2ª rodada, não afetado por *plumbing* de cor em JS), **os 4 revisores estão em `APROVADO`**. Verificação técnica da Etapa A concluída.

Falta o **Portão 2**: validação prática/visual do usuário. Só com os dois portões a Etapa A é encerrada e a Etapa B (Modal) começa.

---

## 8. Lista de follow-up (não bloqueia a Etapa A / Etapa B)

Registrados pelos revisores na 1ª rodada; tratados depois, sem travar o avanço:

1. **Modal — números verdes da barra divergente** (`color:TOKENS.ng` `#0C8A5C` sobre painel branco = 4,29:1, logo abaixo de 4,5:1 para texto pequeno). Trocar por `--ng-light` no tema claro — exige checar o valor no escuro (cor dual-tema em JS inline).
2. **Script de boot — `catch` força escuro** em qualquer exceção; um `throw` de `matchMedia`/`localStorage` rebaixaria uma preferência `light` salva para escuro naquele *load*. Alinhado com "app principal assume escuro", mas frágil.
3. **Bordas de distrito/município no claro** (`--map-group-border` / `--map-open-border`): contraste 1,8–2,5 sobre o preenchimento; visíveis, porém tênues em projeção.
4. **Marca d'água "CEARÁ"** sobre a forma do estado no nível 0 (contraste ~2,5, ainda menor com opacidade .62): praticamente ilegível. Decorativa, aprovada no Bloco 5.
5. **`title` estático do botão de tema** no HTML ("Alternar tema claro/escuro") é sobrescrito por `syncThemeBtn()` ("Mudar para o tema claro/escuro") assim que o JS roda. Ambos claros; apenas uniformizar se desejado.
6. **Hierarquia dinâmica de rótulos via JS** (destaque no *hover*/seleção): o usuário optou por avaliar só o resultado CSS; possível follow-up futuro, fora da Etapa A.
