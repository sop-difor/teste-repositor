# F6 — LLM + prompt · Revisão

4 lentes, subagentes independentes, contexto limpo. Rodada única — os 4 aprovaram de
primeira, com follow-ups pequenos já incorporados no mesmo commit.

## Vereditos

| Lente | Veredito | Resumo |
|---|---|---|
| `rev-seguranca` | **APROVADO** | O SQL só entra na resposta ao usuário depois de já validado (`guards.ts`) e executado com sucesso — nenhum caminho vaza SQL rejeitado ou erro cru. Colunas das views largas no prompt conferidas ao vivo contra `information_schema.columns`: 31/31 em cada view, sem coluna inventada. `SUGESTOES_DEGRADACAO` é texto estático, sem dado de usuário. Grants/RLS/`executar_consulta_ia`/autenticação intocados. |
| `rev-correcao` | **APROVADO** | `construirPromptSql()` produz texto **byte-a-byte idêntico** ao template inline anterior (testado com 4 entradas, incluindo aspas/`--`/acentuação). Rodou o eval real contra produção: 30/32 `intencao_exata`, 8/8 `seguranca` (as 2 diferenças são efeito da chave de acesso usada no teste, não regressão — `motor_intencoes.ts` não foi tocado). Traçou os 4 caminhos de resposta em `index.ts`: `sql` nunca aparece num caminho de erro, `sugestoes` nunca aparece no esclarecimento. |
| `rev-produto` | **APROVADO** | Link "Ver SQL gerado" recolhido por padrão, discreto, não assusta quem não sabe o que é SQL. Badge "resposta gerada — confira" é melhora real sobre "análise gerada". "Fora do escopo" virar aviso neutro corrige uma inconsistência (antes saía com o badge de sucesso). As 3 sugestões de degradação batem em intenções reais — clicar nelas sempre responde. |
| `rev-aderencia` | **APROVADO** | Nomes/estilo consistentes com o resto do arquivo. CSS novo usa só variáveis do tema (nenhuma cor fixa) — não quebra o modo escuro. Nenhum `.sql` novo, nenhuma mudança em `guards.ts`/`motor_intencoes.ts`. As sugestões de degradação reaproveitam texto já existente nos chips do rodapé, sem duplicar com redação divergente. |

**F6: 4/4 APROVADO.** Sem sign-off de usuário exigido (só F1 e F8).

## Follow-ups incorporados no mesmo commit (`6212c2d` + ajuste do número que some sozinho)

| # | Origem | Item | Resolução |
|---|---|---|---|
| — | `rev-aderencia` | Doc da fase sem a seção "Como verificar" que todas as fases anteriores têm | Adicionada |
| — | `rev-produto` | As 3 sugestões de degradação eram todas sobre contratos — nenhuma sobre processos (metade do domínio) | Trocada uma por "Processos de replanilhamento em tramitação" |
| — | `rev-correcao` | Comentário no prompt cita "72 de 427" processos sem obra vinculada — já desatualizado (75 de 420 ao vivo) | Número específico removido do comentário (evita o mesmo drift se repetir) |

## Follow-ups para fases futuras

| # | Origem | Item | Fase |
|---|---|---|---|
| FU-F6-1 | `rev-produto` | Rótulo "Ver SQL gerado" ainda usa a palavra técnica "SQL" — considerar "Ver consulta técnica usada" | F7/F8, polimento de texto |
| FU-F6-2 | `rev-produto` | Sessão expirada / limite de uso / falha do LLM / fora do escopo usam o mesmo estilo visual neutro — diferenciar ajudaria o gestor a distinguir a causa | F7 (observabilidade) |
| FU-F6-3 | `rev-correcao` | Eval `--llm` (com `GEMINI_API_KEY` real) não foi rodado nesta revisão — recomendado antes do piloto (F8), já que o prompt cresceu com as views largas | F8 |
| FU-F6-4 | `rev-correcao` | Nenhum teste automatizado dedicado para `construirPromptSql()` — a extração já habilita isso | Quando conveniente |

## Situação

**F6 concluída, 4/4 APROVADO.** Caminho LLM agora mostra o SQL gerado, usa as views largas
da F4 no prompt, tem rótulo de confiança alinhado ao `README.md`, e degrada com sugestões
concretas em vez de texto genérico. Nenhuma mudança em segurança/banco nesta fase.

**Ainda não publicada em produção** (só revisada/aprovada) — ver `README.md` para o estado
de deploy antes de considerar isto em uso real.

Próximo: **F7** — 👍/👎 + campo veredito no log; painel de uso/falhas; rotina "falha →
intenção ou caso de eval". Depois: F8 (integração + piloto, com sign-off do usuário).
