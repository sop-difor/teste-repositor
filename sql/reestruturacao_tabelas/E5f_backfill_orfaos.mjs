// E5f — Completa os sub-itens "órfãos" das composições SINAPI/SEINFRA.
//
// Órfão = codigo_item que aparece DENTRO de uma composição mas nunca teve linha
// própria em sinapi_itens/seinfra_itens. No modelo antigo a descrição/preço deles
// vinha embutida no JSON. Sem esse backfill, o modal de composição mostra a linha
// do órfão em branco (descrição/unidade vazias, preço 0).
//
// Este script lê o CSV de backup (E0), extrai os embeds dos órfãos e cria:
//   *_item (código + descrição + unidade), *_descricao e *_preco (histórico por mês).
// É idempotente: rodar de novo não duplica nada.
//
// Uso:
//   1) tenha o db-url.local nesta pasta (mesma string da E0)
//   2) node E5f_backfill_orfaos.mjs "CAMINHO/sinapi_itens_2026-09-01.csv" sinapi
//      node E5f_backfill_orfaos.mjs "CAMINHO/seinfra_itens_2026-09-01.csv" seinfra

import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

const here = dirname(fileURLToPath(import.meta.url));
const csvPath = process.argv[2];
const fonte = (process.argv[3] || '').toLowerCase(); // 'sinapi' | 'seinfra'

if (!csvPath || !['sinapi', 'seinfra'].includes(fonte) || !existsSync(csvPath)) {
  console.error('Uso: node E5f_backfill_orfaos.mjs "<caminho do CSV>" <sinapi|seinfra>');
  process.exitCode = 1; process.exit();
}
const urlFile = join(here, 'db-url.local');
let cs = process.argv[4] || (existsSync(urlFile) ? readFileSync(urlFile, 'utf8').trim() : '') || process.env.SUPABASE_DB_URL;
if (!cs) { console.error('Falta a string de conexão (db-url.local).'); process.exitCode = 1; process.exit(); }
try { const u = new URL(cs); u.searchParams.delete('sslmode'); u.searchParams.delete('ssl'); cs = u.toString(); } catch {}

const T = fonte === 'sinapi'
  ? { item: 'sinapi_item', desc: 'sinapi_descricao', preco: 'sinapi_preco', refExpr: `rt_ord_de_data(referencia::date)` }
  : { item: 'seinfra_item', desc: 'seinfra_descricao', preco: 'seinfra_preco', refExpr: `referencia::int` };

const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('SET statement_timeout = 0');
console.log('Conectado. Carregando o CSV numa tabela temporária...');

await c.query('BEGIN');
await c.query(`CREATE TEMP TABLE _bf (
  id bigint, identificacao text, codigo text, descricao text, unidade text,
  preco_unitario numeric, tipo_encargo text, referencia text, created_at timestamptz, composicao jsonb
) ON COMMIT DROP`);

const ingest = c.query(copyFrom(`COPY _bf FROM STDIN WITH (FORMAT csv, HEADER true)`));
await pipeline(createReadStream(csvPath), ingest);
console.log('CSV carregado. Extraindo órfãos...');

const sql = `
WITH emb AS (
  SELECT e.el->>'codigo_item' AS codigo,
         e.el->>'tipo_item' AS tipo_item,
         nullif(e.el->>'descricao_item','') AS descricao,
         nullif(e.el->>'unidade','') AS unidade,
         nullif(e.el->>'preco_unitario','')::numeric AS preco,
         rt_norm_encargo(r.tipo_encargo) AS tipo_encargo,
         ${T.refExpr} AS ord
  FROM _bf r
  CROSS JOIN LATERAL jsonb_array_elements(rt_comp_canon(r.composicao)) e(el)
  WHERE rt_comp_canon(r.composicao) IS NOT NULL AND coalesce(e.el->>'codigo_item','') <> ''
),
orf AS (
  SELECT * FROM emb WHERE NOT EXISTS (SELECT 1 FROM ${T.item} i WHERE i.codigo = emb.codigo)
),
it AS (
  INSERT INTO ${T.item} (codigo, identificacao, descricao, unidade)
  SELECT DISTINCT ON (codigo) codigo,
         CASE WHEN upper(coalesce(tipo_item,'')) LIKE 'COMPOSI%' THEN 'C' ELSE 'I' END,
         coalesce((array_agg(descricao ORDER BY ord DESC) FILTER (WHERE descricao IS NOT NULL))[1], codigo),
         (array_agg(unidade ORDER BY ord DESC) FILTER (WHERE unidade IS NOT NULL))[1]
  FROM orf GROUP BY codigo, CASE WHEN upper(coalesce(tipo_item,'')) LIKE 'COMPOSI%' THEN 'C' ELSE 'I' END
  ON CONFLICT (codigo) DO NOTHING
  RETURNING codigo
),
d AS (
  INSERT INTO ${T.desc} (codigo, vigente_desde_ord, descricao, unidade)
  SELECT i.codigo, min(o.ord), i.descricao, i.unidade
  FROM ${T.item} i JOIN orf o ON o.codigo = i.codigo
  WHERE NOT EXISTS (SELECT 1 FROM ${T.desc} x WHERE x.codigo = i.codigo)
  GROUP BY i.codigo, i.descricao, i.unidade
  ON CONFLICT DO NOTHING
  RETURNING codigo
),
seq AS (
  SELECT codigo, tipo_encargo, ord, preco,
         lag(preco) OVER (PARTITION BY codigo, tipo_encargo ORDER BY ord) AS prev
  FROM (SELECT DISTINCT codigo, tipo_encargo, ord, preco FROM orf) q
),
p AS (
  INSERT INTO ${T.preco} (codigo, tipo_encargo, vigente_desde_ord, preco_unitario)
  SELECT codigo, tipo_encargo, ord, preco FROM seq
  WHERE prev IS DISTINCT FROM preco
    AND NOT EXISTS (SELECT 1 FROM ${T.preco} x
                    WHERE x.codigo = seq.codigo AND x.tipo_encargo = seq.tipo_encargo AND x.vigente_desde_ord = seq.ord)
  ON CONFLICT DO NOTHING
  RETURNING codigo
)
SELECT (SELECT count(*) FROM it) itens, (SELECT count(*) FROM d) descricoes, (SELECT count(*) FROM p) precos,
       (SELECT count(DISTINCT codigo) FROM orf) orfaos_encontrados;
`;
const { rows } = await c.query(sql);
await c.query('COMMIT');
await c.end();
console.log('OK:', rows[0]);
console.log('Reveja um item no modal de composição do sistema.');
