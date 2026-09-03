# Etapa A — Tema Claro/Escuro · Configuração dos 4 Revisores

Spec de referência: [`docs/etapa-A-tema-spec.md`](etapa-A-tema-spec.md) — aprovada em 2026-08-28
Plano de implementação: [`docs/etapa-A-tema-plano.md`](etapa-A-tema-plano.md)

---

## Natureza deste documento

- **Nenhum código é alterado agora.** Este documento define **como a Etapa A será revisada** depois de implementada.
- Serve como guia: quando a implementação terminar (bloco 8 do plano), 4 revisores independentes conferem o trabalho contra critérios escritos e devolvem `APROVADO` ou `BLOQUEADO`.
- O usuário revisa e aprova este documento **antes** de o plano virar tarefas de implementação.

---

## Como a revisão funciona

1. **Quando roda:** ao final da Etapa A inteira (depois do bloco 8 do plano), não a cada bloco. Durante a implementação, o acompanhamento bloco a bloco é feito com o usuário em linguagem simples e de forma visual quando possível (ver plano, "Como o acompanhamento vai funcionar"); os revisores são a checagem técnica formal do conjunto.
2. **Quem roda:** 4 subagentes independentes, um por lente — **Objetivo/Spec**, **Regressão**, **Design/UX**, **Performance**. Rodam em paralelo, sem ver o resultado um do outro.
3. **O que cada um recebe:**
   - A spec aprovada (`docs/etapa-A-tema-spec.md`).
   - Este documento.
   - A lista de arquivos alterados + um resumo em linguagem clara do que mudou.
   - Acesso de leitura ao repositório (código antes e depois).
4. **O que cada um devolve:** um veredito `APROVADO` **ou** `BLOQUEADO`, seguido de:
   - **Achados bloqueantes** (impedem o avanço): descrição, onde, por que fere a spec, e o que precisa mudar.
   - **Achados não bloqueantes** (não impedem): vão para uma lista de *follow-up* anexada à spec, tratados depois sem travar a Etapa B.
5. **Decisão final da Etapa A — dois portões obrigatórios:** (a) **os 4 revisores em `APROVADO`** (validação técnica); e (b) a **validação prática e visual do usuário** (percepção, no uso real, de que o resultado esperado foi obtido). Só com os dois cumpridos avança para a Etapa B (Modal).
6. **Ciclo de correção:** cada achado bloqueante → a correção é feita **apenas naquilo** → os revisores afetados rodam de novo → repete até os 4 aprovarem.
7. **Conflitos:**
   - Revisor contra a spec escrita → **a spec vence** (o revisor registra a divergência como não bloqueante, para o usuário decidir se quer mudar a spec no futuro).
   - Revisor contra revisor → **o usuário arbitra**.
8. **Limite de alçada:** um revisor **não** pode bloquear por gosto pessoal fora dos critérios escritos, nem por algo que a spec marcou como fora de escopo (janela do contrato, filtros, tela de entrada). Preocupações desse tipo são registradas como "fora de escopo — Etapa B/C/D", nunca como bloqueio.

---

## O que é "bloqueante" e o que é "follow-up"

| Bloqueante (trava a Etapa A) | Follow-up (não trava) |
|---|---|
| Um critério de aceite da spec não cumprido | Uma melhoria de acabamento que a spec não exige |
| Tema escuro com diferença **perceptível** em relação ao atual | Ajuste fino de cor no tema claro que ninguém notaria sem comparar |
| Algo que funcionava e parou de funcionar (nos dois temas) | Ideia de refinamento para uma etapa futura |
| Erro técnico no "console"; brecha de segurança nova | Sugestão de organização interna do código sem efeito visível |
| Texto ilegível / contraste abaixo do padrão AA | Preferência estética pessoal sem base num critério escrito |
| "Piscada" de tema no carregamento; pedaço do mapa preso no tema anterior após a troca | — |

---

## Revisor 1 — Objetivo / Spec

