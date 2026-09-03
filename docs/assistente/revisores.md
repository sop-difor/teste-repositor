# Assistente de Dados — configuração dos 4 revisores

Vale para **todas as fases** (F0–F8). Segue o modelo das Etapas A–D do GECOPE
(`docs/_concluido/etapa-*-revisores.md`), adaptado para revisão **por fase** em vez de uma
única revisão no fim.

## Como a revisão funciona

1. **Quando roda:** ao final de **cada fase**, antes de liberar a seguinte.
2. **Quem roda:** 4 subagentes independentes, um por lente. Rodam **em paralelo**, sem ver
   o resultado um do outro, com **contexto limpo** (recebem o resultado + o diff + como
   testar — não o raciocínio de quem implementou).
3. **O que cada um recebe:**
   - Este documento e o plano da fase (`docs/assistente/fase-N-*.md`).
   - `escopo-dados.md` e `provedor-llm.md`.
   - A lista de arquivos alterados + resumo em linguagem clara do que mudou.
   - Acesso de leitura ao repositório e, quando a lente exigir, às ferramentas de teste
     (Supabase MCP para banco, navegador headless para o front).
4. **O que cada um devolve:** veredito **`APROVADO`** ou **`BLOQUEADO`**, seguido de:
   - **Achados bloqueantes** — descrição, onde, por que é grave, o que precisa mudar.
   - **Achados follow-up** (não bloqueiam) — vão para uma lista rastreada, tratados depois
     sem travar a fase seguinte.
5. **Decisão da fase:** os **4 em `APROVADO`**. Nas fases F1 e F8, além disso, **sign-off
   do usuário**.
6. **Ciclo de correção:** cada achado bloqueante → corrige-se **apenas aquilo** → os
   revisores afetados rodam de novo → repete até os 4 aprovarem. **2 rodadas de
   `BLOQUEADO` na mesma fase → escala para o usuário decidir.**
7. **Conflitos:**
   - Revisor contra o plano escrito → **o plano vence**; o revisor registra a divergência
     como follow-up para o usuário decidir depois.
   - Revisor contra revisor → **o usuário arbitra**.
8. **Limite de alçada:** um revisor não bloqueia por gosto pessoal fora dos critérios
   escritos, nem por algo que o plano marcou como fora de escopo desta fase. Vira
   follow-up, nunca bloqueio.

## Severidade

| Bloqueante (trava a fase) | Follow-up (não trava) |
|---|---|
| Objetivo declarado da fase não cumprido | Melhoria de acabamento que a fase não exige |
| Brecha de segurança nova ou não corrigida quando a fase era sobre isso | Refino para uma fase futura |
| Número errado apresentado como certo; SQL que retorna dado fora do escopo | Sugestão de organização interna sem efeito observável |
| Erro no console; regressão (algo que funcionava e parou) | Preferência estética sem base em critério escrito |
| Segredo commitado; PII trafegando para terceiros | Nome de variável, comentário |

## As 4 lentes

### Revisor 1 — `rev-seguranca` (Segurança & dados)

**Pergunta:** "Isto abre, mantém aberta ou deixa de fechar alguma porta?"

Confere, conforme a fase:
- Menor privilégio: a role, a função e a Edge Function só alcançam o que
  `escopo-dados.md` autoriza. `gecope_ia_readonly` sem `LOGIN`.
- Injeção de SQL: entradas do usuário nunca concatenadas em SQL cru; validação
  só-`SELECT` / instrução única intacta nas duas camadas.
- Exposição via PostgREST: `executar_consulta_ia` **não** executável por `anon` /
  `authenticated` (a partir da F1).
- Identidade: `usuario` derivado do JWT no servidor, nunca do corpo (a partir da F1).
- Rate limit por usuário existente e efetivo (a partir da F1).
- Governança: o LLM recebe só schema + pergunta, nunca linhas (`provedor-llm.md`).
- PII: sem segredo no repositório; retenção/acesso do `consultas_ia_log` conforme F1.

### Revisor 2 — `rev-correcao` (Correção & confiabilidade)

**Pergunta:** "As respostas estão certas, e o sistema falha de forma segura?"

Confere, conforme a fase:
- O SQL das intenções e o gerado batem com o que o banco realmente contém (testa via
  Supabase MCP no projeto `qexdnxqmiaarzwwwrcor`).
- Casos de borda: empresa inexistente, período vazio, zero resultados, acento/caixa,
  nome parcial.
- Fallback: quando o LLM falha (404/503/SQL inválido), o usuário recebe degradação
  amigável — nunca stack trace, nunca `[object Object]`, nunca número inventado.
- Fatos externos citados no plano conferem (ex.: IDs de modelo Gemini que respondem
  `200`; relacionamentos de tabela).
- A partir da F3: o eval roda e as metas são atingidas.

### Revisor 3 — `rev-produto` (Produto & UX)

**Pergunta:** "Um gestor do piloto entende e confia nesta resposta?"

Confere, conforme a fase:
- A resposta responde à pergunta, em português claro, com números formatados
  (`R$`, milhar, %).
- A fronteira é honesta: dá para saber quando a resposta é "terreno firme" (intenção) e
  quando é "gerada — confira" (LLM).
- Gráfico aparece quando ajuda e não polui quando não ajuda.
- Mensagens de erro e de esclarecimento são úteis e não assustam.
- O fluxo de esclarecimento (pergunta ambígua → pede detalhe → junta contexto) funciona.

### Revisor 4 — `rev-aderencia` (Aderência ao GECOPE)

**Pergunta:** "Isto parece parte do GECOPE ou um corpo estranho?"

Confere, conforme a fase:
- Convenções de código do projeto (estilo, nomes, comentários em português).
- Reaproveita `config.js` / `database.js` / `utils.js` e o padrão de sessão do GECOPE em
  vez de reimplementar (relevante a partir da F8; na F0, apenas registrar o que será
  reaproveitado).
- Tema claro/escuro alinhado ao resto do sistema (chave e etiqueta iguais às das
  Etapas A–D).
- Documentação na pasta `docs/assistente/` no mesmo padrão das Etapas A–D
  (plano / spec / revisão por fase).
- Migrações de banco como arquivo em `sql/` para aplicação manual — o fluxo que o GECOPE
  já usa (`sql/_aplicados/`).

## Registro

Cada fase gera `docs/assistente/fase-N-revisao.md` com: o que foi feito, arquivos
alterados, como testar, o veredito das 4 lentes, achados (bloqueantes e follow-up) e a
resolução de cada bloqueante. Commitado junto com a fase.
