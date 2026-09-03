// guards_test.ts — testes das funções puras de guards.ts.
// Rodar: deno test supabase/functions/gecope-assistant/guards_test.ts
//
// Cobre: validarSqlGeminiOuFalhar (ataques barram, consultas legítimas passam),
// limparSql, interpretarRespostaModelo.

import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  validarSqlGeminiOuFalhar,
  limparSql,
  interpretarRespostaModelo,
} from "./guards.ts";

// --- validarSqlGeminiOuFalhar: deve BARRAR --------------------------------
const ataques: [string, string][] = [
  ["net qualificado", "select 1 from net._http_response"],
  ["aspas", `select 1 from "net"."_http_response"`],
  ["comentário de bloco", "select 1 from net/**/._http_response"],
  ["comentário aninhado", "select 1 from net/*/**/*/._http_response"],
  ["-- em literal", "select 1 where 'x'='--' union select 1 from net._http_response"],
  ["schema_to_xml", "select schema_to_xml('net', true, false, '')"],
  ["database_to_xml", "select database_to_xml(true, false, '')"],
  ["dblink", "select dblink('x', 'select 1')"],
  ["current_setting", "select current_setting('is_superuser')"],
  ["::regclass", "select (concat('n','et'))::regclass::oid"],
  ["current_user", "select current_user, current_catalog"],
  ["pg_ não-qualificado", "select relname from pg_class"],
  ["multi-instrução", "select 1; drop table x"],
  ["não-select", "update processos set fiscal = 'x'"],
  ["função fora da allowlist", "select pg_sleep(10)"],
  ["generate_series", "select generate_series(1, 1000000)"],
];

for (const [nome, sql] of ataques) {
  Deno.test(`barra: ${nome}`, () => {
    assertThrows(() => validarSqlGeminiOuFalhar(sql));
  });
}

// --- validarSqlGeminiOuFalhar: deve PASSAR ------------------------------
const legitimas: [string, string][] = [
  ["count simples", "select count(*) from contratos_edificacao"],
  ["group + order + limit", "select contratada, count(*) from contratos_edificacao group by contratada order by count(*) desc limit 10"],
  ["date_trunc + extract", "select date_trunc('month', data_assinatura), extract(year from data_assinatura) from aditivos_contrato"],
  ["join + coalesce + ilike", "select c.descricao_obra, coalesce(f.saldo_contrato, 0) from contratos_edificacao c join ficha_contrato f on f.id_contrato = c.id_contrato where f.contratada_razao_social ilike '%engenharia%'"],
  ["filter", "select count(*) filter (where status = 'APROVADO') from processos"],
  ["cast ::numeric", "select round(avg(dias_paralisado), 1)::numeric(10,2) from contratos_edificacao"],
  ["date() função", "select date(data_exclusao), count(*) from processos group by 1"],
  ["regexp_replace", "select regexp_replace(processo, '[^0-9]', '', 'g') from processos"],
  ["CTE", "with x as (select contratada, count(*) c from contratos_edificacao group by 1) select * from x order by c desc"],
  ["string_agg", "select string_agg(distinct municipio, ', ') from contratos_edificacao"],
];

for (const [nome, sql] of legitimas) {
  Deno.test(`passa: ${nome}`, () => {
    validarSqlGeminiOuFalhar(sql); // não deve lançar
  });
}

// --- limparSql ---------------------------------------------------------------
Deno.test("limparSql: cerca ```sql", () => {
  assertEquals(limparSql("```sql\nselect 1 from t\n```"), "select 1 from t");
});
Deno.test("limparSql: cerca ```", () => {
  assertEquals(limparSql("```\nselect 1\n```"), "select 1");
});
Deno.test("limparSql: ; final", () => {
  assertEquals(limparSql("select 1 from t ;  "), "select 1 from t");
});
Deno.test("limparSql: sem alteração", () => {
  assertEquals(limparSql("select 1 from t"), "select 1 from t");
});

// --- interpretarRespostaModelo --------------------------------------------
Deno.test("interpretar: JSON puro", () => {
  assertEquals(interpretarRespostaModelo('{"sql": "select 1 from t"}').sql, "select 1 from t");
});
Deno.test("interpretar: JSON com cerca markdown", () => {
  assertEquals(interpretarRespostaModelo('```json\n{"sql": "select 1 from t"}\n```').sql, "select 1 from t");
});
Deno.test("interpretar: JSON com sql em cerca", () => {
  assertEquals(interpretarRespostaModelo('{"sql": "```sql\\nselect 1 from t\\n```"}').sql, "select 1 from t");
});
Deno.test("interpretar: esclarecimento", () => {
  const r = interpretarRespostaModelo('{"sql": null, "tipo": "esclarecimento", "mensagem": "qual período?"}');
  assertEquals(r.sql, null);
  assertEquals(r.tipo, "esclarecimento");
});
Deno.test("interpretar: SQL cru sem JSON", () => {
  assertEquals(interpretarRespostaModelo("select 1 from t").sql, "select 1 from t");
});
Deno.test("interpretar: lixo -> lança", () => {
  assertThrows(() => interpretarRespostaModelo("desculpe, não entendi a pergunta"));
});