**Pergunta que ele responde:** "Foi feito exatamente o que a spec pediu?"

**Confere (base: seção 4.1 da spec):**
- Existe um botão de alternância sol/lua no cabeçalho, no grupo à direita, com texto de ajuda (`title`/`aria-label`) claro; funciona no clique **e** pelo teclado.
- Primeiro acesso, sem preferência guardada: o módulo abre no tema que corresponde à configuração claro/escuro do computador. Testado nos dois estados do computador.
- Depois de clicar no botão: a escolha persiste ao fechar e reabrir a página, e passa a valer mais que a configuração do computador.
- Com uma escolha já guardada: mudar a configuração do computador **não** altera o módulo. Sem escolha guardada: mudar a configuração do computador altera o módulo ao vivo.
- A troca é **imediata**, sem recarregar, e muda numa ação só: mapa, rótulos, painel, gráficos, janela do contrato e caixinhas de informação.
- A preferência é gravada na **mesma gavetinha** que o resto do GECOPE usa (`gecope_theme`, valores `dark`/`light`) e usa a **mesma etiqueta** (`theme-dark`) — abrir o app principal depois reflete a mesma escolha.
- "Região" não aparece mais em lugar nenhum da interface. O caminho é Distrito Operacional → Município → Obra. Os arquivos de dados de região continuam no repositório, sem alteração.

**Aprova se:** todos os itens acima verificados.
**Bloqueia se:** qualquer item não cumprido, ou cumprido só em parte.

---

## Revisor 2 — Regressão

**Pergunta que ele responde:** "Quebrou, mudou ou piorou alguma coisa que já funcionava?"

**Confere (base: seção 4.2 da spec):**
- **Tema escuro idêntico ao atual.** Comparação lado a lado (antes x depois) de todas as telas: mapa nos 3 níveis, painel lateral completo, janela do contrato nas 3 abas atuais e seus gráficos internos (anel de medição, barras de aditivo, linha do tempo do prazo), painel de filtros e listas de seleção, trilha de navegação, menuzinho de "outros distritos", tela de erro, animação de "carregando". **Nenhuma diferença perceptível.**
- Navegação Distrito → Município → Obra; trilha; menuzinho de "outros distritos"; seleção combinada (Ctrl+clique); botão "Obra/Valor"; botão "Carteira ativa/Histórico"; tela cheia; modo apresentação — **tudo funciona nos dois temas**.
- A janela do contrato abre e é exibida corretamente nos dois temas, com os gráficos internos intactos.
- A "higienização" de dados vindos do banco continua em todos os pontos (o módulo é público; nenhum texto do banco pode chegar à tela sem tratamento). Nenhum ponto novo de inserção de conteúdo sem tratamento.
- Cache do navegador, carregamento de dados e telas de erro continuam se comportando igual.
- Verificação técnica: checagem de sintaxe dos scripts sem erro; nenhum identificador duplicado na página; nenhuma "ponta solta" deixada pela remoção do botão "Região".
- "Console" sem erros em: carregamento a frio, troca de tema, abertura da janela do contrato, passar o mouse no mapa, uso da busca — **nos dois temas**.
- Os arquivos `assets/geo/ce-referencia.json` e `assets/geo/ce-blocos.json` aparecem como **não modificados**.

**Aprova se:** o escuro está idêntico, nada quebrou nos dois temas, verificação técnica limpa.
**Bloqueia se:** qualquer diferença perceptível no escuro; qualquer função que parou; erro técnico; ponta solta; arquivo de dados de região alterado.

---

## Revisor 3 — Design / UX

**Pergunta que ele responde:** "O tema claro ficou bom, legível e coerente — inclusive projetado?"

