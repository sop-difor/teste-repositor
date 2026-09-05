# F7 — Feedback + observabilidade · Revisão

4 lentes, subagentes independentes, contexto limpo. Rodada única — os 4 aprovaram de
primeira, com follow-ups incorporados no mesmo commit (um deles, a purga de retenção,
escalado ao usuário antes de implementar).

## Vereditos

| Lente | Veredito | Resumo |
|---|---|---|
| `rev-seguranca` | **APROVADO** | Voto na resposta de outra pessoa: impossível (mesmo caminho de erro para "id não existe" e "id não é seu", sem oráculo). Função nova usa `service_role` de verdade, RLS/grants de `consultas_ia_log` intocados. `check` do SQL não tem bypass. Achou que o painel amplia quem lê o texto das perguntas (decisão do usuário, mas `escopo-dados.md` estava desatualizado) e que a purga de 180 dias prometida na F1 nunca saiu do papel. |
| `rev-correcao` | **APROVADO** | Testou o SQL da migração inteiro (ida e volta) contra produção dentro de transação com rollback — sintaxe correta, idempotente, reversível, nada ficou aplicado. Testou os 3 formatos de resposta de `registrarFeedback` com script isolado (12 asserções, todas passaram). Comparou a agregação do painel com SQL direto no banco — bate exatamente. |
| `rev-produto` | **APROVADO** | Feedback: posição/tamanho dos botões bem calibrados, mas achou que a confirmação era só visual (sutil) e "otimista" (marca como votado antes de saber se deu certo). Painel: números e tabela claros, mas faltava contexto de "isto é área de administração" e faltava `sql_gerado`/`id` para a própria rotina documentada funcionar sem sair do painel. |
| `rev-aderencia` | **APROVADO** | SQL no mesmo padrão de `f1`/`f2`/`f4` (cabeçalho, verificação, rollback). Função nova "parece escrita pela mesma mão" (mesmo CORS, mesmas mensagens de auth). Painel usa a mesma paleta/tema de `assistente.html`, sem cor fixa fora do tema. Achou que `LEIA-ME.md` e `README.md` não tinham sido atualizados com os arquivos novos. |

**F7: 4/4 APROVADO.** Sem sign-off de usuário exigido (só F1 e F8) — mas a purga de
retenção foi apresentada ao usuário como decisão antes de implementar, por envolver
LGPD/dado de produção.

## Follow-ups incorporados no mesmo commit

| # | Origem | Item | Resolução |
|---|---|---|---|
| — | `rev-seguranca` | `escopo-dados.md` dizia "nenhum usuário lê pela API" — não é mais verdade com o painel | Texto atualizado, registrando a decisão e o achado |
| — | `rev-seguranca` | Purga de 180 dias prometida na F1, nunca implementada | **Escalado ao usuário** — decisão: implementar agora. Job `pg_cron` (`gecope-assistente-purga-log`, diário às 3h) adicionado a `f7_feedback.sql` |
| — | `rev-seguranca` + `rev-correcao` | Endpoint de feedback não passava pelo limite de taxa | Checagem de `limiteExcedido` movida para antes do branch de feedback |
| — | `rev-aderencia` | `sql/assistente/LEIA-ME.md` sem linha para `f7_feedback.sql` | Linha adicionada |
| — | `rev-aderencia` | `README.md` sem os 2 arquivos novos na tabela | Adicionados |
| — | `rev-produto` | Confirmação de voto só visual, e "otimista" (marcava antes de saber se deu certo) | `enviarFeedback` devolve sucesso/falha; front-end só marca o botão e mostra "Obrigado pelo retorno" se der certo — senão reabilita e avisa "Não consegui registrar" |
| — | `rev-produto` | Botões sem rótulo, só emoji | Texto "Essa resposta ajudou?" ao lado |
| — | `rev-produto` | Painel sem aviso de que é área de administração | Aviso adicionado no topo da página |
| — | `rev-produto` | Rotina de revisão pede pra olhar o SQL gerado, mas o painel não mostrava (nem o id da linha) | Tabela ganhou coluna de id e um trecho do SQL gerado (truncado) sob a pergunta |
| — | `rev-correcao` | Comentário do índice parcial dizia "acelera as duas consultas do painel", mas a consulta atual não filtra no banco | Comentário corrigido para descrever o estado real |

## Follow-ups para fases futuras

| # | Origem | Item | Quando tratar |
|---|---|---|---|
| FU-F7-1 | `rev-produto` | Sem filtro por período/exportação no painel — fora do escopo pedido para a F7 | Se o piloto (F8) pedir |
| FU-F7-2 | `rev-seguranca` | Reavaliar se o painel deveria checar cargo/permissão, não só login | F8, quando definir quem administra o assistente |

## Situação

**F7 concluída, 4/4 APROVADO.** 👍/👎 nas respostas de verdade; painel de uso/falhas numa
página nova; rotina documentada para transformar o que se repete em intenção (F5) ou caso
de eval (F3); purga automática de 180 dias cumprindo a promessa de LGPD da F1.

Ainda não publicada em produção — ver `README.md` para o estado de deploy.

Próximo: **F8** — `assistente.html` atrás da auth plena do GECOPE, liberar para o piloto,
com sign-off do usuário.
