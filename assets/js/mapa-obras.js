(async function(){
try{
// lê os tokens de cor direto do :root (assets/css/mapa-obras.css) — regra da Fase 2:
// nenhuma cor pode ser hardcoded aqui e também no CSS; o JS só tem a leitura, o CSS
// é a única fonte da verdade da paleta.
// getComputedStyle(document.documentElement) é um objeto VIVO: depois que a classe
// 'theme-dark' entra/sai da raiz, reler _tok() já devolve os valores do outro tema.
// readTokens() reaproveita isso na troca ao vivo de tema (Bloco 6) — ver repaintTheme().
const _cs=getComputedStyle(document.documentElement);
const _tok=k=>_cs.getPropertyValue(k).trim();
function readTokens(){ return {
  ng:_tok('--ng'), ngRgb:_tok('--ng-rgb'), amber:_tok('--amber'),
  statusExec:_tok('--status-exec'), statusOk:_tok('--status-ok'), statusWait:_tok('--status-wait'), statusStop:_tok('--status-stop'),
  mapBase:_tok('--map-base'), mapOpenFill:_tok('--map-open-fill'), mapOpenBorder:_tok('--map-open-border'),
  mapGroupBorder:_tok('--map-group-border'), mapStateFill:_tok('--map-state-fill'), mapStateHover:_tok('--map-state-hover'),
  textBrightest:_tok('--text-brightest'),
  // Bloco 4: cor das linhas de hover/seleção do mapa e a fórmula da coroplética
  // (opacidade = floor + span·t). Vêm do CSS por tema; fallback = valores de sempre.
  mapLine:_tok('--map-line')||_tok('--text-brightest'),
  choroFloor:parseFloat(_tok('--choro-floor'))||0.10, choroSpan:parseFloat(_tok('--choro-span'))||0.62,
  // Etapa C — cinza de "sem correspondência" (filtro ativo, 0 contratos na área).
  // Tokens --nomatch-* definidos nos dois temas; CSS é a única fonte da cor.
  nomatchFill:_tok('--nomatch-fill'), nomatchBorder:_tok('--nomatch-border'),
}; }
// TOKENS continua const (referência estável usada em todo o arquivo); na troca de
// tema o conteúdo é reescrito no lugar com Object.assign, não trocado o objeto.
const TOKENS=readTokens();
document.body.classList.add('boot-loading'); // pulso nos KPIs/gráficos até a 1ª carga de dados terminar (sucesso ou erro)

let GEO, ESTADO, GRP, MUN, DISTRITOS, NAMEIDX;
try{
  const _fetchJson=u=>fetch(u).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' em '+u); return r.json(); });
  const [_muni,_estado,_blocos,_ref]=await Promise.all([
    _fetchJson('assets/geo/ce-municipios.json'),
    _fetchJson('assets/geo/ce-estado.json'),
    _fetchJson('assets/geo/ce-blocos.json'),
    _fetchJson('assets/geo/ce-referencia.json'),
  ]);
  GEO=_muni; ESTADO=_estado; GRP=_blocos;
  MUN=_ref.MUN; DISTRITOS=_ref.DISTRITOS; NAMEIDX=_ref.NAMEIDX;
}catch(e){
  console.error('Falha ao carregar dados geográficos:',e);
  showDataError('Não foi possível carregar os dados geográficos do mapa. Verifique a conexão e recarregue a página.');
  throw e;
}
/* ============================================================
   CONEXÃO COM O SUPABASE
   URL/chave vêm de config.js (window.SUPABASE_URL/KEY), a mesma
   fonte usada pelo resto do GECOPE — carregue config.js antes
   deste script. Requer política RLS de leitura (SELECT) para o
   papel anon nas tabelas abaixo. Se o Supabase estiver inacessível,
   o painel mostra um erro explícito (showDataError) — não há
   dataset de demonstração.
   ============================================================ */
const SB_URL=window.SUPABASE_URL;
const SB_KEY=window.SUPABASE_KEY;
const SB_TABLE='contratos_edificacao';
const SB_COMISSAO='comissao_fiscalizacao';
const SB_ADITIVOS='aditivos_contrato';
const SB_FICHA='ficha_contrato';
const SB_MEDICOES='medicoes'; // Etapa B: curva de evolução da medição na aba Resumo
// só as colunas realmente usadas em mapRow()/openModal() — evita select=* (a tabela
// tem ~38 colunas, várias nunca lidas pelo app) e o payload extra que vem junto.
const CONTRATOS_COLS=['id_obra','nr_contrato_sop','codigo_obra','descricao_obra','descricao_tipo_contrato',
  'contratada','contratante','municipio','status_contrato','status_obra','data_assinatura','data_inicio_real',
  'valor_atual_contrato','valor_atual','valor_original','total_aditivo','total_reajuste','total_realinhado',
  'dias_paralisado','data_fim_previsto','distrito_operacional','nr_contrato_ext','nr_contrato_sic','nr_os',
  'prazo_execucao','prazo_vigencia_contrato',
  'data_fim_vigencia_contrato','cnpj_contratada','cnpj_contratante','atualizado_em'].join(',');
// prazo_execucao/prazo_vigencia_contrato: prazo ORIGINAL contratado em dias (aba
// Aditivos de prazo). nr_os: nº da ordem de serviço (bloco Detalhes do Resumo).
const COMISSAO_COLS='id_obra,nome_completo,nome_referencia,tipo,matricula';
// aditivos_contrato/ficha_contrato não têm id_obra — a chave de junção com
// contratos_edificacao é nr_contrato_sop (texto, já denormalizado nas duas tabelas,
// evita depender de ficha_contrato.id_contrato pra cruzar com aditivos_contrato).
// data_publicacao é a data que a coluna "Publicação" das tabelas de aditivos mostra
// (antes ela exibia data_assinatura por engano — 92% dos aditivos têm as duas datas
// diferentes). observacao é a descrição textual do aditivo, exibida como linha de
// apoio nas tabelas. data_protocolo existe na tabela mas ainda não é exibida.
const ADITIVOS_COLS='nr_contrato_sop,nr_aditivo,tipo_aditivo,observacao,valor_aprovado,valor_supressao,valor_repercussao,execucao_aprovado,prazo_aprovado,nr_protocolo,data_assinatura,data_publicacao';
// ficha_contrato é NÍVEL CONTRATO (1 linha por nr_contrato_sop, agrega todas as obras).
// valor_original/valor_atual entram para o "contexto do contrato" nos contratos multi-obra.
const FICHA_COLS='nr_contrato_sop,total_medido,percentual_total_medido,valor_original,valor_atual';
// medicoes: junção por id_obra (como comissao_fiscalizacao). Alimenta a tabela mensal
// da aba Medições e a curva "Evolução da medição" do Resumo.
// Colunas de valor (todas POR PERÍODO, não acumuladas): `valor_medido` = bruto medido;
// `valor_ref_glosa` = glosa do período; `total` = LÍQUIDO (bruto − glosa − retenções).
// O "total medido" e a curva usam `total` (líquido); a tabela mostra os 3.
// A situação da medição é sigla_status_medicao (a coluna "status" não existe — o SELECT
// com ela fazia o PostgREST devolver 400 e a aba Medições/curva ficavam sempre vazias).
const MEDICOES_COLS='id_obra,periodo,nr_medicao,valor_medido,valor_ref_glosa,valor_atual,nr_protocolo,total,sigla_status_medicao';
// referência estática dos códigos de situação da medição (STM) exibida na aba
// Medições — só rótulos, não vem do banco (o modelo do usuário traz esta lista).
const STM_LEGENDA=[
  ['ABE','Aberta'],['ACR','Aguardando correção'],['AVA','Aguardando validação'],['APT','Aguardando protocolo'],
  ['AAS','Aguardando assinatura'],['AFI','Aguardando financeiro'],['ECD','Em conferência de docs.'],['FEC','Fechada'],
];
// carteira ativa = tudo que não é "concluído/encerrado" (ver statusBucket) — é o recorte
// que a SOP-CE de fato gerencia; os outros ~90% do histórico só aparecem sob demanda
// (toggle "Histórico completo"), porque não mudam mais e só diluiriam os KPIs/gráficos.
const ACTIVE_STATUSES=['Em Execução','Aguardando OS','Paralisada'];

// monta o objeto que o app consome (obras entram depois, no loadData).
// O módulo opera exclusivamente por Distrito Operacional — os dados de "Região"
// (ce-referencia.json:REGIOES, ce-blocos.json:reg) continuam no disco, mas não
// são mais lidos pelo app.
const DB={distritos:DISTRITOS, municipios:{}};
for(const cod in MUN){ DB.municipios[cod]={nome:MUN[cod].nome, do:MUN[cod].do, obras:[]}; }

