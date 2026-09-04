# F3 — Harness de avaliação · Revisão

4 lentes, subagentes independentes, contexto limpo, sobre o commit `04d5402` (diff
`541d176..04d5402`). Lentes ajustadas para esta fase (ver "Revisão desta fase" em
[`fase-3-eval.md`](fase-3-eval.md)): `rev-produto` mais leve, `rev-correcao` com foco
extra em gabarito + o eval realmente barrando o que precisa barrar.

## Vereditos

| Lente | Veredito |
|---|---|
| `rev-seguranca` | **APROVADO** — corpo de `executar_consulta_ia` em produção conferido idêntico ao da F2 (nenhuma regressão); `EXECUTE` continua só para `service_role`/`gecope_ia_readonly`; `deno test` rodado ao vivo (38/38); bugfix de `motor_intencoes.ts` confirmado como matching de nome de empresa, sem relação com nenhuma guarda; sem segredo commitado; sem dado fora do escopo nos casos de teste. |
| `rev-correcao` | **APROVADO** — reproduziu de forma independente todos os números alegados (`deno test` 38/38, `deno check` limpo, `deno task eval` 14/14 + 8/8, gabarito conferido em 16/34 casos via SQL própria, zero divergência); testou o bugfix ao vivo além do eval (empresa composta, acento/caixa, empresa inexistente, regressão dos outros 13 casos); confirmou as duas camadas de defesa contra as 8 SQLs de ataque isoladamente, sem depender do runner. |
| `rev-produto` | **APROVADO** — casos de teste fazem sentido do ponto de vista de um gestor GECOPE; resposta do bugfix clara e correta em português; metas do portão adequadas ao que mais quebraria confiança do piloto. |
| `rev-aderencia` | **APROVADO** — `eval_run.ts`/`llm.ts` no padrão de `guards.ts`/`motor_intencoes.ts`; extração de `llm.ts` sem drift (nada duplicado/esquecido em `index.ts`); `deno.json` resolve exatamente o specifier que `motor_intencoes.ts` já usava, documentado como só-local; nenhuma migração SQL nesta fase; commits só tocam arquivos do assistente. |

**F3: 4/4 APROVADO.** Sem sign-off de usuário exigido (só F1 e F8, por `revisores.md`).

## Achado do próprio eval (não é um achado de revisor — é o que a fase existe para fazer)

Ao rodar `deno task eval` pela primeira vez, o caso `int-06` falhou: a pergunta "Quantos
processos de replanilhamento temos em tramitação?" respondia "0 processos… **da WTP
PROCESSOS E SOLUÇÕES EM ÁGUA**" — `encontrarMencionado` batia a `contratada` pela
palavra-chave "processos", presente na própria pergunta. **Bug em produção desde antes
desta fase**, não introduzido por ela. Corrigido acrescentando `processo`, `processos`,
`replanilhamento`, `aditivo`, `aditivos`, `medicao`, `medicoes` a
`PALAVRAS_GENERICAS_ENTIDADE` (mesma lógica já usada para `contrato`/`obra`/`empresa`).

Isto é uma mudança de comportamento de produção, fora do "sem tocar em produção" que o
plano original prometia. As 4 lentes concordaram que **não bloqueia** — nenhuma abre porta
de segurança, o `rev-correcao` testou a correção além do próprio eval (regressão dos
outros 13 casos, empresa composta, acento/caixa, empresa inexistente) e o `rev-produto`
confirmou o texto da resposta corrigida. `rev-seguranca` registrou como follow-up de
**processo** (não de segurança): formalizar que o plano de uma fase pode incorporar um
achado do próprio trabalho, não só ser escrito antes e seguido à risca.

## Follow-ups incorporados neste commit

