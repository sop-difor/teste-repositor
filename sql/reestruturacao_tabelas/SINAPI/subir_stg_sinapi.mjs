// Sobe um CSV stg_sinapi_AAAA-MM.csv para a tabela stg_sinapi e roda rt_aplicar_sinapi.
//
// Faz, numa tacada:
//   1) TRUNCATE stg_sinapi
//   2) COPY do CSV para stg_sinapi  (rápido e confiável, aguenta arquivo grande)
//   3) SELECT rt_aplicar_sinapi('AAAA-MM-01')  -> grava o delta no modelo definitivo
//
// A referência (AAAA-MM) sai do nome do arquivo.
//
// Uso:
//   node subir_stg_sinapi.mjs "stg_sinapi_2025-01.csv"
//   node subir_stg_sinapi.mjs "stg_sinapi_2025-01.csv" --so-carregar   (só até o passo 2)
//
// Precisa de um arquivo db-url.local (a string de conexão do banco) nesta pasta
// SINAPI/ OU na pasta reestruturacao_tabelas/ (o script procura nas duas).

import { createReadStream, readFileSync, existsSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import pg from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

const here = dirname(fileURLToPath(import.meta.url));

function acharDbUrl() {
  for (let d = here, i = 0; i < 4; i++, d = dirname(d)) {
    const p = join(d, 'db-url.local');
    if (existsSync(p)) return readFileSync(p, 'utf8').trim();
  }
  return '';
}
const csvArg = process.argv[2];
const soCarregar = process.argv.includes('--so-carregar');

if (!csvArg || !existsSync(csvArg)) {
  console.error('Uso: node subir_stg_sinapi.mjs "stg_sinapi_AAAA-MM.csv" [--so-carregar]');
  process.exitCode = 1; process.exit();
}
const m = basename(csvArg).match(/(\d{4})-(\d{2})/);
if (!m) { console.error('Não achei AAAA-MM no nome do arquivo.'); process.exitCode = 1; process.exit(); }
const referencia = `${m[1]}-${m[2]}-01`;

let cs = process.env.SUPABASE_DB_URL || acharDbUrl();
if (!cs) { console.error('Falta o arquivo db-url.local (com a string de conexao) nesta pasta ou na pasta acima.'); process.exitCode = 1; process.exit(); }
try { const u = new URL(cs); u.searchParams.delete('sslmode'); u.searchParams.delete('ssl'); cs = u.toString(); } catch {}

const c = new pg.Client({ connectionString: cs, ssl: { rejectUnauthorized: false } });
await c.connect();
await c.query('SET statement_timeout = 0');

console.log('1/3  Limpando stg_sinapi...');
await c.query('TRUNCATE stg_sinapi');

console.log(`2/3  Carregando ${basename(csvArg)} ...`);
const ingest = c.query(copyFrom(
  `COPY stg_sinapi (identificacao,codigo,descricao,unidade,preco_unitario,tipo_encargo,referencia,composicao,origem_preco)
   FROM STDIN WITH (FORMAT csv, HEADER true)`
));
await pipeline(createReadStream(csvArg), ingest);
const { rows: [{ n }] } = await c.query('SELECT count(*)::int n FROM stg_sinapi');
console.log(`     ${n} linhas em stg_sinapi.`);

if (soCarregar) {
  console.log('Parando aqui (--so-carregar). Rode depois:  SELECT rt_aplicar_sinapi(\'' + referencia + '\');');
} else {
  console.log(`3/3  rt_aplicar_sinapi('${referencia}') ...`);
  const { rows: [r] } = await c.query('SELECT rt_aplicar_sinapi($1) AS resumo', [referencia]);
  console.log('     ', JSON.stringify(r.resumo));
}

await c.end();
console.log('OK.');