**Confere (base: seção 4.3 da spec):**
- O tema claro é uma paleta **desenhada**, não um fundo branco chapado: hierarquia visual preservada (o que chama a atenção no claro é o mesmo que chama no escuro).
- Contraste de todos os textos dentro do padrão de acessibilidade AA (texto normal 4,5:1; texto grande 3:1), em todas as superfícies.
- "Mapa de calor" legível no claro: dá para distinguir os níveis de intensidade; as linhas de divisão de município/grupo são visíveis sobre o preenchimento; a base é compatível com o efeito de "área acinzentada" que a Etapa C vai introduzir.
- Rótulos do mapa (nome + contador) legíveis sobre **qualquer** cor do mapa no tema claro — sem texto claro sumindo no fundo claro.
- Caixinha de informação, botões de zoom, selo de status, botões do cabeçalho, chips e cartões: efeitos de passar o mouse / foco / selecionado coerentes nos dois temas.
- **Sem "piscada"** do tema errado no carregamento.
- O ícone do botão comunica de forma óbvia para qual tema ele leva, com texto de ajuda.
- Aparência sólida em **projeção**: testado em tela cheia, com a tipografia maior do modo apresentação.

**Aprova se:** paleta clara coerente e legível, mapa e rótulos legíveis no claro, sem piscada, ok em projeção.
**Bloqueia se:** contraste abaixo do padrão; rótulo ou texto ilegível; hierarquia visual quebrada; piscada de tema; tema claro que parece "inversão automática" e não paleta desenhada.

---

## Revisor 4 — Performance

**Pergunta que ele responde:** "Ficou rápido? A troca é instantânea e nada ficou mais lento?"

**Confere (base: seção 4.4 da spec):**
- A troca de tema executa em tempo imperceptível; as operações de redesenho do mapa e de atualização do painel são chamadas **uma vez** por troca, não em repetição.
- O "sensor" da configuração do computador só fica ativo enquanto **não** há escolha guardada, e não dispara atualização de tela redundante.
- Nenhuma piora no custo de redesenhar a tela, no algoritmo que reorganiza os rótulos do mapa para não colidirem, nas pausas de digitação da busca, nem no cache interno de contagens por município.
- O trecho que decide o tema no carregamento é mínimo (só define a etiqueta), sem dependência nova, sem atrasar a abertura da página além do necessário.
- Na troca, nenhum recálculo de layout em cascata evitável (por exemplo, ler medidas da tela dentro de um laço item a item).

**Aprova se:** troca instantânea, sem operação repetida à toa, nada mais lento que antes.
**Bloqueia se:** troca com travadinha perceptível; redesenho disparado em repetição; "sensor" ativo mesmo com escolha guardada; regressão mensurável em qualquer caminho de desempenho.

---

## Registro de resultados (preenchido na revisão)

### 1ª rodada — 2026-08-28 (sobre os Blocos 1–7)

| Revisor | Veredito | Achados bloqueantes | Follow-up |
|---|---|---|---|
| 1 — Objetivo/Spec | `BLOQUEADO` | `setTheme()` não repinta o mapa nem os `style` inline de `TOKENS` (Bloco 6 não implementado) — fere §4.1 / §2.1.3 | spec §5 diz "`<head>`", implementação no `<body>` (inconsistência do texto); `title` estático sobrescrito por `syncThemeBtn()` |
| 2 — Regressão | `BLOQUEADO` | Mesmo achado, confirmado em execução (silhueta do estado presa no verde escuro após a troca) | 6 tokens novos inseridos dentro do bloco `:root` (resolvem idênticos no escuro — "Plano B" opcional); `catch` do boot força escuro |
| 3 — Design/UX | `BLOQUEADO` | Rótulos do mapa no claro < WCAG AA: contador verde-sobre-verde em toda a faixa do coroplético; nome < AA em fills fortes e < 3:1 no *hover* — fere §4.3 | bordas de distrito tênues na projeção; números verdes da barra divergente do modal a 4,29:1; marca d'água "CEARÁ" ilegível (decorativa) |
| 4 — Performance | `APROVADO` | — | mesmo item do Bloco 6, fora da alçada; `_onOsThemeChange` chamava `applyThemeClass` incondicionalmente |

