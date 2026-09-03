# Provedor e modelo do caminho LLM — decisão da F0

## Estratégia (antes do provedor)

O caminho LLM é **minoritário e com direito a falhar**. O esforço principal é **expandir o
motor de intenções** (F5) para cobrir a maior parte das perguntas com regras
determinísticas. O LLM só é acionado quando nenhuma intenção bate, e:

- se não conseguir gerar SQL válido → **degrada** para "não consegui responder com
  segurança; tente uma destas perguntas" + chips de sugestão. Nunca erro cru, nunca
  número inventado.
- toda resposta do LLM vem marcada como **"resposta gerada — confira"** e mostra o **SQL
  gerado** (F6).

Consequência de projeto: a confiabilidade do provedor deixa de ser crítica. Um provedor
gratuito com disponibilidade imperfeita é aceitável, porque a falha dele é um caminho
previsto e tratado, não uma quebra.

## Regra de governança (verificada pelo revisor de Segurança em toda fase)

**O LLM nunca recebe linhas do banco.** O que sai do nosso ambiente para o provedor:

1. o **dicionário de schema condensado** (`schema_prompt.ts`) — estrutura, não dados;
2. o **texto da pergunta do usuário** (pode conter um nome de empresa ou de fiscal que o
   usuário digitou).

O SQL gerado é executado **localmente** pela função só-leitura; o resultado é formatado em
texto **sem** segunda chamada de IA. Nenhum registro de contrato, valor, medição ou pessoa
trafega para o provedor.

Implicação para LGPD: a pergunta do usuário é registrada em `consultas_ia_log` e pode
conter dado pessoal (nome de fiscal/analista). Retenção e acesso restrito ao log são
tratados na F1.

## Provedor: Google Gemini — free tier

Escolhido por já estar integrado, ter tier gratuito com latência adequada para o volume do
piloto, e a falha ser tolerável (ver estratégia acima). Groq (Llama, latência sub-segundo,
também gratuito) fica como **plano B** caso a latência ou a taxa de sucesso do Gemini free
decepcione no eval da F3.

### Cadeia de fallback de modelo (a implementar na F2/F6)

O código **não** deve depender de um único ID de modelo fixo. A geração de SQL tenta uma
lista ordenada; em `404` (modelo removido) ou `503` (sobrecarga) passa para o próximo; se
todos falharem, retorna o caminho de degradação ("não consegui responder").

```
GEMINI_MODELOS = [
  <modelo primário>,     // flash mais recente da free tier
  <modelo secundário>,   // flash da geração anterior, ainda suportado
  <modelo terciário>,    // lite / alias "-latest" como último recurso
]
```

- Retry com backoff só para `503` (sobrecarga temporária): 2 tentativas por modelo,
  ~1,5 s entre elas, antes de passar ao próximo.
- `404`/`400 model not found` → **não** repete o mesmo modelo; passa direto ao próximo e
  registra em `consultas_ia_log.erro` qual ID caiu (para sabermos quando atualizar a
  lista).

### Pendência para a F2/F6 — confirmar os IDs vigentes

Os IDs concretos **não** são fixados aqui porque mudam. Em 03/09/2026 o log mostra
`gemini-2.5-flash` já retornando 404 e o código com `gemini-3.6-flash` (não verificado).

Na F2/F6, antes de fixar a lista:

1. Consultar <https://ai.google.dev/gemini-api/docs/models> e a resposta de
   `GET /v1beta/models` da própria API com a `GEMINI_API_KEY` configurada.
2. Escolher 3 modelos da free tier (primário/secundário/terciário) que suportem
   `generateContent` + `responseMimeType: application/json`.
3. Fixar no código **com comentário datado** e link para a página de modelos.
4. O revisor de Correção confirma que cada ID responde `200` a uma chamada mínima.

## O que a F0 entrega sobre este tema

- Decisão registrada: **estratégia LLM-minoritário-com-direito-a-falhar + Gemini free +
  cadeia de fallback + regra de governança**.
- Nenhuma alteração de código ainda (a cadeia de fallback e os IDs são F2/F6).
