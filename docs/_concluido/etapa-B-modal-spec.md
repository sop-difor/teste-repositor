# Etapa B — Modal "Dados do Contrato" · Especificação e Critérios de Aceite

Módulo: **Mapa de Obras Fiscalizadas** (`gecope_mapa_obras.html`, `assets/js/mapa-obras.js`, `assets/css/mapa-obras.css`)
Status: **✅ Etapa B ENCERRADA em 2026-08-29** — os 4 revisores em `APROVADO` (Portão 1) + validação prática/visual do usuário (Portão 2). Re-emendada a partir do modelo `janela_contrato_melhorado/` (ver §7 itens 12–16). Follow-ups não bloqueantes em [`etapa-B-modal-revisores.md`](etapa-B-modal-revisores.md).
Este documento é a rubrica contra a qual os 4 subagentes revisores julgam a entrega da Etapa B.
Etapa anterior: [`etapa-A-tema-spec.md`](etapa-A-tema-spec.md) — **encerrada em 2026-08-28**.

---

## 0. Contexto — onde a Etapa B se encaixa

As melhorias do `gecope_mapa_obras` foram divididas em 4 etapas, uma por vez:

| Etapa | Escopo | Status |
|---|---|---|
| A. Tema | Tema claro/escuro; alternância imediata; limpeza de "Região". | ✅ encerrada |
| **B. Modal** *(este documento)* | Janela "Dados do Contrato" reorganizada em **5 abas** — Resumo (executivo) · Aditivos de valor · Aditivos de prazo · Medições · Fiscalização. | ✅ encerrada 2026-08-29 |
| C. Super filtro + integração | Novos campos de filtro; mapa/painel/lista como sistema; áreas sem match acinzentadas. | pendente |
| D. Entrada | Eliminar a visão "Ceará inteiro"; entrar já nos 11 distritos com animação. | pendente |

### Processo de revisão (igual para todas as etapas)

- Antes da etapa: spec + critérios de aceite por escrito, **aprovados pelo usuário**. Sem código antes disso.
- Ao fim da etapa: 4 subagentes revisores — **Objetivo/Spec · Regressão · Design/UX · Performance**. Cada um devolve `APROVADO` ou `BLOQUEADO + lista`.
- **Encerramento por 2 portões:** (1) os 4 revisores em `APROVADO`; (2) validação prática/visual do usuário. Só com os dois a Etapa C começa.
- Achado não bloqueante → lista de follow-up, não trava a etapa.
- Conflito revisor × spec → a spec vence. Revisor × revisor → o usuário arbitra.
- A cada bloco importante concluído: apresentação ao usuário em linguagem simples e visual.

### Restrições globais (herdadas)

- **Sem novas dependências / bibliotecas.** Hoje: Leaflet (CDN unpkg) + Google Fonts. Nada além disso.
- Página continua **estática e pública** (sem login). Todo dado do banco passa por `escHtml()` antes de ir para a tela — **nenhum ponto novo de `innerHTML` sem escape**.
- **Modo apresentação** continua funcionando; o modal já é usado em projeção.
- **Tema claro e escuro:** o modal já reage aos dois via tokens CSS. A Etapa B **não** pode introduzir cor hardcoded em JS nem em CSS — CSS é a fonte da verdade da paleta; o JS só lê `TOKENS`.
- Não mudar dados, cálculos, IDs de navegação, ordem de elementos fora do modal. O botão de métrica (`#segMetric`) e o de escopo (Carteira/Histórico) não são tocados.

---

## 1. Objetivo da Etapa B

Reorganizar a janela **"Dados do Contrato"** para que a **primeira aba seja um resumo executivo** — legível de relance por um gestor/conselho, com os números que importam agrupados por assunto — mantendo o detalhamento técnico acessível logo abaixo (recolhível) e nas abas seguintes. Hoje a primeira aba ("Dados Gerais") é uma lista cadastral plana; ela vira **"Resumo"**, e os dados cadastrais passam a um bloco **"Detalhes do contrato"** recolhível dentro dela.

O desenho de todas as abas segue o modelo visual **`janela_contrato_melhorado/Resumo do Contrato.dc.html`** (protótipo do usuário; dados fictícios, tema escuro). Da 1ª emenda (2026-08-28) para esta (2026-08-29):
- A antiga aba única **"Aditivos"** vira **duas**: **"Aditivos de valor"** e **"Aditivos de prazo"** → o modal passa a **5 abas**.
- A aba **"Medições"** deixa de ser só um anel e passa a expor a **tabela mensal completa** de `medicoes` + legenda de status.
- O **Resumo** é reorganizado conforme o modelo (cartão de identificação único, 2 cartões de status, faixa de 4 indicadores, curva com grade, "Pontos de atenção", "Detalhes" recolhível).

Acrescenta-se a aba **"Fiscalização"**, com a comissão de fiscalização completa (função, titular, suplente, demais membros) — hoje espremida dentro de "Dados Gerais" atrás de um botão.

E um botão **"📍 Localizar no mapa"** no cabeçalho do modal, que fecha a janela e leva o mapa até a obra.

---

## 2. Escopo

### 2.1 Dentro do escopo

**2.1.1 — Cinco abas** (`data-tab`): `resumo` · `aditivos-valor` · `aditivos-prazo` · `medicoes` · `fiscalizacao`.
Ordem fixa, nessa sequência. "Resumo" é a aba inicial ao abrir o modal. (Emenda 2026-08-29: a antiga aba única "Aditivos" passa a duas — de valor e de prazo — conforme o modelo `janela_contrato_melhorado/`.)

**2.1.2 — Aba "Resumo" (dashboard executivo).** Reescrita em 2026-08-29 a partir do modelo `janela_contrato_melhorado/Resumo do Contrato.dc.html`. Cabeçalho do modal ganha o subtítulo "Resumo executivo do contrato" e um ícone.