// Escapa texto vindo do banco (contratos_edificacao/comissao_fiscalizacao) antes de
// injetar via innerHTML \u2014 p\u00e1gina p\u00fablica, sem login, ent\u00e3o qualquer HTML gravado
// nesses campos (objeto, contratada, contratante, fiscal, status etc.) executaria
// no navegador de qualquer visitante do Mapa de Obras.
function escHtml(s){ return String(s??'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function normTxt(s){return (s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z ]/g,' ').replace(/\s+/g,' ').trim();}
// normaliza mantendo digitos (necessario p/ diferenciar 1o/2o/3o membro)
function normTxtNum(s){return (s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
// classifica o "tipo" de um integrante da comissao num rotulo padronizado + rank.
// `rank` = ordem de EXIBI\u00c7\u00c3O na lista da comiss\u00e3o (protocolo: Fiscal, Presidente,
// 1\u00ba..4\u00ba Membro, Membro, Suplente). N\u00c3O define sozinho quem \u00e9 o fiscal respons\u00e1vel \u2014
// isso \u00e9 pickFiscal() (Fiscal, sen\u00e3o 1\u00ba Membro).
function classifyComissao(tipoRaw){
  const t=normTxtNum(tipoRaw);
  // SUPLENTE primeiro: "1\u00ba Suplente" cont\u00e9m "1" (viraria 1\u00ba Membro) e "Fiscal
  // Suplente" cont\u00e9m "FISCAL" (viraria titular).
  if(t.includes('SUPLENTE')) return {label:'SUPLENTE', rank:0};
  if(t.includes('FISCAL')) return {label:'FISCAL', rank:7};
  if(t.includes('PRESIDENTE')) return {label:'PRESIDENTE', rank:6};
  if(t.includes('1') || t.includes('PRIMEIRO')) return {label:'1\u00ba MEMBRO', rank:5};
  if(t.includes('2') || t.includes('SEGUNDO')) return {label:'2\u00ba MEMBRO', rank:4};
  if(t.includes('3') || t.includes('TERCEIRO')) return {label:'3\u00ba MEMBRO', rank:3};
  if(t.includes('4') || t.includes('QUARTO')) return {label:'4\u00ba MEMBRO', rank:2};
  if(t.includes('MEMBRO')) return {label:'MEMBRO', rank:1};
  return {label: tipoRaw ? String(tipoRaw).toUpperCase() : 'MEMBRO', rank:-1};
}
// fiscal RESPONS\u00c1VEL: quem tem tipo "Fiscal"; sen\u00e3o o "1\u00ba Membro" (conselhos sem
// fiscal nomeado); sen\u00e3o o primeiro da lista (maior rank). Os demais s\u00e3o auxiliares \u2014
// continuam na lista completa da comiss\u00e3o.
function pickFiscal(com){
  if(!com || !com.length) return null;
  return com.find(m=>m.tipo==='FISCAL') || com.find(m=>m.tipo==='1\u00ba MEMBRO') || com[0];
}
// classificação da situação da obra em 4 estados fixos, cada um com cor reservada
// (nunca a mesma paleta usada nos distritos/regiões do mapa, para não confundir os dois canais de cor)
const STATUS_STATES=[
  {key:'exec', label:'Em execução',  color:TOKENS.statusExec},
  {key:'ok',   label:'Concluída/encerrada', color:TOKENS.statusOk},
  {key:'wait', label:'Aguardando OS', color:TOKENS.statusWait},
  {key:'stop', label:'Paralisada',   color:TOKENS.statusStop},
];
// .color é copiado de TOKENS no load; renderStatusChart() emite style="background:.."
// a partir daqui. Na troca de tema ao vivo, repaintTheme() chama isto pra re-derivar.
function syncStatusColors(){
  const m={exec:TOKENS.statusExec, ok:TOKENS.statusOk, wait:TOKENS.statusWait, stop:TOKENS.statusStop};
  STATUS_STATES.forEach(s=>{ s.color=m[s.key]; });
}
function statusBucket(rawStatus){
  const s=normTxt(rawStatus);
  if(s.includes('PARALIS')) return 'stop';
  if(s.includes('AGUARDANDO')) return 'wait';
  if(s.includes('ENCERRADO')||s.includes('CONCLU')) return 'ok';
  return 'exec';
}
function num(x){const n=parseFloat(x);return isFinite(n)?n:0;}
// Etapa C — buckets de filtro pré-computados por obra (uma vez, aqui e no loadData),
// para que passF() não recalcule nada por chamada (roda dezenas de milhares de vezes
// por frame de mapa). Faixas: limite inferior inclusivo, superior exclusivo (a faixa
// 75–100% inclui 100%; ">100%" é estritamente acima). Prazo: reusa prazoCalc.
function faixaValorBucket(v){ return v<1e6?'ate1m':v<5e6?'1a5m':v<20e6?'5a20m':'acima20m'; }
function prazoDateBucket(iniStr,fimStr){
  const c=prazoCalc(iniStr,fimStr);
  if(!c) return 'semdata';
  return c.overdue?'vencido':(c.remainingDays<=30?'avencer':'ok');
}
function medicaoBucket(pct){
  if(pct==null) return 'semficha';
  const x=num(pct);
  return x<25?'0a25':x<50?'25a50':x<75?'50a75':x<=100?'75a100':'acima100';
}
function mapRow(r){
  const ano=r.data_assinatura?+String(r.data_assinatura).slice(0,4):(r.data_inicio_real?+String(r.data_inicio_real).slice(0,4):null);
  // 1 contrato : N obras. contratos_edificacao tem 1 linha por OBRA. `valor` é o valor
  // DESTA obra (valor_atual → valor_original → só como último recurso o do contrato);
  // `valorContrato` (= valor_atual_contrato, igual em todas as obras do contrato) e
  // `nObras` são preenchidos no loadData. Métrica do mapa soma `valor` → sem contar o
  // contrato N vezes.
  const valor=num(r.valor_atual)||num(r.valor_original)||num(r.valor_atual_contrato);
  return {id_obra:r.id_obra, contrato:r.nr_contrato_sop||r.codigo_obra||('#'+r.id_obra), codigo_obra:r.codigo_obra||'',
    objeto:r.descricao_obra||'—', tipo:r.descricao_tipo_contrato||'', contratada:r.contratada||'—', contratante:r.contratante||'—',
    municipioTxt:r.municipio||'', status:r.status_contrato||r.status_obra||'—', statusObra:r.status_obra||'—', ano, valor,
    valorContrato:num(r.valor_atual_contrato)||valor, nObras:1, valorOriginalContrato:num(r.valor_original),
    valor_original:num(r.valor_original), aditivo:num(r.total_aditivo), reajuste:num(r.total_reajuste),
    realinhado:num(r.total_realinhado), paralisado:num(r.dias_paralisado),
    assinatura:r.data_assinatura||'', fim_prev:r.data_fim_previsto||'', fiscal:'—', raw:r,
    // buckets de filtro (Etapa C) — distrito e medição são preenchidos no loadData,
    // onde o código do município e o.ficha já são conhecidos.
    distrito:null, medicaoBucket:'semficha',
    faixaValorBucket:faixaValorBucket(valor),
    prazoExecBucket:prazoDateBucket(r.data_inicio_real,r.data_fim_previsto),
    vigenciaBucket:prazoDateBucket(r.data_inicio_real,r.data_fim_vigencia_contrato),
    paralisadaBucket:num(r.dias_paralisado)>0?'sim':'nao'};
}
// Busca uma tabela paginada. A 1ª página pede a contagem total via
// `Prefer: count=exact` (o servidor devolve em Content-Range: "0-999/N") — a partir
// daí as páginas restantes são conhecidas de antemão e disparadas todas em paralelo
// (Promise.all), em vez de um `while` sequencial esperando página a página.
async function fetchTable(tbl,{select='*',filter=''}={}){
  const qs=`select=${encodeURIComponent(select)}${filter?'&'+filter:''}`;
  const headers={apikey:SB_KEY, Authorization:'Bearer '+SB_KEY};
  const PAGE=1000;
  const first=await fetch(`${SB_URL}/rest/v1/${tbl}?${qs}`,{headers:{...headers, Range:`0-${PAGE-1}`, Prefer:'count=exact'}});
  if(!first.ok) throw new Error('HTTP '+first.status+' em '+tbl+' — verifique URL/chave/RLS');
  const firstChunk=await first.json();
  const range=first.headers.get('content-range'); // "0-999/3577"
  const total=range && range.includes('/') ? parseInt(range.split('/')[1],10) : NaN;
  if(!isFinite(total)){ console.warn('Content-Range ausente/inválido em '+tbl+' — assumindo que a 1ª página já é a tabela inteira ('+firstChunk.length+' linhas). Se a tabela tiver mais que isso, os dados vêm truncados.'); return firstChunk; }
  if(firstChunk.length>=total) return firstChunk;
  const pageReqs=[];
  for(let from=PAGE; from<total; from+=PAGE){
    const to=Math.min(from+PAGE-1,total-1);
    pageReqs.push(fetch(`${SB_URL}/rest/v1/${tbl}?${qs}`,{headers:{...headers, Range:`${from}-${to}`}})
      .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' em '+tbl); return r.json(); }));
  }
  const rest=await Promise.all(pageReqs);
  return firstChunk.concat(...rest);
}
// monta o filtro `col=in.(...)` de uma query PostgREST. Valores de coluna texto
// (quote=true) vão entre aspas duplas, com qualquer aspa embutida escapada — sem
// isso, qualquer valor com vírgula/parêntese/aspa quebra a lista inteira (fetchTable
// lança, e o .catch em loadData desliga a aba pra TODOS os contratos do escopo, não
// só o de valor problemático). id_obra é numérico, não precisa — mesmo padrão já
// usado no filtro de status_obra em loadData().
function inListFilter(col,values,quote){
  if(!values||!values.length) return '';
  const list=quote ? values.map(v=>`"${String(v).replace(/"/g,'\\"')}"`).join(',') : values.join(',');
  return `${col}=in.(${list})`;
}
// id_obra -> comissão de fiscalização completa, ordenada pelo rank de EXIBIÇÃO de
// classifyComissao (Fiscal > Presidente > 1º..4º Membro > Membro > Suplente). Quem é
// o fiscal RESPONSÁVEL é decidido à parte por pickFiscal().
// idFilter restringe às obras já carregadas (só faz sentido na carteira ativa, onde a
// lista de ids cabe numa query — no histórico completo os ~350 ids estourariam a URL,
// então busca a tabela de comissão inteira, só com as colunas usadas).
async function fetchFiscais(idFilter){
  const filter=inListFilter('id_obra',idFilter,false);
  const rows=await fetchTable(SB_COMISSAO,{select:COMISSAO_COLS,filter}); const m={};
  for(const r of rows){
    const k=r.id_obra; if(k==null) continue;
    const nome=r.nome_completo||r.nome_referencia; if(!nome) continue;
    const c=classifyComissao(r.tipo);
    (m[k]=m[k]||[]).push({nome, tipo:c.label, rank:c.rank, matricula:r.matricula||''});
  }
  for(const k in m) m[k].sort((a,b)=>b.rank-a.rank);
  return m;
}
// data em destaque na tabela de aditivos = publicação (fallback assinatura, hoje nunca
// necessário — nenhum aditivo tem data_publicacao nula). Um helper só pra não repetir
// a coalescência nos 3 pontos de render + no sort abaixo.
function adPubDate(a){ return a.data_publicacao||a.data_assinatura||''; }
// descrição textual do aditivo (observacao), com quebras/espaços colapsados — linha
// de apoio nas tabelas de aditivo. Vazio => a linha não é renderizada.
function adObs(a){ return String(a.observacao||'').replace(/\s+/g,' ').trim(); }
// a linha .{pfx}-obs opcional embaixo de cada linha das tabelas de aditivo (valor e
// prazo compartilham a marcação, só muda o prefixo da classe). escHtml: texto do banco.
function adObsRow(a,pfx){ const o=adObs(a); return o?`<div class="${pfx}-obs">${escHtml(o)}</div>`:''; }
// aviso de escopo obra × contrato (só aparece em contrato multi-obra). `msg` é o texto.
function advScopeNote(o,msg){ return (o.nObras||1)>1 ? `<div class="adv-scope-note">${msg}</div>` : ''; }
// nr_contrato_sop -> aditivos do contrato (ordenados pela data de PUBLICAÇÃO, mais
// recente primeiro — data_assinatura da base tem ruído, há registros com data futura;
// desempate por data_assinatura só pra deixar a ordem determinística).
// Mesma lógica de escopo que fetchFiscais: na carteira ativa filtra pelos contratos já
// carregados (cabe numa URL); no histórico completo busca a tabela inteira (~580 linhas).
async function fetchAditivos(nrFilter){
  const filter=inListFilter('nr_contrato_sop',nrFilter,true);
  const rows=await fetchTable(SB_ADITIVOS,{select:ADITIVOS_COLS,filter}); const m={};
  for(const r of rows){ const k=r.nr_contrato_sop; if(!k) continue; (m[k]=m[k]||[]).push(r); }
  for(const k in m) m[k].sort((a,b)=>
    adPubDate(b).localeCompare(adPubDate(a))
    || (b.data_assinatura||'').localeCompare(a.data_assinatura||''));
  return m;
}
// nr_contrato_sop -> ficha do contrato (só os 2 totais de medição já calculados
// upstream pelo SIGSOP — total_medido/percentual_total_medido, ver aba Medições do modal).
async function fetchFichas(nrFilter){
  const filter=inListFilter('nr_contrato_sop',nrFilter,true);
  const rows=await fetchTable(SB_FICHA,{select:FICHA_COLS,filter}); const m={};
  for(const r of rows){ if(r.nr_contrato_sop) m[r.nr_contrato_sop]=r; }
  return m;
}
// id_obra -> lista de medições (para a curva "Evolução da medição" do Resumo).
// Ordena por nr_medicao (as medições são sequenciais); periodo é só rótulo do eixo.
async function fetchMedicoes(idFilter){
  const filter=inListFilter('id_obra',idFilter,false);
  const rows=await fetchTable(SB_MEDICOES,{select:MEDICOES_COLS,filter}); const m={};
  for(const r of rows){ const k=r.id_obra; if(k==null) continue; (m[k]=m[k]||[]).push(r); }
  for(const k in m) m[k].sort((a,b)=>(num(a.nr_medicao)-num(b.nr_medicao)) || String(a.periodo||'').localeCompare(String(b.periodo||'')));
  return m;
}
// `lastSync` é o maior `atualizado_em` dos contratos carregados (ver chamada em loadData),
// não o horário em que o navegador buscou os dados — "Base atualizada em" precisa refletir
// quando a BASE mudou de fato, não quando a página foi recarregada (antes usava
// `new Date()`, então mostrava "agora" mesmo em bases paradas há dias).
let _lastStatus=null; // últimos args — replay na troca de tema (o dot lê TOKENS.ng/amber inline)
function setStatus(txt,ok,lastSync){
  _lastStatus={txt,ok,lastSync};
  const el=document.getElementById('connStatus');
  if(el){el.textContent=txt; const d=el.parentElement.querySelector('.d'); const dot=ok?TOKENS.ng:TOKENS.amber; d.style.background=dot; d.style.boxShadow='0 0 10px '+dot;}
  const b=document.querySelector('.badge');
  if(b){ b.classList.toggle('demo',!ok); const t=document.getElementById('badgeTxt'); if(t) t.textContent = ok?'Base de dados · ao vivo':'Erro de conexão'; }
  const syncEl=document.getElementById('syncTime');
  if(syncEl) syncEl.textContent = ok ? (lastSync ? fmtDateTimeBR(lastSync) : '—') : '— (falha na conexão)';
}
function showDataError(msg){
  document.body.classList.remove('boot-loading');
  setStatus('Erro ao carregar dados', false);
  const el=document.getElementById('dataError');
  if(el){ const m=document.getElementById('dataErrorMsg'); if(m) m.textContent=msg; el.hidden=false; }
}
const _dataErrorRetryBtn=document.getElementById('dataErrorRetry');
if(_dataErrorRetryBtn) _dataErrorRetryBtn.onclick=()=>location.reload();

// cache de curta duração (sessionStorage) para não refazer o fetch inteiro a cada
// F5 durante uma apresentação — 5min é curto o bastante pra nunca mostrar dado
// visivelmente desatualizado, e longo o bastante pra recarregar/trocar de escopo
// instantaneamente dentro da mesma sessão.
const CACHE_TTL_MS=5*60*1000;
// Etapa B: o formato do cache ganhou `medic` (v3 — curva de medição do Resumo) e,
// depois, mais colunas em cada linha de `medic` (v4 — nr_protocolo/total/status pra
// a tabela mensal da aba Medições). v5: cada linha de `adit` ganhou data_publicacao.
// v6: `medic` voltou a ser preenchido de verdade (o SELECT pedia a coluna inexistente
// `status`; agora é `sigla_status_medicao`) — caches v5 guardaram `medic:{}`.
// v7: `rows` ganhou nr_os/prazo_execucao/prazo_vigencia_contrato e `fisc` ganhou
// matricula por integrante. v8: cada linha de `adit` ganhou observacao. v9: cada linha
// de `ficha` ganhou valor_original/valor_atual (contexto do contrato, multi-obra).
// v10: cada linha de `medic` ganhou valor_ref_glosa (glosa por período).
// O bump de versão garante que um objeto de formato antigo nunca seja reidratado como
// se fosse completo.
function cacheKey(scope){ return 'gecope_mapa_cache_v10_'+scope; }
function readCache(scope){
  try{
    const raw=sessionStorage.getItem(cacheKey(scope)); if(!raw) return null;
    const obj=JSON.parse(raw);
    if(!obj || (Date.now()-obj.ts)>CACHE_TTL_MS) return null;
    return obj;
  }catch{ return null; }
}
function writeCache(scope,rows,fisc,adit,ficha,medic){
  try{ sessionStorage.setItem(cacheKey(scope), JSON.stringify({ts:Date.now(),rows,fisc,adit,ficha,medic})); }
  catch(e){ /* quota/privacidade — cache é só um bônus de velocidade, ignora e segue sem ele */ }
}

async function loadData(){
  for(const c in DB.municipios) DB.municipios[c].obras=[];
  invalidateAggCache(); // sem isso, um hover no mapa durante o fetch devolveria contagens da era de filtro anterior
  try{
    const scope=st.dataScope;
    const cached=readCache(scope);
    let rows, fisc, adit, ficha, medic;
    if(cached){
      rows=cached.rows; fisc=cached.fisc; adit=cached.adit||{}; ficha=cached.ficha||{}; medic=cached.medic||{};
    } else if(scope==='ativa'){
      // carteira ativa: filtra no servidor (só ~348 linhas) e, com os ids/números já em
      // mãos, busca comissão/aditivos/ficha/medições só desses contratos — evita baixar as
      // tabelas inteiras quando 90% delas são de obras já encerradas, fora da carteira ativa.
      const filter=`status_obra=in.(${ACTIVE_STATUSES.map(s=>`"${s}"`).join(',')})`;
      rows=await fetchTable(SB_TABLE,{select:CONTRATOS_COLS,filter});
      const ids=[...new Set(rows.map(r=>r.id_obra).filter(v=>v!=null))];
      const nrs=[...new Set(rows.map(r=>r.nr_contrato_sop).filter(Boolean))];
      [fisc,adit,ficha,medic]=await Promise.all([
        fetchFiscais(ids).catch(e=>{ console.warn('comissao_fiscalizacao indisponível:',e.message); return {}; }),
        fetchAditivos(nrs).catch(e=>{ console.warn('aditivos_contrato indisponível:',e.message); return {}; }),
        fetchFichas(nrs).catch(e=>{ console.warn('ficha_contrato indisponível:',e.message); return {}; }),
        fetchMedicoes(ids).catch(e=>{ console.warn('medicoes indisponível:',e.message); return {}; }),
      ]);
      writeCache(scope,rows,fisc,adit,ficha,medic);
    } else {
      // histórico completo: os ids/números não cabem numa query in.(...), então busca
      // as tabelas inteiras (só com as colunas usadas) em paralelo.
      const [rowsR,fiscR,aditR,fichaR,medicR]=await Promise.all([
        fetchTable(SB_TABLE,{select:CONTRATOS_COLS}),
        fetchFiscais().catch(e=>{ console.warn('comissao_fiscalizacao indisponível:',e.message); return {}; }),
        fetchAditivos().catch(e=>{ console.warn('aditivos_contrato indisponível:',e.message); return {}; }),
        fetchFichas().catch(e=>{ console.warn('ficha_contrato indisponível:',e.message); return {}; }),
        fetchMedicoes().catch(e=>{ console.warn('medicoes indisponível:',e.message); return {}; }),
      ]);
      rows=rowsR; fisc=fiscR; adit=aditR; ficha=fichaR; medic=medicR;
      writeCache(scope,rows,fisc,adit,ficha,medic);
    }
    // 1 contrato : N obras — conta quantas obras de cada contrato estão CARREGADAS
    // (na carteira ativa é só as ativas; no histórico completo é todas). Só usado como
    // sinal "tem mais de uma obra" (multiObra), não como número exibido ao usuário.
    const obraCountBySop={};
    for(const r of rows){ const k=r.nr_contrato_sop; if(k) obraCountBySop[k]=(obraCountBySop[k]||0)+1; }
    let sem=0;
    for(const r of rows){ const cod=NAMEIDX[normTxt(r.municipio)]; if(!cod){sem++;continue;} const o=mapRow(r); const com=fisc[o.id_obra]||[]; o.comissao=com; const _fi=pickFiscal(com); o.fiscal=_fi?_fi.nome:'—'; o.fiscalTipo=_fi?_fi.tipo:'FISCAL';
      const nrKey=r.nr_contrato_sop; o.aditivos=(nrKey&&adit[nrKey])||[]; o.ficha=(nrKey&&ficha[nrKey])||null;
      o.medicoes=medic[o.id_obra]||[];
      o.nObras=(nrKey&&obraCountBySop[nrKey])||1;
      // valor original DO CONTRATO: a ficha tem o valor real (1 linha por contrato,
      // agrega todas as obras). Sem ficha: obra única → o próprio valor_original;
      // multi-obra → valor_atual_contrato como piso (subestima o % do art. 125, o que é
      // conservador — não gera alarme falso). Nunca uma soma parcial das obras da carteira.
      o.valorOriginalContrato=num(o.ficha&&o.ficha.valor_original) || (o.nObras===1?o.valor_original:num(o.valorContrato)) || o.valor_original;
      // `o.aditivo` = total_aditivo DA OBRA (contratos_edificacao.total_aditivo é por obra —
      // obras diferentes do mesmo contrato têm valores diferentes). Só cai na Σ dos
      // aditivos do contrato quando é obra ÚNICA e o campo veio 0 mas o contrato tem
      // aditivo de valor (defasagem do SIGSOP) — os aditivos_contrato não separam por obra.
      if(o.nObras===1 && !num(r.total_aditivo) && o.aditivos.length)
        o.aditivo=o.aditivos.reduce((s,a)=>s+num(a.valor_repercussao),0);
      // buckets de filtro que dependem de dado só conhecido aqui (Etapa C)
      const _g=grpById(gidOf(cod)); o.distrito=_g?_g.nome:null;
      // filtro "Medição (% executado)" — NÍVEL OBRA (Σ das medições da obra ÷ valor da
      // obra), como o resto do modal; fallback na ficha só em contrato de obra única.
      o.medicaoBucket=medicaoBucket(medObraStats(o).pct);
      DB.municipios[cod].obras.push(o); }
    invalidateAggCache();
    const scopeTxt=scope==='ativa'?'carteira ativa':'histórico completo';
    // Comparação por string funciona porque `atualizado_em` vem do Postgres em ISO
    // (YYYY-MM-DD...), que ordena lexicograficamente igual a cronologicamente.
    let lastSync=null;
    for(const r of rows){ if(r.atualizado_em && (!lastSync || r.atualizado_em>lastSync)) lastSync=r.atualizado_em; }
    setStatus(`Base de dados · ${rows.length} contrato${rows.length===1?'':'s'}${sem?` (${sem} sem município no CE)`:''} · ${scopeTxt}`, true, lastSync);
  }catch(e){
    console.error(e);
    showDataError('Não foi possível carregar os contratos: '+e.message);
    return;
  }
  document.body.classList.remove('boot-loading');
  fillFilters(); render(); refit();
}
const BRL=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
// só pras abas Aditivos/Medições do modal (valores por contrato individual, onde
// centavos importam pra bater com o extrato oficial) — os KPIs do painel principal e
// os cards de obra continuam em BRL (sem casas decimais) de propósito: são somas de
// carteira/lista, ninguém confere centavo a centavo ali, e o número já é grande o
// bastante sem precisar de mais 3 caracteres de ruído.
const BRL2=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL',minimumFractionDigits:2,maximumFractionDigits:2});
const NUM=new Intl.NumberFormat('pt-BR');
// os percentuais já existentes no app usam toFixed(0) (sem casa decimal, então sem
// separador nenhum) — as abas Aditivos/Medições do modal são o 1º lugar a mostrar
// 1 casa decimal de verdade, então precisam da vírgula pt-BR (Intl.NumberFormat
// seria mais robusto, mas pra 1 valor isolado o replace já resolve sem 3ª instância).
function fmtPct1(v){ return v.toFixed(1).replace('.',','); }
// valor em reais com sinal explícito só no negativo ("−R$ …"); positivo e zero sem
// prefixo. Usado onde o número pode ser negativo (repercussão de aditivo, total_aditivo
// líquido). O "−" é U+2212, como no resto do modal.
function signedBRL(n){ return (n<0?'−':'')+BRL2.format(Math.abs(n)); }

// Etapa D: nível inicial = 1 (11 Distritos Operacionais). O nível 0 ("Ceará
// inteiro" como bloco único) deixou de ser um destino navegável — o app nasce
// já dividido nos distritos e a animação de entrada termina neles.
const st={metric:'obras',level:1,group:null,city:null,hoverGroup:null,dataScope:'ativa',
  sel:null, // Ctrl+clique em vários distritos/municípios: {kind:'group'|'city', ids:Set}
  // Etapa C: chaves novas declaradas já como Set (as defs em FILTER_DEFS e a UI
  // entram no Bloco 2 — até lá ficam vazias e inertes).
  f:{ano:new Set(),status:new Set(),contratada:new Set(),contratante:new Set(),fiscal:new Set(),
     distrito:new Set(),municipio:new Set(),tipo:new Set(),faixaValor:new Set(),
     prazoExec:new Set(),vigencia:new Set(),paralisada:new Set(),medicao:new Set(),q:''}};

const METRIC={obras:{label:'Nº de obras',fmt:v=>NUM.format(v)},
              valor:{label:'Valor total',fmt:v=>BRL.format(v)},
              aditivo:{label:'Aditivos (R$)',fmt:v=>BRL.format(v)}};
let BASE=TOKENS.mapBase; // re-derivado na troca de tema (repaintTheme)
const allIds=Object.keys(DB.municipios);
function groupsList(){return DB.distritos;}
function gidOf(id){return DB.municipios[id].do;}
function idsOfGroup(g){return allIds.filter(id=>String(gidOf(id))===String(g));}
function grpById(g){return groupsList().find(x=>String(x.id)===String(g));}

// Etapa C — passF orientado a dados: um laço sobre FILTER_DEFS em vez de um `if`
// cravado por campo. Cada def expõe `get(o)` → o valor de filtro daquela obra (string
// ou null); campos "de valores" (Contratada, Ano…) e "de categoria fixa" (Faixa de
// valor, Prazo…) usam o mesmo caminho — a diferença está só em como fillFilters()
// monta a lista de opções. A busca livre `q` continua um caso à parte.
function passF(o){const f=st.f;
  for(let i=0;i<FILTER_DEFS.length;i++){
    const d=FILTER_DEFS[i], set=f[d.key];
    if(set && set.size){ const v=d.get(o); if(v==null || !set.has(v)) return false; }
  }
  if(f.q){
    // busca livre em TODOS os campos textuais da obra; ";" separa termos com lógica OU
    // (ex.: "ROBERTO BRINGEL; VIRNA" traz as obras de qualquer um dos dois fiscais).
    const terms=f.q.split(';').map(t=>t.trim().toLowerCase()).filter(Boolean);
    if(terms.length){
      const campos=[o.objeto,o.municipioTxt,o.fiscal,o.contratada,o.contratante,
        o.ano!=null?String(o.ano):'',o.statusObra,o.contrato,o.codigo_obra];
      const hit=terms.some(t=>campos.some(c=>String(c||'').toLowerCase().includes(t)));
      if(!hit) return false;
    }
  }
  return true;
}
// PERFORMANCE: obrasOf() é chamada dezenas de milhares de vezes por frame de pan/zoom
// do mapa (declutter de rótulos ordena por prioridade chamando-a pra cada item, várias
// vezes por sort) — sem memoização, cada chamada refiltra o array de obras do zero.
// O cache vale por uma "época" de filtro: qualquer mudança em st.f (busca, checkbox)
// ou recarga de dados (loadData) chama invalidateAggCache(), que só zera o Map — o
// próximo obrasOf(id) recalcula e guarda de novo. Município tem no máximo algumas
// dezenas de obras, então o custo de popular o cache inteiro é desprezível.
let _obrasOfCache=new Map();
function invalidateAggCache(){ _obrasOfCache=new Map(); }
function obrasOf(id){
  let hit=_obrasOfCache.get(id);
  if(hit===undefined){ hit=DB.municipios[id].obras.filter(passF); _obrasOfCache.set(id,hit); }
  return hit;
}
function aggIds(ids){let obras=0,valor=0,valorOriginal=0,par=0,adit=0;ids.forEach(id=>obrasOf(id).forEach(o=>{obras++;valor+=o.valor;valorOriginal+=o.valor_original;adit+=o.aditivo;if(statusBucket(o.statusObra)==='stop')par++;}));return{obras,valor,valorOriginal,par,adit};}
function mval(a){return st.metric==='valor'?a.valor:st.metric==='aditivo'?a.adit:a.obras;}

// ---- mapa ----
const map=L.map('map',{zoomControl:false,attributionControl:false,minZoom:6,maxZoom:11});
L.control.zoom({position:'bottomright'}).addTo(map);
let layer,stateShape,fullBounds=null;
const HID={weight:0,opacity:0,fillOpacity:0};
function zt(){const z=(map&&map.getZoom)?map.getZoom():NaN; return isFinite(z)?Math.max(0,Math.min(1,(z-6)/4)):0;}  // 0 no estado inteiro, 1 aproximado
function gw(){return 1.0+0.9*zt();}                                 // espessura da divisa de bloco

function visible(id){
  if(st.level<=1) return false;
  if(st.level===2) return String(gidOf(id))===String(st.group);
  return id===st.city;
}
// intensidade coroplética do nível 2 (municípios dentro do distrito/região aberto):
// recalculado 1x por render() em vez de 1x por município, já que styleFeature() é
// chamado 184x por layer.setStyle() — ver render() logo abaixo. A mesma choroT()
// alimenta o nível 1 (ver groupStyle) — uma curva só, calibrada num lugar só.
let _levelMax=1;
// razão value/max, sempre em [0,1] — clamp nos dois lados (não só no topo) porque o
// valor de entrada vem de dado ao vivo (Supabase); um agregado negativo (ex.: métrica
// "aditivo" com reduções líquidas) não pode gerar fillOpacity fora do intervalo válido.
function choroT(value,max){ return Math.max(0,Math.min(1,value/max)); }
// Etapa C — "sem correspondência": só existe com filtro ativo. Município: 0 contratos
// que passam. Distrito: consulta _groupCountByGid (contagem já calculada 1x por
// render(), como _groupValByGid). Fora de filtro, sempre false — mapa idêntico ao de hoje.
let _groupCountByGid=new Map();
function noMatchCity(id){ return hasActiveFilter() && aggIds([id]).obras===0; }
function noMatchGroup(gid){ return hasActiveFilter() && (_groupCountByGid.get(String(gid))||0)===0; }
const NOMATCH_STYLE=()=>({fillColor:TOKENS.nomatchFill,color:TOKENS.nomatchBorder,weight:0.5+0.4*zt(),fillOpacity:.16,opacity:.5});
function styleFeature(f){
  const id=f.properties.id;
  if(!visible(id)) return HID;                    // níveis 0 e 1: municípios escondidos
  if(st.level===2){
    // município na seleção combinada (Ctrl+clique): destaque cheio, sobrepõe a
    // intensidade coroplética normal — precisa ser visualmente inconfundível com
    // "só tem muita obra" (que usa a mesma cor base, só mais opaca)
    if(st.sel&&st.sel.kind==='city'&&st.sel.ids.has(String(id))) return {fillColor:TOKENS.ng,color:TOKENS.mapLine,weight:1.6+0.8*zt(),fillOpacity:.78,opacity:1};
    if(noMatchCity(id)) return NOMATCH_STYLE();   // Etapa C: filtro ativo, 0 contratos
    // preenchimento varia com a métrica atual (obra/valor/aditivo), não é mais
    // uma cor uniforme — um município com 0 obras e um com o máximo do distrito
    // não podem ser visualmente idênticos (achado da revisão final de design)
    const t=choroT(mval(aggIds([id])),_levelMax);
    return {fillColor:BASE,color:TOKENS.mapOpenBorder,weight:0.5+0.7*zt(),fillOpacity:TOKENS.choroFloor+TOKENS.choroSpan*t,opacity:.85};
  }
  if(noMatchCity(id)) return NOMATCH_STYLE();     // Etapa C: nível 3, cidade aberta sem resultado
  return {fillColor:TOKENS.mapOpenFill,color:TOKENS.mapLine,weight:1.0+1.0*zt(),fillOpacity:.85,opacity:1};  // cidade aberta (nível 3)
}
function applyInteractivity(){
  // Etapa C: polígono "sem correspondência" também fica inerte (não navegável).
  layer.eachLayer(l=>{ if(l._path){ const id=l.feature.properties.id; l._path.style.pointerEvents = (visible(id) && !noMatchCity(id))?'':'none'; } });
}
const tip=L.tooltip({sticky:true,direction:'top'});
function tipHtml(id){
  // Etapa D: nível 0 removido — o app nunca fica no "Ceará inteiro".
  if(st.level===1){const g=gidOf(id),gg=grpById(g);const v=mval(aggIds(idsOfGroup(g)));return `<b>${gg.nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`;}
  const v=mval(aggIds([id]));return `<b>${DB.municipios[id].nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`;
}
function onEach(f,l){
  l.on('mouseover',()=>{ const id=f.properties.id; if(!visible(id)||noMatchCity(id))return; l.setStyle({weight:1.8,color:TOKENS.mapLine}); l.bringToFront();
                         tip.setLatLng(l.getBounds().getCenter()).setContent(tipHtml(id)).addTo(map); });
  l.on('mouseout',()=>{ layer.resetStyle(l); tip.remove(); });
  l.on('click',e=>onClick(f.properties.id,e));
}
function onClick(id,e){
  if(!visible(id) || noMatchCity(id)) return;
  // Ctrl/Cmd+clique num município (nível 2, dentro de um distrito/região aberto)
  // soma à seleção combinada em vez de abrir aquele município sozinho
  if(st.level===2 && e && e.originalEvent && (e.originalEvent.ctrlKey||e.originalEvent.metaKey)){ toggleSelection('city',id); return; }
  if(st.level===1) goGroup(gidOf(id));       // Etapa D: nível 0 removido
  else if(st.level===2) goCity(id);
}

// ---- camada de blocos (Distritos Operacionais dissolvidos) ----
let groupLayer=null;
// intensidade coroplética do nível 1 quando há busca/filtro ativo — mesmo raciocínio
// de _levelMax (nível 2, ver styleFeature): recalculado 1x por render(), não 1x por
// grupo, já que groupStyle() roda uma vez por distrito a cada setStyle().
// _groupValByGid guarda o valor de cada grupo desse mesmo cálculo (Map gid->valor),
// pra groupStyle() só consultar em vez de rechamar idsOfGroup()+aggIds() por feature
// (achado da revisão: sem isso, cada grupo era agregado 2x por render() — aqui e
// dentro de groupStyle). Começa como Map vazio, nunca null: buildGroupLayer() também
// invoca groupStyle() por feature (no init), antes do próximo render() repopular o
// Map — .get() num Map vazio devolve undefined (cai no "||0" abaixo) em vez de
// estourar. Mesma folga existe no debounce de 150ms da busca/filtros (fSearch e
// os checkboxes, mais abaixo): entre a mudança e o render() que recalcula este Map,
// um hover/zoomend nesse intervalo lê o valor de ANTES da mudança — vazio, se nenhum
// filtro estava ativo ainda, ou a combinação anterior, se já havia um — nunca a nova.
// Aceito de propósito (efeito cosmético de até 150ms, autocorrige sozinho) em vez de
// complicar o cache pra fechar uma janela tão estreita.
let _levelMaxGroup=1, _groupValByGid=new Map();
function groupStyle(f){
  // distrito/região na seleção combinada (Ctrl+clique): mesmo destaque cheio usado
  // pra município selecionado no nível 2 — consistência visual entre os dois níveis
  if(f&&st.sel&&st.sel.kind==='group'&&st.sel.ids.has(String(f.properties.gid))) return {fillColor:TOKENS.ng,color:TOKENS.mapLine,weight:gw()+1.2,fillOpacity:.68,opacity:1};
  if(f&&noMatchGroup(f.properties.gid)) return NOMATCH_STYLE(); // Etapa C: filtro ativo, distrito sem contratos
  // sem busca/filtro ativos: cor uniforme, como sempre foi — a própria divisão em
  // distritos/regiões já é a informação. Com filtro ativo, escala a opacidade pela
  // intensidade — mesma fórmula de styleFeature no nível 2 (floor + span·t, por tema),
  // pra responder visualmente "onde estão os resultados" sem precisar descer de nível.
  const fillOpacity=hasActiveFilter() ? TOKENS.choroFloor+TOKENS.choroSpan*choroT(_groupValByGid.get(String(f.properties.gid))||0,_levelMaxGroup) : .5;
  return {fillColor:BASE,color:TOKENS.mapGroupBorder,weight:gw(),fillOpacity,opacity:.9};
}
function groupHover(){return {fillColor:TOKENS.mapOpenFill,color:TOKENS.mapLine,weight:gw()+0.8,fillOpacity:.72};}
function onGroup(f,l){
  const gid=f.properties.gid;
  // Etapa C: distrito "sem correspondência" (filtro ativo, 0 contratos) não reage.
  const inert=()=>noMatchGroup(gid);
  // renderPanel() refaz KPIs + os 3 gráficos (inclui reconstruir o SVG do gráfico por
  // ano) — à toa se o painel lateral estiver recolhido e ninguém puder ver o resultado.
  // panelVisible() é compartilhada (perto de _mainEl/openAside, mais abaixo) em vez de
  // recriada a cada feature — buildGroupLayer() chama onGroup() ~11-14x por build.
  l.on('mouseover',()=>{ if(inert()) return; l.setStyle(groupHover()); l.bringToFront(); st.hoverGroup=gid; if(panelVisible()) renderPanel();
    // com filtro ativo, _groupValByGid já tem esse valor (calculado em render() logo
    // antes do groupLayer.setStyle() que acabou de rodar) — não recalcula à toa aqui.
    const v=hasActiveFilter()?(_groupValByGid.get(String(gid))||0):mval(aggIds(idsOfGroup(gid)));
    tip.setLatLng(l.getBounds().getCenter()).setContent(`<b>${f.properties.nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`).addTo(map); });
  l.on('mouseout',()=>{ groupLayer.resetStyle(l); st.hoverGroup=null; if(panelVisible()) renderPanel(); tip.remove(); });
  // Ctrl/Cmd+clique num distrito/região soma à seleção combinada em vez de entrar nele
  l.on('click',e=>{ if(inert()) return; if(e.originalEvent&&(e.originalEvent.ctrlKey||e.originalEvent.metaKey)){ toggleSelection('group',gid); return; } goGroup(gid); });
}
function buildGroupLayer(){ if(groupLayer) groupLayer.remove(); groupLayer=L.geoJSON(GRP.do,{style:groupStyle,onEachFeature:onGroup}); }

function boundsOfIds(ids){
  let b=null; const set=new Set(ids);
  layer.eachLayer(l=>{ if(set.has(l.feature.properties.id)){const lb=l.getBounds(); b=b?b.extend(lb):L.latLngBounds(lb.getSouthWest(),lb.getNorthEast());} });
  return b;
}
// a entrada animada (flyToBounds) roda uma única vez; os vários "ensureSize" de
// segurança (fontes, resize, orientação) chamam fitFull() logo em seguida e, sem
// essa guarda, cortariam a animação no meio com um fitBounds instantâneo.
let _firstFit=true, _entranceDone=false;
function fitFull(){
  if(!fullBounds) return;
  if(_firstFit){
    _firstFit=false;
    // Etapa D: a entrada já parte do nível 1 (11 distritos). Os polígonos de
    // distrito entram com um fade curto logo no início do voo — a câmera se aproxima
    // e eles "assentam" junto. Duração encurtada (2,8s → 1,5s) a pedido; o
    // #mapWrap.in no CSS acompanha (mesma duração).
    if(groupLayer){ enterGroupFade(); requestAnimationFrame(()=>requestAnimationFrame(revealGroupFade)); }
    map.flyToBounds(fullBounds,{padding:[24,24],duration:1.5,easeLinearity:.12});
    map.once('moveend',()=>{ _entranceDone=true; updateLabels(); });
    return;
  }
  if(!_entranceDone) return;
  // reenquadramentos depois da entrada (resize, orientação, entrar/sair da tela
  // cheia) também animam — evita o "salto" instantâneo quando o viewport muda
  map.flyToBounds(fullBounds,{padding:[24,24],duration:.9,easeLinearity:.2});
  map.once('moveend',()=>{ updateLabels(); });
}
function fitGroup(){ const b=boundsOfIds(idsOfGroup(st.group)); if(b) map.fitBounds(b,{padding:[40,40],maxZoom:10}); }
function fitCity(){ const b=boundsOfIds([st.city]); if(b) map.fitBounds(b,{padding:[60,60],maxZoom:11}); }
// Etapa D — fade de entrada dos 11 distritos: opacidade via classe CSS no <path>
// (multiplica sobre o estilo do Leaflet, sem brigar com groupStyle()). Roda uma
// única vez, no primeiro fitFull(); ao terminar, as classes saem e o Leaflet
// volta a mandar sozinho no estilo.
function enterGroupFade(){ if(!groupLayer) return; groupLayer.eachLayer(l=>{ if(l._path) l._path.classList.add('grp-enter'); }); }
function revealGroupFade(){ if(!groupLayer) return; groupLayer.eachLayer(l=>{ if(!l._path) return; l._path.classList.add('grp-enter-in');
  setTimeout(()=>{ if(l._path) l._path.classList.remove('grp-enter','grp-enter-in'); },420); }); }

// navegação
// Etapa D: o nível 0 saiu; "voltar ao topo" (troca de escopo, breadcrumb raiz,
// reset da busca) leva ao nível 1. goState fica como alias de goSub para os
// pontos que ainda o chamam.
function goSub(){st.sel=null;st.level=1;st.group=null;st.city=null;st.hoverGroup=null;render();fitFull();}
function goState(){goSub();}
function goGroup(g){st.sel=null;st.group=g;st.level=2;st.city=null;st.hoverGroup=null;render();fitGroup();}
function goCity(id){st.sel=null;st.city=id;st.level=3;st.hoverGroup=null;render();fitCity();}

// ---- rótulos ----
// centroide "de área" (não a média dos vértices) — evita rótulo deslocado em
// polígonos irregulares/côncavos, onde a densidade de vértices não é uniforme.
function ringCentroid(ring){
  let a=0,cx=0,cy=0;
  for(let i=0;i<ring.length-1;i++){
    const x1=ring[i][0],y1=ring[i][1],x2=ring[i+1][0],y2=ring[i+1][1];
    const cross=x1*y2-x2*y1; a+=cross; cx+=(x1+x2)*cross; cy+=(y1+y2)*cross;
  }
  a/=2;
  if(Math.abs(a)<1e-12){let sx=0,sy=0,n=0;ring.forEach(p=>{sx+=p[0];sy+=p[1];n++;});return{area:0,cx:sx/n,cy:sy/n};}
  return{area:Math.abs(a),cx:cx/(6*a),cy:cy/(6*a)};
}
// em formas côncavas/finas (ex.: município em forma de "C" ou faixa estreita) o
// centroide de área pode cair fora do polígono, dentro do vizinho — por isso
// validamos com um teste ponto-em-polígono e caímos para alternativas mais seguras.
function pointInRing(pt,ring){
  let inside=false;
  for(let i=0,j=ring.length-2;i<ring.length-1;j=i++){
    const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1];
    const hit=((yi>pt[1])!==(yj>pt[1])) && (pt[0] < (xj-xi)*(pt[1]-yi)/(yj-yi)+xi);
    if(hit) inside=!inside;
  }
  return inside;
}
function bboxCenterOfRing(ring){
  let minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
  ring.forEach(p=>{if(p[0]<minx)minx=p[0];if(p[0]>maxx)maxx=p[0];if(p[1]<miny)miny=p[1];if(p[1]>maxy)maxy=p[1];});
  return[(minx+maxx)/2,(miny+maxy)/2];
}
function vertexAvgOfRing(ring){
  let sx=0,sy=0,n=0; ring.forEach(p=>{sx+=p[0];sy+=p[1];n++;}); return[sx/n,sy/n];
}
// distância de um ponto a um segmento — usado para achar o ponto mais "afundado"
// dentro do polígono (pólo de inacessibilidade), última linha de defesa para
// formas em "C"/"U" onde nem o centroide, nem o bbox, nem a média de vértices caem dentro.
function pointToSegDist(p,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1],len2=dx*dx+dy*dy;
  let t=len2>0?((p[0]-a[0])*dx+(p[1]-a[1])*dy)/len2:0; t=Math.max(0,Math.min(1,t));
  return Math.hypot(p[0]-(a[0]+t*dx),p[1]-(a[1]+t*dy));
}
function poleOfInaccessibility(ring,gridN){
  let minx=Infinity,maxx=-Infinity,miny=Infinity,maxy=-Infinity;
  ring.forEach(p=>{if(p[0]<minx)minx=p[0];if(p[0]>maxx)maxx=p[0];if(p[1]<miny)miny=p[1];if(p[1]>maxy)maxy=p[1];});
  let best=null,bestD=-1; const stepx=(maxx-minx)/gridN, stepy=(maxy-miny)/gridN;
  for(let gx=0;gx<=gridN;gx++)for(let gy=0;gy<=gridN;gy++){
    const pt=[minx+gx*stepx,miny+gy*stepy]; if(!pointInRing(pt,ring))continue;
    let d=Infinity; for(let k=0;k<ring.length-1;k++){const dd=pointToSegDist(pt,ring[k],ring[k+1]); if(dd<d)d=dd;}
    if(d>bestD){bestD=d;best=pt;}
  }
  return best;
}
function pickLabelPoint(ring,areaC){
  const candidates=[[areaC.cx,areaC.cy], bboxCenterOfRing(ring), vertexAvgOfRing(ring)];
  for(const c of candidates){ if(pointInRing(c,ring)) return c; }
  return poleOfInaccessibility(ring,40) || candidates[0];
}
function centroidOf(geom){
  const polys=geom.type==='Polygon'?[geom.coordinates]:geom.coordinates;
  let best=null,bestRing=null;
  polys.forEach(poly=>{ const outer=poly[0]; if(!outer||outer.length<4)return;
    const c=ringCentroid(outer); if(!best||c.area>best.area){best=c;bestRing=outer;} });
  if(!best){let sx=0,sy=0,n=0;
    (geom.type==='Polygon'?geom.coordinates:geom.coordinates.flat()).forEach(r=>r.forEach(p=>{sx+=p[0];sy+=p[1];n++;}));
    return[sy/n,sx/n];}
  const[cx,cy]=pickLabelPoint(bestRing,best);
  return[cy,cx];
}
const munC={}; GEO.features.forEach(f=>munC[f.properties.id]=centroidOf(f.geometry));

