require('dotenv').config();
const http = require('http');
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EVO_API_URL = process.env.EVO_API_URL;
const EVO_API_KEY = process.env.EVO_API_KEY;
const EVO_INSTANCE = process.env.EVO_INSTANCE;
const EVO_CONTAINER_NAME = process.env.EVO_CONTAINER_NAME || 'gecope-evolution-api';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !EVO_API_URL || !EVO_API_KEY || !EVO_INSTANCE) {
  console.error('ERRO CRÍTICO: variáveis de ambiente faltando para o watchdog.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const POLL_INTERVAL_MS = parseInt(process.env.WATCHDOG_POLL_MS || '30000', 10);
// Tempo de degradação sustentada antes de reiniciar sozinho — evita reiniciar por uma
// falha isolada/blip momentâneo (ex.: uma requisição lenta), só por algo persistente.
const DEGRADED_GRACE_MS = parseInt(process.env.WATCHDOG_DEGRADED_GRACE_MS || '120000', 10);
// Intervalo mínimo entre reinícios automáticos — sem isso, um problema que o restart não
// resolve (ex.: sessão realmente deslogada no celular) faria o watchdog reiniciar em loop
// a cada ciclo, sem ganho nenhum.
const RESTART_COOLDOWN_MS = parseInt(process.env.WATCHDOG_RESTART_COOLDOWN_MS || '300000', 10);
// Cooldown BEM menor, só para pedidos manuais — evita que um clique duplicado no botão
// "Reiniciar Conexão" dispare dois restarts seguidos, mas sem herdar o cooldown de 5min do
// restart automático. Sem isso, um admin que clicasse o botão minutos depois de o watchdog
// já ter reiniciado sozinho por degradação teria o pedido silenciosamente ignorado por
// `cooldownOk` (ver tick() abaixo) — a UI mostrava "pedido enviado" e nada acontecia, sem
// nenhum sinal de que o clique não teve efeito nenhum.
const MANUAL_RESTART_COOLDOWN_MS = parseInt(process.env.WATCHDOG_MANUAL_RESTART_COOLDOWN_MS || '30000', 10);
const FAILURE_WINDOW_MS = parseInt(process.env.WATCHDOG_FAILURE_WINDOW_MS || '600000', 10);
const FAILURE_THRESHOLD = parseInt(process.env.WATCHDOG_FAILURE_THRESHOLD || '2', 10);

// Fala com o Docker Engine local via socket Unix — sem biblioteca externa (dockerode),
// só http nativo do Node, para não precisar mexer no package-lock.json. O watchdog NUNCA
// escuta porta nenhuma: só inicia conexões para fora (Supabase, Evolution) e para o socket
// local. Nada na rede consegue "chamar" o watchdog — é isso que mantém o acesso ao Docker
// isolado do que recebe tráfego da internet (ver comentário no docker-compose.yml).
function dockerRequest(path, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: '/var/run/docker.sock', path, method, timeout: 15000 }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout ao falar com o Docker socket')));
    req.end();
  });
}

async function restartEvolutionContainer() {
  const { status, body } = await dockerRequest(`/containers/${EVO_CONTAINER_NAME}/restart?t=10`, 'POST');
  if (status !== 204) throw new Error(`Docker retornou status ${status}: ${body}`);
}

async function getEvolutionState() {
  try {
    const res = await fetch(`${EVO_API_URL}/instance/connectionState/${EVO_INSTANCE}`, {
      headers: { apikey: EVO_API_KEY },
      timeout: 10000
    });
    if (!res.ok) return 'error';
    const data = await res.json().catch(() => null);
    return data?.instance?.state || 'unknown';
  } catch {
    return 'unreachable';
  }
}

// Sinal complementar ao connectionState: o incidente real que motivou este watchdog foi
// exatamente a Evolution API reportando state:"open" (sessão salva parecia boa) enquanto
// o envio de fato falhava com "Connection Closed" — o estado em cache mentia. Falhas
// recentes e recorrentes em whatsapp_jobs com esse padrão de erro são o sinal que pega
// esse caso, quando o connectionState sozinho não pegaria.
async function hasRecentConnectionFailures() {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString();
  const { data, error } = await sb
    .from('whatsapp_jobs')
    .select('id, result')
    .eq('status', 'failed')
    .gte('finished_at', since);

  if (error || !data) return false;
  const padraoErroConexao = /connection closed|precondition|econnrefused|logout|428/i;
  const count = data.filter(j => padraoErroConexao.test(JSON.stringify(j.result || ''))).length;
  return count >= FAILURE_THRESHOLD;
}

