// guards.ts — funções puras de validação/saneamento do SQL do modelo.
// Extraídas de index.ts na F2 para poderem ser testadas isoladamente
// (index.ts chama Deno.serve no load, então não é importável num teste).
//
// Estas guardas são a CÓPIA em JS das checagens da função Postgres
// executar_consulta_ia (defesa em profundidade). Ao mexer aqui, mexer lá também
// (sql/assistente/f*.sql) e vice-versa.

// Nomes que podem aparecer como `nome(` — funções analíticas seguras + palavras
// -chave SQL que precedem parêntese. Espelha funcoes_ok da função SQL.
export const FUNCOES_OK = new Set([
  "select","from","where","and","or","not","in","exists","on","over","filter",
  "values","case","when","by","all","any","some","using","as","into","distinct",
  "order","group","having","limit","offset","union","intersect","except","join",
  "cross","inner","left","right","full","outer","natural","lateral","within",
  "returning","partition","rows","range","between","ilike","like","similar","with",
  "count","sum","avg","min","max","stddev","stddev_pop","stddev_samp","variance",
  "var_pop","var_samp","corr","mode","percentile_cont","percentile_disc",
  "row_number","rank","dense_rank","percent_rank","cume_dist","ntile","lag","lead",
  "first_value","last_value","nth_value","bool_and","bool_or","every",
  "string_agg","array_agg","json_agg","jsonb_agg",
  "round","trunc","ceil","ceiling","floor","abs","sign","mod","power","sqrt","div",
  "greatest","least",
  "lower","upper","initcap","trim","btrim","ltrim","rtrim","length","char_length",
  "character_length","octet_length","substr","substring","lpad","rpad","position",
  "strpos","replace","translate","concat","concat_ws","format","split_part","starts_with",
  "reverse","repeat","overlay","md5","encode","decode","chr","ascii","left","right",
  "string_to_array","array_to_string","array_length","cardinality","unnest",
  "regexp_replace","regexp_match","regexp_matches","regexp_count","regexp_split_to_array",
  "to_char","to_date","to_number","to_timestamp","date_trunc","date_part","date_bin",
  "extract","age","now","current_date","current_time","current_timestamp","localtime",
  "localtimestamp","make_date","make_timestamp","make_interval","justify_days",
  "justify_hours","justify_interval",
  "date","time","timestamp","interval","numeric","int","int4","int8","bigint","integer",
  "text","varchar","bool","boolean","real","float","double",
  "exp","ln","log","width_bucket",
  "to_json","to_jsonb","json_build_object","jsonb_build_object","row_to_json",
  "json_object_agg","jsonb_object_agg",
  "cast","coalesce","nullif","nvl",
]);

// Rejeita SQL inseguro. Lança Error com mensagem legível. Espelha as guardas de
// executar_consulta_ia (F1) — não normaliza (rejeita comentário/aspas de saída).
export function validarSqlGeminiOuFalhar(sql: string): void {
  const s = sql.trim();

  if (/\/\*|\*\/|--|"/.test(s)) {
    throw new Error("Consulta gerada usa comentário ou aspas — bloqueada.");
  }
  if (!/^\s*(select|with)\s/i.test(s)) {
    throw new Error("Consulta gerada não começa com SELECT/WITH — bloqueada.");
  }
  if (/\b(insert|update|delete|drop|alter|truncate|grant|revoke|create)\b/i.test(s)) {
    throw new Error("Comando não permitido detectado na consulta gerada — bloqueada.");
  }
  if (/;\s*\S/.test(s)) {
    throw new Error("Mais de uma instrução detectada — bloqueada.");
  }
  if (/\b(net|cron|extensions|auth|storage|vault|graphql|graphql_public|realtime|pgsodium|pgbouncer|pg_temp|pg_toast|information_schema|supabase_migrations|supabase_functions|_analytics|_realtime)\s*\./i.test(s)) {
    throw new Error("Consulta gerada referencia schema fora de public — bloqueada.");
  }
  if (/\bpg_[a-z0-9_]+/i.test(s)) {
    throw new Error("Consulta gerada referencia catálogo do sistema — bloqueada.");
  }
  if (/::\s*reg[a-z]+/i.test(s) || /\breg(class|role|namespace|proc|procedure|type|oper|operator|config|dictionary)\b/i.test(s)) {
    throw new Error("Consulta gerada usa cast para tipo de catálogo (reg*) — bloqueada.");
  }
  if (/\b(current_catalog|current_role|current_user|current_schema|session_user|system_user)\b/i.test(s)) {
    throw new Error("Consulta gerada referencia identidade da sessão — bloqueada.");
  }
  for (const m of s.toLowerCase().matchAll(/([a-z_][a-z0-9_]+)\s*\(/g)) {
    if (!FUNCOES_OK.has(m[1])) {
      throw new Error(`Função não permitida na consulta gerada: ${m[1]} — bloqueada.`);
    }
  }
}

// Limpa o SQL que o modelo devolveu: tira cercas de markdown, ; final, espaços.
export function limparSql(sql: string): string {
  return sql
    .trim()
    .replace(/^```(?:json|sql|postgresql)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/;\s*$/, "")
    .trim();
}

export type RespostaModelo = {
  sql: string | null;
  tipo?: "esclarecimento" | "fora_do_escopo";
  mensagem?: unknown;
};

// Interpreta o texto do modelo. Esperado: JSON {"sql": "..."} etc.
// Tolera cerca de markdown em volta do JSON e SQL cru sem JSON.
export function interpretarRespostaModelo(texto: string): RespostaModelo {
  const t = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const obj = JSON.parse(t) as RespostaModelo;
    if (obj && typeof obj === "object") {
      if (obj.sql != null) obj.sql = limparSql(String(obj.sql));
      return obj;
    }
  } catch {
    // não era JSON — pode ser SQL cru
  }
  if (/^\s*(select|with)\s/i.test(t)) return { sql: limparSql(t) };
  throw new Error("Resposta do modelo não é JSON nem SQL reconhecível.");
}