// Etapa D: o rótulo "CEARÁ" (stateLbl) saiu junto com o nível 0.
let cityItems=[], groupItems=[];
let cityLbl,groupLbl;
function buildCityState(){
  cityItems=allIds.map(id=>({id,ll:L.latLng(munC[id]),nome:DB.municipios[id].nome,
    mk:L.marker(munC[id],{interactive:false,keyboard:false,icon:L.divIcon({className:'mun-label',iconSize:[0,0],
      html:`<div class="lbl"><div class="lbl-name">${DB.municipios[id].nome}</div><div class="lbl-count"></div></div>`})})}));
  cityLbl=L.layerGroup(cityItems.map(i=>i.mk));
}
// ajustes manuais pontuais de posição de rótulo [Δlat,Δlon], por nome já sem o
// prefixo "D.O." — ver comentário de uso mais abaixo.
const GRP_LABEL_NUDGE={'Aracoiaba':[0,0.10],'Sertão de Sobral':[0.10,0.10],'Maciço de Baturité':[-0.05,0.05],'Vale do Jaguaribe':[-0.05,0.05],'RM Fortaleza':[0.12,0]};
// nomes curtos o bastante pra caber numa linha só, mesmo com 2+ palavras — pedido
// pontual do usuário pra "Santa Quitéria" (a quebra em 2 linhas do shortGroupLabel()
// é pensada pra nomes longos tipo "Sertão de Sobral", não faz sentido aqui).
const GRP_LABEL_ONE_LINE=new Set(['Santa Quitéria']);
// nome completo (usado em breadcrumb/painel/tooltip) pode ser longo demais pra
// caber lado a lado no mapa — tira as preposições de ligação (de/da/do/dos/das)
// e quebra em até 2 linhas centralizadas. Ex.: "SERTÃO DE SOBRAL" -> "SERTÃO"/"SOBRAL".
function shortGroupLabel(nome){
  const compact=nome.replace(/\s+(de|da|do|dos|das)\s+/gi,' ').trim();
  const words=compact.split(/\s+/);
  if(words.length<=1 || GRP_LABEL_ONE_LINE.has(nome)) return {plain:compact, html:escHtml(compact)};
  const mid=Math.ceil(words.length/2);
  const l1=words.slice(0,mid).join(' '), l2=words.slice(mid).join(' ');
  return {plain:compact, html:`${escHtml(l1)}<br>${escHtml(l2)}`};
}
function rebuildGroupLabels(){
  if(groupLbl) groupLbl.remove();
  groupItems=[];
  // rótulo do distrito usa o mesmo centroidOf() (área + pólo de inacessibilidade
  // em formas côncavas) já usado pros municípios — aplicado à forma REAL dissolvida
  // do distrito (GRP), não a uma média simples dos centros dos municípios membros.
  // A média simples empurra o rótulo pro lado onde há mais municípios pequenos
  // agrupados, mesmo que a forma do distrito como um todo seja bem diferente disso
  // — daí rótulos nitidamente fora do centro visual em distritos irregulares.
  const feats=(GRP.do&&GRP.do.features)||[];
  groupsList().forEach(g=>{
    const ids=idsOfGroup(g.id); if(!ids.length)return;
    const feat=feats.find(f=>String(f.properties.gid)===String(g.id));
    let la,lo;
    if(feat){ [la,lo]=centroidOf(feat.geometry); }
    else{ const ms=ids.map(id=>munC[id]); la=ms.reduce((s,x)=>s+x[0],0)/ms.length; lo=ms.reduce((s,x)=>s+x[1],0)/ms.length; }
    const short=g.nome.replace(/^D\.O\.\s*/,'');
    // ajuste manual fino pontual (pedido do usuário) — centroidOf() acerta a
    // grande maioria, mas "certo matematicamente" e "parece bem posicionado pro
    // olho humano" nem sempre coincidem num polígono específico; em vez de
    // afinar o algoritmo geral só por causa de 1 caso, desloca só esse rótulo.
    if(GRP_LABEL_NUDGE[short]){ const [dLa,dLo]=GRP_LABEL_NUDGE[short]; la+=dLa; lo+=dLo; }
    // rótulo no mapa é só a versão curta/quebrada (sem preposição, em 2 linhas) —
    // breadcrumb, painel e tooltip continuam usando o nome oficial completo
    // (grpById/g.nome), essa abreviação existe só pra caber no mapa.
    const compact=shortGroupLabel(short);
    groupItems.push({id:g.id,ll:L.latLng([la,lo]),nome:compact.plain,
      mk:L.marker([la,lo],{interactive:false,keyboard:false,icon:L.divIcon({className:'grp-label',iconSize:[0,0],
        html:`<div class="lbl"><div class="lbl-name">${compact.html}</div><div class="lbl-count"></div></div>`})})});
  });
  groupLbl=L.layerGroup(groupItems.map(i=>i.mk));
}
function setLayer(l,on){ if(!l)return; if(on&&!map.hasLayer(l))l.addTo(map); else if(!on&&map.hasLayer(l))l.remove(); }
function declutter(items,fs,H,pad,filt,prioFn){
  const placed=[];
  const prio=prioFn||(it=>it.prio||0);
  const sorted=[...items].sort((a,b)=>prio(b)-prio(a));
  for(const it of sorted){
    const el=it.mk.getElement(); if(!el)continue;
    if(filt&&!filt(it)){el.style.display='none';continue;}
    // caixa de colisão vem do tamanho REAL do texto renderizado (getBoundingClientRect
    // do wrapper .lbl), não de "nº de caracteres × fator estimado". A estimativa por
    // caractere é sempre uma média — apertar o fator o bastante pra caber rótulos
    // curtos deixa rótulos longos (ex. "Serra da Ibiapaba"/"Sertão de Sobral", ambos
    // ~17 caracteres) subestimados o bastante pra colidir de verdade sem o algoritmo
    // perceber (achado do usuário). Precisa estar visível pra medir — por isso troca
    // pra '' antes de ler o rect, e só volta pra 'none' se realmente colidir.
    el.style.display='';
    const inner=el.querySelector('.lbl');
    const p=map.latLngToContainerPoint(it.ll);
    let w=it.nome.length*fs+pad, h=H; // fallback, só usado se .lbl não for encontrado
    if(inner){ const r=inner.getBoundingClientRect(); w=r.width+pad; h=r.height+2; }
    const bx={x1:p.x-w/2,y1:p.y-h/2,x2:p.x+w/2,y2:p.y+h/2};
    let hit=false; for(const q of placed){if(bx.x1<q.x2&&bx.x2>q.x1&&bx.y1<q.y2&&bx.y2>q.y1){hit=true;break;}}
    el.style.display=hit?'none':''; if(!hit)placed.push(bx);
  }
}
// tamanhos base dos rótulos do mapa (nome do distrito/município + contador de
// obras) — aumentados a pedido: legibilidade em tela de projeção importa mais
// aqui do que caber mais texto por rótulo. declutter() deriva a caixa de colisão
// de cada rótulo destes mesmos valores (ver chamadas em updateLabels()), então
// aumentar aqui não desalinha a lógica de "esconder rótulo que colide" — ela
// escala junto.
// são 11 Distritos Operacionais; a quebra em 2 linhas (shortGroupLabel) resolve o
// aperto de nomes longos sem sacrificar o tamanho da fonte (pedido: legível em
// projeção).
function lblFS(){const t=zt();return {grp:12+3.5*t, mun:10.5+3*t, st:32};}
function applyLabelSizes(){const s=lblFS(),r=document.documentElement.style;
  r.setProperty('--grpfs',s.grp.toFixed(1)+'px');r.setProperty('--munfs',s.mun.toFixed(1)+'px');r.setProperty('--stfs',s.st+'px');return s;}
function refreshMapCounts(){
  const filt=hasActiveFilter();
  groupItems.forEach(it=>{
    const el=it.mk.getElement(); const c=el&&el.querySelector('.lbl-count');
    const n=aggIds(idsOfGroup(it.id)).obras;
    if(c) c.textContent=NUM.format(n);
    // Etapa C: rótulo esmaecido — só onde o rótulo aparece (nível 1 para distrito).
    if(el) el.classList.toggle('nomatch', filt && n===0 && st.level===1);
  });
  cityItems.forEach(it=>{
    const el=it.mk.getElement(); const c=el&&el.querySelector('.lbl-count');
    const n=obrasOf(it.id).length;
    if(c) c.textContent=NUM.format(n);
    if(el) el.classList.toggle('nomatch', filt && n===0 && visible(it.id)); // só o município visível no nível 2/3
  });
}
function updateLabels(){
  // Nenhum rótulo do mapa aparece enquanto a animação de entrada (flyToBounds)
  // ainda está rodando: durante o voo o declutter roda num zoom que ainda vai
  // mudar e escondia parte dos nomes, deixando distritos "sem nome" à mostra.
  // Só quando a apresentação termina (_entranceDone, marcado no moveend do
  // primeiro fitFull) os rótulos entram — já no enquadramento final.
  if(!_entranceDone){ setLayer(groupLbl,false); setLayer(cityLbl,false); return; }
  const s=applyLabelSizes();
  setLayer(groupLbl,st.level===1);
  setLayer(cityLbl,st.level>=2);
  refreshMapCounts();
  // prioridade por nº de obras: em colisão de rótulos, o município/distrito
  // mais relevante (ex.: Sobral) vence e permanece visível, em vez do primeiro
  // da lista por ordem arbitrária de id.
  // fs/pad um pouco mais enxutos que o "esperado" pro tamanho real da fonte: o
  // aumento de fonte pedido pelo usuário deixou a caixa de colisão estimada
  // grande o bastante pra esconder Quixeramobim (cercado por outros 5 distritos)
  // em janelas não-maximizadas — a fonte renderizada não muda, só a folga usada
  // pra decidir o que colide com o quê.
  if(st.level===1) declutter(groupItems, s.grp*0.48, s.grp*2.2, 2, null, it=>aggIds(idsOfGroup(it.id)).obras);
  else if(st.level===2) declutter(cityItems, s.mun*0.6, s.mun*2.6, 7, it=>String(gidOf(it.id))===String(st.group), it=>obrasOf(it.id).length);
  else if(st.level===3) declutter(cityItems, s.mun*0.6, s.mun*2.6, 7, it=>it.id===st.city, it=>obrasOf(it.id).length);
}