| # | Origem | Item | Resolução |
|---|---|---|---|
| FU-A1 | `rev-aderencia` | `README.md` "Estado atual" ainda listava F3 como "próxima"; tabela "Arquivos" não citava `llm.ts`/`eval_run.ts`/`deno.json`/`casos.jsonl` | Atualizado — F2 e F3 marcadas concluídas, F4 é a próxima; arquivos novos listados |
| FU-A2 | `rev-aderencia` | Doc mandava rodar os `deno task` "de dentro de `gecope-assistant/`", mas `deno.json` vive em `supabase/functions/` (compartilhado entre Edge Functions) | `fase-3-eval.md` corrigido |
| F-a | `rev-correcao` | `contemNumero` só removia um nível de separador de milhar (`4.103.725` não batia com `4103725`) | `eval_run.ts`: substituição repetida até estabilizar, colapsa quantos grupos houver. Sem caso atual afetado (maior valor do gabarito é 2944, um só grupo) — corrigido antes de precisar |
| F-b | `rev-correcao` | `llm_nao_sei` pode dar 100% mesmo com `GEMINI_API_KEY` inválida (degradação por erro e recusa correta são indistinguíveis na taxa agregada) | Nota acrescentada ao item D de "Como verificar" em `fase-3-eval.md`: conferir os `obs` por caso, não só o `%`, ao rodar `--llm` de verdade |

## Follow-ups para fases futuras

| # | Origem | Item | Fase |
|---|---|---|---|
| F-c | `rev-correcao` | IDs dos 3 modelos Gemini não testados contra `/v1beta/models` (sem chave utilizável nesta revisão) | já era **FU-77** — pré-requisito do deploy |
| F-d | `rev-correcao` / `rev-produto` | `int-15` é caso fraco (0 aditivos assinados no período real, não exercita a soma); resposta com zero resultados deixa "Por tipo:" pendurado sem itens | F5/F6, quando essa intenção for revisitada — trocar a janela por "este ano" **e** tratar o caso `total === 0` com mensagem própria em vez do bloco vazio |
| F-e | `rev-produto` | `casos.jsonl` não tem nenhum caso de gabarito fixo conferindo valor monetário formatado (`R$`, milhar) contra dado real — só contagens inteiras | F5, ao expandir os casos |
| F-01 | `rev-seguranca` | Registrar como processo (não como regra rígida) que uma fase pode incorporar um achado do próprio trabalho realizado nela, com nota explícita, em vez de só documentar depois do fato | decisão do usuário, sem fase associada |

## Snapshot `--llm` (04/09/2026) — informativo, não altera o veredito acima

Com uma `GEMINI_API_KEY` nova, confirmados primeiro **sem gastar cota de geração**: os 3
IDs de `GEMINI_MODELOS` (`gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3.5-flash-lite`)
existem e suportam `generateContent` (`GET /v1beta/models/<id>`) — **FU-77 fechada**.

Ao rodar `deno task eval:llm` de verdade:

```
llm_dado           9/9/0   → 50%  (alvo 80%, informativo)
llm_nao_sei        6/0/0   → 100% (alvo 90%, informativo)
ambigua            0/4/0   → 0%   (alvo 90%, informativo)
seguranca_prompt   1/0/0   → 100%
```

**Causa raiz identificada** (chamada direta à API, fora do wrapper, para ver o corpo do
erro): `HTTP 429`, `RESOURCE_EXHAUSTED` —
`generate_content_free_tier_requests`, **limite de 20 requisições/dia por modelo** numa
chave recém-criada. O primeiro dos dois runs (29 chamadas reais, cada uma podendo tentar
até 3 modelos com retry) esgotou a cota diária de `gemini-3.6-flash` e deixou
`gemini-3.5-flash-lite` — o último da cadeia — genuinamente sobrecarregado (503) por
volume geral do free tier no momento. Uma nova tentativa 20s depois, só com a categoria
`ambigua`, deu o mesmo resultado (cota não se recompõe em segundos).

**Isto confirma ao vivo o achado FU-b do `rev-correcao`**: `llm_nao_sei` mostrou 100%,
mas por **degradação por cota esgotada**, não por recusa correta — a taxa agregada não
distingue as duas coisas. Sem esse achado registrado na revisão, esse 100% teria sido
lido como sinal de que a fronteira "não sei responder" funciona bem; na verdade o teste
real dessa categoria não rodou.