Layout (de cima para baixo), tudo **só leitura**, a partir de `raw` / `o` / `o.ficha` / `o.comissao` / **`o.medicoes`** (§3.3):

1. **Cartão de identificação (um só).** "OBJETO DO CONTRATO" + a descrição da obra em destaque; divisória tracejada; grade de 4 colunas — **Município** · **Distrito Operacional** · **Contratada** (razão social + "CNPJ …") · **Fiscalização** (nome do fiscal + "Comissão de N membros"). Funde o que na 1ª versão eram quatro blocos separados (objeto, mini-cartões, contratado/contratante, faixa de fiscalização).
2. **Dois cartões de status lado a lado** — **Situação da obra** e **Situação do contrato**: ponto colorido + rótulo + a **palavra do status** em destaque na cor do status (`TOKENS.status*`) + mini-linha do tempo (data início → data fim; barra de progresso; "N dias restantes" / "Vencido há N dias" na cor certa). Execução: `data_inicio_real → data_fim_previsto`. Contrato: `data_inicio_real → data_fim_vigencia_contrato`. Reusa `prazoCalc`.
3. **Faixa de 4 indicadores:**
   - **Valor atual do contrato** — cartão de destaque (fundo verde), valor grande + "Original: R$ …" abaixo.
   - **Aditivos** — `total_aditivo` em R$ + "+X,X% sobre o valor original" + barrinha (proporção do teto de 25%).
   - **Total medido** — `total_medido` (de `ficha_contrato`) em R$ + "X,X% do valor atual" + barrinha.
   - **Saldo a medir** — `max(0, valor_atual − total_medido)` em R$ + "X,X% do valor atual" + barrinha. *(É o mesmo "Restante a medir" que a aba Medições já mostra.)*
   O anel `donutGauge` e o cartão "Comparativo físico × financeiro" da 1ª versão **saem** — o modelo não os tem.
4. **Cartão "Evolução da medição (%)"** — largura total; gráfico de linha com **linhas de grade** horizontais; cabeçalho à direita "Última medição: {período} · Nª medição". Série = `valor_medido` (acumulado na origem) ÷ `valor_atual` por `periodo` de `o.medicoes`. Uma linha só (não há avanço físico separado na base). Estado vazio: "Sem medições registradas para este contrato."
5. **Cartão "Pontos de atenção"** — lista (2 colunas) de alertas **derivados de valores já exibidos no próprio dashboard**, com marcador colorido por severidade. Regras (limiares de gestão / legais — não são dados novos):
   - `dias_paralisado > 0` → "Obra paralisada há N dias".
   - `prazoCalc` de execução vencido → "Prazo de execução vencido há N dias"; senão, quando `prazoCalc` já marca o prazo como próximo do fim (cor âmbar, ≤ 30 dias restantes — o mesmo limiar das timelines do resto do módulo) → "Prazo de execução encerra em N dias". *(Emenda 2026-08-29: era "≤ 60 dias"; alinhado ao `prazoCalc` existente para não introduzir um limiar novo — decisão registrada no relatório do Bloco 2 e confirmada pelo Revisor 2.)*
   - `prazoCalc` de vigência vencido → "Vigência contratual vencida há N dias".
   - `total_aditivo/valor_original ≥ 25%` → "Aditivos somam X,X% do valor original — acima do limite de 25% do art. 125 da Lei 14.133/2021"; senão ≥ 10% → "Aditivos somam X,X% do valor original".
   - nenhum → "Nenhum ponto de atenção identificado neste contrato."
   Nenhum número novo é calculado — a lista **rotula** valores que já aparecem nos cartões acima. Ver §7 item 12.
6. **"Detalhes do contrato" — bloco recolhível** ao fim, **recolhido por padrão** (`aria-expanded`, `hidden`, padrão `adToggle`). Grade: **Código da obra** · **Tipo de contrato** · **SAC** (`nr_contrato_sic`) · **Data de assinatura** · **Contratante** (razão social) · **CNPJ do contratante** · **Total de reajuste** · **Total realinhado**. (Contratante, reajuste e realinhado saíram dos cartões do topo — ficam aqui, para não se perder informação hoje visível. O Nº do contrato fica no título do modal.)

**Regras da aba Resumo:**
- **Ícones:** conjunto pequeno de **SVG inline** (sem biblioteca nova, sem asset externo), `aria-hidden`, cor por `currentColor` / `var(--...)`.
- **Gráficos:** criar **uma** função de gráfico de linha simples (SVG inline, sem lib), agora com linhas de grade. Nenhuma cor hardcoded — tudo de `TOKENS` / `var(--...)`.
- **Sem conta nova de dinheiro:** % de aditivos / % medido / série da curva são **razões de valores que já existem** (`valor_medido/valor_atual`, `total_aditivo/valor_original`, `percentual_total_medido`). Nada de somar aditivo a aditivo (dinheiro); a curva apenas plota `valor_medido` ÷ `valor_atual` por `periodo`.
- **"Dias paralisado":** aparece no cartão "Situação da obra" (linha de status) e, se `> 0`, também como ponto de atenção — é o **mesmo dado**, não duplicação de layout.
- Todos os campos com "—" quando nulos; todo texto do banco por `escHtml`/`fmtVal`/`fmtCNPJ`/`fmtDateBR`.

