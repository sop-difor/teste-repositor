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
//
// Secrets necessários (já configurados): GEMINI_API_KEY
// Secrets automáticos do Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// verify_jwt: true (painel) — mantém; a checagem de auth.getUser aqui é
//   necessária porque a anon key também é um JWT que passa no verify_jwt.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { tentarIntencao, type DadosGrafico } from "./motor_intencoes.ts";
import { SCHEMA_PROMPT } from "./schema_prompt.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // restrinja ao domínio do GECOPE em produção
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GEMINI_MODEL = "gemini-3.6-flash"; // recomendado diretamente pela API do Gemini em set/2026 (gemini-2.5-flash foi descontinuado); se parar de funcionar no futuro, veja https://ai.google.dev/gemini-api/docs/models
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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

// ---------------------------------------------------------------------------
// Validação da consulta gerada pelo Gemini — camada extra, além da que já
// existe dentro da função executar_consulta_ia no Postgres (defesa em
// profundidade: mesmo que uma camada falhe, a outra ainda bloqueia).
// ---------------------------------------------------------------------------
// Espelha, em JS, as guardas da função executar_consulta_ia (defesa em
// profundidade). Normaliza antes de checar — sem comentários de bloco/linha e
// sem aspas de identificador — para fechar bypass por `"net"."x"` e `net/**/.x`.
function validarSqlGeminiOuFalhar(sql: string): void {
  const s = sql
    .trim()
    .replace(/\/\*[\s\S]*?\*\//g, " ") // comentário de bloco
    .replace(/--[^\n]*/g, " ")          // comentário de linha
    .replace(/"/g, " ");                // aspas de identificador

  if (!/^\s*select\s/i.test(s)) {
    throw new Error("Consulta gerada não começa com SELECT — bloqueada.");
  }
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/i.test(s)) {
    throw new Error("Comando não permitido detectado na consulta gerada — bloqueada.");
  }
  if (/;\s*\S/.test(s)) {
    throw new Error("Mais de uma instrução detectada — bloqueada.");
  }
  // F1: nenhuma referência a schema fora de 'public'. gecope_ia_readonly tem
  // USAGE em 'net' (herdado de PUBLIC) e net._http_response pode conter tokens
  // de chamadas HTTP de saída do pg_net.
  if (/\b(net|cron|extensions|auth|storage|vault|graphql|graphql_public|realtime|pgsodium|pgbouncer|pg_temp|pg_toast|information_schema|supabase_migrations|supabase_functions|_analytics|_realtime)\s*\./i.test(s)) {
    throw new Error("Consulta gerada referencia schema fora de public — bloqueada.");
  }
  // F1: nenhum identificador de catálogo do sistema, qualificado ou não.
  if (/\bpg_[a-z0-9_]+/i.test(s)) {
    throw new Error("Consulta gerada referencia catálogo do sistema — bloqueada.");
  }
  // F1: funções de leitura de ambiente / ponte externa.
  if (/\b(dblink|current_setting|set_config|lo_import|lo_export)\b/i.test(s)) {
    throw new Error("Função não permitida detectada na consulta gerada — bloqueada.");
  }
}

// ---------------------------------------------------------------------------
// Chama o Gemini para gerar SQL a partir da pergunta em linguagem natural
// ---------------------------------------------------------------------------
async function gerarSqlComGemini(
  pergunta: string
): Promise<{ sql: string | null; tipo?: "esclarecimento" | "fora_do_escopo"; mensagem?: unknown }> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY não configurada nos secrets da função.");

  const corpoRequisicao = JSON.stringify({
    contents: [
      {
        parts: [{ text: `${SCHEMA_PROMPT}\n\nPERGUNTA DO USUÁRIO: ${pergunta}` }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  const MAX_TENTATIVAS = 2; // 1 tentativa original + 1 repetição em caso de sobrecarga temporária
  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa++) {
    const resposta = await fetch(GEMINI_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-goog-api-key": apiKey,
      },
      body: corpoRequisicao,
    });

    if (resposta.status === 503 && tentativa < MAX_TENTATIVAS) {
      // Sobrecarga temporária do lado do Gemini — espera um pouco e tenta de novo
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }

    if (!resposta.ok) {
      const corpoErro = await resposta.text();
      ultimoErro = new Error(`Erro na API do Gemini (${resposta.status}): ${corpoErro}`);
      break;
    }

    const dados = await resposta.json();
    const textoGerado = dados?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!textoGerado) throw new Error("Resposta do Gemini veio vazia ou em formato inesperado.");

    return JSON.parse(textoGerado);
  }

  throw ultimoErro ?? new Error("Erro desconhecido ao chamar a API do Gemini.");
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
  return `${linhas.length} resultado(s) encontrado(s):\n${linhasFormatadas}${sufixo}`;
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
      await supabase.from("consultas_ia_log").insert({
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
    const respostaGemini = await gerarSqlComGemini(pergunta);

    if (!respostaGemini.sql) {
      const mensagemTexto = paraTextoSeguro(respostaGemini.mensagem) || "Não consegui entender essa pergunta.";
      const ehEsclarecimento = respostaGemini.tipo === "esclarecimento";

      await supabase.from("consultas_ia_log").insert({
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

    validarSqlGeminiOuFalhar(sql);

    // ---- 3. Executa via a função segura (validação dupla + role só-leitura) ----
    const { data: linhas, error: erroExecucao } = await supabase.rpc("executar_consulta_ia", {
      sql_consulta: sql,
    });

    if (erroExecucao) throw erroExecucao;

    const resposta = formatarResultado(linhas ?? []);
    const grafico = detectarGraficoAutomatico(linhas ?? [], pergunta);

    await supabase.from("consultas_ia_log").insert({
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
    console.error("Erro no gecope-assistant:", erro);

    await supabase.from("consultas_ia_log").insert({
      usuario,
      pergunta,
      origem: "gemini",
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