async function getControlRow() {
  const { data, error } = await sb.from('whatsapp_control').select('*').eq('id', 1).maybeSingle();
  if (error) throw error;
  return data;
}

async function updateControlRow(fields) {
  const { error } = await sb.from('whatsapp_control')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', 1);
  if (error) console.error('[watchdog] erro ao atualizar whatsapp_control:', error.message);
}

let lastAutoRestartAt = 0;
let lastManualRestartAt = 0;
// Espelha degraded_since do banco em memória para não precisar reler a cada ciclo só para
// saber "desde quando" — evita uma corrida boba de leitura/escrita no mesmo ciclo.
let degradedSinceMemory = null;

async function tick() {
  const control = await getControlRow();
  const state = await getEvolutionState();
  const recentFailures = await hasRecentConnectionFailures();
  const isBad = state !== 'open' || recentFailures;

  if (isBad && !degradedSinceMemory) {
    degradedSinceMemory = new Date().toISOString();
    await updateControlRow({ degraded_since: degradedSinceMemory });
    console.log(`[watchdog] Degradado detectado (state=${state}, falhas_recentes=${recentFailures}).`);
  } else if (!isBad && degradedSinceMemory) {
    degradedSinceMemory = null;
    await updateControlRow({ degraded_since: null });
    console.log('[watchdog] Conexão normalizada.');
  }

  const manualRequest = !!control?.restart_requested_at &&
    (!control.last_restarted_at || new Date(control.restart_requested_at) > new Date(control.last_restarted_at));
  const sustainedBad = !!degradedSinceMemory &&
    (Date.now() - new Date(degradedSinceMemory).getTime() >= DEGRADED_GRACE_MS);

  // Cooldowns independentes: um pedido manual só é barrado por cliques manuais recentes
  // demais (MANUAL_RESTART_COOLDOWN_MS), nunca pelo cooldown de 5min do restart automático
  // — antes os dois caíam no mesmo `cooldownOk`, e um restart automático recente podia
  // engolir silenciosamente o clique de um admin em "Reiniciar Conexão" logo em seguida.
  const manualCooldownOk = (Date.now() - lastManualRestartAt) >= MANUAL_RESTART_COOLDOWN_MS;
  const autoCooldownOk = (Date.now() - lastAutoRestartAt) >= RESTART_COOLDOWN_MS;

  const shouldRestartManual = manualRequest && manualCooldownOk;
  const shouldRestartAuto = !manualRequest && sustainedBad && autoCooldownOk;

  if (shouldRestartManual || shouldRestartAuto) {
    console.log(`[watchdog] Reiniciando ${EVO_CONTAINER_NAME} (motivo: ${shouldRestartManual ? 'pedido manual' : 'degradado sustentado'}).`);
    // Cooldown é gravado ANTES da tentativa, não só em caso de sucesso. Incidente real
    // (2026-08-24): quando restartEvolutionContainer() falhava (ex.: Docker sobrecarregado
    // por restarts em sequência, socket dando timeout), o cooldown nunca era ativado — o
    // watchdog tentava de novo a cada ciclo (30s), sem parar, cada tentativa interrompendo
    // o boot do evolution-api no meio (~10s para subir). Isso o impedia de terminar de
    // subir para sempre, e só um `docker stop` manual no watchdog quebrava o loop.
    const now = Date.now();
    if (shouldRestartManual) lastManualRestartAt = now; else lastAutoRestartAt = now;
    try {
      await restartEvolutionContainer();
      await updateControlRow({ last_restarted_at: new Date().toISOString() });
    } catch (err) {
      console.error('[watchdog] falha ao reiniciar container:', err.message);
    }
  } else if (manualRequest && !manualCooldownOk) {
    // Pedido manual existe mas foi barrado pelo cooldown — loga para não ficar invisível
    // (o admin só via "pedido enviado" no front-end e nada acontecia, sem rastro nenhum).
    console.warn(`[watchdog] Pedido manual de restart ignorado por cooldown (${Math.ceil((MANUAL_RESTART_COOLDOWN_MS - (Date.now() - lastManualRestartAt)) / 1000)}s restantes).`);
  }
}

async function mainLoop() {
  console.log(`[watchdog] iniciado — verificando a cada ${POLL_INTERVAL_MS}ms.`);
  while (true) {
    try {
      await tick();
    } catch (err) {
      console.error('[watchdog] erro no ciclo:', err.message);
    }
    await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
  }
}

mainLoop();