**2.1.3 — Aba "Fiscalização".** Move para cá o conteúdo hoje embutido em "Dados Gerais":
- **Fiscal titular** em destaque: nome + função (rótulo classificado por `classifyComissao` — PRESIDENTE / FISCAL / 1º-3º MEMBRO / SUPLENTE).
- **Suplente** (se houver membro classificado como SUPLENTE): nome + função.
- **Comissão completa**: lista de todos os membros, na ordem já usada hoje (`rank` desc: Presidente > Fiscal > 1º/2º/3º Membro > Suplente), cada linha com **função** e **nome**.
- **Matrícula:** **fora do escopo da Etapa B** (decisão do usuário — §7). `comissao_fiscalizacao` traz só `id_obra, nome_completo, nome_referencia, tipo` — sem matrícula nem id de fiscal. A matrícula existe em `app_users` (`matricula, nome, sobrenome, full_name`, `role='fiscal'`), mas o único vínculo possível hoje é **casamento por nome** (fragil — nomes de `app_users` são curtos/sem acento, os da comissão são completos/acentuados; o módulo de Processos precisa de 3 estratégias de match). A Etapa B **não** busca `app_users` nem exibe matrícula. Entra numa etapa futura, quando houver um vínculo confiável (id) no banco. Na aba Fiscalização, cada membro aparece com **função + nome**, sem espaço reservado para matrícula.
- Se a comissão não veio (`comissao_fiscalizacao` indisponível — já tem `.catch` no `loadData`): a aba mostra um estado vazio limpo ("Sem dados de fiscalização para este contrato."), como as abas Aditivos/Medições já fazem.

**2.1.4 — Aba "Aditivos de valor".** A partir do modelo:
- **Faixa de 5 cartões:** Valor original · **Acréscimos** (Σ `valor_aprovado` — já somado hoje para as barras divergentes — + "X,X% do original") · **Supressões** (Σ `valor_supressao` + %) · **Repercussão líquida** (Σ `valor_repercussao` + %) · **Valor atual** (`o.valor` + "N aditivos de valor").
- **Tabela** (visível, não recolhida): por aditivo de valor — Nº (`nr_aditivo`) · NUP / nº do processo (`nr_protocolo`) · Publicação (`data_assinatura`) · Acréscimo · Supressão · Repercussão, cada coluna de valor com uma **pílula de %** sobre o valor original.
- **Widget "Limite legal de acréscimo · art. 125 da Lei 14.133/2021":** barra do acréscimo acumulado (`Σ valor_aprovado / valor_original`) contra 25%; cor por faixa (≥25% `statusStop`, ≥20% `statusWait`, senão `ng`); texto "margem disponível de X,X%" / "limite de 25% atingido".
- **Sai** o gráfico de barras divergentes da 1ª versão (o modelo usa a faixa de cartões + tabela). As somas Σ acréscimo/supressão/repercussão **já são feitas hoje** para as barras — não é conta nova.

**2.1.5 — Aba "Aditivos de prazo".** A partir do modelo — dois cartões grandes, **Prazo de execução** e **Prazo de vigência**, cada um com:
- **Cabeçalho:** Original · Prorrogado · Vigente, em dias. "Vigente" = `prazoCalc(data_inicio_real → data_fim_previsto).totalDays` (execução) / `… → data_fim_vigencia_contrato` (vigência). "Prorrogado" = **Σ `execucao_aprovado`** (execução) / **Σ `prazo_aprovado`** (vigência) dos aditivos de prazo. "Original" = Vigente − Prorrogado.
- **3 mini-cartões:** Data-limite (`data_fim_previsto` / `data_fim_vigencia_contrato`) · Falta para encerrar (`prazoCalc.remainingDays`; "Vencido há N" se negativo) · Prazo decorrido (`prazoCalc.pct` + barra).
- **Tabela:** por aditivo de prazo — Nº · NUP (`nr_protocolo`) · Publicação (`data_assinatura`) · Prorrogação (+N dias, +X% do prazo original) · Prazo acumulado (soma corrente).
- **Barra empilhada** prazo original × prorrogações + legenda + frase-resumo.
- Estado vazio por bloco: "Nenhum aditivo de prazo de execução/vigência registrado."

> **Exceção de cálculo registrada (§7 item 13):** os totais de **dias** de prorrogação (`Σ execucao_aprovado`, `Σ prazo_aprovado`) e a coluna "Prazo acumulado" **somam aditivo a aditivo**. A regra "não somar aditivo a aditivo" continua valendo para **dinheiro** (usa-se `total_aditivo`, coluna autoritativa de `contratos_edificacao`), mas **não há** coluna pré-calculada equivalente para dias de prazo — a soma das linhas é a única fonte, e é auditável linha a linha na própria tabela.

**2.1.6 — Aba "Medições".** De anel para **tabela mensal completa**, a partir do modelo:
- **Faixa de 4 indicadores:** Total medido (`o.ficha.total_medido`) · Saldo da obra (`max(0, valor_atual − total_medido)`) · Percentual executado (`o.ficha.percentual_total_medido`) · Última medição (último `periodo` de `o.medicoes`).
- **Tabela mensal** (de `o.medicoes`): Nr (`nr_medicao`) · STM (`status`) · Período (`periodo`) · Protocolo (`nr_protocolo`) · Medido (`valor_medicao`) · Total (`total`). **Sem STP, sem Glosa, sem Ajuste** — não existem na tabela real (decisão do usuário 2026-08-29 — §7 item 15). Rodapé: Total Medido · Saldo da Obra · Percentual (da ficha, como hoje).
- **Cartão "Legendas de status (STM)":** referência estática dos códigos de `status` (ABE/ACR/AVA/APT/AAS/AFI/ECD/FEC …). Só STM — a coluna STP foi retirada.
- O anel `donutGauge` da 1ª versão sai (o modelo usa a tabela). Os totais do rodapé/faixa continuam vindo de `ficha_contrato` (autoritativo), **não** de somar a tabela.
- Sem `o.ficha` → faixa com "—"; sem `o.medicoes` → tabela com estado vazio "Sem medições registradas para este contrato." (não erro).