// ---- painel ----
// resolve a seleção (Ctrl+clique) pra ids de município, que é a unidade que
// obrasOf()/aggIds() entendem — kind='group' guarda ids de distrito/região, então
// precisa "abrir" cada um; kind='city' já são ids de município, direto.
function selectionMunIds(){
  if(!st.sel || !st.sel.ids.size) return null;
  return st.sel.kind==='group' ? [...st.sel.ids].flatMap(idsOfGroup) : [...st.sel.ids];
}
function scopeIds(){
  const sel=selectionMunIds(); if(sel) return sel;
  if(st.level===1 && st.hoverGroup!=null) return idsOfGroup(st.hoverGroup);
  if(st.level<=1) return allIds;
  if(st.level===2) return idsOfGroup(st.group);
  return [st.city];
}
// Ctrl+clique em distrito/região (nível 1, kind='group') ou município dentro de
// um distrito aberto (nível 2, kind='city') soma/remove da seleção combinada.
// Clique normal em qualquer lugar (goState/goSub/goGroup/goCity) limpa a seleção —
// ela só existe "pausada" no nível onde foi criada.
function toggleSelection(kind,id){
  // gid de distrito/região é numérico no GeoJSON, mas o dataset do chip removível
  // (data-selid) sempre serializa pra string — sem normalizar aqui, tirar um chip
  // clicando nele faz Set.has(id) falhar (3 !== "3") e ADICIONA em vez de remover.
  id=String(id);
  if(!st.sel || st.sel.kind!==kind) st.sel={kind,ids:new Set()};
  if(st.sel.ids.has(id)) st.sel.ids.delete(id); else st.sel.ids.add(id);
  if(!st.sel.ids.size) st.sel=null;
  render();
  // sem flyToBounds aqui de propósito: cada Ctrl+clique já reenquadraria o mapa,
  // e enquanto o usuário ainda está compondo a seleção (clicando em vários lugares
  // em sequência) isso mais atrapalha do que ajuda — pedido do usuário.
}
function clearSelection(){ if(st.sel){ st.sel=null; render(); } }
function statusBreakdown(ids){
  const c={exec:0,ok:0,wait:0,stop:0}; let total=0;
  ids.forEach(id=>obrasOf(id).forEach(o=>{ c[statusBucket(o.statusObra)]++; total++; }));
  return {c,total};
}
function renderStatusChart(ids){
  const {c,total}=statusBreakdown(ids);
  const bar=document.getElementById('statBar'), leg=document.getElementById('statLeg');
  // A barra empilhada saiu (ajuste visual pedido: 3 mini-cards verticais); o
  // elemento #statBar continua no HTML só por compatibilidade, sempre vazio.
  if(bar) bar.innerHTML='';
  if(!leg) return;
  if(!total){ leg.innerHTML='<div class="empty" style="padding:2px 0">Sem obras neste recorte.</div>'; return; }
  leg.innerHTML=STATUS_STATES.filter(s=>c[s.key]>0).map(s=>{
    const pct=Math.round(c[s.key]/total*100);
    return `<div class="sit"><span class="dot" style="background:${s.color}"></span>`
      +`<span class="sit-l">${s.label}</span>`
      +`<span class="sit-v"><b>${NUM.format(c[s.key])}</b> <span class="sit-p">(${pct}%)</span></span></div>`;
  }).join('');
}
// barra de 2 segmentos (mesma linguagem visual da "Situação das obras" acima) comparando
// o valor original dos contratos com o total já incorporado em aditivos — pergunta que a
// cúpula faz na prática: "quanto do valor atual da carteira é aditivo, não orçamento original?"
function renderAditivoChart(ids){
  const bar=document.getElementById('aditivoBar'), leg=document.getElementById('aditivoLeg');
  if(!bar||!leg) return;
  const a=aggIds(ids), total=a.valorOriginal+a.adit;
  if(!total){ bar.innerHTML=''; leg.innerHTML='<div class="empty" style="padding:2px 0">Sem valores neste recorte.</div>'; return; }
  const pctAditReal=a.adit/total*100, pctOrigReal=100-pctAditReal;
  // largura mínima visível pro segmento de aditivo quando ele existe mas é pequeno
  // (ex.: 2%) — mesmo tratamento que rankRows() já dá às barras de ranking
  // (Math.max(4,...)), senão o segmento fica fino a ponto de sumir visualmente e a
  // única informação real vira o texto da legenda, não o gráfico em si.
  const pctAdit=a.adit>0?Math.max(3,pctAditReal):0, pctOrig=100-pctAdit;
  bar.innerHTML=
    `<i style="width:${pctOrig}%;background:var(--ng-deep)" title="Valor original: ${BRL.format(a.valorOriginal)} (${pctOrigReal.toFixed(0)}%)"></i>`
    +(a.adit>0?`<i style="width:${pctAdit}%;background:var(--amber)" title="Aditivos: ${BRL.format(a.adit)} (${pctAditReal.toFixed(0)}%)"></i>`:'');
  leg.innerHTML=
    `<span class="sit"><span class="dot" style="background:var(--ng-deep)"></span>Original <b>${BRL.format(a.valorOriginal)}</b></span>`
    +(a.adit>0?`<span class="sit"><span class="dot" style="background:var(--amber)"></span>Aditivos <b>${BRL.format(a.adit)}</b> (${pctAditReal.toFixed(0)}%)</span>`:'');
}
// mini gráfico de barras (SVG) com a contagem de contratos por ano de assinatura no
// recorte atual — dá noção de safra/tendência que nenhum KPI isolado mostra.
function renderYearChart(ids){
  const host=document.getElementById('yearChart'); if(!host) return;
  const counts={};
  ids.forEach(id=>obrasOf(id).forEach(o=>{ if(o.ano) counts[o.ano]=(counts[o.ano]||0)+1; }));
  const anos=Object.keys(counts).map(Number).sort((a,b)=>a-b);
  if(!anos.length){ host.innerHTML='<div class="empty" style="padding:2px 0">Sem data de assinatura neste recorte.</div>'; return; }
  const max=Math.max(...anos.map(a=>counts[a]));
  // Barras em HTML/flex (não mais SVG com preserveAspectRatio="none", que esticava
  // barras e rótulos): o painel tem largura fluida, então flex resolve a distribuição
  // sozinho, o texto fica nítido em qualquer largura, e cada ano ganha o valor acima
  // da barra, um trilho de fundo e destaque quando é o pico. Altura mínima de 6% pra
  // anos com poucos contratos não sumirem.
  const cols=anos.map(a=>{
    const pct=Math.max(6, counts[a]/max*100);
    const peak=counts[a]===max ? ' peak' : '';
    return `<div class="ycol${peak}" title="${a}: ${NUM.format(counts[a])} contrato${counts[a]===1?'':'s'}">`
      +`<div class="yval">${NUM.format(counts[a])}</div>`
      +`<div class="ytrack"><div class="ybar" style="height:${pct.toFixed(1)}%"></div></div>`
      +`<div class="ylab">’${String(a).slice(2)}</div></div>`;
  }).join('');
  host.innerHTML=`<div class="ychart" role="img" aria-label="Contratos por ano de assinatura">${cols}</div>`;
}
function setKPIs(){
  const ids=scopeIds(); const a=aggIds(ids);
  kObras.textContent=NUM.format(a.obras); kValor.textContent=BRL.format(a.valor); kPar.textContent=NUM.format(a.par);
  kMedio.textContent=a.obras?BRL.format(a.valor/a.obras):'—';
  kMun.textContent=NUM.format(ids.filter(id=>obrasOf(id).length>0).length);
  kAdit.textContent=BRL.format(a.adit);
  renderStatusChart(ids);
  renderAditivoChart(ids);
  renderYearChart(ids);
}
// entries pra ranking/popover de irmãos — mesma forma que rankRows() consome
// ({k,nome,sub,v}). Compartilhadas entre renderPanel() e o popover de navegação
// lateral da trilha (Fase 8): uma lista, uma ordenação, um lugar só calculando.
function groupEntries(){
  // ordem fixa dos Distritos Operacionais, pela numeração (1º, 2º, …).
  return groupsList().map(g=>({k:g.id,nome:g.nome.replace(/^D\.O\.\s*/,''),sub:g.sede,v:mval(aggIds(idsOfGroup(g.id)))}))
    .sort((a,b)=>a.k-b.k);
}
// includeZero=true pro popover de irmãos (Fase 8): lá qualquer município do grupo
// precisa ser navegável, mesmo sem contrato — diferente do ranking do painel do
// nível 2, que só lista quem tem obra (filtro original, mantido por padrão)
function cityEntries(ids,includeZero){
  return ids.map(id=>({k:id,nome:DB.municipios[id].nome,sub:'',v:mval(aggIds([id]))}))
    .filter(e=>includeZero||e.v>0).sort((a,b)=>b.v-a.v);
}
function rankRows(entries,onClick){
  const max=Math.max(1,...entries.map(e=>e.v));
  const amber=st.metric==='aditivo'?' amber':'';
  return entries.map((e,i)=>`<div class="rrow" role="button" tabindex="0" data-k="${e.k}" data-kind="${onClick}">
     <div class="t"><span class="nm">${escHtml(e.nome)} ${e.sub?`<span class="sub2">· ${escHtml(e.sub)}</span>`:''}</span><span class="vv">${METRIC[st.metric].fmt(e.v)}</span></div>
     <div class="rbar${amber}"><i style="width:${Math.max(4,e.v/max*100)}%"></i></div></div>`).join('');
}
// ativação de .rrow (painel de ranking e popover de irmãos usam o mesmo HTML/dataset)
function goRrow(rr){ if(rr.dataset.kind==='group')goGroup(rr.dataset.k); else goCity(rr.dataset.k); }
// Enter/Espaço → clique, pros cards que são <div role="button"> em vez de <button> nativo
function activateOnKey(e,selector){
  if(e.key!=='Enter' && e.key!==' ') return;
  const target=e.target.closest(selector); if(!target) return;
  e.preventDefault(); target.click();
}
let CUROBRAS=[];
const PIN_SVG='<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s7-7.58 7-12A7 7 0 0 0 5 10c0 4.42 7 12 7 12z"/><circle cx="12" cy="10" r="2.3"/></svg>';
function obraCard(o,i){
  const cod=NAMEIDX[normTxt(o.municipioTxt)];
  const munTxt=escHtml(o.municipioTxt);
  const munChip=o.municipioTxt
    ? (cod ? `<span class="chip mun locate" role="button" tabindex="0" data-cod="${cod}" title="Ver ${munTxt} no mapa">${PIN_SVG}${munTxt}</span>`
           : `<span class="chip mun">${munTxt}</span>`)
    : '';
  return `<div class="obra" role="button" tabindex="0" aria-label="Ver todos os dados do contrato ${escHtml(o.contrato)}" data-oid="${i}">
    <div class="r1"><span class="ct">${escHtml(o.contrato)}</span><span class="vl">${BRL.format(o.valor)}</span></div>
    <div class="ob just">${escHtml(o.objeto)}</div>
    <div class="chips"><span class="chip">${escHtml(o.status)}</span>${o.tipo?`<span class="chip">${escHtml(o.tipo)}</span>`:''}${munChip}</div>
    <div class="info">
      <div><div class="l">Contratada</div><div class="d">${escHtml(o.contratada)}</div></div>
      <div><div class="l">Valor atual</div><div class="d">${BRL.format(o.valor)}</div></div>
      <div class="fis"><div class="l">${escHtml(o.fiscalTipo||'FISCAL')}</div><div class="d">${escHtml(o.fiscal||'—')}</div></div>
    </div>
    <div class="more">Ver todos os dados ↗</div>
  </div>`;
}
function obrasCards(ids){
  const arr=[]; ids.forEach(id=>obrasOf(id).forEach(o=>arr.push(o)));
  arr.sort((a,b)=>b.valor-a.valor);
  CUROBRAS=arr;
  if(!arr.length) return `<div class="empty">${hasActiveFilter()?'Nenhum contrato encontrado com estes filtros.':'Nenhum contrato neste recorte.'}</div>`;
  return arr.slice(0,120).map((o,i)=>obraCard(o,i)).join('') + (arr.length>120?`<div class="empty">+ ${arr.length-120} contratos… refine a busca/filtros</div>`:'');
}

