// index.ts — Edge Function: gecope-assistant-painel
// F7: leitura agregada de consultas_ia_log para a página assistente-painel.html.
// Função separada da gecope-assistant (que pergunta+grava): esta só lê, nunca
// escreve, e existe puramente para dar números/observabilidade ao uso do
// assistente e uma lista do que falhou ou levou 👎 (a matéria-prima da rotina
// "falha → intenção ou caso de eval", ver docs/assistente/rotina-revisao-falhas.md).
//
// Acesso: exige a mesma sessão real do GECOPE que a gecope-assistant (JWT via
// auth.getUser) — sem checagem de cargo/permissão por decisão do usuário
// (05/09/2026): qualquer pessoa logada no GECOPE com o link consegue abrir.
// Revisitar quando o piloto (F8) começar de verdade.
//
// consultas_ia_log só tem policy de escrita/leitura para service_role (F1) —
// por isso o painel não lê a tabela direto do navegador: passa por aqui,
// que usa a mesma SUPABASE_SERVICE_ROLE_KEY da gecope-assistant.

import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // restrinja ao domínio do GECOPE em produção
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Teto de linhas trazidas para agregar em JS — um piloto de ~10-20 pessoas
// não chega perto disso tão cedo; se um dia chegar, isso vira uma consulta
// agregada no banco em vez de trazer tudo.
const LIMITE_LINHAS_AGREGACAO = 5000;
const LIMITE_LISTA_PROBLEMAS = 50;

type LinhaLog = {
  id: number;
  usuario: string | null;
  pergunta: string;
  origem: string | null;
  sucesso: boolean | null;
  erro: string | null;
  veredito: string | null;
  created_at: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // ---- Autenticação: mesma exigência da gecope-assistant (F1) ----
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return new Response(
      JSON.stringify({ erro: "Entre no GECOPE para ver o painel." }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
  const { data: { user }, error: erroAuth } = await supabase.auth.getUser(token);
  if (erroAuth || !user) {
    return new Response(
      JSON.stringify({ erro: "Sua sessão do GECOPE expirou. Entre novamente." }),
      { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }

  try {
    const { data, error } = await supabase
      .from("consultas_ia_log")
      .select("id, usuario, pergunta, origem, sucesso, erro, veredito, created_at")
      .order("created_at", { ascending: false })
      .limit(LIMITE_LINHAS_AGREGACAO);

    if (error) throw error;

    const linhas = (data ?? []) as LinhaLog[];

    const porOrigem: Record<string, number> = {};
    let sucessos = 0;
    let falhas = 0;
    let positivos = 0;
    let negativos = 0;

    for (const l of linhas) {
      const origem = l.origem ?? "desconhecida";
      porOrigem[origem] = (porOrigem[origem] ?? 0) + 1;
      if (l.sucesso === true) sucessos++;
      if (l.sucesso === false) falhas++;
      if (l.veredito === "positivo") positivos++;
      if (l.veredito === "negativo") negativos++;
    }

    const problemas = linhas
      .filter((l) => l.sucesso === false || l.veredito === "negativo")
      .slice(0, LIMITE_LISTA_PROBLEMAS)
      .map((l) => ({
        id: l.id,
        pergunta: l.pergunta,
        origem: l.origem,
        erro: l.erro,
        veredito: l.veredito,
        criadoEm: l.created_at,
      }));

    return new Response(
      JSON.stringify({
        total: linhas.length,
        totalTruncado: linhas.length === LIMITE_LINHAS_AGREGACAO,
        porOrigem,
        sucessos,
        falhas,
        positivos,
        negativos,
        problemas,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  } catch (erro) {
    console.error("Erro no gecope-assistant-painel:", erro);
    return new Response(
      JSON.stringify({ erro: "Não consegui carregar os números agora. Tente novamente em instantes." }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } }
    );
  }
});