**Invariantes das abas de Aditivos e Medições:** os números continuam vindo das mesmas fontes (`total_aditivo`, `ficha_contrato`, e as Σ de valor já feitas hoje para as barras divergentes); a **única** agregação nova permitida é a de **dias** de prazo (§2.1.5 / §7 item 13). Nenhuma informação hoje visível é removida — a tabela de medições, agora exposta, é ganho, não perda. Sem cor hardcoded. Toggles que permanecerem recolhem por padrão com `aria-expanded`.

**2.1.7 — Botão "📍 Localizar no mapa".** No cabeçalho do modal (`.mh`), ao lado do "✕". Ao clicar (decisão do usuário — §7), o comportamento é **exatamente**:
- **fecha o modal**;
- **navega direto para o município da obra** (nível 3, via `goCity` do id do município), pelo mesmo caminho que um clique no mapa já dispara — `render()` uma vez, sem redesenho repetido;
- **mantém os filtros atualmente aplicados** (`st.f` — ano, status, contratada, contratante, fiscal, busca): não os limpa nem os altera;
- **não altera a métrica selecionada** (`st.metric`, Obra/Valor — `#segMetric` intocado);
- **não altera o escopo** (Carteira ativa / Histórico — `st.dataScope`);
- **não limpa seleção nem contexto** além do que a navegação normal para um município já faz: `goCity` já zera a seleção combinada (`st.sel`) ao mudar de nível, exatamente como um clique no mapa — nada a mais é limpo;
- se a obra não tiver município mapeável no CE (caso raro já tratado no `loadData` como "sem município no CE"), o botão fica **desabilitado** com `title` explicativo.

Em resumo: o efeito é idêntico ao de o usuário mesmo clicar naquele município no mapa — nenhum efeito colateral extra sobre filtros, métrica, escopo ou estado.

**2.1.8 — Estrutura e acessibilidade.**
- `role="tablist"` / `role="tab"` / `role="tabpanel"` já existem; manter e estender para as **5 abas**, com `aria-selected` e `aria-controls` corretos.
- Foco: ao abrir o modal, foco no primeiro elemento focável (hoje `#modalX`); `Esc` fecha (já existe); as setas de tab não são obrigatórias (não existem hoje) — **não** regredir o que há.
- `.mtabs` já tem `overflow-x:auto` — **5 abas** devem caber sem quebrar; rola na horizontal se preciso, sem cortar a aba ativa; conferir em 360px de largura e em projeção.
- Tabelas largas (Aditivos de valor, Aditivos de prazo, Medições) rolam dentro do próprio contêiner (`overflow-x:auto`) — o corpo do modal não ganha rolagem horizontal.

### 2.2 Fora do escopo (não é regressão se não estiver aqui)

- **Exceção autorizada (§7 itens 7 e 14):** a Etapa B busca **uma tabela nova** — `medicoes` — usada agora tanto pela curva "Evolução da medição" do Resumo quanto pela **tabela mensal** da aba Medições (§2.1.6). É a **única** tabela nova. Segue o padrão de `aditivos`/`comissão`: fetch no `loadData` filtrado por `id_obra` na carteira ativa (tabela inteira no histórico), com `.catch` que degrada para estado vazio. As colunas lidas de `medicoes` (§3.3) incluem `nr_protocolo`, `total`, `status` além das da curva — é a **mesma** tabela nova, só mais colunas dela; `CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS` seguem intocados. `matrícula` via `app_users`, fotos, documentos e avanço **físico** separado continuam fora.
- **RLS de `medicoes`:** a política de leitura anônima (`for select using(true)`, como as demais tabelas do SIGSOP) será adicionada **no backend pelo usuário** (§7 item 16). A implementação assume que a tabela responde; se não responder, o `.catch` mantém o resto do módulo intacto e as áreas de medição ficam com estado vazio.
- **Matrícula do fiscal fica para uma etapa futura**, quando existir um vínculo confiável (id) entre `comissao_fiscalizacao` e `app_users` — o casamento por nome de hoje é frágil demais para um dado de identificação.
- Qualquer mudança nos filtros, no mapa, no painel lateral, na tela de entrada — Etapas C e D.
- Edição de dados, exportação, impressão dedicada, permalink por contrato.
- Retrofit do modal em outros módulos do GECOPE.
- Mudança de fontes/tipografia global ou de layout estrutural da página.

---

## 3. Abordagem técnica (proposta — revisores podem contestar)

### 3.1 Onde mexe

- **`assets/js/mapa-obras.js`** — `openModal(o)` e auxiliares: `buildResumoPane` (dashboard — §2.1.2) e `buildFiscalizacaoPane` novos; `buildAdValorPane` / `buildAdPrazoPane` (a partir do atual `buildAditivosPane`, dividido) e `buildMedicoesPane` (tabela mensal) **reescritos conforme o modelo**, reusando `prazoCalc` **sem alterar a matemática**; `prazoCalc` já extraído de `timelineGauge`; nova função de **gráfico de linha com grade** (SVG inline, sem lib); conjunto de **ícones SVG inline**; `wireModalTabs` estendido para **5 abas**; handler do botão "Localizar no mapa". `divergingBars` / `donutGauge` deixam de ser chamados pelo modal (o modelo não os usa) — as funções ficam no arquivo, sem remoção.
- **`loadData` / `mapRow`**: adição autorizada — buscar `medicoes` (`fetchMedicoes`, padrão de `fetchAditivos`) e anexar `o.medicoes` (array ordenado por `nr_medicao`/`periodo`), agora com as colunas `nr_protocolo`, `total`, `status` além das da curva. Nada mais em `loadData`/`mapRow` muda; `fetchFiscais`/`fetchAditivos`/`fetchFichas` e as funções de agregação/cálculo **intocadas**.
- **`assets/css/mapa-obras.css`** — regras do `.modal` (novos blocos do Resumo, o toggle "Detalhes do contrato", a aba Fiscalização, o botão "Localizar"). Reuso máximo das classes que já existem (`.msec`, `.mgrid`, `.mkpi`, `.mcomlist`, `.adToggle`).
- **`gecope_mapa_obras.html`** — nada, ou o mínimo. O modal é 100% gerado por `innerHTML` em `openModal`; não há marcação estática de aba no HTML. **Sem reestruturação desnecessária do HTML.**