// ---- modal com os dados do contrato ----
function fmtContratoExt(v){
  if(v===null||v===undefined||v==='') return '—';
  const s=String(v).trim();
  if(/\d\/\d{4}/.test(s)) return escHtml(s);
  const d=s.replace(/\D/g,'');
  if(d.length>4) return `${d.slice(0,-4)}/${d.slice(-4)}`;
  return escHtml(s);
}
function fmtDateBR(v){
  if(!v) return '—';
  const s=String(v);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if(m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d=new Date(s); if(!isNaN(d)) return d.toLocaleDateString('pt-BR');
  return escHtml(s);
}
function fmtDateTimeBR(v){
  if(!v) return '—';
  const s=String(v);
  const m=s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if(m) return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
  const d=new Date(s); if(!isNaN(d)) return d.toLocaleDateString('pt-BR')+' '+d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  return escHtml(s);
}
function fmtVal(v){ return (v===null||v===undefined||v==='') ? '—' : escHtml(String(v)); }
function fmtCNPJ(v){
  if(v===null||v===undefined||v==='') return '—';
  const d=String(v).replace(/\D/g,'');
  if(d.length!==14) return escHtml(String(v));
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12,14)}`;
}
function mSection(title,fields){
  return `<div class="msec">${title}</div><div class="mgrid">`
    +fields.map(([l,d,extra])=>`<div><div class="l">${l}</div><div class="d">${d}${extra||''}</div></div>`).join('')
    +`</div>`;
}
// ---- gráficos legados do modal ----
// donutGauge / pieLegend / divergingBars / timelineGauge NÃO são mais chamados pelo
// modal desde a Etapa B (o modelo do usuário usa tabelas e barras próprias). Ficam
// no arquivo por decisão de escopo (spec §3.1) — remoção seria mudança fora do que
// a Etapa B autoriza. `prazoCalc` (usado por todos) segue vivo e compartilhado.
// anel/gauge de 1 valor (0-100%).
function donutGauge(pct,color,size){
  size=size||110;
  const stroke=Math.round(size*0.13), r=(size-stroke)/2, c=2*Math.PI*r;
  const p=Math.max(0,Math.min(100,pct)), dash=c*p/100;
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${p.toFixed(1)}% medido">
    <circle class="donut-track" cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke-width="${stroke}"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${dash.toFixed(2)} ${(c-dash).toFixed(2)}" transform="rotate(-90 ${size/2} ${size/2})"/>
  </svg>`;
}
// legenda em lista (dot + rótulo + valor) compartilhada pelas duas fábricas de gráfico
// acima — "neutral" usa a cor de "trilho" do CSS em vez de uma cor de dado (evita
// hardcode de cor aqui pra algo que não representa categoria nenhuma, só o restante).
function pieLegend(items){
  return `<div class="pie-leg">${items.map(s=>
    `<div class="pie-item"><span class="pie-dot${s.neutral?' neutral':''}"${s.neutral?'':` style="background:${s.color}"`}></span>`
    +`<span class="pie-l">${escHtml(s.label)}</span><span class="pie-v">${s.pctLabel}</span></div>`).join('')}</div>`;
}
// barras DIVERGENTES (eixo zero ao centro) pra Acréscimo/Supressão/Repercussão — o
// gráfico certo pra esse dado específico: Acréscimo é sempre ganho (positivo, cresce
// pra direita), Supressão é sempre perda conceitual mesmo guardada como número
// positivo na base (por isso entra com sinal invertido aqui, cresce pra esquerda), e
// Repercussão é a diferença líquida das duas (valor_aprovado−valor_supressao) — pode
// dar positiva OU negativa de verdade, então precisa de um eixo que aceite os dois
// lados. Uma pizza não serve (fatia negativa não existe — foi o motivo da 1ª versão
// desta função ter tirado a Repercussão da pizza); barras na mesma direção também não
// (não mostram que Supressão é uma redução, nem pra que lado a Repercussão pende).
// Cada barra escala em relação ao maior |percentual| dos três — o rótulo ao lado
// sempre mostra o percentual real (sobre o valor original), a barra só dá a
// comparação visual entre os três.
function divergingBars(rows){
  const maxAbs=Math.max(.1,...rows.map(r=>Math.abs(r.pct)));
  return `<div class="divbars">${rows.map(r=>{
    const w=Math.abs(r.pct)/maxAbs*48; // até 48% de cada lado do centro, deixa folga da borda
    const left=r.pct<0 ? (50-w) : 50;
    return `<div class="divbar-row"><div class="divbar-h"><span class="divbar-l">${escHtml(r.label)}</span><span class="divbar-v" style="color:${r.color}">${r.valLabel}</span></div>
      <div class="divbar-track"><i class="divbar-mid"></i><i class="divbar-fill" style="left:${left.toFixed(2)}%;width:${w.toFixed(2)}%;background:${r.color}"></i></div></div>`;
  }).join('')}</div>`;
}
function parseISODate(s){
  const m=s&&String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1],+m[2]-1,+m[3])) : null;
}
// linha de prazo: início → fim + quanto já passou (barra) + dias restantes/vencidos.
// Usa as datas JÁ vigentes do contrato (data_inicio_real/data_fim_previsto/
// data_fim_vigencia_contrato) — esses campos vêm de contratos_edificacao e já refletem
// qualquer aditivo de prazo aprovado até hoje, então não precisa somar dias de aditivo
// em aditivo pra saber "o prazo atual": a base já faz essa conta.
// núcleo do cálculo de prazo — MESMA fórmula de sempre, extraída para ser
// compartilhada entre a linha visual (timelineGauge, aba Aditivos) e os blocos
// Prazo/Execução da aba Resumo (Etapa B). Devolve null quando faltam datas.
function prazoCalc(startStr,endStr){
  const start=parseISODate(startStr), end=parseISODate(endStr);
  if(!start||!end) return null;
  const now=new Date(), today=new Date(Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()));
  const totalDays=Math.round((end-start)/86400000);
  const remainingDays=Math.round((end-today)/86400000);
  const pct=totalDays>0?Math.max(0,Math.min(100,(totalDays-remainingDays)/totalDays*100)):100;
  const overdue=remainingDays<0;
  const daysTxt=overdue?`Vencido há ${NUM.format(Math.abs(remainingDays))} dia${Math.abs(remainingDays)===1?'':'s'}`
    :`${NUM.format(remainingDays)} dia${remainingDays===1?'':'s'} restante${remainingDays===1?'':'s'}`;
  const color=overdue?TOKENS.statusStop:(remainingDays<=30?TOKENS.amber:TOKENS.ng);
  return {totalDays,remainingDays,pct,overdue,daysTxt,color};
}
// cor de TEXTO por estado (Etapa B / Bloco 7 — acessibilidade). A cor "cheia" de
// vermelho/âmbar/verde de TOKENS serve para preenchimentos (barras, pontos), mas em
// TEXTO pequeno sobre fundo claro ela não alcança WCAG AA — aqui mapeamos para as
// variantes de texto do tema (--status-stop-text / --amber-text / --ng-light), que
// o CSS já define escuras o suficiente no tema claro. Preenchimentos continuam com
// a cor cheia (TOKENS.*), inalterados.
function statusTextColor(c){
  if(c===TOKENS.statusStop) return 'var(--status-stop-text)';
  if(c===TOKENS.statusWait || c===TOKENS.amber) return 'var(--amber-text)';
  if(c===TOKENS.ng) return 'var(--ng-light)';
  return c;
}
function timelineGauge(label,startStr,endStr){
  const c=prazoCalc(startStr,endStr);
  if(!c) return `<div class="tl-row"><div class="tl-h"><span class="tl-l">${escHtml(label)}</span><span class="tl-days">—</span></div><div class="empty" style="padding:2px 0">Datas insuficientes pra calcular o prazo.</div></div>`;
  return `<div class="tl-row">
    <div class="tl-h"><span class="tl-l">${escHtml(label)}</span><span class="tl-days" style="color:${c.color}">${c.daysTxt}</span></div>
    <div class="tl-track"><i style="width:${c.pct.toFixed(1)}%;background:${c.color}"></i></div>
    <div class="tl-dates"><span>${fmtDateBR(startStr)}</span><span>${fmtDateBR(endStr)}</span></div>
  </div>`;
}
// card de indicador do modal (rótulo + valor) — .mkpi/.mkpis ainda estilizados no
// CSS; helper mantido para reuso futuro (nenhum pane o chama após a Etapa B).
function mkpi(label,valHtml){ return `<div class="mkpi"><div class="l">${label}</div><div class="v">${valHtml}</div></div>`; }
// botão discreto que recolhe/expande a lista de cards de um dos dois grupos de
// aditivo (valor/prazo) — o resumo (barras/timeline) fica sempre visível, só o
// detalhe por aditivo (mais verboso, cresce com o nº de aditivos) começa recolhido.
// Mesmo padrão de toggle já usado no botão "Comissão completa" de Dados Gerais.
function adToggle(targetId,n,kindLabel){
  return `<button type="button" class="adToggle" data-target="${targetId}" aria-expanded="false" aria-controls="${targetId}">
    <span>Ver ${n} aditivo${n===1?'':'s'} ${kindLabel}</span> <span class="adToggle-car">▾</span></button>`;
}
// cabeçalho do card de aditivo. Hoje só a lista "Outros aditivos" (buildAdValorPane)
// usa isto — valor e prazo têm tabelas próprias (.adv-*/.adp-*).
function adRowHeader(a){
  const obs=adObs(a);
  return `<div class="adrow-h"><span class="adnum">Aditivo ${fmtVal(a.nr_aditivo)}</span><span class="chip">${fmtVal(a.tipo_aditivo)}</span><span class="addate">${fmtDateBR(adPubDate(a))}</span></div>
    <div class="adproto">Processo ${fmtVal(a.nr_protocolo)}</div>${obs?`<div class="adobs">${escHtml(obs)}</div>`:''}`;
}
// Etapa B / Bloco 1 — a antiga aba única "Aditivos" foi dividida em duas:
// "Aditivos de valor" e "Aditivos de prazo". adCompute() é o prelúdio comum
// (as 3 sublistas), pra não duplicar a filtragem entre os dois panes.
function adCompute(o,raw){
  const list=(o.aditivos||[]);
  // aditivos_contrato é NÍVEL CONTRATO (não separa por obra) — as abas de aditivo
  // trabalham com o valor original DO CONTRATO, não o da obra.
  const orig=num(o.valorOriginalContrato)||num(raw.valor_original);
  const hasValor=a=>!!(num(a.valor_aprovado)||num(a.valor_supressao)||num(a.valor_repercussao));
  const hasPrazo=a=>!!(num(a.execucao_aprovado)||num(a.prazo_aprovado));
  return {
    orig,
    valorList:list.filter(hasValor),
    prazoList:list.filter(hasPrazo),
    outrosList:list.filter(a=>!hasValor(a)&&!hasPrazo(a)),
  };
}
// Aba "Aditivos de valor" (Etapa B / Bloco 4 — modelo janela_contrato_melhorado):
// faixa de 5 cartões → tabela por aditivo (com pílula de %) → widget do art. 125.
// As Σ acréscimo/supressão/repercussão são AS MESMAS que o pane usava para as
// barras divergentes — nenhum número muda; a barra do art. 125 é Σ acréscimo ÷
// valor_original contra a constante legal de 25% (não é dado novo).
function buildAdValorPane(o,raw){
  const {valorList,outrosList,orig}=adCompute(o,raw);
  if(!valorList.length && !outrosList.length)
    return `<div class="msec">Aditivos de valor</div><div class="empty">Nenhum aditivo de valor registrado para este contrato.</div>`;

  const pctS=v=>orig?fmtPct1(v/orig*100)+'%':'—';
  // aditivos_contrato não separa por obra: nos contratos multi-obra estes números
  // são do CONTRATO INTEIRO (todas as obras).
  let out=advScopeNote(o,'Aditivos do contrato — abrangem todas as obras deste contrato (a base não os separa por obra).');

  if(valorList.length){
    const acres =valorList.reduce((s,a)=>s+num(a.valor_aprovado),0);
    const supr  =valorList.reduce((s,a)=>s+num(a.valor_supressao),0);
    const reperc=valorList.reduce((s,a)=>s+num(a.valor_repercussao),0);
    const repClsT=reperc>0?'pos':reperc<0?'neg':'zero';

    const strip=`<div class="adv-strip">
      <div class="adv-c"><div class="rs-lbl">Valor original</div><div class="adv-n">${BRL2.format(orig)}</div></div>
      <div class="adv-c"><div class="rs-lbl">Acréscimos</div><div class="adv-n pos">${BRL2.format(acres)}</div><div class="adv-s">${pctS(acres)} do original</div></div>
      <div class="adv-c"><div class="rs-lbl">Supressões</div><div class="adv-n neg">${supr?'−'+BRL2.format(supr):BRL2.format(0)}</div><div class="adv-s">${pctS(supr)} do original</div></div>
      <div class="adv-c"><div class="rs-lbl">Repercussão líquida</div><div class="adv-n ${repClsT}">${signedBRL(reperc)}</div><div class="adv-s ${repClsT}">${pctS(Math.abs(reperc))} do original</div></div>
      <div class="adv-c adv-hero"><div class="rs-lbl">Valor atual${(o.nObras||1)>1?' (contrato)':''}</div><div class="adv-n">${BRL2.format(num(o.valorContrato))}</div><div class="adv-s">${NUM.format(valorList.length)} aditivo${valorList.length===1?'':'s'} de valor</div></div>
    </div>`;

    const cell=(val,cls,pill)=>`<div class="adv-cell"><span class="adv-v ${cls}">${val}</span>${pill||''}</div>`;
    const trows=valorList.map((a,i)=>{
      const av=num(a.valor_aprovado), sv=num(a.valor_supressao), rv=num(a.valor_repercussao);
      const aC=cell(av>0?BRL2.format(av):'—', av>0?'pos':'zero', av>0?`<span class="adv-pill pos">+${pctS(av)}</span>`:'');
      const sC=cell(sv>0?'−'+BRL2.format(sv):'—', sv>0?'neg':'zero', sv>0?`<span class="adv-pill neg">−${pctS(sv)}</span>`:'');
      const rC=cell(rv!==0?signedBRL(rv):'—', rv>0?'pos':rv<0?'neg':'zero', rv!==0?`<span class="adv-pill ${rv<0?'neg':'pos'}">${rv<0?'−':'+'}${pctS(Math.abs(rv))}</span>`:'');
      return `<div class="adv-row${i%2?' odd':''}">
        <div class="adv-rmain">
          <div class="adv-num">${fmtVal(a.nr_aditivo)}</div>
          <div class="adv-nup"><span class="adv-nup-p">${fmtVal(a.nr_protocolo)}</span></div>
          <div class="adv-pub">${fmtDateBR(adPubDate(a))}</div>
          ${aC}${sC}${rC}
        </div>${adObsRow(a,'adv')}</div>`;
    }).join('');
    const table=`<div class="adv-table">
      <div class="adv-thead"><div class="rs-lbl">Aditivos de valor (${valorList.length})</div><span class="adv-note">Valores em reais · pílula = % sobre o valor original</span></div>
      <div class="adv-scroll"><div class="adv-grid">
        <div class="adv-hrow"><div>Nº</div><div>NUP · nº do processo</div><div>Publicação</div><div class="r">Acréscimo</div><div class="r">Supressão</div><div class="r">Repercussão</div></div>
        ${trows}
      </div></div></div>`;

    const pctA=orig?acres/orig*100:0;
    const lc=pctA>=25?TOKENS.statusStop:pctA>=20?TOKENS.statusWait:TOKENS.ng;
    const lTxt=pctA>=25
      ? 'Limite de 25% atingido — novo acréscimo depende de justificativa e enquadramento legal.'
      : `Margem disponível de ${fmtPct1(25-pctA)}% do valor original.`;
    const limite=`<div class="adv-limite">
      <div class="rs-lbl">Limite legal de acréscimo · art. 125 da Lei 14.133/2021</div>
      <div class="adv-lim-row"><span>Acréscimo acumulado sobre o valor original</span><b style="color:${statusTextColor(lc)}">${fmtPct1(pctA)}% de 25,0%</b></div>
      <div class="adv-lim-bar"><i style="width:${Math.min(100,pctA/25*100).toFixed(1)}%;background:${lc}"></i></div>
      <div class="adv-lim-txt" style="color:${statusTextColor(lc)}">${lTxt}</div></div>`;

    out+=strip+table+limite;
  }

  if(outrosList.length){
    const rows=outrosList.map(a=>`<div class="adrow">${adRowHeader(a)}</div>`).join('');
    out+=`<div class="msec">Outros aditivos (${outrosList.length})</div><div class="adlist">${rows}</div>`;
  }
  return out;
}
// Aba "Aditivos de prazo" (Etapa B / Bloco 5 — modelo janela_contrato_melhorado):
// dois blocos (execução / vigência), cada um com cabeçalho Original·Prorrogado·Vigente
// em dias, 3 mini-cartões (calendário, via prazoCalc), tabela com "Prazo acumulado" e
// barra empilhada. "Original" = coluna autoritativa do contrato (prazo_execucao /
// prazo_vigencia_contrato — 100% preenchidas na base); "Prorrogado" = Σ dos dias dos
// aditivos de prazo (auditável linha a linha na tabela); "Vigente" = Original +
// Prorrogado (prazo CONTRATUAL). Antes o "Original" saía do intervalo de datas menos
// as prorrogações, e o intervalo absorvia os dias de paralisação — inflava o número.
function buildAdPrazoPane(o,raw){
  const {prazoList}=adCompute(o,raw);
  const dd=n=>{ const r=Math.round(n); return NUM.format(r)+' dia'+(Math.abs(r)===1?'':'s'); };
  const block=(titulo,sub,aditField,origField,startStr,endStr,vazioLabel)=>{
    // c = janela de CALENDÁRIO (inclui paralisações) — só alimenta os 3 mini-cartões.
    // O trio Original/Prorrogado/Vigente e a tabela são CONTRATUAIS e não dependem de
    // datas: aparecem mesmo em contrato "Aguardando OS" sem data_inicio_real.
    const c=prazoCalc(startStr,endStr);
    const lista=prazoList.filter(a=>num(a[aditField]));
    const prorrog=lista.reduce((s,a)=>s+num(a[aditField]),0);
    const original=num(raw[origField]);
    const vigente=original+prorrog;                    // prazo contratual (não o span de datas)
    const base=original>0?original:(vigente||1);       // evita ÷0 se a coluna vier zerada
    const pctBlock=base>0?prorrog/base*100:0;
    const cor=pctBlock>=100?TOKENS.statusStop:(pctBlock>=50?TOKENS.statusWait:TOKENS.ng);
    let acc=original;
    const trows=lista.map((a,i)=>{
      const d=num(a[aditField]); acc+=d;
      return `<div class="adp-row${i%2?' odd':''}">
        <div class="adp-rmain">
          <div class="adp-num">${fmtVal(a.nr_aditivo)}</div>
          <div class="adp-nup"><span class="adp-nup-p">${fmtVal(a.nr_protocolo)}</span></div>
          <div class="adp-pub">${fmtDateBR(adPubDate(a))}</div>
          <div class="adp-cell"><span class="adp-v">+${dd(d)}</span><span class="adp-pill">+${base>0?fmtPct1(d/base*100)+'%':'—'}</span></div>
          <div class="adp-acc">${dd(acc)}</div>
        </div>${adObsRow(a,'adp')}</div>`;
    }).join('');
    const tableInner=lista.length
      ? `<div class="adp-hrow"><div>Nº</div><div>NUP · nº do processo</div><div>Publicação</div><div class="r">Prorrogação</div><div class="r">Prazo acumulado</div></div>${trows}`
      : `<div class="empty" style="padding:14px 16px">${vazioLabel}</div>`;
    const origW=100/(1+pctBlock/100);
    const txt=pctBlock>=100
      ? 'As prorrogações já dobraram o prazo originalmente contratado.'
      : `Prorrogações somam ${fmtPct1(pctBlock)}% do prazo original.`;
    const minis=c?`<div class="adp-minis">
        <div class="adp-mini"><div class="rs-lbl">Data-limite</div><div class="adp-mv">${fmtDateBR(endStr)}</div></div>
        <div class="adp-mini"><div class="rs-lbl">Falta para encerrar</div><div class="adp-mv" style="color:${statusTextColor(c.color)}">${escHtml(c.daysTxt)}</div></div>
        <div class="adp-mini"><div class="rs-lbl">Prazo decorrido</div><div class="adp-mv">${fmtPct1(c.pct)}%</div>
          <div class="adp-mini-bar"><i style="width:${c.pct.toFixed(1)}%;background:${c.color}"></i></div></div>
      </div>
      <div class="adp-cal-note">Datas de calendário — incluem paralisações; podem não fechar com o prazo contratual acima.</div>`:'';
    return `<div class="adp-block">
      <div class="adp-head">
        <div><div class="adp-h">${titulo}</div><div class="adp-sub">${sub}</div></div>
        <div class="adp-trio">
          <div><div class="rs-lbl">Original</div><div class="adp-d">${dd(original)}</div></div>
          <div><div class="rs-lbl">Prorrogado</div><div class="adp-d" style="color:${statusTextColor(cor)}">${prorrog?'+'+dd(prorrog):'—'}</div></div>
          <div><div class="rs-lbl">Vigente</div><div class="adp-d">${dd(vigente)}</div></div>
        </div>
      </div>
      ${minis}
      <div class="adp-scroll"><div class="adp-grid">${tableInner}</div></div>
      <div class="adp-foot">
        <div class="adp-stack"><i style="width:${origW.toFixed(1)}%"></i></div>
        <div class="adp-leg"><span><i class="d-o"></i>Prazo original</span><span><i class="d-p"></i>Prorrogações</span>
          <b style="color:${statusTextColor(cor)}">${txt}</b></div>
      </div>
    </div>`;
  };
  const cE=prazoCalc(raw.data_inicio_real,raw.data_fim_previsto);
  const cV=prazoCalc(raw.data_inicio_real,raw.data_fim_vigencia_contrato);
  if(!prazoList.length && !cE && !cV)
    return `<div class="msec">Aditivos de prazo</div><div class="empty">Nenhum aditivo de prazo registrado para este contrato.</div>`;
  // "Original" (prazo_execucao/prazo_vigencia_contrato) é por OBRA; as prorrogações
  // (aditivos_contrato) são do CONTRATO. Nos contratos multi-obra os dois níveis
  // aparecem juntos — aviso explícito.
  return `<div class="adp-wrap">`
    +advScopeNote(o,'Original é o prazo desta obra; as prorrogações vêm dos aditivos do contrato (a base não os separa por obra).')
    +block('Prazo de execução','Período para conclusão física da obra','execucao_aprovado','prazo_execucao',raw.data_inicio_real,raw.data_fim_previsto,'Nenhum aditivo de prazo de execução registrado.')
    +block('Prazo de vigência','Período de validade jurídica do contrato','prazo_aprovado','prazo_vigencia_contrato',raw.data_inicio_real,raw.data_fim_vigencia_contrato,'Nenhum aditivo de prazo de vigência registrado.')
    +`</div>`;
}
// total_medido/percentual_total_medido vêm prontos de ficha_contrato (mesma origem/
// escopo já usada pros outros totais do contrato) — evita somar as dezenas de linhas
// mensais de medições no cliente só pra chegar num número que a base já calcula.
// Aba "Medições" (Etapa B / Bloco 6 — modelo janela_contrato_melhorado): faixa de
// 4 indicadores (da ficha, autoritativa) → tabela mensal de o.medicoes → rodapé
// (também da ficha) → legendas STM. Sem STP/glosa/ajuste (não existem na base).
// total_medido/percentual_total_medido continuam vindo de ficha_contrato — NÃO se
// soma a tabela mês a mês pra chegar nesses números.
function buildMedicoesPane(o,raw){
  const f=o.ficha;
  const meds=o.medicoes||[];
  if(!f && !meds.length)
    return `<div class="msec">Medições</div><div class="empty">Sem dados de medição disponíveis para este contrato.</div>`;

  const multiObra=(o.nObras||1)>1;
  const {total,pct,saldo}=medObraStats(o);   // total/pct/saldo NO NÍVEL DA OBRA
  const pctW=pct==null?0:Math.max(0,Math.min(100,pct));
  const lastM=meds[meds.length-1];
  const ultima=lastM?`${fmtVal(lastM.periodo)}${lastM.nr_medicao!=null?' · '+NUM.format(lastM.nr_medicao)+'ª medição':''}`:'—';
  const qtdTxt=meds.length
    ? (meds.length===1?'1 medição registrada':`${NUM.format(meds.length)} medições registradas`)
    : 'sem medições desta obra';
  const nota=advScopeNote(o,`Medições desta obra${f&&f.percentual_total_medido!=null?` · medido no contrato (todas as obras): ${fmtPct1(num(f.percentual_total_medido))}%`:''}.`);

  const strip=`<div class="med-strip">
    <div class="med-c"><div class="rs-lbl">Total medido${multiObra?' na obra':''}</div><div class="med-n">${total==null?'—':BRL2.format(total)}</div><div class="med-s">${qtdTxt}</div></div>
    <div class="med-c"><div class="rs-lbl">Saldo da obra</div><div class="med-n">${saldo==null?'—':BRL2.format(saldo)}</div><div class="med-s">Sobre ${BRL2.format(num(o.valor))}</div></div>
    <div class="med-c"><div class="rs-lbl">Percentual executado</div><div class="med-n pos">${pct==null?'—':fmtPct1(pct)+'%'}</div>
      <div class="rs-bar"><i class="g" style="width:${pctW.toFixed(1)}%"></i></div></div>
    <div class="med-c med-hero"><div class="rs-lbl">Última medição</div><div class="med-n">${ultima}</div></div>
  </div>`;

  let tableBlock;
  if(meds.length){
    const glosaTot=meds.reduce((s,m)=>s+num(m.valor_ref_glosa),0);
    const brutoTot=meds.reduce((s,m)=>s+num(m.valor_medido),0);
    // bruto − glosa − líquido: em algumas obras `total` já embute outras retenções
    // (não registradas em valor_ref_glosa). Mostra a diferença pra o rodapé sempre fechar.
    const outrasRet=(total==null)?0:Math.round((brutoTot-glosaTot-total)*100)/100;
    const trows=meds.map((m,i)=>{ const g=num(m.valor_ref_glosa); return `<div class="med-row${i%2?' odd':''}">
      <div class="med-nr">${fmtVal(m.nr_medicao)}</div>
      <div><span class="med-stm">${fmtVal(m.sigla_status_medicao)}</span></div>
      <div class="med-per">${fmtVal(m.periodo)}</div>
      <div class="med-proto">${fmtVal(m.nr_protocolo)}</div>
      <div class="med-val">${BRL2.format(num(m.valor_medido))}</div>
      <div class="med-val med-glosa">${g>0?'−'+BRL2.format(g):'—'}</div>
      <div class="med-tot">${BRL2.format(num(m.total))}</div>
    </div>`; }).join('');
    const foot=`<div class="med-foot">
      <div><div class="rs-lbl">Medido (bruto)</div><div class="med-fn">${BRL2.format(brutoTot)}</div></div>
      <div><div class="rs-lbl">Glosas</div><div class="med-fn med-glosa">${glosaTot>0?'−'+BRL2.format(glosaTot):BRL2.format(0)}</div></div>
      ${outrasRet>=0.01?`<div><div class="rs-lbl">Outras retenções</div><div class="med-fn med-glosa">−${BRL2.format(outrasRet)}</div></div>`:''}
      <div><div class="rs-lbl">Total medido (líquido)</div><div class="med-fn pos">${total==null?'—':BRL2.format(total)}</div></div>
      <div><div class="rs-lbl">Saldo da obra</div><div class="med-fn">${saldo==null?'—':BRL2.format(saldo)}</div></div>
      <div><div class="rs-lbl">Percentual</div><div class="med-fn pos">${pct==null?'—':fmtPct1(pct)+'%'}</div></div>
    </div>`;
    tableBlock=`<div class="med-table">
      <div class="med-thead"><div class="rs-lbl">Medições ${multiObra?'da obra':'do contrato'}</div><span class="adv-note">STM = situação da medição · Medido = bruto · Total = líquido (após glosa) · valores em reais</span></div>
      <div class="med-scroll"><div class="med-grid">
        <div class="med-hrow"><div>Nr</div><div>STM</div><div>Período</div><div>Protocolo</div><div class="r">Medido</div><div class="r">Glosa</div><div class="r">Total</div></div>
        ${trows}${foot}
      </div></div></div>`;
  } else {
    tableBlock=`<div class="med-table"><div class="med-thead"><div class="rs-lbl">Medições ${multiObra?'da obra':'do contrato'}</div></div>`
      +`<div class="empty" style="padding:14px 16px">Sem medições registradas para esta obra.</div></div>`;
  }

  const legend=meds.length?`<div class="med-leg">
    <div class="rs-lbl">Legendas de situação da medição (STM)</div>
    <div class="med-leg-grid">${STM_LEGENDA.map(([c,t])=>`<div class="med-leg-i"><b>${escHtml(c)}</b><span>${escHtml(t)}</span></div>`).join('')}</div></div>`:'';

  return nota+strip+tableBlock+legend;
}
// ---- Aba "Resumo" (dashboard executivo — Etapa B, revisado a partir de modelo do
// usuário). Só leitura; valores de UMA obra já carregada. Os percentuais são razão de
// valores que já existem; a curva plota o `total` LÍQUIDO ACUMULADO no cliente (a base
// entrega por período, já com glosas descontadas) ÷ valor da obra. Ícones = SVG inline. ----
const RS_ICO={
  obj:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18M6 21V7l6-4 6 4v14M10 21v-4h4v4"/><path d="M9 10h.01M15 10h.01M9 13.5h.01M15 13.5h.01"/></svg>',
  pin:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-7.16 7-12A7 7 0 0 0 5 9c0 4.84 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>',
  dist:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V8l5-3 5 3v13M14 21V11l6-3v10M3 21h18M8 10v.01M8 13v.01"/></svg>',
  pessoa:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.5"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/></svg>',
  banco:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10 12 4l9 6M5 10v9M19 10v9M9 10v9M15 10v9M3 20h18"/></svg>',
  valor:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="12" cy="12" r="2.6"/></svg>',
  comissao:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6.6a3 3 0 0 1 0 5.6M21 20a6 6 0 0 0-4-5.6"/></svg>',
  clock:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  chart:'<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16M8 14l3-3 3 2 4-5"/></svg>',
};
// medição NO NÍVEL DA OBRA: Σ do `total` LÍQUIDO das medições desta obra (já com as
// glosas descontadas — não `valor_medido`, que é o bruto) ÷ valor da obra. Denominador =
// `o.valor` (valor_atual da obra em contratos_edificacao — autoritativo; medicoes.valor_atual
// é cópia denormalizada, fica de fallback). `denom` é reexposto para a curva do Resumo (R4)
// usar o MESMO. Sem linhas de medição da obra: só cai na ficha (NÍVEL CONTRATO) quando é
// contrato de obra única; multi-obra fica "—" (a ficha somaria todas as obras).
function medObraStats(o){
  const meds=o.medicoes||[];
  const denom=num(o.valor)||Math.max(0,...meds.map(m=>num(m.valor_atual)))||0;
  if(meds.length){
    const total=meds.reduce((s,m)=>s+num(m.total),0);
    return {total, pct:denom?total/denom*100:0, saldo:Math.max(0,denom-total), denom, fonte:'obra'};
  }
  if((o.nObras||1)===1 && o.ficha && o.ficha.total_medido!=null){
    const total=num(o.ficha.total_medido);
    return {total, pct:num(o.ficha.percentual_total_medido), saldo:Math.max(0,denom-total), denom, fonte:'ficha'};
  }
  return {total:null, pct:null, saldo:null, denom, fonte:'nenhuma'};
}
// gráfico de linha simples (SVG inline, sem lib) — série única: % de medição por
// período. Largura total do cartão, com linhas de grade horizontais (modelo).
function rsLineChart(pts){
  if(!pts.length) return `<div class="empty">Sem medições registradas para este contrato.</div>`;
  const W=920,H=210,PADL=8,PADR=14,PADT=16,PADB=24, iw=W-PADL-PADR, ih=H-PADT-PADB;
  const maxY=Math.max(10,...pts.map(p=>p.y));
  const X=i=>PADL+(pts.length<2?iw/2:i/(pts.length-1)*iw);
  const Y=v=>PADT+ih-(Math.max(0,Math.min(maxY,v))/maxY)*ih;
  const grid=[0,.25,.5,.75,1].map(f=>`<line class="rs-lc-grid" x1="${PADL}" x2="${(W-PADR).toFixed(1)}" y1="${(PADT+ih*f).toFixed(1)}" y2="${(PADT+ih*f).toFixed(1)}"/>`).join('');
  const line=pts.map((p,i)=>`${i?'L':'M'}${X(i).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const area=`${line} L${X(pts.length-1).toFixed(1)},${(PADT+ih).toFixed(1)} L${X(0).toFixed(1)},${(PADT+ih).toFixed(1)} Z`;
  const dots=pts.map((p,i)=>`<circle cx="${X(i).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="2.6"/>`).join('');
  const idxs=pts.length<=6?pts.map((_,i)=>i):[0,Math.round((pts.length-1)/2),pts.length-1];
  const xlabs=idxs.map(i=>`<text x="${X(i).toFixed(1)}" y="${H-7}" text-anchor="${i===0?'start':i===pts.length-1?'end':'middle'}" class="rs-lc-lab">${escHtml(String(pts[i].label||'').slice(0,7))}</text>`).join('');
  const last=pts[pts.length-1];
  return `<svg viewBox="0 0 ${W} ${H}" class="rs-lc" preserveAspectRatio="none" role="img" aria-label="Evolução da medição: ${fmtPct1(last.y)}% no último período">
    ${grid}<path class="rs-lc-area" d="${area}"/><path class="rs-lc-line" d="${line}"/>${dots}
    <text x="${X(pts.length-1).toFixed(1)}" y="${Math.max(12,Y(last.y)-7).toFixed(1)}" text-anchor="end" class="rs-lc-val">${fmtPct1(last.y)}%</text>${xlabs}</svg>`;
}
function buildResumoPane(o,raw){
  const orig=num(raw.valor_original);
  const aditRows=o.aditivos||[];
  // `o.aditivo` já foi corrigido no loadData (Σ repercussão líquida dos aditivos,
  // fallback total_aditivo) — o campo cru do contrato vem zerado em ~1/3 dos casos.
  const adit=num(o.aditivo);
  // acréscimo BRUTO (Σ valor_aprovado) — é o que o art. 125 da Lei 14.133/2021 limita
  // a 25%; supressões não entram nessa conta (usado só nos "pontos de atenção", R5).
  const multiObra=(o.nObras||1)>1;
  const origC=num(o.valorOriginalContrato)||orig;        // valor original do CONTRATO (todas as obras)
  // art. 125: acréscimo BRUTO ÷ valor original DO CONTRATO (o limite legal é do contrato,
  // e os aditivos_contrato não separam por obra).
  const pctAcr=origC?aditRows.reduce((s,a)=>s+num(a.valor_aprovado),0)/origC*100:0;
  const med=medObraStats(o);                             // medição NO NÍVEL DA OBRA
  const medTot=med.total, medPct=med.pct;
  const pR=medPct==null?0:Math.max(0,Math.min(100,medPct)); // % para as barras (clamp 0-100)
  const pctAdit=orig?adit/orig*100:0;                    // repercussão líquida da OBRA ÷ valor original da OBRA
  const pct1=v=>fmtPct1(v)+'%';
  const dd=n=>NUM.format(Math.abs(n))+' dia'+(Math.abs(n)===1?'':'s');
  const cExec=prazoCalc(raw.data_inicio_real,raw.data_fim_previsto);
  const cVig=prazoCalc(raw.data_inicio_real,raw.data_fim_vigencia_contrato);
  const paral=num(raw.dias_paralisado);
  const com=(o.comissao&&o.comissao.length)?o.comissao:[];
  const fiscalResp=pickFiscal(com);

  // ---- R1 — cartão de identificação (objeto + grade de 4) ----
  const idCell=(label,val,sub)=>`<div class="rs-id-cell"><div class="rs-lbl">${label}</div><div class="rs-id-v">${val}</div>${sub?`<div class="rs-id-sub">${sub}</div>`:''}</div>`;
  const fiscSub=`${com.length?NUM.format(com.length)+' membro'+(com.length===1?'':'s'):'sem comissão'} · <button type="button" class="mlink" id="mResumoVerComissao">ver aba &rarr;</button>`;
  const r1=`<div class="rs-row"><div class="rs-id">
    <div><div class="rs-lbl">${RS_ICO.obj} Objeto ${multiObra?'da obra':'do contrato'}</div><div class="rs-obj-txt">${escHtml(o.objeto)}</div></div>
    <div class="rs-id-grid">
      ${idCell('Município', fmtVal(raw.municipio||o.municipioTxt))}
      ${idCell('Distrito Operacional', fmtVal(raw.distrito_operacional))}
      ${idCell('Contratada', fmtVal(raw.contratada), 'CNPJ '+fmtCNPJ(raw.cnpj_contratada))}
      ${idCell('Fiscalização', fiscalResp?escHtml(fiscalResp.nome):'—', fiscSub)}
    </div></div></div>`;

  // ---- R2 — 2 cartões de status (obra / contrato), cor de TOKENS.status* ----
  const stCard=(label,word,c,ini,fim,colOverride,extra)=>{
    const fill=colOverride||(c?c.color:null)||'var(--text-dim)';        // preenchimento (ponto, barra)
    const txt=colOverride?statusTextColor(colOverride):(c?statusTextColor(c.color):'var(--text-dim)'); // texto (AA)
    return `<div class="rs-st">
      <div class="rs-st-head"><i class="rs-st-dot" style="background:${fill}"></i>
        <div class="rs-st-hx"><div class="rs-lbl">${label}</div><div class="rs-st-word" style="color:${txt}">${word||'—'}</div></div></div>
      <div class="rs-st-dates"><span>${fmtDateBR(ini)}</span><span>${fmtDateBR(fim)}</span></div>
      <div class="rs-st-track"><i style="width:${c?c.pct.toFixed(1):0}%;background:${fill}"></i></div>
      <div class="rs-st-days" style="color:${c?statusTextColor(c.color):'var(--text-dim)'}">${c?escHtml(c.daysTxt):'datas insuficientes'}</div>
      ${extra||''}</div>`;
  };
  const obraCol=paral>0?TOKENS.statusStop:(cExec?cExec.color:null);
  const r2=`<div class="rs-row rs-status">`
    +stCard('Situação da obra', fmtVal(raw.status_obra), cExec, raw.data_inicio_real, raw.data_fim_previsto, obraCol,
       paral>0?`<div class="rs-st-paral">Paralisada há ${dd(paral)}</div>`:'')
    +stCard('Situação do contrato', fmtVal(raw.status_contrato), cVig, raw.data_inicio_real, raw.data_fim_vigencia_contrato)
    +`</div>`;

  // ---- R3 — faixa de 4 indicadores ----
  // O card "Aditivos" mostra a REPERCUSSÃO LÍQUIDA (adit = Σ acréscimo − supressão),
  // que pode ser NEGATIVA (supressão líquida): sinal explícito ("−"), barra travada
  // em ≥0, cor neutra. O limite do art. 125 (acréscimo BRUTO) é aferido à parte, no
  // R5, com pctAcr — não nesta barra.
  const aditCol=pctAdit>=25?TOKENS.statusStop:pctAdit>=10?TOKENS.amber:TOKENS.ng;
  const aditSubColor=adit<0?'var(--text-dim)':statusTextColor(aditCol);
  const aditPctTxt=`${adit<0?'−':'+'}${pct1(Math.abs(pctAdit))}`;
  const aditContrato=aditRows.reduce((s,a)=>s+num(a.valor_repercussao),0); // Σ nível contrato
  const saldo=med.saldo;
  const valTxt=multiObra?'do valor da obra':'do valor atual';
  const heroCard=`<div class="rs-card rs-hero"><span class="rs-ic sm">${RS_ICO.valor}</span><div class="rs-lbl">Valor ${multiObra?'desta obra':'atual do contrato'}</div>
    <div class="rs-num big">${BRL2.format(o.valor)}</div>
    <div class="rs-card-sub">Original: ${BRL2.format(orig)}</div>
    ${multiObra?`<div class="rs-card-sub">Contrato (todas as obras): ${BRL2.format(num(o.valorContrato))}</div>`:''}</div>`;
  const aditCard=`<div class="rs-card"><div class="rs-lbl">Aditivos${multiObra?' da obra':''}</div>
    <div class="rs-num">${signedBRL(adit)}</div>
    <div class="rs-card-sub" style="color:${aditSubColor}">${aditPctTxt} sobre o valor original</div>
    ${multiObra?`<div class="rs-card-sub">Contrato: ${signedBRL(aditContrato)}</div>`:''}
    <div class="rs-bar"><i style="width:${Math.max(0,Math.min(100,pctAdit/25*100)).toFixed(1)}%;background:${adit<0?'var(--text-dim)':aditCol}"></i></div></div>`;
  const medCard=`<div class="rs-card"><div class="rs-lbl">Total medido${multiObra?' na obra':''}</div>
    <div class="rs-num">${medTot==null?'—':BRL2.format(medTot)}</div>
    <div class="rs-card-sub">${medPct==null?(med.fonte==='nenhuma'?'sem medições registradas':'—'):pct1(medPct)+' '+valTxt}${med.fonte==='ficha'?' (ficha do contrato)':''}</div>
    ${multiObra&&o.ficha&&o.ficha.percentual_total_medido!=null?`<div class="rs-card-sub">Contrato: ${fmtPct1(num(o.ficha.percentual_total_medido))}% medido</div>`:''}
    <div class="rs-bar"><i class="g" style="width:${pR.toFixed(1)}%"></i></div></div>`;
  const saldoCard=`<div class="rs-card"><div class="rs-lbl">Saldo a medir</div>
    <div class="rs-num">${saldo==null?'—':BRL2.format(saldo)}</div>
    <div class="rs-card-sub">${medPct==null?'—':pct1(Math.max(0,100-pR))+' '+valTxt}</div>
    <div class="rs-bar"><i class="b" style="width:${medPct==null?0:Math.max(0,100-pR).toFixed(1)}%"></i></div></div>`;
  const r3=`<div class="rs-row rs-ind">${heroCard}${aditCard}${medCard}${saldoCard}</div>`;

  // ---- R4 — curva de evolução da medição (largura total, com grade) ----
  // acumula o `total` LÍQUIDO por período (glosas já descontadas), na ordem de nr_medicao
  // (o.medicoes já vem ordenado de fetchMedicoes). Denominador = `med.denom` (valor DA
  // OBRA) — o mesmo dos cards de medição; assim a curva e o card "% executado" fecham.
  const meds=o.medicoes||[];
  const medDenom=med.denom;
  let accMed=0;
  const pts=meds.map(m=>{ accMed+=num(m.total); return {label:m.periodo, y:medDenom?accMed/medDenom*100:0}; }).filter(p=>isFinite(p.y));
  const lastM=meds[meds.length-1];
  const ultimaTxt=lastM?`Última medição: ${fmtVal(lastM.periodo)}${lastM.nr_medicao!=null?' · '+NUM.format(lastM.nr_medicao)+'ª':''}`:'';
  const r4=`<div class="rs-row"><div class="rs-chartbox">
    <div class="rs-cb-head"><div class="rs-lbl">${RS_ICO.chart} Evolução da medição (%)</div>${ultimaTxt?`<span class="rs-cb-sub">${escHtml(ultimaTxt)}</span>`:''}</div>
    ${rsLineChart(pts)}</div></div>`;

  // ---- R5 — pontos de atenção (só rotula valores já exibidos; limiares fixos) ----
  const att=[];
  if(paral>0) att.push([TOKENS.statusStop, `Obra paralisada há ${dd(paral)}.`]);
  if(cExec&&cExec.overdue) att.push([TOKENS.statusStop, `Prazo de execução vencido há ${dd(cExec.remainingDays)}.`]);
  else if(cExec&&cExec.color===TOKENS.amber) att.push([TOKENS.amber, `Prazo de execução encerra em ${dd(cExec.remainingDays)}.`]);
  if(cVig&&cVig.overdue) att.push([TOKENS.statusStop, `Vigência contratual vencida há ${dd(cVig.remainingDays)}.`]);
  if(pctAcr>=25) att.push([TOKENS.statusStop, `Acréscimos somam ${pct1(pctAcr)} do valor original — acima do limite de 25% do art. 125 da Lei 14.133/2021.`]);
  else if(pctAdit>=10) att.push([TOKENS.amber, `Aditivos somam ${pct1(pctAdit)} do valor original.`]);
  if(!att.length) att.push([TOKENS.ng, 'Nenhum ponto de atenção identificado neste contrato.']);
  const r5=`<div class="rs-row"><div class="rs-att">
    <div class="rs-lbl">${RS_ICO.clock} Pontos de atenção</div>
    <div class="rs-att-grid">${att.map(([c,t])=>`<div class="rs-att-i"><i style="background:${c}"></i><span>${escHtml(t)}</span></div>`).join('')}</div>
  </div></div>`;

  // ---- R6 — "Detalhes do contrato" recolhível (fechado por padrão). Reusa .adToggle. ----
  const detFields=[
    ['CÓDIGO DA OBRA', fmtVal(raw.codigo_obra)],
    ['TIPO DE CONTRATO', fmtVal(raw.descricao_tipo_contrato||o.tipo)],
    ['SAC', fmtVal(raw.nr_contrato_sic)],
    ['ORDEM DE SERVIÇO', fmtVal(raw.nr_os)],
    ['DATA DE ASSINATURA', fmtDateBR(raw.data_assinatura)],
    ['CONTRATANTE', fmtVal(raw.contratante)],
    ['CNPJ DO CONTRATANTE', fmtCNPJ(raw.cnpj_contratante)],
    ['TOTAL DE REAJUSTE', BRL2.format(num(raw.total_reajuste))],
    ['TOTAL REALINHADO', BRL2.format(num(raw.total_realinhado))],
  ];
  const detalhes=`<button type="button" class="adToggle" data-target="mDetList" aria-expanded="false" aria-controls="mDetList">`
    +`<span>Detalhes do contrato</span> <span class="adToggle-car">&#9662;</span></button>`
    +`<div id="mDetList" hidden><div class="mgrid" style="margin-top:10px">`
    +detFields.map(([l,d])=>`<div><div class="l">${l}</div><div class="d">${d}</div></div>`).join('')
    +`</div></div>`;
  return r1+r2+r3+r4+r5+detalhes;
}
// obra atualmente exibida no modal — guardada só para redesenhar o modal na troca
// de tema ao vivo (os gráficos internos carregam cor de TOKENS no innerHTML).
let _lastModalObra=null;
function openModal(o){
  _lastModalObra=o;
  const raw=o.raw||{};
  const resumoHTML=buildResumoPane(o,raw);
  const fiscalizacaoHTML=buildFiscalizacaoPane(o);
  const adValorHTML=buildAdValorPane(o,raw);
  const adPrazoHTML=buildAdPrazoPane(o,raw);
  const medicoesHTML=buildMedicoesPane(o,raw);
  // "Localizar no mapa": fecha o modal e navega até o município da obra (nível 3),
  // pelo mesmo goCity() de um clique no mapa — não altera filtros, métrica nem escopo.
  const munCod=o.municipioTxt?NAMEIDX[normTxt(o.municipioTxt)]:null;
  const munTxt=escHtml(o.municipioTxt||raw.municipio||'');
  const locateBtn=munCod
    ? `<button type="button" class="m-locate" id="modalLocate" title="Fechar e ver ${munTxt} no mapa">${PIN_SVG}<span>Localizar no mapa</span></button>`
    : `<button type="button" class="m-locate" id="modalLocate" disabled title="Este contrato não tem município mapeável no Ceará">${PIN_SVG}<span>Localizar no mapa</span></button>`;
  document.getElementById('modal').innerHTML=
    `<div class="mtop" data-tab="resumo">
       <div class="mh"><div class="mh-titles">
           <div class="mt">DADOS DO CONTRATO Nº ${fmtContratoExt(raw.nr_contrato_ext)}</div>
           ${(o.nObras||1)>1?`<div class="mobra">${RS_ICO.dist}<span>Obra ${escHtml(o.codigo_obra||('#'+o.id_obra))} · uma das obras deste contrato</span></div>`:''}
           <div class="msub">${RS_ICO.chart}<span>Resumo executivo do contrato</span></div></div>
         <div class="mh-actions">${locateBtn}<button class="mx" id="modalX" aria-label="Fechar">✕</button></div></div>
       <div class="mtabs" role="tablist">
         <button type="button" class="mtab on" role="tab" aria-selected="true" aria-controls="mPaneResumo" data-tab="resumo">Resumo</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneAdValor" data-tab="aditivos-valor">Aditivos de valor</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneAdPrazo" data-tab="aditivos-prazo">Aditivos de prazo</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneMedicoes" data-tab="medicoes">Medições</button>
         <button type="button" class="mtab" role="tab" aria-selected="false" aria-controls="mPaneFiscalizacao" data-tab="fiscalizacao">Fiscalização</button>
       </div>
     </div>
     <div class="mbody" data-tab="resumo">
       <div class="mobj">${escHtml(o.objeto)}</div>
       <div class="mpane" id="mPaneResumo" role="tabpanel" data-pane="resumo">${resumoHTML}</div>
       <div class="mpane" id="mPaneAdValor" role="tabpanel" data-pane="aditivos-valor" hidden>${adValorHTML}</div>
       <div class="mpane" id="mPaneAdPrazo" role="tabpanel" data-pane="aditivos-prazo" hidden>${adPrazoHTML}</div>
       <div class="mpane" id="mPaneMedicoes" role="tabpanel" data-pane="medicoes" hidden>${medicoesHTML}</div>
       <div class="mpane" id="mPaneFiscalizacao" role="tabpanel" data-pane="fiscalizacao" hidden>${fiscalizacaoHTML}</div>
       <div class="mupd">Atualizado em ${fmtDateTimeBR(raw.atualizado_em)}</div>
     </div>`;
  document.getElementById('modalBg').classList.add('show');
  document.getElementById('modalX').onclick=closeModal;
  const _loc=document.getElementById('modalLocate');
  if(_loc && munCod) _loc.onclick=()=>{ closeModal(); goCity(munCod); };
  const _vc=document.getElementById('mResumoVerComissao');
  if(_vc) _vc.onclick=()=>{ const t=document.querySelector('.modal .mtab[data-tab="fiscalizacao"]'); if(t) t.click(); };
  wireModalTabs();
  wireAdToggles();
}
// Aba "Fiscalização": fiscal titular em destaque + suplente (se houver) + comissão
// completa. Ordenação/classificação já vêm prontas de fetchFiscais (rank desc via
// classifyComissao). A matrícula (comissao_fiscalizacao.matricula) aparece quando
// preenchida — nem todo integrante tem.
function buildFiscalizacaoPane(o){
  const com=(o.comissao&&o.comissao.length)?o.comissao:[];
  if(!com.length) return `<div class="empty">Sem dados de fiscalização para este contrato.</div>`;
  // com[] já vem ordenado por rank de EXIBIÇÃO (fetchFiscais). O fiscal responsável
  // NÃO é necessariamente com[0] — é pickFiscal (Fiscal, senão 1º Membro).
  const titular=pickFiscal(com);
  const suplente=com.find(m=>m.tipo==='SUPLENTE');
  // matrícula (quando houver) sempre no mesmo <span class="mcommat"> — some da lista e
  // do card sem herdar o uppercase de .rs-fi-func.
  const matTag=m=>m.matricula?` <span class="mcommat">· mat. ${escHtml(m.matricula)}</span>`:'';
  const fiCard=(label,m)=>`<div class="rs-fi-card"><span class="rs-ic sm">${RS_ICO.pessoa}</span>
    <div><div class="rs-lbl">${label}</div><div class="rs-fi-nome">${escHtml(m.nome)}</div><div class="rs-fi-func">${escHtml(m.tipo)}${matTag(m)}</div></div></div>`;
  const top=`<div class="rs-fi-top">${fiCard('Fiscal responsável',titular)}${(suplente&&suplente!==titular)?fiCard('Suplente',suplente):''}</div>`;
  const list=`<div class="msec">Comissão de fiscalização (${com.length})</div>`
    +`<div class="mcomlist">${com.map(m=>`<div class="mcomrow"><span class="mcomtipo">${escHtml(m.tipo)}</span><span class="mcomnome">${escHtml(m.nome)}${matTag(m)}</span></div>`).join('')}</div>`;
  return top+list;
}
// troca de aba: cada openModal() reconstrói o innerHTML do zero, então os listeners
// são refeitos a cada abertura — igual ao padrão já usado pro botão de fechar/comissão.
function wireModalTabs(){
  const tabs=[...document.querySelectorAll('.modal .mtab')];
  const body=document.querySelector('.modal .mbody');
  const top=document.querySelector('.modal .mtop');
  tabs.forEach(t=>t.onclick=()=>{
    tabs.forEach(x=>{ const on=x===t; x.classList.toggle('on',on); x.setAttribute('aria-selected',String(on)); });
    document.querySelectorAll('.modal .mpane').forEach(p=>{ p.hidden=p.dataset.pane!==t.dataset.tab; });
    if(body) body.dataset.tab=t.dataset.tab; // a aba Resumo esconde a linha .mobj (o objeto já está no cartão)
    if(top) top.dataset.tab=t.dataset.tab;   // e o subtítulo "Resumo executivo do contrato" no cabeçalho
    // telas estreitas: 5 abas não cabem; traz a aba ativa para dentro da faixa
    // rolável (block:'nearest' evita pulo vertical da página).
    try{ t.scrollIntoView({inline:'nearest',block:'nearest'}); }catch(_){}
  });
}
// mesmo padrão do botão de comissão (Dados Gerais), generalizado pros 2 toggles de
// lista de aditivo (valor/prazo) — reconstruído a cada openModal(), então não precisa
// de delegação de evento nem de limpar listener velho.
function wireAdToggles(){
  document.querySelectorAll('.modal .adToggle').forEach(btn=>{
    btn.onclick=()=>{
      const el=document.getElementById(btn.dataset.target); if(!el) return;
      const willOpen=el.hidden;
      el.hidden=!willOpen; btn.setAttribute('aria-expanded',String(willOpen));
      btn.querySelector('.adToggle-car').textContent=willOpen?'▴':'▾';
    };
  });
}
function closeModal(){ document.getElementById('modalBg').classList.remove('show'); }
document.getElementById('modalBg').addEventListener('click',e=>{ if(e.target.id==='modalBg') closeModal(); });
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeModal(); });
// Esc limpa a seleção combinada (Ctrl+clique) — mas só quando não há nada "mais
// em cima" pra fechar primeiro (modal aberto, dropdown de filtro aberto), senão
// um só Esc fecharia o modal E perderia a seleção ao mesmo tempo, e só fora de
// tela cheia: dentro dela o navegador reserva o Esc pra sair da tela cheia (não
// dá pra bloquear isso por código, é assim de propósito, por segurança — já
// tentamos religar a tela cheia em seguida e não é confiável, o navegador
// bloqueia de propósito essa reentrada). Sair da tela cheia (botão OU Esc) nunca
// mexe na seleção — ela só é limpa clicando em espaço vazio do mapa (ver
// map.on('click',...) mais abaixo) ou no botão/chip dedicados no painel.
document.addEventListener('keydown',e=>{
  if(e.key!=='Escape' || !st.sel) return;
  if(document.getElementById('modalBg').classList.contains('show')) return;
  if(document.querySelector('.msel.on')) return;
  if(document.fullscreenElement) return;
  if(isSiblingPopoverOpen()) return; // mesma regra: fecha o popover de irmãos primeiro, não perde a seleção no mesmo Esc
  clearSelection();
});
// Etapa C: genérico — qualquer chave de st.f que seja um Set com itens conta como
// filtro ativo (não só as que já têm def em FILTER_DEFS).
function hasActiveFilter(){ return !!st.f.q || Object.keys(st.f).some(k=>st.f[k] instanceof Set && st.f[k].size>0); }
// Etapa C — sufixo "· N contrato(s) encontrado(s)" na linha de escopo do painel,
// visível em TODOS os níveis quando há filtro ativo (o nível Estado/Distritos já
// tinha o seu; aqui cobre distrito, município e seleção combinada). N sai de
// aggIds → obrasOf → passF, a mesma fonte de tudo no painel.
function resultsSuffix(ids){
  if(!hasActiveFilter()) return '';
  const n=aggIds(ids).obras;
  return ` · <b>${NUM.format(n)}</b> contrato${n===1?'':'s'} encontrado${n===1?'':'s'}`;
}
function renderPanel(){
  setKPIs();
  const scope=document.getElementById('scope'), body=document.getElementById('body');
  const methodName='Distritos Operacionais';
  if(st.sel && st.sel.ids.size){
    // seleção combinada (Ctrl+clique em vários distritos/municípios) tem
    // prioridade sobre o ranking/busca normais — é um recorte explícito do usuário
    const kindLabel=st.sel.kind==='group'?'distrito':'município';
    const chips=[...st.sel.ids].map(id=>{
      const nome=st.sel.kind==='group' ? (grpById(id)?grpById(id).nome.replace(/^D\.O\.\s*/,''):id)
                                        : (DB.municipios[id]?DB.municipios[id].nome:id);
      return `<span class="chip chip-sel" role="button" tabindex="0" data-selid="${id}" title="Remover ${escHtml(nome)} da seleção">${escHtml(nome)} ✕</span>`;
    }).join('');
    const n=st.sel.ids.size;
    scope.innerHTML=`<b>${n}</b> ${kindLabel}${n===1?'':'s'} selecionado${n===1?'':'s'}${resultsSuffix(selectionMunIds())} — Ctrl+clique pra somar/tirar da seleção`
      +` <button class="clearf" id="clearSelBtn" style="display:inline-flex;margin-left:8px;padding:3px 10px;font-size:10px">Limpar seleção</button>`;
    document.getElementById('clearSelBtn').onclick=clearSelection;
    body.innerHTML=`<div class="chips" style="margin-bottom:14px">${chips}</div>`
      +`<div class="sec-h"><span>Contratos combinados</span></div>`+obrasCards(selectionMunIds());
  } else if(st.level<=1 && hasActiveFilter()){
    // busca/filtro ativo com o mapa ainda no nível Estado/Distritos: mostra os
    // contratos encontrados direto (em vez do ranking por distrito), cada um com
    // o município clicável — sem precisar descer manualmente até lá
    const cards=obrasCards(allIds), n=CUROBRAS.length;
    scope.innerHTML=`<b>${NUM.format(n)}</b> contrato${n===1?'':'s'} encontrado${n===1?'':'s'}${n?' — clique no município do card para localizar no mapa':''}`;
    body.innerHTML=`<div class="sec-h"><span>Resultados da busca</span><span>${NUM.format(n)}</span></div>`+cards;
  } else if(st.level<=1){
    if(st.level===1 && st.hoverGroup!=null){
      const g=grpById(st.hoverGroup); const ids=idsOfGroup(st.hoverGroup);
      scope.innerHTML=`Distrito destacado — <b>clique para abrir os municípios</b>${resultsSuffix(ids)}`;
      body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${g.nome}</div>`
        +`<div class="scope" style="margin-top:8px">${ids.length} municípios neste distrito</div>`;
    } else {
      scope.innerHTML=`Estado dividido por <b>${methodName}</b> — passe o mouse ou clique para entrar`; // Etapa D: nível 0 removido
      const ents=groupEntries();
      body.innerHTML=`<div class="sec-h"><span>${methodName}</span><span>${ents.length}</span></div>`+rankRows(ents,'group');
    }
  } else if(st.level===2){
    const g=grpById(st.group);
    const ids=idsOfGroup(st.group);
    scope.innerHTML=`Distrito selecionado${resultsSuffix(ids)}`;
    const ents=cityEntries(ids);
    body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${g.nome}</div>`
      +`<div class="sec-h"><span>Cidades (${ids.length})</span><span>clique p/ abrir</span></div>`+rankRows(ents,'city')
      +`<div class="sec-h" style="margin-top:20px"><span>Contratos do distrito</span></div>`+obrasCards(ids);
  } else {
    const id=st.city, g=grpById(gidOf(id));
    scope.innerHTML=`Município selecionado · ${g.nome.replace(/^D\.O\.\s*/,'')}${resultsSuffix([id])}`;
    body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${DB.municipios[id].nome}</div>`
      +`<div class="sec-h" style="margin-top:12px"><span>Contratos</span><span>${obrasOf(id).length}</span></div>`+obrasCards([id]);
  }
}
function renderCrumb(){
  const c=document.getElementById('crumb');
  const methodName='Distritos';
  // qualquer render() reconstrói a trilha do zero (innerHTML) — a âncora que o popover
  // de irmãos guardava fica órfã, então fecha aqui em vez de tentar reposicionar.
  closeSiblingPopover();
  const sibTrig=(nome)=>`<a data-nav="siblings" class="cur sib" role="button" tabindex="0" aria-haspopup="true" title="Ver outros ${st.level===2?'distritos':'municípios'}"><span class="sib-text">${nome}</span> <span class="sib-caret">▾</span></a>`;
  let h='';
  // Etapa D: nível 1 é a "casa" do app — a trilha começa em "Distritos", sem o
  // "Ceará" isolado que antes representava o nível 0.
  if(st.level===1){h=`<span class="cur">${methodName}</span>`;}
  else if(st.level===2){h=`<a data-nav="sub">${methodName}</a><span class="sep">›</span>${sibTrig(grpById(st.group).nome.replace(/^D\.O\.\s*/,''))}`;}
  else {h=`<a data-nav="sub">${methodName}</a><span class="sep">›</span><a data-nav="group">${grpById(gidOf(st.city)).nome.replace(/^D\.O\.\s*/,'')}</a><span class="sep">›</span>${sibTrig(DB.municipios[st.city].nome)}`;}
  if(st.sel && st.sel.ids.size) h+=`<span class="sep">›</span><span class="cur">${st.sel.ids.size} selecionado${st.sel.ids.size===1?'':'s'}</span>`;
  c.innerHTML=h;
}
function renderFoot(){
  document.getElementById('foot').innerHTML=
    `Fluxo: <b>Distritos Operacionais → cidades</b>. Clique numa área para descer; use a trilha no topo para voltar.
     Divisão oficial dos 11 D.Os (SOP). Dados oficiais da base de contratos de obras da SOP-CE.`;
}

function render(){
  if(st.level===2) _levelMax=Math.max(1,...idsOfGroup(st.group).map(id=>mval(aggIds([id]))));
  if(st.level===1 && hasActiveFilter()){
    _groupValByGid=new Map(); _groupCountByGid=new Map();
    groupsList().forEach(g=>{ const a=aggIds(idsOfGroup(g.id)); _groupValByGid.set(String(g.id),mval(a)); _groupCountByGid.set(String(g.id),a.obras); });
    _levelMaxGroup=Math.max(1,...[..._groupValByGid.values()]);
  } else {
    _groupValByGid=new Map(); _groupCountByGid=new Map();
  }
  layer.setStyle(styleFeature); applyInteractivity(); updateLabels();
  // groupStyle() agora faz trabalho de verdade (idsOfGroup+aggIds) quando há filtro
  // ativo, não só devolve um objeto constante — só compensa recalcular enquanto o
  // próprio groupLayer está visível (nível 1). Ctrl+clique em grupo (st.sel.kind
  // ==='group') também só existe nesse nível (goGroup/goCity/goState/goSub sempre
  // zeram st.sel antes de sair dele), então esta guarda não perde o "reflete seleção
  // sem esperar o zoomend" que esta chamada existe pra garantir.
  if(st.level===1 && groupLayer){
    groupLayer.setStyle(groupStyle);
    // Etapa C: distrito "sem correspondência" fica sem pointer (cursor normal, não navegável)
    groupLayer.eachLayer(l=>{ if(l._path) l._path.style.pointerEvents = noMatchGroup(l.feature.properties.gid)?'none':''; });
  }
  setLayer(stateShape, false); // Etapa D: nível 0 removido — stateShape nunca é exibido
  setLayer(groupLayer, st.level===1); if(st.level===1 && groupLayer) groupLayer.bringToFront();
  renderCrumb(); renderPanel(); renderFoot(); renderFilterChips();
}

// ---- filtros / busca (multi-seleção) ----
// Etapa C — cada def é "de valores" (get:o=>string|null; opções varridas dos dados,
// como Contratada) OU "de categoria fixa" (get:o=>chave do bucket; opções fixas em
// `cats`, com rótulo próprio — faixas e derivados). passF() trata as duas igual;
// só fillFilters() difere. Ordem: navegação → atributos do contrato → pessoas/empresas.
const FILTER_DEFS=[
  {key:'distrito',label:'Distrito Operacional',get:o=>o.distrito||null},
  {key:'municipio',label:'Município',get:o=>o.municipioTxt||null},
  {key:'tipo',label:'Tipo de contrato',get:o=>o.tipo||null},
  {key:'ano',label:'Ano',get:o=>o.ano?String(o.ano):null,numeric:true},
  {key:'status',label:'Status da obra',get:o=>(o.statusObra&&o.statusObra!=='—')?o.statusObra:null},
  {key:'prazoExec',label:'Prazo de execução',get:o=>o.prazoExecBucket,cats:[
    {v:'ok',label:'No prazo'},{v:'avencer',label:'A vencer (≤ 30 dias)'},{v:'vencido',label:'Vencido'},{v:'semdata',label:'Sem data'}]},
  {key:'vigencia',label:'Vigência do contrato',get:o=>o.vigenciaBucket,cats:[
    {v:'ok',label:'Vigente'},{v:'avencer',label:'A vencer (≤ 30 dias)'},{v:'vencido',label:'Vencida'},{v:'semdata',label:'Sem data'}]},
  {key:'paralisada',label:'Obra paralisada',get:o=>o.paralisadaBucket,cats:[
    {v:'sim',label:'Sim'},{v:'nao',label:'Não'}]},
  {key:'faixaValor',label:'Faixa de valor',get:o=>o.faixaValorBucket,cats:[
    {v:'ate1m',label:'Até R$ 1 mi'},{v:'1a5m',label:'R$ 1–5 mi'},{v:'5a20m',label:'R$ 5–20 mi'},{v:'acima20m',label:'Acima de R$ 20 mi'}]},
  {key:'medicao',label:'Medição (% executado)',get:o=>o.medicaoBucket,cats:[
    {v:'0a25',label:'0–25%'},{v:'25a50',label:'25–50%'},{v:'50a75',label:'50–75%'},{v:'75a100',label:'75–100%'},{v:'acima100',label:'Acima de 100%'},{v:'semficha',label:'Sem ficha'}]},
  {key:'contratada',label:'Contratada',get:o=>(o.contratada&&o.contratada!=='—')?o.contratada:null},
  {key:'contratante',label:'Contratante',get:o=>(o.contratante&&o.contratante!=='—')?o.contratante:null},
  {key:'fiscal',label:'Fiscal',get:o=>(o.fiscal&&o.fiscal!=='—')?o.fiscal:null},
];
function updateMselBtn(key){
  const m=document.querySelector(`.msel[data-key="${key}"]`); if(!m) return;
  const btn=m.querySelector('.msel-btn'); const label=btn.dataset.label; const n=st.f[key].size;
  btn.innerHTML = n ? `${label} <span class="cnt">(${n})</span>` : `${label}: todos`;
}
function fillFilters(){
  const all=[]; allIds.forEach(id=>DB.municipios[id].obras.forEach(o=>all.push(o)));
  const host=document.getElementById('filtersHost');
  host.innerHTML=FILTER_DEFS.map(d=>{
    let vals; // [{v,label}]
    if(d.cats){
      // categoria fixa: opções sempre as mesmas; rótulo próprio.
      vals=d.cats.map(c=>({v:c.v,label:c.label}));
    } else {
      const set=new Set(); all.forEach(o=>{const v=d.get(o); if(v)set.add(v);});
      // poda "fantasma": valor selecionado que não existe mais no recorte carregado
      // (ex.: troca Carteira↔Histórico) não pode continuar recortando.
      if(st.f[d.key].size) st.f[d.key]=new Set([...st.f[d.key]].filter(v=>set.has(v)));
      vals=[...set].sort(d.numeric?(a,b)=>b-a:(a,b)=>a.localeCompare(b,'pt-BR')).map(v=>({v,label:v}));
    }
    const empty=vals.length===0;
    const opts=vals.map(x=>`<label class="msel-opt"><input type="checkbox" value="${escHtml(x.v)}">${escHtml(x.label)}</label>`).join('')
      || '<div class="msel-empty">Sem opções neste recorte</div>';
    return `<div class="msel${empty?' is-empty':''}" data-key="${d.key}">
      <button type="button" class="msel-btn" data-label="${escHtml(d.label)}"${empty?' disabled title="Nenhum contrato do recorte atual tem este atributo"':''}></button>
      <div class="msel-panel">
        <div class="msel-query"></div>
        ${opts}
        <div class="msel-noresult">Nenhuma opção encontrada</div>
      </div>
    </div>`;
  }).join('');
  document.querySelectorAll('.msel').forEach(m=>{
    const key=m.dataset.key;
    m.querySelectorAll('.msel-opt input').forEach(cb=>{ cb.checked=st.f[key].has(cb.value); });
    updateMselBtn(key);
  });
}
// busca por digitação direta (sem campo de texto): com o painel aberto, as teclas
// digitadas filtram as opções ao vivo — reseta sozinho após uma pausa ou ao fechar.
function normSearch(s){ return (s==null?'':String(s)).normalize('NFKD').replace(/[̀-ͯ]/g,'').toLowerCase(); }
let mselQuery='', mselQueryTimer=null;
function mselFilterOpts(m){
  const q=normSearch(mselQuery); let anyVisible=false;
  m.querySelectorAll('.msel-opt').forEach(opt=>{
    const show=!q || normSearch(opt.querySelector('input').value).includes(q);
    opt.classList.toggle('hide',!show); if(show) anyVisible=true;
  });
  const qEl=m.querySelector('.msel-query');
  if(qEl){ qEl.textContent=mselQuery?`Buscando: "${mselQuery}"`:''; qEl.classList.toggle('show',!!mselQuery); }
  const nr=m.querySelector('.msel-noresult');
  if(nr) nr.classList.toggle('show', !!mselQuery && !anyVisible);
}
function mselResetQuery(m){ mselQuery=''; if(m) mselFilterOpts(m); }
const _fHost=document.getElementById('filtersHost');
_fHost.addEventListener('click',e=>{
  const btn=e.target.closest('.msel-btn'); if(!btn) return;
  const m=btn.closest('.msel'); const wasOn=m.classList.contains('on');
  document.querySelectorAll('.msel.on').forEach(x=>{x.classList.remove('on'); mselResetQuery(x);});
  if(!wasOn){ m.classList.add('on'); mselResetQuery(m); }
});
_fHost.addEventListener('change',e=>{
  const cb=e.target.closest('.msel-opt input'); if(!cb) return;
  const key=cb.closest('.msel').dataset.key;
  if(cb.checked) st.f[key].add(cb.value); else st.f[key].delete(cb.value);
  updateMselBtn(key); invalidateAggCache(); render(); autoLocateSearch();
});
document.addEventListener('click',e=>{
  if(!e.target.closest('.msel')) document.querySelectorAll('.msel.on').forEach(x=>{x.classList.remove('on'); mselResetQuery(x);});
});
document.addEventListener('keydown',e=>{
  const m=document.querySelector('.msel.on'); if(!m) return;
  if(e.target.tagName==='INPUT' && e.target.type!=='checkbox') return;
  if(e.key==='Escape'){ m.classList.remove('on'); mselResetQuery(m); return; }
  if(e.key==='Backspace'){ mselQuery=mselQuery.slice(0,-1); mselFilterOpts(m); e.preventDefault(); }
  else if(e.key.length===1 && /[a-zA-Z0-9À-ÿ]/.test(e.key)){ mselQuery+=e.key; mselFilterOpts(m); e.preventDefault(); }
  else return;
  clearTimeout(mselQueryTimer); mselQueryTimer=setTimeout(()=>mselResetQuery(m),2500);
});
// A pedido: pesquisar nos filtros NÃO reposiciona mais o mapa. Antes, 1 município
// encontrado fazia a câmera voar até ele (fitCity, zoom alto — o "zoom grande sem
// necessidade" reclamado, ex.: busca por "ALVES FREITAS") e vários faziam um
// flyToBounds pra enquadrar todos. Agora a busca só refiltra dados, cores do mapa
// e painel; o enquadramento só muda por navegação explícita (clique numa área).
let _searchNav=false; // mantido por compatibilidade — a busca não navega mais o mapa
function autoLocateSearch(){ /* no-op: busca/filtro não mexe na câmera */ }
let _fSearchTimer=null;
document.getElementById('fSearch').addEventListener('input',e=>{
  // PERFORMANCE: render() reestiliza toda a camada GeoJSON + roda o algoritmo de
  // declutter de rótulos a cada chamada — sem debounce isso rodava a cada tecla digitada.
  st.f.q=e.target.value.trim(); // mantém o caso digitado (o chip mostra); passF() minúsculo no compare
  clearTimeout(_fSearchTimer);
  _fSearchTimer=setTimeout(()=>{ invalidateAggCache(); render(); autoLocateSearch(); },150);
});
// Etapa C — zera busca + todos os campos de filtro. Compartilhado pelo botão do
// rodapé do painel (#clearF) e pelo "Limpar tudo" do bloco de chips.
function clearAllFilters(){
  Object.keys(st.f).forEach(k=>{ if(st.f[k] instanceof Set) st.f[k].clear(); });
  st.f.q=''; const fs=document.getElementById('fSearch'); if(fs) fs.value='';
  document.querySelectorAll('.msel-opt input').forEach(cb=>cb.checked=false);
  document.querySelectorAll('.msel').forEach(m=>{updateMselBtn(m.dataset.key); m.classList.remove('on'); mselResetQuery(m);});
  invalidateAggCache(); render(); autoLocateSearch();
}
document.getElementById('clearF').onclick=clearAllFilters;

// Etapa C — bloco "Filtros ativos": um chip por valor selecionado (× remove só
// aquele valor), + "Limpar tudo". Some quando não há filtro. Acende o selo do
// #ctrlToggle. Chamado no fim de render(), então acompanha qualquer mudança.
function fchipLabel(d,v){ const c=d.cats&&d.cats.find(x=>x.v===v); return c?c.label:v; }
function renderFilterChips(){
  const host=document.getElementById('filterChips'); if(!host) return;
  const chips=[];
  if(st.f.q) chips.push(`<span class="chip fchip" data-key="__q" role="button" tabindex="0" title="Remover a busca">Busca: “${escHtml(st.f.q)}” <b class="x" aria-hidden="true">✕</b></span>`);
  FILTER_DEFS.forEach(d=>{
    const set=st.f[d.key]; if(!set||!set.size) return;
    [...set].forEach(v=>{
      const lab=`${d.label}: ${fchipLabel(d,v)}`;
      chips.push(`<span class="chip fchip" data-key="${escHtml(d.key)}" data-val="${escHtml(v)}" role="button" tabindex="0" title="Remover ${escHtml(lab)}">${escHtml(lab)} <b class="x" aria-hidden="true">✕</b></span>`);
    });
  });
  host.innerHTML = chips.length
    ? chips.join('')+`<button type="button" class="fchip-clear" id="fchipClear">Limpar tudo</button>`
    : '';
  const c=document.getElementById('fchipClear'); if(c) c.onclick=clearAllFilters;
  const tgl=document.getElementById('ctrlToggle'); if(tgl) tgl.classList.toggle('has-filters', chips.length>0);
  // "+" fica em destaque quando há algum filtro selecionado (podem estar recolhidos)
  const ft=document.getElementById('filtToggle');
  if(ft) ft.classList.toggle('has-active', FILTER_DEFS.some(d=>{const s=st.f[d.key];return s&&s.size;}));
}
function removeFilterChip(chip){
  const key=chip.dataset.key;
  if(key==='__q'){ st.f.q=''; const fs=document.getElementById('fSearch'); if(fs) fs.value=''; }
  else {
    const val=chip.dataset.val; st.f[key].delete(val); updateMselBtn(key);
    document.querySelectorAll(`.msel[data-key="${key}"] .msel-opt input`).forEach(cb=>{ if(cb.value===val) cb.checked=false; });
  }
  invalidateAggCache(); render(); autoLocateSearch();
}
document.getElementById('filterChips').addEventListener('click',e=>{
  const chip=e.target.closest('.fchip'); if(chip) removeFilterChip(chip);
});
document.getElementById('filterChips').addEventListener('keydown',e=>{
  if(e.key!=='Enter' && e.key!==' ') return;
  const chip=e.target.closest('.fchip'); if(!chip) return;
  e.preventDefault(); removeFilterChip(chip);
});

// painel de filtros recolhível (recolhido por padrão)
const _ctrl=document.getElementById('ctrl'), _ctrlT=document.getElementById('ctrlToggle');
// Etapa C — com ~14 campos o painel pode passar da altura da tela (ainda mais quando
// o cabeçalho quebra em várias linhas em telas estreitas). Limita a altura ao espaço
// real abaixo do topo do painel na viewport; o overflow-y:auto do CSS rola o resto.
function fitCtrlHeight(){
  if(!_ctrl.classList.contains('show')) return;
  const top=_ctrl.getBoundingClientRect().top;
  _ctrl.style.maxHeight=Math.max(160,window.innerHeight-top-14)+'px';
}
function openCtrl(o){ _ctrl.classList.toggle('show',o); _ctrlT.style.display=o?'none':''; if(o) fitCtrlHeight(); }
_ctrlT.onclick=()=>openCtrl(true);
document.getElementById('ctrlClose').onclick=()=>openCtrl(false);
window.addEventListener('resize',fitCtrlHeight);
openCtrl(false);

// o bloco de filtros (as ~13 multi-seleções, #filtersHost) começa RECOLHIDO — só
// Métrica + Buscar à mostra. O "+" ao lado de "Filtros" expande/recolhe. Os chips de
// filtro ativo e o botão "Limpar" ficam sempre visíveis (o usuário vê/remove o que
// está filtrando). Reusa _fHost (delegação de eventos das multi-seleções, acima).
const _filtT=document.getElementById('filtToggle');
function toggleFilters(show){
  const on = show===undefined ? _fHost.hidden : !!show;
  _fHost.hidden=!on;
  _filtT.textContent=on?'−':'+';       // − (U+2212) / +
  _filtT.setAttribute('aria-expanded',String(on));
  const t=on?'Recolher filtros':'Mostrar todos os filtros';
  _filtT.title=t; _filtT.setAttribute('aria-label',t);
  if(_ctrl.classList.contains('show')) fitCtrlHeight();
}
if(_filtT){ _filtT.onclick=()=>toggleFilters(); toggleFilters(false); } // estado inicial numa fonte só

// painel lateral (KPIs/ranking) recolhível — aberto por padrão (ver modo apresentação abaixo)
const _mainEl=document.querySelector('main'), _asideT=document.getElementById('asideToggle');
// compartilhada com onGroup() (nível 1) — evita recriar o mesmo closure a cada feature
// em buildGroupLayer() (~11-14x por build/troca de método).
function panelVisible(){ return !_mainEl.classList.contains('aside-collapsed'); }
function openAside(o){
  _mainEl.classList.toggle('aside-collapsed',!o); _asideT.style.display=o?'none':'';
  // ao reabrir, o painel pode estar com conteúdo velho (onGroup pula renderPanel()
  // enquanto está recolhido, ver Fase 7) — atualiza 1x na hora de abrir pra não mostrar
  // o hover de antes de fechar caso o mouse ainda esteja sobre um distrito/região.
  if(o) renderPanel();
  clearTimeout(openAside._t); openAside._t=setTimeout(()=>{ map.invalidateSize(false); refit(); },380);
}
_asideT.onclick=()=>openAside(true);
document.getElementById('asideClose').onclick=()=>openAside(false);

// modo apresentação: layout padrão fixo desta página (tipografia maior) —
// pensado para projetar em reunião (ex.: conselho deliberativo). O painel
// lateral de KPIs começa recolhido (só o mapa à mostra); "Sair" (topo
// esquerdo) sai do módulo; "Filtros" e "Painel" continuam disponíveis.
// O botão "Tela cheia" só liga/desliga a tela cheia real do navegador.
document.body.classList.add('presentation');
openCtrl(false);
openAside(false);

const _btnPresent=document.getElementById('btnPresent'), _btnPresentTxt=document.getElementById('btnPresentTxt');
function syncFullscreenBtn(){
  const on=!!document.fullscreenElement;
  _btnPresent.classList.toggle('on',on);
  _btnPresentTxt.textContent = on ? 'Sair da tela cheia' : 'Tela cheia';
}
function requestRealFullscreen(){
  const root=document.documentElement;
  if(!document.fullscreenElement && root.requestFullscreen) return root.requestFullscreen().catch(()=>{});
  return Promise.resolve();
}
_btnPresent.addEventListener('click',()=>{
  if(document.fullscreenElement) document.exitFullscreen().catch(()=>{});
  else requestRealFullscreen();
});
document.addEventListener('fullscreenchange',syncFullscreenBtn);

// ---- Etapa A / Bloco 1 — alternância de tema (claro/escuro) ----
// A decisão INICIAL do tema roda num <script> inline no topo do <body> (antes de
// qualquer pintura, pra não "piscar"): escolha salva em localStorage 'gecope_theme'
// vence; na ausência dela, segue o prefers-color-scheme do SO; a classe 'theme-dark'
// na raiz e no <body> marca o escuro. Aqui tratamos a troca MANUAL pelo botão, o
// "sensor" do tema do SO, a sincronização do rótulo/ícone do botão e a REPINTURA
// ao vivo (repaintTheme): painel/CSS já reagem sozinhos via var(), mas o mapa
// (camadas Leaflet) e as cores injetadas inline por JS a partir de TOKENS precisam
// ser reaplicadas na troca.
const _btnTheme=document.getElementById('btnTheme');
function isDarkTheme(){ return document.documentElement.classList.contains('theme-dark'); }
// A etiqueta 'theme-dark' vai na raiz do documento E no <body>: a raiz para o CSS
// (:root:not(.theme-dark)) e para o JS que lê as cores via
// getComputedStyle(document.documentElement); o <body> para a convenção
// body.theme-dark compartilhada com o resto do GECOPE. Mantém as duas em sincronia.
function applyThemeClass(dark){
  document.documentElement.classList.toggle('theme-dark',dark);
  document.body.classList.toggle('theme-dark',dark);
}
function syncThemeBtn(){
  if(!_btnTheme) return;
  const txt = isDarkTheme() ? 'Mudar para o tema claro' : 'Mudar para o tema escuro';
  _btnTheme.title=txt; _btnTheme.setAttribute('aria-label',txt);
}
// repintura ao vivo (Bloco 6): a classe do tema já foi trocada na raiz, então
// getComputedStyle volta os valores do novo tema. Reescreve TOKENS no lugar,
// re-deriva o que ficou capturado à parte (BASE), re-estiliza a silhueta do
// estado (stateShape — o render() não a re-estiliza), redesenha o modal se
// estiver aberto (os gráficos internos carregam cor de TOKENS no innerHTML) e
// chama render() UMA vez, que reaplica styleFeature/groupStyle nas camadas,
// refaz os rótulos e regenera KPIs/gráficos/painel a partir de TOKENS.
function repaintTheme(){
  Object.assign(TOKENS, readTokens());
  BASE=TOKENS.mapBase;
  syncStatusColors();                 // cores de STATUS_STATES (dots de "Situação das obras")
  if(_lastStatus) setStatus(_lastStatus.txt,_lastStatus.ok,_lastStatus.lastSync); // dot de "Base de dados"
  if(!layer) return; // troca antes do init do mapa: o render() inicial já pinta no tema certo
  if(stateShape) stateShape.setStyle({fillColor:TOKENS.mapStateFill,color:`rgba(${TOKENS.ngRgb},.42)`});
  const _mbg=document.getElementById('modalBg');
  if(_mbg&&_mbg.classList.contains('show')&&_lastModalObra) openModal(_lastModalObra);
  render();
}
function setTheme(dark){
  applyThemeClass(dark);
  try{ localStorage.setItem('gecope_theme', dark?'dark':'light'); }
  catch(e){ /* privacidade/quota — a troca ainda vale nesta sessão */ }
  syncThemeBtn();
  repaintTheme();
}
if(_btnTheme){
  _btnTheme.addEventListener('click',()=>setTheme(!isDarkTheme()));
  syncThemeBtn();
}
// "sensor" da configuração do SO: só age enquanto NÃO houver escolha manual salva.
// Depois de uma escolha explícita, mudar o tema do SO não mexe mais no módulo.
if(window.matchMedia){
  const _mqLight=window.matchMedia('(prefers-color-scheme: light)');
  const _onOsThemeChange=e=>{
    let pref=null; try{ pref=localStorage.getItem('gecope_theme'); }catch(_){}
    if(pref) return;
    const dark=!e.matches;
    if(dark===isDarkTheme()) return; // evento do SO sem mudança efetiva — nada a repintar
    applyThemeClass(dark);
    syncThemeBtn();
    repaintTheme();
  };
  if(_mqLight.addEventListener) _mqLight.addEventListener('change',_onOsThemeChange);
  else if(_mqLight.addListener) _mqLight.addListener(_onOsThemeChange); // navegadores antigos
}

// A tela cheia é acionada SOMENTE pelo botão "Tela cheia" (ver _btnPresent, acima).
// O gatilho automático no 1º clique/tecla em qualquer lugar da página foi removido
// a pedido — clicar fora do mapa não entra mais em tela cheia.

// prefetch leve da página de destino ao passar o mouse no botão "Voltar"
function prefetchPagina(url){
  if(document.querySelector(`link[rel="prefetch"][href="${url}"]`)) return;
  const link=document.createElement('link'); link.rel='prefetch'; link.href=url; document.head.appendChild(link);
}
window.prefetchPagina=prefetchPagina;

// alterna entre a carteira ativa (padrão — obras que ainda podem ser geridas) e o
// histórico completo (todas, incluindo as ~90% já concluídas/encerradas)
const _btnScope=document.getElementById('btnScope'), _btnScopeTxt=document.getElementById('btnScopeTxt');
function syncScopeBtn(loading){
  if(!_btnScopeTxt) return;
  _btnScopeTxt.textContent = loading ? 'Carregando…' : (st.dataScope==='ativa' ? 'Carteira ativa' : 'Histórico completo');
  if(_btnScope) _btnScope.classList.toggle('on', st.dataScope==='historico');
}
function setDataScope(scope){
  if(scope===st.dataScope) return;
  st.dataScope=scope; goState();
  syncScopeBtn(true);
  if(_btnScope) _btnScope.disabled=true;
  loadData().finally(()=>{ syncScopeBtn(false); if(_btnScope) _btnScope.disabled=false; });
}
if(_btnScope) _btnScope.addEventListener('click',()=>setDataScope(st.dataScope==='ativa'?'historico':'ativa'));
syncScopeBtn(false);

// (o segmento "Dividir por" — Distrito Op. / Região — foi removido; o módulo opera
//  exclusivamente por Distrito Operacional.)
document.getElementById('segMetric').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  document.querySelectorAll('#segMetric button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  st.metric=b.dataset.v; render();
});
document.getElementById('crumb').addEventListener('click',e=>{
  const a=e.target.closest('a'); if(!a)return; const n=a.dataset.nav;
  if(n==='state')goState(); else if(n==='sub')goSub(); else if(n==='group')goGroup(gidOf(st.city));
  else if(n==='siblings') isSiblingPopoverOpen()?closeSiblingPopover():openSiblingPopover(a);
});
// mesmo padrão de teclado já usado em #body pra .rrow/.obra/etc. (Enter/Espaço aciona
// como clique) — só pro gatilho novo; os outros links da trilha (data-nav sem
// "siblings") já não tinham tabindex antes desta fase, fora do escopo consertar aqui.
document.getElementById('crumb').addEventListener('keydown',e=>activateOnKey(e,'a[data-nav="siblings"]'));
// ---- popover de navegação lateral entre irmãos (Fase 8) ----
// mesmo mecanismo nos níveis 2 e 3: o segmento atual da trilha (nome do distrito/
// região ou do município) abre a lista de irmãos pra pular direto — sem precisar
// voltar ao nível 1 primeiro e entrar de novo (antes: sempre 2 navegações + 2 voos
// de câmera; agora, 1). Reaproveita rankRows()/.rrow — mesmo HTML/clique/teclado dos
// rankings que já existem no painel — em vez de um componente novo.
const _crumbPop=document.getElementById('crumbPop');
// #mapWrap tem transform:scale(...) o tempo todo (intro do mapa — mesmo depois de
// terminar, ".in" deixa "scale(1)", não "none") — isso vira o containing block de
// qualquer descendente position:fixed, então um fixed aqui NÃO fica relativo à
// viewport como o nome sugere, fica relativo ao #mapWrap. Resolvido usando
// position:absolute (ver CSS) de propósito, com as coordenadas convertidas pra esse
// referencial — window.innerWidth/innerHeight continuam sendo a régua certa pra
// decidir "cabe na tela", só a atribuição final que precisa do offset do wrap.
const _mapWrapEl=document.getElementById('mapWrap');
function isSiblingPopoverOpen(){ return _crumbPop.classList.contains('show'); }
function closeSiblingPopover(){ _crumbPop.classList.remove('show'); }
function openSiblingPopover(anchorEl){
  let title,entries,kind;
  // "outros" — exclui o grupo/município atual da própria lista (groupEntries/
  // cityEntries devolvem a lista completa, usada como está no ranking do painel;
  // aqui precisa ficar só quem realmente é diferente de onde já se está)
  if(st.level===2){ title='Outros distritos'; entries=groupEntries().filter(e=>String(e.k)!==String(st.group)); kind='group'; }
  else if(st.level===3){ title='Outros municípios'; entries=cityEntries(idsOfGroup(gidOf(st.city)),true).filter(e=>String(e.k)!==String(st.city)); kind='city'; }
  else return;
  // .pop-body é a única parte que rola — o cabeçalho (também a alça de arrasto) e
  // a alça de resize ficam FORA dela de propósito, senão sumiriam de vista assim
  // que o usuário rolasse até o fim da lista de irmãos.
  _crumbPop.innerHTML=`<div class="sec-h" title="Arraste para mover"><span>${title}</span><span>${entries.length}</span></div>`
    +`<div class="pop-body">`+(entries.length?rankRows(entries,kind):'<div class="msel-empty">Nenhum resultado neste recorte</div>')+`</div>`
    +`<div class="resize-grip" title="Arraste para redimensionar"></div>`;
  // o gatilho não é o pai direto do popover no DOM (fica fora de #crumb, que
  // reconstrói o innerHTML a cada render() — um filho ali seria apagado a cada
  // navegação), e a trilha muda de largura/posição conforme o nome do grupo/
  // município, então o cálculo de onde abrir tem que ser dinâmico.
  // "show" entra ANTES de medir a largura: o popover é redimensionável (pedido do
  // usuário) e o tamanho escolhido numa abertura anterior persiste — com
  // display:none, offsetWidth sempre devolveria 0, e o clamp usaria um número
  // errado (a versão antiga usava a largura padrão fixa, ficava errada assim que
  // alguém arrastava o canto pra deixar mais largo).
  _crumbPop.classList.add('show');
  const wrapRect=_mapWrapEl.getBoundingClientRect();
  const r=anchorEl.getBoundingClientRect();
  const popW=_crumbPop.offsetWidth;
  const leftVp=Math.max(8,Math.min(window.innerWidth-popW-8,r.left+r.width/2-popW/2));
  _crumbPop.style.left=(leftVp-wrapRect.left)+'px';
  _crumbPop.style.top=(r.bottom+8-wrapRect.top)+'px';
  // clamp vertical contra a viewport de verdade (não o #mapWrap, que em telas
  // estreitas — layout empilhado, mapa só com 56vh — é bem mais baixo que a tela
  // toda) — popover ficou mais alto (pedido do usuário), sem isso ele passava a
  // renderizar parcialmente fora da área visível.
  const popRect=_crumbPop.getBoundingClientRect();
  if(popRect.bottom>window.innerHeight-8){
    const topVp=Math.max(8,window.innerHeight-8-popRect.height);
    _crumbPop.style.top=(topVp-wrapRect.top)+'px';
  }
}
_crumbPop.addEventListener('click',e=>{
  if(_crumbPop.dataset.dragged==='1'){ delete _crumbPop.dataset.dragged; return; } // clique no fim de um arrasto não deve navegar
  const rr=e.target.closest('.rrow'); if(!rr) return;
  closeSiblingPopover();
  goRrow(rr);
});
_crumbPop.addEventListener('keydown',e=>activateOnKey(e,'.rrow'));
// arrasto (mover, pela alça do título) e redimensionar (pela alça .resize-grip no
// canto) — pedido do usuário. Tentamos primeiro a propriedade CSS resize: nativa,
// mas ela se mostrou pouco confiável bem no canto arredondado do popover (o alvo de
// arrasto do navegador fica menor que a área visível ali, e um clique um pouco fora
// do ponto exato virava "clique fora fecha" em vez de redimensionar) — daí a alça
// própria, com uma área de agarrar previsível.
let _popDrag=null, _popResize=null;
// limites em sincronia com min-width/min-height/max-width/max-height de .crumb-pop
// no CSS — CSS não tem como impor esses limites num resize feito via JS puro
// (só existe pra "resize:both" nativo), então o clamp é feito aqui também.
const POP_MIN_W=260,POP_MIN_H=160,POP_MAX_W=560,POP_MAX_H=560;
_crumbPop.addEventListener('mousedown',e=>{
  if(e.target.closest('.resize-grip')){
    _popResize={startW:_crumbPop.offsetWidth,startH:_crumbPop.offsetHeight,startX:e.clientX,startY:e.clientY};
    e.preventDefault();
    return;
  }
  const handle=e.target.closest('.sec-h'); if(!handle) return;
  const wrapRect=_mapWrapEl.getBoundingClientRect();
  const popRect=_crumbPop.getBoundingClientRect();
  _popDrag={dx:e.clientX-popRect.left,dy:e.clientY-popRect.top,wrapRect,moved:false};
  e.preventDefault(); // evita selecionar texto durante o arrasto
});
document.addEventListener('mousemove',e=>{
  if(_popResize){
    const {startW,startH,startX,startY}=_popResize;
    _crumbPop.style.width=Math.max(POP_MIN_W,Math.min(POP_MAX_W,startW+(e.clientX-startX)))+'px';
    _crumbPop.style.height=Math.max(POP_MIN_H,Math.min(POP_MAX_H,startH+(e.clientY-startY)))+'px';
    return;
  }
  if(!_popDrag) return;
  _popDrag.moved=true;
  const {dx,dy,wrapRect}=_popDrag;
  const maxLeft=Math.max(4,wrapRect.width-_crumbPop.offsetWidth-4);
  const maxTop=Math.max(4,wrapRect.height-_crumbPop.offsetHeight-4);
  _crumbPop.style.left=Math.max(4,Math.min(maxLeft,e.clientX-wrapRect.left-dx))+'px';
  _crumbPop.style.top=Math.max(4,Math.min(maxTop,e.clientY-wrapRect.top-dy))+'px';
});
document.addEventListener('mouseup',()=>{
  if(_popResize){ _popResize=null; _crumbPop.dataset.dragged='1'; return; } // mesma supressão do click final usada no arrasto
  if(_popDrag && _popDrag.moved) _crumbPop.dataset.dragged='1'; // suprime o click subsequente no mouseup do arrasto
  _popDrag=null;
});
// clique fora fecha (mesmo padrão do .msel de filtros); clique EM CIMA do próprio
// gatilho não conta como "fora" — senão o toggle do handler de #crumb abriria e este
// listener fecharia de volta no mesmo clique, e o popover nunca apareceria.
document.addEventListener('click',e=>{
  // clique final de um arrasto/resize (mouseup) não conta como "fora", mesmo que o
  // cursor tenha acabado fora do popover — acontece sempre que o usuário arrasta o
  // canto além do tamanho máximo (560px): a caixa para de crescer no limite, mas o
  // cursor continua indo, então solta o botão já fora da área. Sem essa checagem
  // aqui (achado reportado pelo usuário), "ampliar e soltar" fechava o popover.
  if(_crumbPop.dataset.dragged==='1'){ delete _crumbPop.dataset.dragged; return; }
  if(isSiblingPopoverOpen() && !e.target.closest('.crumb-pop') && !e.target.closest('a[data-nav="siblings"]')) closeSiblingPopover();
});
document.addEventListener('keydown',e=>{ if(e.key==='Escape' && isSiblingPopoverOpen()) closeSiblingPopover(); });

document.getElementById('body').addEventListener('click',e=>{
  // chip de item selecionado (Ctrl+clique): clicar nele tira da seleção combinada
  const sc=e.target.closest('.chip-sel');
  if(sc){ toggleSelection(st.sel?st.sel.kind:'group',sc.dataset.selid); return; }
  const rr=e.target.closest('.rrow');
  if(rr){ goRrow(rr); return; }
  // chip de município do card do contrato: leva direto até ele no mapa,
  // em vez de precisar descer Estado → Distrito → Cidade manualmente
  const loc=e.target.closest('.chip.mun.locate');
  if(loc){ goCity(loc.dataset.cod); return; }
  const ob=e.target.closest('.obra'); if(ob){ const o=CUROBRAS[+ob.dataset.oid]; if(o) openModal(o); }
});
// mesmas ações acima, via teclado (Enter/Espaço) — os cards (.rrow/.obra/
// .chip.mun.locate/.chip-sel) são <div>/<span> com role="button" e tabindex, não
// elementos <button> nativos, então não recebem ativação por teclado de graça;
// painel público de órgão estadual precisa ser navegável sem mouse.
document.getElementById('body').addEventListener('keydown',e=>activateOnKey(e,'.rrow,.obra,.chip.mun.locate,.chip-sel'));
map.on('zoomend',()=>{ layer.setStyle(styleFeature); if(groupLayer&&map.hasLayer(groupLayer))groupLayer.setStyle(groupStyle); updateLabels(); });
map.on('moveend',()=>updateLabels());
// clicar em espaço vazio do mapa (fora de qualquer distrito/região/município)
// limpa a seleção combinada — caminho alternativo ao Esc que funciona igual
// dentro e fora de tela cheia, sem depender do navegador (ver histórico de
// tentativas com Esc: o navegador reserva Esc pra sair da tela cheia e não dá
// pra garantir que a seleção seja limpa sem sair junto). Clique EM cima de um
// polígono não conta — quem trata isso é o handler de clique do próprio
// polígono (onGroup/onClick), que decide entre navegar e Ctrl+selecionar.
map.on('click',e=>{
  if(!st.sel) return;
  const t=e.originalEvent&&e.originalEvent.target;
  if(t&&t.closest&&t.closest('.leaflet-interactive')) return;
  clearSelection();
});

// ---- init ----
// medido (Fase 7): construir as 184 features aqui custa ~6-15ms mesmo invisível
// nos níveis 0/1 (HID) — não compensa adiar/complicar a inicialização por isso.
layer=L.geoJSON(GEO,{style:styleFeature,onEachFeature:onEach}).addTo(map);
fullBounds=layer.getBounds();
// Etapa D: o polígono do estado deixou de ser um destino navegável — sem clique,
// sem hover, sem o tooltip "Clique para dividir". Os 11 polígonos de distrito
// (municípios dissolvidos) já cobrem todo o estado, então stateShape nem é mais
// exibido (ver render()); permanece criado só como objeto inerte para repaintTheme.
stateShape=L.geoJSON(ESTADO,{interactive:false,style:{fillColor:TOKENS.mapStateFill,color:`rgba(${TOKENS.ngRgb},.42)`,weight:1.5,fillOpacity:.96}});
buildCityState(); rebuildGroupLabels(); buildGroupLayer();
// posição inicial "afastada" — o refit()/fitFull() logo abaixo anima a
// aproximação (efeito de entrada suave, tipo câmera chegando no mapa)
map.fitBounds(fullBounds,{padding:[220,220],animate:false});
render();
loadData();   // busca contratos (Supabase); em falha, mostra estado de erro (showDataError)

// mantém o mapa centralizado apesar de fontes, layout e barra de endereço (mobile)
function refit(){ if(st.level>=3) fitCity(); else if(st.level===2) fitGroup(); else fitFull(); }
function ensureSize(){
  // enquanto a entrada animada (flyToBounds) está rodando, invalidateSize()
  // reposiciona o mapa instantaneamente e corta a animação no meio — daí o
  // "tapa" no final. Ignora os ensureSize() de segurança até ela terminar.
  if(!_firstFit && !_entranceDone) return;
  map.invalidateSize(false); refit();
}
requestAnimationFrame(ensureSize);

// revelação: o mapa parte oculto (opacity/scale) e some com o fitFull() acima —
// dois requestAnimationFrame garantem que o navegador pinte o estado inicial
// antes de iniciar a transição, senão o fade não roda.
requestAnimationFrame(()=>requestAnimationFrame(()=>{
  document.getElementById('mapWrap').classList.add('in');
}));
[80,200,400,700,1100,1700,2500].forEach(t=>setTimeout(ensureSize,t));
['load','resize','pageshow','orientationchange'].forEach(ev=>window.addEventListener(ev,()=>setTimeout(ensureSize,60)));
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) ensureSize(); });
if(document.fonts && document.fonts.ready) document.fonts.ready.then(ensureSize);
if(window.ResizeObserver){ let t; new ResizeObserver(()=>{ clearTimeout(t); t=setTimeout(ensureSize,50); }).observe(document.getElementById('map')); }

}catch(e){
  console.error('Erro fatal na inicialização do painel:',e);
  if(typeof showDataError==='function') showDataError('Ocorreu um erro ao carregar o painel: '+(e&&e.message||e));
  window.__bootError=(e&&e.stack)||String(e);
}
})();
