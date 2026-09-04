// llm.ts — chamada ao provedor LLM (Gemini) com cadeia de fallback de modelo.
// Extraído de index.ts na F3 para o harness de avaliação (eval_run.ts) poder
// importar sem subir o servidor (index.ts chama Deno.serve no load).

import { SCHEMA_PROMPT } from "./schema_prompt.ts";
import { interpretarRespostaModelo, type RespostaModelo } from "./guards.ts";

// F2: cadeia de fallback de modelo. 404/400 (modelo removido) -> próximo já;
// 503 (sobrecarga) -> 1 retry (sleep 1000ms) -> próximo. Teto de 9s por
// requisição, ~24s no caminho todo. Todos falharam -> lança (o chamador degrada).
// IDs conferidos em ai.google.dev/gemini-api/docs/models em set/2026 — "stable"
// da free tier. Ao atualizar, conferir a lista lá.
export const GEMINI_MODELOS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const geminiEndpoint = (modelo: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

const GEMINI_TIMEOUT_MS = 9000;      // teto por requisição (fetch não tem timeout no Deno)
const GEMINI_PRAZO_TOTAL_MS = 24000; // teto do caminho LLM inteiro

// Mensagem única para todo "não deu" do caminho LLM. Sem a palavra "segurança"
// (a causa costuma ser 503/rede/cota).
export const MSG_DEGRADADO =
  "Não consegui responder a essa pergunta agora. Tente reformular de forma mais simples, ou use uma das perguntas sugeridas.";

export async function gerarSqlComGemini(pergunta: string): Promise<RespostaModelo> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada nos secrets da função.");

  const corpoRequisicao = JSON.stringify({
    contents: [{ parts: [{ text: `${SCHEMA_PROMPT}\n\nPERGUNTA DO USUÁRIO: ${pergunta}` }] }],
    generationConfig: { responseMimeType: "application/json", temperature: 0.1 },
  });

  const prazoFinal = Date.now() + GEMINI_PRAZO_TOTAL_MS;
  let ultimoErro: Error | null = null;

  for (const modelo of GEMINI_MODELOS) {
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      if (Date.now() > prazoFinal) {
        throw ultimoErro ?? new Error("Tempo esgotado no caminho LLM.");
      }

      let resposta: Response;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), GEMINI_TIMEOUT_MS);
      try {
        resposta = await fetch(geminiEndpoint(modelo), {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-goog-api-key": apiKey },
          body: corpoRequisicao,
          signal: ctrl.signal,
        });
      } catch (e) {
        const abortado = e instanceof DOMException && e.name === "AbortError";
        ultimoErro = new Error(`${abortado ? "Timeout" : "Rede"} ao chamar ${modelo}: ${e instanceof Error ? e.message : e}`);
        break;
      } finally {
        clearTimeout(timer);
      }

      if (resposta.ok) {
        const dados = await resposta.json();
        const textoGerado = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textoGerado) {
          ultimoErro = new Error(`Resposta vazia de ${modelo}.`);
          break;
        }
        return interpretarRespostaModelo(textoGerado);
      }

      if (resposta.status === 503) {
        ultimoErro = new Error(`Modelo ${modelo} sobrecarregado (503).`);
        if (tentativa < 2 && Date.now() + 1000 < prazoFinal) {
          await new Promise((r) => setTimeout(r, 1000));
          continue;
        }
        break;
      }

      if (resposta.status === 404 || resposta.status === 400) {
        ultimoErro = new Error(`Modelo ${modelo} indisponível (${resposta.status}).`);
        break;
      }

      const corpoErro = (await resposta.text()).slice(0, 300);
      ultimoErro = new Error(`Erro ${resposta.status} em ${modelo}: ${corpoErro}`);
      break;
    }
  }

  throw ultimoErro ?? new Error("Todos os modelos da cadeia falharam.");
}