### 3.2 Regras que não podem ser quebradas

- **`escHtml()` em todo dado do banco.** Todo campo novo exibido (`descricao_tipo_contrato`, `cnpj_*`, nomes de comissão, etc.) passa por `escHtml`/`fmtVal`/`fmtCNPJ`/`fmtDateBR` como os atuais. Zero `innerHTML` com valor cru.
- **Sem cor nova hardcoded.** Status usa `TOKENS.status*` (já lido no boot e re-derivado na troca de tema — ver Etapa A). Se algum indicador do Resumo precisar de cor, ela vem de `TOKENS` ou de `var(--...)` no CSS.
- **Troca de tema com o modal aberto** continua funcionando: a Etapa A fez `repaintTheme()` redesenhar o modal aberto via `openModal(_lastModalObra)`. Os panes novos entram nesse mesmo caminho (são reconstruídos por `openModal`), então **herdam** a repintura. O reset de aba para "Resumo" na troca de tema é o mesmo follow-up já registrado na Etapa A (§8) — não é regressão nova.
- **Idempotência dos listeners:** cada `openModal()` reconstrói o `innerHTML` inteiro e refaz os `.onclick` locais (padrão atual) — nada de `addEventListener` acumulando.

### 3.3 Campos disponíveis (sem buscar nada novo)

De `raw` (linha do `contratos_edificacao`, via `CONTRATOS_COLS`): `descricao_obra`, `descricao_tipo_contrato`, `nr_contrato_ext`, `nr_contrato_sic`, `codigo_obra`, `municipio`, `distrito_operacional`, `status_obra`, `status_contrato`, `valor_original`, `valor_atual_contrato`, `valor_atual`, `total_aditivo`, `total_reajuste`, `total_realinhado`, `dias_paralisado`, `data_assinatura`, `data_inicio_real`, `data_fim_previsto`, `data_fim_vigencia_contrato`, `cnpj_contratada`, `cnpj_contratante`, `contratada`, `contratante`, `atualizado_em`.
De `o` (derivado em `mapRow` + `loadData`): `valor` (com fallback), `objeto`, `comissao` (array `{nome,tipo,rank}`), `aditivos` (array), `ficha` (`{total_medido, percentual_total_medido}`), `municipioTxt`, `id_obra`.
**Nova** — `o.medicoes` (array, de `fetchMedicoes`): por medição — `id_obra`, `nr_medicao`, `periodo`, `nr_protocolo`, `valor_medicao`, `valor_medido` (acumulado), `valor_atual`, `total`, `status`. Ordenado por `nr_medicao`/`periodo`. Vazio/ausente ⇒ curva e tabela de Medições mostram estado vazio (não erro). As colunas `nr_protocolo`, `total`, `status` são da **mesma** tabela nova — não contam como "coluna nova" de `CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS`.
**Colunas inexistentes na tabela real** (não usar; o modelo as mostra só com dado fictício): STP / situação do pagamento, glosa, ajuste.
**Matrícula: não disponível.** Função dos membros: derivada de `tipo` por `classifyComissao`.
**Avanço físico separado: não existe na base** — `medicoes` só tem valor financeiro; a curva do Resumo é uma linha só.

---

## 4. Critérios de aceite — por lente de revisor

### 4.1 Objetivo / Spec