**Não bloqueia nada** (a categoria é informativa, acordado com o usuário) e não muda o
veredito 4/4 da fase. Mas é um dado real para decisões futuras:
- O free tier do Gemini tem cota **diária** baixa por modelo (20/dia numa chave nova) —
  `provedor-llm.md` já previa que isso poderia "decepcionar" e cita Groq como plano B.
  Vale reavaliar essa troca **antes** da F6 (prompt/produção), não depois.
- Repetir `deno task eval:llm` amanhã (cota deveria renovar) daria um snapshot mais limpo
  — não necessário para fechar F3, mas útil antes de decidir sobre o plano B.
- Em produção, o piloto (~10–20 pessoas) pode esbarrar na mesma cota diária dependendo do
  volume de perguntas que caem no caminho LLM — motivo a mais para a F5 (expandir o motor
  de intenções) ser prioridade logo após o deploy: cada pergunta resolvida por intenção é
  uma chamada a menos que disputa essa cota.

## Situação

**F3 concluída, 4/4 APROVADO.** Portão determinístico verde: `intencao_exata` 14/14
(100%, alvo 95%), `seguranca` 8/8 (100%, alvo 100%). `deno task test` 38/38. `deno check`
limpo nos 5 módulos. Gabarito conferido de forma independente por duas pessoas (quem
implementou e o `rev-correcao`), 16+ dos 34 casos numéricos, zero divergência.

**FU-77 fechada** (04/09/2026): os 3 IDs de `GEMINI_MODELOS` confirmados via
`GET /v1beta/models`. Snapshot `--llm` rodado (ver seção acima) — atingiu cota diária do
free tier no meio do teste, informativo, não bloqueia.

Pendente antes do deploy único (F1+F2+F3):
1. ~~FU-77~~ — feita.
2. `supabase functions deploy gecope-assistant` — sobe `index.ts` + `guards.ts` + `llm.ts`
   + `motor_intencoes.ts` (com o bugfix) + `schema_prompt.ts`. Cobre F1 (JWT real,
   allowlist), F2 (bug do LIMIT, cadeia de modelos, degradação) e o bugfix da F3.
3. Conferência ao vivo pós-deploy com JWT real de um usuário do GECOPE (verificações F–K
   de `fase-2-nucleo.md`).

## Deploy único (F1+F2+F3) — aplicado e conferido ao vivo (04/09/2026)

`supabase functions deploy gecope-assistant` — v14 → **v17**, sobe `index.ts` + `guards.ts`
+ `llm.ts` + `motor_intencoes.ts` + `schema_prompt.ts`. Rollback = redeploy da v14
(código pré-F1 em git, `782e86c`).

Conferência ao vivo (checagens F–K de `fase-2-nucleo.md`):
- Sem `Authorization`: `401` do próprio gateway do Supabase (`verify_jwt`).
- Com a `anon key` como Bearer (JWT válido, mas não é usuário real): `401` da **nossa**
  checagem (`auth.getUser`) — `"Sua sessão do GECOPE expirou..."`. Prova que a guarda de
  identidade da F1 está ativa (a v14 antiga não tinha essa checagem).
- Com sessão real do usuário (`nildeno.aragao@sop.ce.gov.br`), via `assistente.html`:
  - 2 perguntas de intenção → `origem: intencao`, `sucesso: true`, respondidas na hora.
    `usuario` no log = e-mail real da sessão (não "desconhecido", não falsificável pelo
    corpo — confirma a guarda de identidade da F1 em uso real, não só em teste).
  - 1 pergunta livre ("Quais as obras fiscalizadas pelo Roberto Bringel?") caiu no
    caminho LLM e **degradou**: `origem: gemini_degradado`, `erro: "Modelo
    gemini-3.5-flash-lite sobrecarregado (503)"` — a mesma cota diária gratuita já
    esgotada nos testes da F3 (ver "Snapshot `--llm`" acima), não um bug novo. O ponto
    que importa: degradou com a mensagem amigável (`MSG_DEGRADADO`), **não** com o erro
    cru `42601` que a v14 antiga dava (comparado ao vivo com um registro real de
    03/09/2026 no log, antes da correção). F2 funcionando em produção, não só em teste.

**F1+F2+F3 confirmadas em produção — não só revisadas em código.** Estado registrado em
`docs/assistente/README.md`.

Depois: **F4** — views largas para Q&A.
