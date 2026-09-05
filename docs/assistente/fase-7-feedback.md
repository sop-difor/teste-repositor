# F7 — Feedback + observabilidade

**Objetivo:** o usuário consegue avaliar cada resposta (👍/👎); isso fica gravado no mesmo
log que já existe desde a F1; e existe uma página simples para ver o uso e as falhas, com
uma rotina documentada para transformar o que se repete em intenção nova (F5) ou caso de
eval (F3).

Decisões do usuário (05/09/2026): painel numa página nova e simples
(`assistente-painel.html`), sem checagem de cargo — qualquer pessoa logada no GECOPE com o
link consegue abrir. Restringir por cargo fica para quando o piloto (F8) começar de verdade.

## Escopo desta fase (README: 👍/👎 + campo veredito no log; painel de uso/falhas; rotina
"falha → intenção ou caso de eval")

### 1. Coluna `veredito` em `consultas_ia_log` (`sql/assistente/f7_feedback.sql`)

`text`, com `check (veredito in ('positivo','negativo'))`, nula por padrão (a maioria das
perguntas nunca recebe voto — não é obrigatório). Sem mudança de RLS: a tabela já é
"só service_role escreve" desde a F1; o `UPDATE` do veredito continua passando pela Edge
Function, nunca direto do navegador.

### 2. Feedback via a mesma Edge Function (`index.ts`)

Em vez de criar uma função nova só para isso, a função `gecope-assistant` passa a aceitar
dois formatos de corpo: `{ pergunta }` (o de sempre) ou `{ tipo: "feedback", logId,
veredito }`. A autenticação é a mesma (JWT real, F1). O `UPDATE` só é aplicado se o
`usuario` do log bater com o usuário autenticado — ninguém vota na pergunta de outra
pessoa.

As duas respostas que representam uma resposta de verdade (motor de intenções e Gemini
com SQL executado) passam a devolver `logId` no JSON — as únicas que ganham botão de
👍/👎 no front-end. Esclarecimento, degradação e erro não têm "uma resposta" para avaliar.

### 3. Botões 👍/👎 (`assistente.html`)

Aparecem só nas respostas com `logId`. Ao votar, desabilita os dois botões e destaca o
escolhido (evita voto duplicado/trocado sem recarregar a página — reenviar depois de
recarregar sobrescreve o voto anterior, comportamento aceitável para o piloto).

### 4. Painel de uso/falhas (`assistente-painel.html` + nova função
`gecope-assistant-painel`)

Página nova, mesmo login do GECOPE (sem checagem de cargo). Uma função de leitura
separada (só `SELECT`, roda com a `service_role`, exige JWT válido) devolve:
- números gerais: total de perguntas, % resolvidas pelo motor de intenções vs. IA,
  contagem de 👍/👎;
- a lista das perguntas que falharam ou levaram 👎 (mais recentes primeiro), com a
  pergunta, de onde veio, o erro (se houver) e o veredito — a matéria-prima da rotina
  abaixo.

### 5. Rotina "falha → intenção ou caso de eval"

Documentada em `docs/assistente/rotina-revisao-falhas.md` — processo manual periódico
(quem usa o painel decide a frequência), não automatizado: abrir o painel, olhar as
perguntas problemáticas, e para cada uma decidir entre (a) se é uma pergunta que devia ter
resposta rápida e se repete, virar uma intenção nova (padrão da F5); (b) se é um caso que
o caminho LLM deveria acertar e não acertou, virar um caso novo em `casos.jsonl` (padrão
da F3), para não regredir; (c) se é claramente fora do escopo do assistente, não fazer
nada — a degradação já está certa.

## Fora do escopo desta fase

- Checagem de cargo/permissão no painel — decisão explícita do usuário, revisitar na F8.
- Comentário livre junto do 👎 (só o voto positivo/negativo por enquanto).
- Qualquer automação da rotina de revisão (ela é manual, documentada, não um cron/rotina
  de código).