- [ ] O modal tem **5 abas** na ordem Resumo · Aditivos de valor · Aditivos de prazo · Medições · Fiscalização; "Resumo" abre por padrão.
- [ ] A aba **Resumo** segue o dashboard da §2.1.2, na ordem (cartão de identificação único → 2 cartões de status → faixa de 4 indicadores → curva com grade → "Pontos de atenção" → "Detalhes"), tudo preenchido dos dados já carregados (ou "—"/estado vazio quando nulo). Ícones são SVG inline, `aria-hidden`. Cabeçalho com subtítulo "Resumo executivo do contrato".
- [ ] Os **4 indicadores** do Resumo são Valor atual (destaque) · Aditivos (`total_aditivo` + %) · Total medido (`total_medido` + %) · Saldo a medir (`max(0, valor_atual − total_medido)` + %). **Sem anel, sem "comparativo".**
- [ ] A **curva "Evolução da medição"** é uma linha só (`valor_medido/valor_atual` por `periodo` de `o.medicoes`), com **linhas de grade** e estado vazio "sem medições" quando não há dado.
- [ ] O cartão **"Pontos de atenção"** lista alertas por severidade segundo os limiares da §2.1.2 item 5 (paralisada; prazo exec vencido / próximo do fim pelo âmbar do `prazoCalc`; vigência vencida; aditivo ≥25% art. 125 / ≥10%; ou "nenhum ponto de atenção"). **Nenhum número novo** — só rotula valores já exibidos.
- [ ] O bloco **"Detalhes do contrato"** existe ao fim do Resumo, **recolhido por padrão**, expande/recolhe por clique com `aria-expanded` correto, e contém código · tipo · SAC · data de assinatura · **contratante + CNPJ do contratante** · **total de reajuste** · **total realinhado**.
- [ ] A aba **Fiscalização** mostra fiscal titular (nome+função), suplente quando houver, e a comissão completa ordenada (`rank` desc); estado vazio limpo quando não há comissão; **matrícula não aparece** (nem como "—") — está fora do escopo desta etapa.
- [ ] A aba **Aditivos de valor** tem a faixa de 5 cartões (Valor original · Acréscimos · Supressões · Repercussão líquida · Valor atual), a tabela por aditivo de valor (Nº · NUP · Publicação · Acréscimo · Supressão · Repercussão, com pílula de %), e o widget "Limite legal · art. 125" (Σ acréscimo / valor original vs 25%). Somas de valor = as que já existem hoje para as barras divergentes.
- [ ] A aba **Aditivos de prazo** tem os dois cartões (Execução / Vigência) com cabeçalho Original/Prorrogado/Vigente em dias, 3 mini-cartões (Data-limite · Falta para encerrar · Prazo decorrido), tabela por aditivo de prazo (Nº · NUP · Publicação · Prorrogação · Prazo acumulado) e barra empilhada. "Prorrogado" = Σ `execucao_aprovado`/`prazo_aprovado`; "Original" = Vigente − Prorrogado (agregação de **dias** autorizada — §7 item 13).
- [ ] A aba **Medições** tem a faixa de 4 indicadores (da ficha), a **tabela mensal** de `o.medicoes` (Nr · STM · Período · Protocolo · Medido · Total — **sem STP/Glosa/Ajuste**), o rodapé de totais (da ficha) e o cartão "Legendas de status (STM)". Sem `o.medicoes` ⇒ tabela com estado vazio, não erro.
- [ ] Nenhuma informação hoje visível foi removida nas abas de Aditivos/Medições; os números de dinheiro vêm das mesmas fontes de hoje (`total_aditivo`, `ficha_contrato`, Σ de valor já existentes).
- [ ] O botão **"📍 Localizar no mapa"** está no cabeçalho do modal, **fecha o modal** e navega até o **município** da obra (nível 3); **mantém filtros, métrica e escopo**; não limpa mais contexto que a navegação normal; desabilitado com `title` quando a obra não tem município mapeável.
- [ ] "Dias paralisado" aparece no cartão "Situação da obra" e, se `> 0`, também como ponto de atenção — o mesmo dado, sem duplicação de layout.
- [ ] A **única** tabela nova buscada é `medicoes` (via `fetchMedicoes`, padrão de `fetchAditivos`, com `.catch`). Sem `app_users`. Sem coluna nova em `CONTRATOS_COLS`/`COMISSAO_COLS`/`ADITIVOS_COLS`/`FICHA_COLS` (colunas adicionais de `medicoes` são da própria tabela nova).

### 4.2 Regressão

- [ ] `openModal` abre e renderiza corretamente nos **dois temas**, para contratos **com e sem** aditivos, **com e sem** ficha, **com e sem** comissão, **com e sem** medições (`o.medicoes` vazio ⇒ curva mostra estado vazio, não erro).
- [ ] Adicionar `fetchMedicoes` **não quebra `loadData`**: se `medicoes` falhar (RLS/rede), o `.catch` degrada para `o.medicoes = []` e todo o resto do módulo (mapa, painel, outras abas) carrega igual. O cache `sessionStorage` (`cacheKey`) continua consistente (versão do cache sobe se o formato muda).
- [ ] Trocar de aba funciona para as **5**; `hidden`/`aria-selected` corretos; nenhum dado hoje visível some na reorganização; os valores de dinheiro exibidos nas abas de Aditivos e Medições são exatamente os de hoje (comparar contrato a contrato — as fontes `total_aditivo`/`ficha_contrato`/Σ de valor não mudaram).
- [ ] `Esc` fecha; clique no fundo fecha; `#modalX` fecha — como hoje.
- [ ] Trocar o tema com o modal aberto redesenha o modal nos dois sentidos, sem cor presa (herda o `repaintTheme` da Etapa A).
- [ ] `escHtml()` / `fmtCNPJ` / `fmtDateBR` aplicados a **todo** campo do banco no modal; nenhum `innerHTML` novo com dado cru (conferência de código).
- [ ] `node --check` sem erro; sem `id` duplicado (o modal não deve introduzir `id` fixo que colida — os `id` internos do modal são recriados a cada `openModal`, conferir que não há choque com os 41 `id` estáticos da página).
- [ ] Nada fora do modal muda: mapa, painel, filtros, navegação, `#segMetric`, Carteira/Histórico, breadcrumb, modo apresentação — idênticos.
- [ ] Após "Localizar no mapa": `st.f` (filtros), `st.metric`, `st.dataScope` **inalterados**; o estado do mapa é o mesmo de um clique manual naquele município (comparar os dois caminhos).
- [ ] Console sem erro ao: abrir o modal (vários contratos), trocar de aba, expandir "Detalhes do contrato", clicar "Localizar no mapa", trocar de tema com o modal aberto — nos dois temas.
- [ ] `assets/geo/*.json` inalterados.

### 4.3 Design / UX

