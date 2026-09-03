// index.ts — Edge Function: gecope-assistant
// Ponto de entrada único do assistente de dados do GECOPE.
//
// Fluxo:
//   0. Autentica: exige JWT de usuário real (auth.getUser); "usuario" vem do
//      token, nunca do corpo. Aplica rate limit por usuário.  [F1]
//   1. Tenta o motor de intenções (regras, rápido, sem custo)
//   2. Se não bater nenhuma intenção, cai no Gemini (gera SQL, valida, executa)
//   3. Grava tudo em consultas_ia_log, sempre
//
// Deploy (Supabase CLI):
//   supabase functions deploy gecope-assistant
//
// Estrutura de pastas esperada:
//   supabase/functions/gecope-assistant/index.ts        <- este arquivo
//   supabase/functions/gecope-assistant/motor_intencoes.ts
//   supabase/functions/gecope-assistant/schema_prompt.ts
//   supabase/functions/gecope-assistant/guards.ts        (+ guards_test.ts)
//
// Secrets necessários (já configurados): GEMINI_API_KEY
// Secrets automáticos do Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// verify_jwt: true (painel) — mantém; a checagem de auth.getUser aqui é
//   necessária porque a anon key também é um JWT que passa no verify_jwt.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { tentarIntencao, type DadosGrafico } from "./motor_intencoes.ts";
import { SCHEMA_PROMPT } from "./schema_prompt.ts";
import {
  validarSqlGeminiOuFalhar,
  interpretarRespostaModelo,
  type RespostaModelo,
} from "./guards.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // restrinja ao domínio do GECOPE em produção
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// F2: cadeia de fallback de modelo. Tenta em ordem; 404/400 (modelo removido) ->
// próximo imediatamente; 503 (sobrecarga) -> 1 retry (sleep 1000ms) -> próximo.
// Teto de 9s por requisição, ~24s no caminho todo. Todos falharam -> degradação
// (o LLM tem "direito a falhar", ver docs/assistente/provedor-llm.md). IDs
// conferidos em ai.google.dev/gemini-api/docs/models em set/2026 — "stable" da
// free tier. Ao atualizar, conferir a lista lá.
const GEMINI_MODELOS = ["gemini-3.6-flash", "gemini-3.5-flash", "gemini-3.5-flash-lite"];
const geminiEndpoint = (modelo: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`;

// ---------------------------------------------------------------------------
// Converte qualquer valor em texto de forma segura — evita o clássico bug de
// JavaScript que transforma objetos em "[object Object]" quando concatenados
// ou guardados sem cuidado. Se o Gemini devolver um campo que deveria ser
// texto simples mas veio como objeto aninhado, isso ainda produz algo legível.
// ---------------------------------------------------------------------------
function paraTextoSeguro(valor: unknown): string {
  if (typeof valor === "string") return valor;
  if (valor === null || valor === undefined) return "";
  try {
    return JSON.stringify(valor);
  } catch {
    return String(valor);
  }
}

// Validação/saneamento do SQL do modelo: ver ./guards.ts (funções puras,
// testadas em ./guards_test.ts; espelham as guardas de executar_consulta_ia).

const GEMINI_TIMEOUT_MS = 9000;     // teto por requisição (fetch não tem timeout no Deno)
const GEMINI_PRAZO_TOTAL_MS = 24000; // teto do caminho LLM inteiro — depois degrada

// Uma só mensagem para todo "não deu" do caminho LLM (cadeia de modelos, SQL
// inválido, execução falhou). Não é defeito do sistema — é "essa pergunta não
// deu". Sem a palavra "segurança" (a causa costuma ser 503/rede/cota).
const MSG_DEGRADADO =
  "Não consegui responder a essa pergunta agora. Tente reformular de forma mais simples, ou use uma das perguntas sugeridas.";

// ---------------------------------------------------------------------------
// Chama o Gemini para gerar SQL a partir da pergunta em linguagem natural.
// Percorre GEMINI_MODELOS; 503 -> 1 retry no mesmo modelo (sleep 1000ms) ->
// próximo; 404/400 -> próximo direto. Cada requisição tem teto de 9s; o
// caminho inteiro tem teto de ~24s. Esgotou -> lança (o chamador degrada).
// ---------------------------------------------------------------------------
async function gerarSqlComGemini(pergunta: string): Promise<RespostaModelo> {
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
        break; // próximo modelo
      } finally {
        clearTimeout(timer);
      }

      if (resposta.ok) {
        const dados = await resposta.json();
        const textoGerado = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textoGerado) {
          ultimoErro = new Error(`Resposta vazia de ${modelo}.`);
          break; // próximo modelo
        }
        return interpretarRespostaModelo(textoGerado);
      }

      if (resposta.status === 503) {
        ultimoErro = new Error(`Modelo ${modelo} sobrecarregado (503).`);
        if (tentativa < 2 && Date.now() + 1000 < prazoFinal) {
          await new Promise((r) => setTimeout(r, 1000));
          continue; // 1 retry no mesmo modelo
        }
        break; // -> próximo modelo
      }

      if (resposta.status === 404 || resposta.status === 400) {
        ultimoErro = new Error(`Modelo ${modelo} indisponível (${resposta.status}).`);
        break; // -> próximo modelo, sem repetir
      }

      // 401 / 429 (cota) / 500 / outro
      const corpoErro = (await resposta.text()).slice(0, 300);
      ultimoErro = new Error(`Erro ${resposta.status} em ${modelo}: ${corpoErro}`);
      break; // -> próximo modelo
    }
  }

  throw ultimoErro ?? new Error("Todos os modelos da cadeia falharam.");
}

// ---------------------------------------------------------------------------
// Detecta automaticamente se um resultado do Gemini serve para virar gráfico:
// exatamente 2 colunas, a primeira parecendo categoria (texto) e a segunda
// numérica, com um número razoável de linhas (2 a 15 — mais que isso vira
// ilegível como gráfico de barras).
// ---------------------------------------------------------------------------
function detectarGraficoAutomatico(linhas: Record<string, unknown>[], pergunta: string): DadosGrafico | undefined {
  if (linhas.length < 2 || linhas.length > 15) return undefined;

  const chaves = Object.keys(linhas[0]);
  if (chaves.length !== 2) return undefined;

  const [chaveLabel, chaveValor] = chaves;
  const valoresSaoNumericos = linhas.every((l) => typeof l[chaveValor] === "number" || !isNaN(Number(l[chaveValor])));
  const labelsSaoTexto = linhas.every((l) => typeof l[chaveLabel] === "string");

  if (!valoresSaoNumericos || !labelsSaoTexto) return undefined;

  return {
    tipo: "barra",
    titulo: pergunta.length <= 60 ? pergunta : "Resultado da consulta",
    rotulos: linhas.map((l) => String(l[chaveLabel])),
    valores: linhas.map((l) => Number(l[chaveValor])),
  };
}

// ---------------------------------------------------------------------------
// Formata um array de linhas (json) em texto legível, sem precisar de outra
// chamada de IA — mais rápido e mais barato.
// ---------------------------------------------------------------------------
function formatarResultado(linhas: Record<string, unknown>[]): string {
  if (linhas.length === 0) return "Nenhum resultado encontrado para essa consulta.";

  if (linhas.length === 1) {
    const chaves = Object.keys(linhas[0]);
    return chaves.map((k) => `${k}: ${linhas[0][k]}`).join("\n");
  }

  const linhasFormatadas = linhas
    .slice(0, 20)
    .map((linha) => "• " + Object.values(linha).join(" — "))
    .join("\n");

  const sufixo = linhas.length > 20 ? `\n... e mais ${linhas.length - 20} linha(s).` : "";
  // 200 (limite interno) / 500 (cap externo) = a lista foi CORTADA — não é a
  // contagem real. Deixar isso explícito para o gestor não decidir por um número
  // que não é o total. (Contadores exatos de verdade: F5/F6.)
  const capAtingido = linhas.length === 200 || linhas.length === 500;
  const cabecalho = capAtingido
    ? `Mais de ${linhas.length} resultados (limite do sistema — refine a pergunta ou peça um total/contagem):`
    : `${linhas.length} resultado(s) encontrado(s):`;
  return `${cabecalho}\n${linhasFormatadas}${sufixo}`;
}

// Grava no log sem nunca derrubar a resposta ao usuário (log é best-effort).
// deno-lint-ignore no-explicit-any
async function logSeguro(supabase: any, linha: Record<string, unknown>): Promise<void> {
  try {
    await supabase.from("consultas_ia_log").insert(linha);
  } catch (e) {
    console.error("Falha ao gravar consultas_ia_log:", e);
  }
}

// ---------------------------------------------------------------------------
// Limite de perguntas por usuário numa janela de tempo. Aproximado (conta o
// que já foi gravado em consultas_ia_log) — suficiente para um piloto interno.
// ---------------------------------------------------------------------------
const RATE_LIMITE_JANELA_MIN = 60;
const RATE_LIMITE_MAX = 40;

async function limiteExcedido(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  usuario: string
): Promise<boolean> {
  const desde = new Date(Date.now() - RATE_LIMITE_JANELA_MIN * 60_000).toISOString();
  const { count, error } = await supabase
    .from("consultas_ia_log")
    .select("*", { count: "exact", head: true })
    .eq("usuario", usuario)
    .gte("created_at", desde);
  if (error) return false; // na dúvida, não bloqueia o usuário por falha nossa
  return (count ?? 0) >= RATE_LIMITE_MAX;
}

// ---------------------------------------------------------------------------
// Handler principal
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let pergunta = "";
  let usuario = "desconhecido";

  // ---- 0. Autenticação: exige JWT de usuário real do GECOPE ----
  // verify_jwt=true no painel já rejeita requisição sem Bearer válido, mas a
  // anon key TAMBÉM é um JWT válido — então validamos aqui que o token é de um
  // usuário de verdade (auth.getUser), e derivamos "usuario" do token, nunca
  // do corpo. Mesmo padrão da função approve-user.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(
      JSON.stringify({ resposta: "Entre no GECOPE para usar o assistente.", origem: "sessao" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  const { data: { user }, error: erroAuth } = await supabase.auth.getUser(token);
  if (erroAuth || !user) {
    return new Response(
      JSON.stringify({ resposta: "Sua sessão do GECOPE expirou. Entre novamente e recarregue esta página.", origem: "sessao" }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  usuario = user.email ?? user.id;

  try {
    const corpo = await req.json();
    pergunta = (corpo.pergunta ?? "").trim();

    if (!pergunta) {
      return new Response(JSON.stringify({ erro: "Campo 'pergunta' é obrigatório." }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // ---- 0b. Rate limit por usuário ----
    if (await limiteExcedido(supabase, usuario)) {
      return new Response(
        JSON.stringify({
          resposta: `Limite de ${RATE_LIMITE_MAX} perguntas por hora atingido. Aguarde alguns minutos e continue.`,
          origem: "limite",
        }),
        { status: 429, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ---- 1. Tenta o motor de intenções primeiro (rápido, sem custo) ----
    const resultadoIntencao = await tentarIntencao(supabase, pergunta);
    if (resultadoIntencao) {
      await logSeguro(supabase, {
        usuario,
        pergunta,
        sql_gerado: `[intenção: ${resultadoIntencao.intencaoId}]`,
        origem: "intencao",
        sucesso: true,
        linhas_retornadas: resultadoIntencao.linhas,
      });

      return new Response(
        JSON.stringify({
          resposta: resultadoIntencao.resposta,
          origem: "intencao",
          grafico: resultadoIntencao.grafico ?? null,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    // ---- 2. Fallback: Gemini gera o SQL ----
    // O caminho LLM tem "direito a falhar": qualquer erro aqui (cadeia de
    // modelos esgotada, SQL inválido, execução falhou) vira degradação amigável
    // com sugestão de reformular — nunca erro cru, nunca número inventado.
    let respostaGemini: RespostaModelo;
    try {
      respostaGemini = await gerarSqlComGemini(pergunta);
    } catch (erroLlm) {
      await logSeguro(supabase, {
        usuario, pergunta, sql_gerado: null, origem: "gemini_degradado", sucesso: false,
        erro: paraTextoSeguro(erroLlm instanceof Error ? erroLlm.message : erroLlm),
      });
      return new Response(
        JSON.stringify({ resposta: MSG_DEGRADADO, origem: "degradado" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    if (!respostaGemini.sql) {
      const mensagemTexto = paraTextoSeguro(respostaGemini.mensagem) || "Não consegui entender essa pergunta.";
      const ehEsclarecimento = respostaGemini.tipo === "esclarecimento";

      await logSeguro(supabase, {
        usuario,
        pergunta,
        sql_gerado: null,
        origem: ehEsclarecimento ? "gemini_esclarecimento" : "gemini_fora_escopo",
        sucesso: ehEsclarecimento, // não é bem um "sucesso", mas também não é uma falha real
        erro: ehEsclarecimento ? null : mensagemTexto,
      });

      return new Response(
        JSON.stringify({
          resposta: mensagemTexto,
          origem: "gemini",
          precisaEsclarecimento: ehEsclarecimento,
        }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const sql = respostaGemini.sql;

    // ---- 3. Valida e executa. Falha aqui = degradação, não erro cru. ----
    let linhas: Record<string, unknown>[] | null = null;
    try {
      validarSqlGeminiOuFalhar(sql);
      const { data, error: erroExecucao } = await supabase.rpc("executar_consulta_ia", {
        sql_consulta: sql,
      });
      if (erroExecucao) throw erroExecucao;
      linhas = data;
    } catch (erroSql) {
      await logSeguro(supabase, {
        usuario, pergunta, sql_gerado: sql, origem: "gemini_degradado", sucesso: false,
        erro: paraTextoSeguro(erroSql instanceof Error ? erroSql.message : erroSql),
      });
      return new Response(
        JSON.stringify({ resposta: MSG_DEGRADADO, origem: "degradado" }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
      );
    }

    const resposta = formatarResultado(linhas ?? []);
    const grafico = detectarGraficoAutomatico(linhas ?? [], pergunta);

    await logSeguro(supabase, {
      usuario,
      pergunta,
      sql_gerado: sql,
      origem: "gemini",
      sucesso: true,
      linhas_retornadas: linhas?.length ?? 0,
    });

    return new Response(JSON.stringify({ resposta, origem: "gemini", grafico: grafico ?? null }), {
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  } catch (erro) {
    // Erro inesperado (corpo malformado, intenção lançou, etc.) — os caminhos
    // esperados de falha do LLM já degradam acima com origem "degradado".
    console.error("Erro no gecope-assistant:", erro);

    await logSeguro(supabase, {
      usuario,
      pergunta,
      origem: "erro",
      sucesso: false,
      erro: paraTextoSeguro(erro instanceof Error ? erro.message : erro),
    });

    return new Response(
      JSON.stringify({
        resposta: "Ocorreu um erro ao processar sua pergunta. Tente reformular ou fale com o suporte técnico.",
        origem: "erro",
      }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