**Correções aplicadas (só o apontado):** Bloco 6 implementado — `readTokens()` + `repaintTheme()` (re-lê `TOKENS`, `stateShape.setStyle`, redesenha modal aberto, `render()` uma vez) em `setTheme()` e no sensor do SO, este com guarda de mudança efetiva. Contraste dos rótulos no claro: sem `opacity:.8`, `.lbl-name` → `#1C2B23`, `.lbl-count` → `#123024`. Detalhe em [`etapa-A-tema-spec.md`](etapa-A-tema-spec.md) §7.

### 2ª rodada — 2026-08-28 (sobre a repintura ao vivo + contraste dos rótulos)

| Revisor | Veredito | Achados bloqueantes | Follow-up |
|---|---|---|---|
| 1 — Objetivo/Spec | `BLOQUEADO` | "Situação das obras" (dots) não reestilizada na troca ao vivo: `STATUS_STATES` é `const` com as cores copiadas de `TOKENS` no load; `repaintTheme()` reescrevia `TOKENS` mas não `STATUS_STATES`. Fere §4.1 (reestiliza gráficos numa única ação). | — |
| 2 — Regressão | `APROVADO` | — | Trocar o tema com o modal aberto reconstrói o modal e a aba ativa volta para "Dados Gerais" (consequência de capacidade nova; aceitável) |
| 3 — Design/UX | `APROVADO` | — | itens já na §8 (bordas tênues, marca d'água "CEARÁ") |
| 4 — Performance | `APROVADO` | — | `render()`=1, `setStyle`=1 por troca, sem laço; sensor do SO com guarda de mudança efetiva |

**Correção aplicada (só o apontado):** novo `syncStatusColors()` re-deriva `STATUS_STATES[*].color` de `TOKENS`; `repaintTheme()` o chama após o `Object.assign`. Mesma classe de bug corrigida também em `setStatus` (dot de "Base de dados", que lê `TOKENS.ng`/`amber` inline): últimos args guardados em `_lastStatus` e reexecutados na troca. Verificado em navegador (dados reais, cache): dots de status `#2F7DB8/#B0730C/#C5372F` (claro) ↔ `#3C87C9/#FAB219/#D03B3B` (escuro) e conn-dot `#0C8A5C` ↔ `#2FE6A0`, ida e volta idênticas, console limpo.

### 3ª rodada — 2026-08-28 — R1, R2, R4 (R3 não é afetado pela correção de *plumbing* de cor em JS; veredito `APROVADO` da 2ª rodada mantido)

| Revisor | Veredito | Achados bloqueantes | Follow-up |
|---|---|---|---|
| 1 — Objetivo/Spec | `APROVADO` | nenhum | reset de aba do modal na troca (já na §8); `title` estático vs `syncThemeBtn` (§8 item 5) |
| 2 — Regressão | `APROVADO` | nenhum | nenhum |
| 4 — Performance | `APROVADO` | nenhum | `_lastStatus={…}` passou a alocar um objeto pequeno por chamada de `setStatus` — custo imensurável, só rastreio |

### Resultado final da revisão técnica (Portão 1)

**Os 4 revisores em `APROVADO`:** R1 Objetivo/Spec (3ª rodada), R2 Regressão (3ª rodada), R3 Design/UX (2ª rodada), R4 Performance (3ª rodada). Achados de *follow-up* consolidados na spec §8.

**Etapa A concluída quando:** os 4 vereditos = `APROVADO` (✅ **cumprido**) **e** o usuário deu a validação prática/visual (✅ **cumprido — usuário aprovou em 2026-08-28**). Achados de follow-up migram para a spec como lista anexa (§8) e são tratados depois, sem travar a Etapa B.

## ✅ Etapa A ENCERRADA (2026-08-28) — os dois portões cumpridos. Próxima: Etapa B (Modal).