- [ ] A aba Resumo é **escaneável**: um gestor identifica valor, avanço, prazo e fiscal em segundos; hierarquia visual clara entre cartões, rótulos e valores; os gráficos (2 anéis, 1 linha, 2 timelines, barras) são leves e legíveis, sem poluição.
- [ ] Contraste de todo texto do modal ≥ WCAG AA (normal 4,5:1; grande 3:1) nos **dois temas**, em todas as superfícies do modal — inclusive texto sobre o cartão de destaque (fundo verde) e rótulos de eixo/legenda dos gráficos.
- [ ] As **5 abas** cabem sem quebra feia em 360px e em projeção (tipografia do modo apresentação); `.mtabs` rola horizontalmente se preciso, sem cortar a aba ativa. As tabelas largas (Aditivos de valor/prazo, Medições) rolam dentro do próprio contêiner — o corpo do modal não rola na horizontal.
- [ ] O bloco "Detalhes do contrato" comunica claramente que é expansível (cursor, ícone ▾/▴, `aria-expanded`), e recolhido não deixa "buraco" no layout.
- [ ] O botão "Localizar no mapa" é reconhecível (ícone + rótulo curto), com `title`/`aria-label`, e seus estados hover/focus/disabled são coerentes com os outros botões do modal nos dois temas.
- [ ] Estados vazios (sem aditivo / sem ficha / sem comissão) são limpos e informativos, não erro.
- [ ] As abas Aditivos de valor, Aditivos de prazo e Medições ficaram **escaneáveis** (indicador-chave / cartões primeiro, tabela depois); as tabelas e a barra "art. 125" / barras empilhadas são legíveis nos dois temas; a tabela mensal de Medições rola sem cortar cabeçalho.

### 4.4 Performance

- [ ] `openModal` continua sendo **uma** construção de `innerHTML` + religamento de listeners locais; nenhum laço sobre todos os contratos/municípios dentro do modal. A curva percorre só `o.medicoes` de **um** contrato (poucas dezenas de linhas).
- [ ] Nenhuma requisição de rede disparada ao abrir o modal, trocar de aba ou clicar "Localizar" (as medições já vêm no `loadData`, junto de aditivos/comissão).
- [ ] `fetchMedicoes` não piora perceptivelmente o `loadData`: é paralelo aos outros fetches (`Promise.all`), filtrado por `id_obra` na carteira ativa; no histórico completo é uma tabela a mais, no mesmo padrão já aceito para aditivos.
- [ ] "Localizar no mapa" reusa o caminho de navegação existente (`goCity` + `render()` uma vez), sem redesenho repetido.
- [ ] As 5 abas e os blocos novos (curva com grade, "Pontos de atenção", tabelas de aditivos, tabela mensal de Medições) não pioram o tempo de abertura do modal de forma perceptível (medir com o modal de um contrato com muitos aditivos + comissão grande + muitas medições).
- [ ] Sem leitura de layout em laço (`getBoundingClientRect`/`offsetWidth`) na montagem do modal.

---

## 5. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Aba Resumo (dashboard) ficar poluída / lenta de ler | Critério 4.3 ("escaneável em segundos", gráficos leves); validação visual do usuário; modelo de referência do usuário como norte |
| `medicoes` sem RLS anônima → curva **e tabela de Medições** vazias em produção | `.catch` degrada para estado vazio (o resto do módulo não sente); a política `for select using(true)` em `medicoes` será adicionada **no backend pelo usuário** (§7 item 16) — pendência de backend, não bloqueia a Etapa B |
| `medicoes` inchar o `loadData` no histórico completo | Mesmo padrão de `aditivos` (tabela inteira, colunas mínimas, paralelo); critério 4.4 mede |
| Curva sugerir avanço **físico** que a base não tem | Rótulo honesto: "Evolução da medição (%)", uma linha só; §2.1.2 e 4.1 travam a interpretação |
| "Pontos de atenção" parecer um cálculo/juízo novo | §7 item 12: só rotula valores já exibidos nos cartões (dias paralisado, % de aditivo, dias de prazo) com limiares legais/de gestão fixos; nenhum número novo; revisor 2 confere |
| Split Aditivos → valor/prazo introduzir erro de cálculo ou perder um dado | Invariantes da §2.1.4–§2.1.6 + critérios 4.1/4.2: dinheiro segue vindo de `total_aditivo` e das Σ já existentes; só a agregação de **dias** é nova (§7 item 13), auditável linha a linha |
| Tabela mensal de Medições mostrar coluna sem dado | §7 item 15: só Nr · STM · Período · Protocolo · Medido · Total (o que existe em `medicoes`); STP/Glosa/Ajuste não entram |
| Matrícula ausente / vínculo por nome frágil | Fora do escopo da Etapa B (§2.2 + §7); entra quando houver id de vínculo confiável |
| "Localizar no mapa" quebrar a navegação do mapa | Reusa `goCity` + o caminho de clique já existente; critério 4.2 cobre "nada fora do modal muda" |
| `id` interno do modal colidindo com `id` estático da página | 4.2 cobre; manter o prefixo `m...`/`mAd...` já usado |
| Cor hardcoded entrando junto com um "selo" novo no Resumo | Regra global + 4.1/4.3; selo usa `TOKENS`/`var(--...)` |

---

## 6. Definição de pronto

A Etapa B está pronta quando todos os itens da seção 4 estão marcados, os 4 subagentes revisores retornaram `APROVADO`, **e** o usuário deu a validação prática/visual. Achados não bloqueantes vão para uma lista de follow-up anexa, sem impedir o início da Etapa C.

---

## 7. Confirmações registradas (2026-08-28)

Decisões do usuário que fixam o escopo da Etapa B:

1. **Matrícula do fiscal — fora do escopo desta etapa.** A matrícula existe em `app_users` (`role='fiscal'`), mas o único vínculo com `comissao_fiscalizacao` hoje é casamento por nome (frágil). A Etapa B não busca `app_users` nem exibe matrícula; entra numa etapa futura, com um id de vínculo confiável. Na aba Fiscalização: **função + nome** por membro.
2. **"📍 Localizar no mapa" — fecha o modal e vai ao município** da obra (nível 3).
3. **Abas Aditivos e Medições — "alinhar + repensar a ordem".** Recebem a linguagem visual do Resumo e a ordem "indicador-chave no topo → gráfico/detalhe → listas recolhíveis". **Sem mudar número, cálculo ou gráfico; sem remover informação.** *(Substituído em 2026-08-29 pelos itens 14–15: as abas seguem agora o modelo — split de Aditivos e tabela mensal de Medições; o princípio "sem mudar número de dinheiro / sem remover informação" continua.)*
4. **Bloco "Financeiro" do Resumo — todos os 6 valores:** valor original, valor atual, total em aditivos (R$ e %), total de reajuste, total realinhado, total medido (R$ e %). *(Adaptado em 2026-08-29: os 4 indicadores do modelo cobrem valor atual, original, aditivos R$/% e total medido R$/%; **total de reajuste** e **total realinhado** passam para o bloco recolhível "Detalhes do contrato" — continuam visíveis, sem remoção.)*

**Refinamentos registrados na aprovação da spec (2026-08-28):**

5. **"Dias paralisado" no Resumo — sem duplicação visual excessiva.** *(Adaptado em 2026-08-29 ao layout do modelo — §2.1.2 reescrita: aparece no cartão **"Situação da obra"** como a linha de status quando `dias_paralisado > 0`, e, se `> 0`, também como **ponto de atenção**. É o mesmo dado em dois lugares que servem a leituras diferentes — não é duplicação de layout.)*
6. **"📍 Localizar no mapa" — sem efeitos colaterais na navegação.** O botão: fecha o modal; mantém os **filtros** aplicados; navega **direto ao município** da obra; **não altera a métrica** (Obra/Valor) nem o **escopo** (Carteira/Histórico); **não limpa seleção/contexto** além do que a navegação normal para um município já faz. Efeito idêntico a clicar naquele município no mapa.

**Emenda do Resumo a partir de um modelo visual do usuário (2026-08-28):**

7. **A aba "Resumo" passa a ser um dashboard executivo** (§2.1.2 reescrita) com cartões e alguns gráficos leves — objeto, contratado/contratante, 4 indicadores (valor de destaque, total medido, anel de execução, comparativo), curva de medição + 2 timelines de prazo, faixa de fiscalização, "Detalhes do contrato". Ícones = **SVG inline** (sem biblioteca). Isso **substitui** a regra anterior "sem gráfico novo no Resumo" e o **Bloco 2 será refeito** com este desenho.
8. **Anel "Execução da obra" = `percentual_total_medido`** (o mesmo % da medição, reapresentado como avanço). Não há avanço físico separado na base.
9. **Curva "Evolução da medição"** — autorizada a **buscar a tabela nova `medicoes`** (única exceção à regra "sem tabela nova" da Etapa B). É **uma linha** (`valor_medido/valor_atual` por `periodo`); não há série física. Se a RLS anônima de `medicoes` não existir, a curva fica vazia e isso vira **pendência de backend** (não bloqueia a Etapa B).
10. **"Detalhes do contrato"** (fim do Resumo, **recolhido por padrão**): código da obra, tipo de contrato, SAC, data de assinatura, e demais campos cadastrais fora dos cartões. O Nº do contrato fica no título do modal.
11. **Link "Ver detalhes da fiscalização →"** no Resumo **troca para a aba Fiscalização** (não abre sub-toggle).

**Re-emenda a partir do modelo `janela_contrato_melhorado/` (2026-08-29) — respostas do usuário:**

12. **"Pontos de atenção" no Resumo** — lista de alertas por severidade, **derivada de valores já exibidos no dashboard** (dias paralisado; % de aditivo vs 25% do art. 125 / vs 10%; dias de prazo restantes vs 60; vigência vencida). **Não calcula número novo** — rotula o que já está nos cartões, com limiares legais/de gestão fixos. Autorizada como parte do modelo.
13. **Aditivos de prazo — agregação de dias permitida.** `Σ execucao_aprovado` / `Σ prazo_aprovado` e a coluna "Prazo acumulado" **somam aditivo a aditivo**. A regra "não somar aditivo a aditivo" segue valendo para **dinheiro** (usa-se `total_aditivo`, coluna autoritativa); para **dias de prazo** não existe coluna pré-calculada equivalente — a soma das linhas é a única fonte e é auditável linha a linha na tabela.
14. **Modal com 5 abas + `medicoes` com mais colunas.** A antiga aba única "Aditivos" passa a **"Aditivos de valor"** e **"Aditivos de prazo"** (ordem: Resumo · Aditivos de valor · Aditivos de prazo · Medições · Fiscalização). A tabela nova `medicoes` (já autorizada — item 9) passa a ser lida também com `nr_protocolo`, `total`, `status` (mesma tabela, mais colunas dela). O **Resumo** é reorganizado conforme o modelo (§2.1.2 reescrita): cartão de identificação único → 2 cartões de status → 4 indicadores (Valor atual · Aditivos · Total medido · **Saldo a medir**) → curva **com linhas de grade** → "Pontos de atenção" → "Detalhes". **Saem** o anel `donutGauge` e o cartão "comparativo" da 1ª emenda; o donut da aba Medições e as barras divergentes da aba Aditivos também saem (o modelo não os usa).
15. **Aba Medições — tabela mensal completa** de `o.medicoes`: Nr · STM (`status`) · Período · Protocolo (`nr_protocolo`) · Medido (`valor_medicao`) · Total (`total`). **Sem STP, Glosa, Ajuste** — não existem na tabela real (decisão do usuário). Faixa/rodapé de totais seguem vindo de `ficha_contrato`. Cartão "Legendas de status (STM)".
16. **RLS de `medicoes`** — a política de leitura anônima (`for select using(true)`) será adicionada **no backend pelo usuário**. A implementação assume que a tabela responde; o `.catch` cobre o caso de falha (o resto do módulo não sente).
