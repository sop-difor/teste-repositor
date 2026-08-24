(async function(){
try{
// lê os tokens de cor direto do :root (assets/css/mapa-obras.css) — regra da Fase 2:
// nenhuma cor pode ser hardcoded aqui e também no CSS; o JS só tem a leitura, o CSS
// é a única fonte da verdade da paleta.
const _cs=getComputedStyle(document.documentElement);
const _tok=k=>_cs.getPropertyValue(k).trim();
const TOKENS={
  ng:_tok('--ng'), ngRgb:_tok('--ng-rgb'), amber:_tok('--amber'),
  statusExec:_tok('--status-exec'), statusOk:_tok('--status-ok'), statusWait:_tok('--status-wait'), statusStop:_tok('--status-stop'),
  mapBase:_tok('--map-base'), mapOpenFill:_tok('--map-open-fill'), mapOpenBorder:_tok('--map-open-border'),
  mapGroupBorder:_tok('--map-group-border'), mapStateFill:_tok('--map-state-fill'), mapStateHover:_tok('--map-state-hover'),
  textBrightest:_tok('--text-brightest'),
};
document.body.classList.add('boot-loading'); // pulso nos KPIs/gráficos até a 1ª carga de dados terminar (sucesso ou erro)

let GEO, ESTADO, GRP, MUN, DISTRITOS, REGIOES, NAMEIDX;
try{
  const _fetchJson=u=>fetch(u).then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status+' em '+u); return r.json(); });
  const [_muni,_estado,_blocos,_ref]=await Promise.all([
    _fetchJson('assets/geo/ce-municipios.json'),
    _fetchJson('assets/geo/ce-estado.json'),
    _fetchJson('assets/geo/ce-blocos.json'),
    _fetchJson('assets/geo/ce-referencia.json'),
  ]);
  GEO=_muni; ESTADO=_estado; GRP=_blocos;
  MUN=_ref.MUN; DISTRITOS=_ref.DISTRITOS; REGIOES=_ref.REGIOES; NAMEIDX=_ref.NAMEIDX;
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
// só as colunas realmente usadas em mapRow()/openModal() — evita select=* (35 colunas,
// 8 delas nunca lidas pelo app) trazendo ~4MB quando ~3,4MB bastam.
const CONTRATOS_COLS=['id_obra','nr_contrato_sop','codigo_obra','descricao_obra','descricao_tipo_contrato',
  'contratada','contratante','municipio','status_contrato','status_obra','data_assinatura','data_inicio_real',
  'valor_atual_contrato','valor_atual','valor_original','total_aditivo','total_reajuste','total_realinhado',
  'dias_paralisado','data_fim_previsto','distrito_operacional','nr_contrato_ext','nr_contrato_sic',
  'data_fim_vigencia_contrato','cnpj_contratada','cnpj_contratante','atualizado_em'].join(',');
const COMISSAO_COLS='id_obra,nome_completo,nome_referencia,tipo';
// carteira ativa = tudo que não é "concluído/encerrado" (ver statusBucket) — é o recorte
// que a SOP-CE de fato gerencia; os outros ~90% do histórico só aparecem sob demanda
// (toggle "Histórico completo"), porque não mudam mais e só diluiriam os KPIs/gráficos.
const ACTIVE_STATUSES=['Em Execução','Aguardando OS','Paralisada'];

// monta o objeto que o app consome (obras entram depois, no loadData)
const DB={distritos:DISTRITOS, regioes:REGIOES, municipios:{}};
for(const cod in MUN){ DB.municipios[cod]={nome:MUN[cod].nome, do:MUN[cod].do, reg:MUN[cod].reg, obras:[]}; }

// Escapa texto vindo do banco (contratos_edificacao/comissao_fiscalizacao) antes de
// injetar via innerHTML \u2014 p\u00e1gina p\u00fablica, sem login, ent\u00e3o qualquer HTML gravado
// nesses campos (objeto, contratada, contratante, fiscal, status etc.) executaria
// no navegador de qualquer visitante do Mapa de Obras.
function escHtml(s){ return String(s??'').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function normTxt(s){return (s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z ]/g,' ').replace(/\s+/g,' ').trim();}
// normaliza mantendo digitos (necessario p/ diferenciar 1o/2o/3o membro)
function normTxtNum(s){return (s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
// classifica o "tipo" de um integrante da comissao num rotulo padronizado,
// respeitando a hierarquia: Presidente > Fiscal > 1o/2o/3o Membro > Suplente.
function classifyComissao(tipoRaw){
  const t=normTxtNum(tipoRaw);
  if(t.includes('PRESIDENTE')) return {label:'PRESIDENTE', rank:6};
  if(t.includes('FISCAL')) return {label:'FISCAL', rank:5};
  // Precisa vir antes dos testes de d\u00edgito: um valor real como "1\u00ba Suplente"
  // cont\u00e9m "1", ent\u00e3o SUPLENTE tinha que ser checado primeiro \u2014 sen\u00e3o esse
  // integrante era classificado (e ranqueado) como titular "1\u00ba Membro".
  if(t.includes('SUPLENTE')) return {label:'SUPLENTE', rank:1};
  if(t.includes('1') || t.includes('PRIMEIRO')) return {label:'1\u00ba MEMBRO', rank:4};
  if(t.includes('2') || t.includes('SEGUNDO')) return {label:'2\u00ba MEMBRO', rank:3};
  if(t.includes('3') || t.includes('TERCEIRO')) return {label:'3\u00ba MEMBRO', rank:2};
  if(t.includes('MEMBRO')) return {label:'MEMBRO', rank:0};
  return {label: tipoRaw ? String(tipoRaw).toUpperCase() : 'MEMBRO', rank:-1};
}
// classificação da situação da obra em 4 estados fixos, cada um com cor reservada
// (nunca a mesma paleta usada nos distritos/regiões do mapa, para não confundir os dois canais de cor)
const STATUS_STATES=[
  {key:'exec', label:'Em execução',  color:TOKENS.statusExec},
  {key:'ok',   label:'Concluída/encerrada', color:TOKENS.statusOk},
  {key:'wait', label:'Aguardando OS', color:TOKENS.statusWait},
  {key:'stop', label:'Paralisada',   color:TOKENS.statusStop},
];
function statusBucket(rawStatus){
  const s=normTxt(rawStatus);
  if(s.includes('PARALIS')) return 'stop';
  if(s.includes('AGUARDANDO')) return 'wait';
  if(s.includes('ENCERRADO')||s.includes('CONCLU')) return 'ok';
  return 'exec';
}
function num(x){const n=parseFloat(x);return isFinite(n)?n:0;}
function mapRow(r){
  const ano=r.data_assinatura?+String(r.data_assinatura).slice(0,4):(r.data_inicio_real?+String(r.data_inicio_real).slice(0,4):null);
  const valor=num(r.valor_atual_contrato)||num(r.valor_atual)||num(r.valor_original);
  return {id_obra:r.id_obra, contrato:r.nr_contrato_sop||r.codigo_obra||('#'+r.id_obra), codigo_obra:r.codigo_obra||'',
    objeto:r.descricao_obra||'—', tipo:r.descricao_tipo_contrato||'', contratada:r.contratada||'—', contratante:r.contratante||'—',
    municipioTxt:r.municipio||'', status:r.status_contrato||r.status_obra||'—', statusObra:r.status_obra||'—', ano, valor,
    valor_original:num(r.valor_original), aditivo:num(r.total_aditivo), reajuste:num(r.total_reajuste),
    realinhado:num(r.total_realinhado), paralisado:num(r.dias_paralisado),
    assinatura:r.data_assinatura||'', fim_prev:r.data_fim_previsto||'', fiscal:'—', raw:r};
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
// id_obra -> comissão de fiscalização completa (ordenada: Presidente > Fiscal > 1º/2º/3º Membro > Suplente).
// idFilter restringe às obras já carregadas (só faz sentido na carteira ativa, onde a
// lista de ids cabe numa query — no histórico completo os ~3.577 ids estourariam a URL,
// então busca a tabela de comissão inteira, só com as 4 colunas usadas).
async function fetchFiscais(idFilter){
  const filter=idFilter&&idFilter.length ? `id_obra=in.(${idFilter.join(',')})` : '';
  const rows=await fetchTable(SB_COMISSAO,{select:COMISSAO_COLS,filter}); const m={};
  for(const r of rows){
    const k=r.id_obra; if(k==null) continue;
    const nome=r.nome_completo||r.nome_referencia; if(!nome) continue;
    const c=classifyComissao(r.tipo);
    (m[k]=m[k]||[]).push({nome, tipo:c.label, rank:c.rank});
  }
  for(const k in m) m[k].sort((a,b)=>b.rank-a.rank);
  return m;
}
// `lastSync` é o maior `atualizado_em` dos contratos carregados (ver chamada em loadData),
// não o horário em que o navegador buscou os dados — "Base atualizada em" precisa refletir
// quando a BASE mudou de fato, não quando a página foi recarregada (antes usava
// `new Date()`, então mostrava "agora" mesmo em bases paradas há dias).
function setStatus(txt,ok,lastSync){
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
function cacheKey(scope){ return 'gecope_mapa_cache_v1_'+scope; }
function readCache(scope){
  try{
    const raw=sessionStorage.getItem(cacheKey(scope)); if(!raw) return null;
    const obj=JSON.parse(raw);
    if(!obj || (Date.now()-obj.ts)>CACHE_TTL_MS) return null;
    return obj;
  }catch{ return null; }
}
function writeCache(scope,rows,fisc){
  try{ sessionStorage.setItem(cacheKey(scope), JSON.stringify({ts:Date.now(),rows,fisc})); }
  catch(e){ /* quota/privacidade — cache é só um bônus de velocidade, ignora e segue sem ele */ }
}

async function loadData(){
  for(const c in DB.municipios) DB.municipios[c].obras=[];
  invalidateAggCache(); // sem isso, um hover no mapa durante o fetch devolveria contagens da era de filtro anterior
  try{
    const scope=st.dataScope;
    const cached=readCache(scope);
    let rows, fisc;
    if(cached){
      rows=cached.rows; fisc=cached.fisc;
    } else if(scope==='ativa'){
      // carteira ativa: filtra no servidor (só ~348 linhas) e, com os ids já em mãos,
      // busca a comissão só desses contratos — evita baixar as ~8.239 linhas inteiras
      // de comissao_fiscalizacao quando 90% delas são de obras já encerradas.
      const filter=`status_obra=in.(${ACTIVE_STATUSES.map(s=>`"${s}"`).join(',')})`;
      rows=await fetchTable(SB_TABLE,{select:CONTRATOS_COLS,filter});
      const ids=[...new Set(rows.map(r=>r.id_obra).filter(v=>v!=null))];
      try{ fisc=await fetchFiscais(ids); }catch(e){ console.warn('comissao_fiscalizacao indisponível:',e.message); fisc={}; }
      writeCache(scope,rows,fisc);
    } else {
      // histórico completo: os ids não cabem numa query id_obra=in.(...), então busca
      // as duas tabelas inteiras (só com as colunas usadas) em paralelo.
      const [rowsR,fiscR]=await Promise.all([
        fetchTable(SB_TABLE,{select:CONTRATOS_COLS}),
        fetchFiscais().catch(e=>{ console.warn('comissao_fiscalizacao indisponível:',e.message); return {}; }),
      ]);
      rows=rowsR; fisc=fiscR;
      writeCache(scope,rows,fisc);
    }
    let sem=0;
    for(const r of rows){ const cod=NAMEIDX[normTxt(r.municipio)]; if(!cod){sem++;continue;} const o=mapRow(r); const com=fisc[o.id_obra]||[]; o.comissao=com; o.fiscal=com[0]?com[0].nome:'—'; o.fiscalTipo=com[0]?com[0].tipo:'FISCAL'; DB.municipios[cod].obras.push(o); }
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
const NUM=new Intl.NumberFormat('pt-BR');

const st={method:'do',metric:'obras',level:0,group:null,city:null,hoverGroup:null,dataScope:'ativa',
  sel:null, // Ctrl+clique em vários distritos/regiões/municípios: {kind:'group'|'city', ids:Set}
  f:{ano:new Set(),status:new Set(),contratada:new Set(),contratante:new Set(),fiscal:new Set(),q:''}};

const METRIC={obras:{label:'Nº de obras',fmt:v=>NUM.format(v)},
              valor:{label:'Valor total',fmt:v=>BRL.format(v)},
              aditivo:{label:'Aditivos (R$)',fmt:v=>BRL.format(v)}};
const BASE=TOKENS.mapBase;
const allIds=Object.keys(DB.municipios);
function groupsList(){return st.method==='do'?DB.distritos:DB.regioes;}
function gidOf(id){const m=DB.municipios[id];return st.method==='do'?m.do:m.reg;}
function idsOfGroup(g){return allIds.filter(id=>String(gidOf(id))===String(g));}
function grpById(g){return groupsList().find(x=>String(x.id)===String(g));}

function passF(o){const f=st.f;
  if(f.ano.size && !f.ano.has(String(o.ano))) return false;
  if(f.status.size && !f.status.has(o.statusObra)) return false;
  if(f.contratada.size && !f.contratada.has(o.contratada)) return false;
  if(f.contratante.size && !f.contratante.has(o.contratante)) return false;
  if(f.fiscal.size && !f.fiscal.has(o.fiscal)) return false;
  if(f.q){const q=f.q; if(!(((o.contrato||'').toLowerCase().includes(q))||((o.codigo_obra||'').toLowerCase().includes(q))||((o.objeto||'').toLowerCase().includes(q))||((o.contratada||'').toLowerCase().includes(q))||((o.municipioTxt||'').toLowerCase().includes(q)))) return false;}
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
function styleFeature(f){
  const id=f.properties.id;
  if(!visible(id)) return HID;                    // níveis 0 e 1: municípios escondidos
  if(st.level===2){
    // município na seleção combinada (Ctrl+clique): destaque cheio, sobrepõe a
    // intensidade coroplética normal — precisa ser visualmente inconfundível com
    // "só tem muita obra" (que usa a mesma cor base, só mais opaca)
    if(st.sel&&st.sel.kind==='city'&&st.sel.ids.has(String(id))) return {fillColor:TOKENS.ng,color:TOKENS.textBrightest,weight:1.6+0.8*zt(),fillOpacity:.78,opacity:1};
    // preenchimento varia com a métrica atual (obra/valor/aditivo), não é mais
    // uma cor uniforme — um município com 0 obras e um com o máximo do distrito
    // não podem ser visualmente idênticos (achado da revisão final de design)
    const t=choroT(mval(aggIds([id])),_levelMax);
    return {fillColor:BASE,color:TOKENS.mapOpenBorder,weight:0.5+0.7*zt(),fillOpacity:.10+.62*t,opacity:.85};
  }
  return {fillColor:TOKENS.mapOpenFill,color:TOKENS.textBrightest,weight:1.0+1.0*zt(),fillOpacity:.85,opacity:1};  // cidade aberta (nível 3)
}
function applyInteractivity(){
  layer.eachLayer(l=>{ if(l._path) l._path.style.pointerEvents = visible(l.feature.properties.id)?'':'none'; });
}
const tip=L.tooltip({sticky:true,direction:'top'});
function tipHtml(id){
  if(st.level===0) return '<b>Ceará</b><br>Clique para dividir';
  if(st.level===1){const g=gidOf(id),gg=grpById(g);const v=mval(aggIds(idsOfGroup(g)));return `<b>${gg.nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`;}
  const v=mval(aggIds([id]));return `<b>${DB.municipios[id].nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`;
}
function onEach(f,l){
  l.on('mouseover',()=>{ if(!visible(f.properties.id))return; l.setStyle({weight:1.8,color:TOKENS.textBrightest}); l.bringToFront();
                         tip.setLatLng(l.getBounds().getCenter()).setContent(tipHtml(f.properties.id)).addTo(map); });
  l.on('mouseout',()=>{ layer.resetStyle(l); tip.remove(); });
  l.on('click',e=>onClick(f.properties.id,e));
}
function onClick(id,e){
  if(!visible(id)) return;
  // Ctrl/Cmd+clique num município (nível 2, dentro de um distrito/região aberto)
  // soma à seleção combinada em vez de abrir aquele município sozinho
  if(st.level===2 && e && e.originalEvent && (e.originalEvent.ctrlKey||e.originalEvent.metaKey)){ toggleSelection('city',id); return; }
  if(st.level===0) goSub();
  else if(st.level===1) goGroup(gidOf(id));
  else if(st.level===2) goCity(id);
}

// ---- camada de blocos (D.O./Região dissolvidos) ----
let groupLayer=null;
// intensidade coroplética do nível 1 quando há busca/filtro ativo — mesmo raciocínio
// de _levelMax (nível 2, ver styleFeature): recalculado 1x por render(), não 1x por
// grupo, já que groupStyle() roda uma vez por distrito/região a cada setStyle().
// _groupValByGid guarda o valor de cada grupo desse mesmo cálculo (Map gid->valor),
// pra groupStyle() só consultar em vez de rechamar idsOfGroup()+aggIds() por feature
// (achado da revisão: sem isso, cada grupo era agregado 2x por render() — aqui e
// dentro de groupStyle). Começa como Map vazio, nunca null: buildGroupLayer() também
// invoca groupStyle() por feature (na troca de método), antes do próximo render()
// repopular o Map — .get() num Map vazio devolve undefined (cai no "||0" abaixo) em
// vez de estourar; o valor errado nesse instante nunca chega a pintar, porque
// render() roda de novo, síncrono, logo em seguida (ver handler de #segMethod — se
// esse handler algum dia ganhar um await/setTimeout entre trocar st.method e chamar
// render() de novo, essa garantia quebra e um flash com valores do método errado
// fica visível). Mesma folga existe no debounce de 150ms da busca/filtros (fSearch e
// os checkboxes, mais abaixo): entre a mudança e o render() que recalcula este Map,
// um hover/zoomend nesse intervalo lê o valor de ANTES da mudança — vazio, se nenhum
// filtro estava ativo ainda, ou a combinação anterior, se já havia um — nunca a nova.
// Aceito de propósito (efeito cosmético de até 150ms, autocorrige sozinho) em vez de
// complicar o cache pra fechar uma janela tão estreita.
let _levelMaxGroup=1, _groupValByGid=new Map();
function groupStyle(f){
  // distrito/região na seleção combinada (Ctrl+clique): mesmo destaque cheio usado
  // pra município selecionado no nível 2 — consistência visual entre os dois níveis
  if(f&&st.sel&&st.sel.kind==='group'&&st.sel.ids.has(String(f.properties.gid))) return {fillColor:TOKENS.ng,color:TOKENS.textBrightest,weight:gw()+1.2,fillOpacity:.68,opacity:1};
  // sem busca/filtro ativos: cor uniforme, como sempre foi — a própria divisão em
  // distritos/regiões já é a informação. Com filtro ativo, escala a opacidade pela
  // intensidade — exatamente a mesma fórmula de styleFeature no nível 2 (.10+.62*t),
  // pra responder visualmente "onde estão os resultados" sem precisar descer de nível.
  const fillOpacity=hasActiveFilter() ? .10+.62*choroT(_groupValByGid.get(String(f.properties.gid))||0,_levelMaxGroup) : .5;
  return {fillColor:BASE,color:TOKENS.mapGroupBorder,weight:gw(),fillOpacity,opacity:.9};
}
function groupHover(){return {fillColor:TOKENS.mapOpenFill,color:TOKENS.textBrightest,weight:gw()+0.8,fillOpacity:.72};}
function onGroup(f,l){
  const gid=f.properties.gid;
  // renderPanel() refaz KPIs + os 3 gráficos (inclui reconstruir o SVG do gráfico por
  // ano) — à toa se o painel lateral estiver recolhido e ninguém puder ver o resultado.
  // panelVisible() é compartilhada (perto de _mainEl/openAside, mais abaixo) em vez de
  // recriada a cada feature — buildGroupLayer() chama onGroup() ~11-14x por build.
  l.on('mouseover',()=>{ l.setStyle(groupHover()); l.bringToFront(); st.hoverGroup=gid; if(panelVisible()) renderPanel();
    // com filtro ativo, _groupValByGid já tem esse valor (calculado em render() logo
    // antes do groupLayer.setStyle() que acabou de rodar) — não recalcula à toa aqui.
    const v=hasActiveFilter()?(_groupValByGid.get(String(gid))||0):mval(aggIds(idsOfGroup(gid)));
    tip.setLatLng(l.getBounds().getCenter()).setContent(`<b>${f.properties.nome}</b><br>${METRIC[st.metric].label}: ${METRIC[st.metric].fmt(v)}`).addTo(map); });
  l.on('mouseout',()=>{ groupLayer.resetStyle(l); st.hoverGroup=null; if(panelVisible()) renderPanel(); tip.remove(); });
  // Ctrl/Cmd+clique num distrito/região soma à seleção combinada em vez de entrar nele
  l.on('click',e=>{ if(e.originalEvent&&(e.originalEvent.ctrlKey||e.originalEvent.metaKey)){ toggleSelection('group',gid); return; } goGroup(gid); });
}
function buildGroupLayer(){ if(groupLayer) groupLayer.remove(); groupLayer=L.geoJSON(GRP[st.method],{style:groupStyle,onEachFeature:onGroup}); }

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
    // o rótulo "CEARÁ" some durante o voo da câmera: texto dentro de um marcador
    // sendo escalado continuamente pela animação de zoom do Leaflet treme/borra —
    // reaparece só quando o mapa se assenta (moveend)
    setLayer(stateLbl,false);
    map.flyToBounds(fullBounds,{padding:[24,24],duration:2.8,easeLinearity:.06});
    map.once('moveend',()=>{ _entranceDone=true; updateLabels(); });
    return;
  }
  if(!_entranceDone) return;
  // reenquadramentos depois da entrada (resize, orientação, entrar/sair da tela
  // cheia) também animam — evita o "salto" instantâneo quando o viewport muda
  setLayer(stateLbl,false);
  map.flyToBounds(fullBounds,{padding:[24,24],duration:.9,easeLinearity:.2});
  map.once('moveend',()=>{ updateLabels(); });
}
function fitGroup(){ const b=boundsOfIds(idsOfGroup(st.group)); if(b) map.fitBounds(b,{padding:[40,40],maxZoom:10}); }
function fitCity(){ const b=boundsOfIds([st.city]); if(b) map.fitBounds(b,{padding:[60,60],maxZoom:11}); }

// navegação
function goState(){st.sel=null;st.level=0;st.group=null;st.city=null;st.hoverGroup=null;render();fitFull();}
function goSub(){st.sel=null;st.level=1;st.group=null;st.city=null;st.hoverGroup=null;render();fitFull();}
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
const stateC=(()=>{let la=0,lo=0,n=0;for(const id in munC){la+=munC[id][0];lo+=munC[id][1];n++;}return[la/n,lo/n];})();

let cityItems=[], groupItems=[], stateItem=null;
let cityLbl,groupLbl,stateLbl;
function buildCityState(){
  cityItems=allIds.map(id=>({id,ll:L.latLng(munC[id]),nome:DB.municipios[id].nome,
    mk:L.marker(munC[id],{interactive:false,keyboard:false,icon:L.divIcon({className:'mun-label',iconSize:[0,0],
      html:`<div class="lbl"><div class="lbl-name">${DB.municipios[id].nome}</div><div class="lbl-count"></div></div>`})})}));
  cityLbl=L.layerGroup(cityItems.map(i=>i.mk));
  stateItem={ll:L.latLng(stateC),mk:L.marker(stateC,{interactive:false,keyboard:false,icon:L.divIcon({className:'state-label',iconSize:[0,0],html:'<span>Ceará</span>'})})};
  stateLbl=L.layerGroup([stateItem.mk]);
}
// ajustes manuais pontuais de posição de rótulo [Δlat,Δlon], por nome já sem o
// prefixo "D.O." — ver comentário de uso mais abaixo.
const GRP_LABEL_NUDGE={'Aracoiaba':[0,0.10],'Sertão de Sobral':[0.10,0.10],'Maciço de Baturité':[-0.05,0.05],'Vale do Jaguaribe':[-0.05,0.05],'RM Fortaleza':[0.12,0]};
// nomes curtos o bastante pra caber numa linha só, mesmo com 2+ palavras — pedido
// pontual do usuário pra "Santa Quitéria" (a quebra em 2 linhas do shortGroupLabel()
// é pensada pra nomes longos tipo "Sertão de Sobral", não faz sentido aqui).
const GRP_LABEL_ONE_LINE=new Set(['Santa Quitéria']);
// nome completo (usado em breadcrumb/painel/tooltip) é longo demais pra caber
// lado a lado no mapa em "Região" (14 itens, vários espremidos no mesmo canto) —
// tira as preposições de ligação (de/da/do/dos/das) e quebra em até 2 linhas
// centralizadas. Pedido do usuário: "SERTÃO DE SOBRAL" -> "SERTÃO"/"SOBRAL".
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
  // rótulo de distrito/região usa o mesmo centroidOf() (área + pólo de
  // inacessibilidade em formas côncavas) já usado pros municípios — aplicado à
  // forma REAL dissolvida do distrito (GRP), não a uma média simples dos
  // centros dos municípios membros. A média simples empurra o rótulo pro lado
  // onde há mais municípios pequenos agrupados, mesmo que a forma do distrito
  // como um todo seja bem diferente disso — daí rótulos nitidamente fora do
  // centro visual em distritos irregulares (achado do usuário).
  const feats=(GRP[st.method]&&GRP[st.method].features)||[];
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
// "Região" tem 14 itens (vs. 11 de "Distrito Op."), muitos deles espremidos no
// mesmo canto do mapa (litoral/serra no norte) — com a fonte grande pedida pelo
// usuário, alguns simplesmente não cabem lado a lado, não importa quanto se
// desloque cada um manualmente (empurrar um pra longe de um vizinho só empurra
// pra cima do próximo). Reduz um pouco só nesse modo; "Distrito Op." (padrão)
// mantém o tamanho grande.
// mesmo tamanho pros dois métodos agora — a quebra em 2 linhas (shortGroupLabel)
// já resolve o aperto de "Região" (14 itens) sem precisar sacrificar o tamanho
// da fonte que o usuário pediu maior.
function lblFS(){const t=zt();return {grp:12+3.5*t, mun:10.5+3*t, st:32};}
function applyLabelSizes(){const s=lblFS(),r=document.documentElement.style;
  r.setProperty('--grpfs',s.grp.toFixed(1)+'px');r.setProperty('--munfs',s.mun.toFixed(1)+'px');r.setProperty('--stfs',s.st+'px');return s;}
function refreshMapCounts(){
  groupItems.forEach(it=>{
    const el=it.mk.getElement(); const c=el&&el.querySelector('.lbl-count');
    if(c) c.textContent=NUM.format(aggIds(idsOfGroup(it.id)).obras);
  });
  cityItems.forEach(it=>{
    const el=it.mk.getElement(); const c=el&&el.querySelector('.lbl-count');
    if(c) c.textContent=NUM.format(obrasOf(it.id).length);
  });
}
function updateLabels(){
  const s=applyLabelSizes();
  setLayer(stateLbl,st.level===0);
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
  if(!total){ bar.innerHTML=''; leg.innerHTML='<div class="empty" style="padding:2px 0">Sem obras neste recorte.</div>'; return; }
  bar.innerHTML=STATUS_STATES.filter(s=>c[s.key]>0).map(s=>{
    const pct=c[s.key]/total*100;
    return `<i style="width:${pct}%;background:${s.color}" title="${s.label}: ${NUM.format(c[s.key])} obras (${pct.toFixed(0)}%)"></i>`;
  }).join('');
  leg.innerHTML=STATUS_STATES.filter(s=>c[s.key]>0).map(s=>{
    const pct=Math.round(c[s.key]/total*100);
    return `<span class="sit"><span class="dot" style="background:${s.color}"></span>${s.label} <b>${NUM.format(c[s.key])}</b> (${pct}%)</span>`;
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
  // viewBox de largura FIXA (não cresce com o nº de anos) — no modo "Histórico
  // completo" o recorte pode ter ~17 anos distintos; se a largura do viewBox
  // escalasse com anos.length, o aspect ratio real (largura:altura) se distanciaria
  // muito do aspect ratio do container (width:100%/height fixa em CSS), e o SVG
  // encolhia por letterboxing vertical até sobrar mais espaço em branco que gráfico.
  // Com largura fixa, só a largura de cada barra individual muda — o gráfico como
  // um todo sempre preenche o container por igual, com 1 ano ou com 20.
  const W=300, H=64, gap=Math.min(6,W/anos.length*0.18), barW=(W-(anos.length-1)*gap)/anos.length;
  const bars=anos.map((a,i)=>{
    const h=Math.max(2,counts[a]/max*(H-16)), x=i*(barW+gap), y=H-14-h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${TOKENS.ng}"><title>${a}: ${NUM.format(counts[a])} contrato${counts[a]===1?'':'s'}</title></rect>`
      +`<text x="${(x+barW/2).toFixed(1)}" y="${H-3}" text-anchor="middle" class="ychart-lbl">’${String(a).slice(2)}</text>`;
  }).join('');
  // preserveAspectRatio="none": o container tem largura fluida (painel lateral) e
  // altura fixa (CSS); mesmo com viewBox de largura fixa, o aspect ratio do
  // container varia com o layout. "none" garante que o gráfico sempre preenche o
  // espaço exatamente, sem letterboxing — o leve esticamento não distorce a leitura
  // de um gráfico de barras (ao contrário de uma imagem/foto).
  host.innerHTML=`<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="ychart" role="img" aria-label="Contratos por ano de assinatura">${bars}</svg>`;
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
  return groupsList().map(g=>({k:g.id,nome:g.nome.replace(/^D\.O\.\s*/,''),sub:g.sede,v:mval(aggIds(idsOfGroup(g.id)))}))
    .sort(st.method==='do'?(a,b)=>a.k-b.k:(a,b)=>b.v-a.v);
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
  if(!arr.length) return '<div class="empty">Nenhum contrato neste recorte (verifique os filtros).</div>';
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
const NUMBR=new Intl.NumberFormat('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
function fmtNumBR(v){ return NUMBR.format(num(v)); }
function mSection(title,fields){
  return `<div class="msec">${title}</div><div class="mgrid">`
    +fields.map(([l,d,extra])=>`<div><div class="l">${l}</div><div class="d">${d}${extra||''}</div></div>`).join('')
    +`</div>`;
}
function openModal(o){
  const raw=o.raw||{};
  const obra=[
    ['STATUS DA OBRA', fmtVal(raw.status_obra)],
    ['MUNICÍPIO', fmtVal(raw.municipio||o.municipioTxt)],
    ['DISTRITO OPERACIONAL', fmtVal(raw.distrito_operacional)],
  ];
  const comissao=(o.comissao&&o.comissao.length)
    ? o.comissao.map(m=>[fmtVal(m.tipo).toUpperCase(), fmtVal(m.nome)])
    : [['FISCAL', fmtVal(o.fiscal)]];
  const contrato=[
    ['Nº DO CONTRATO', fmtContratoExt(raw.nr_contrato_ext)],
    ['CÓDIGO DA OBRA', fmtVal(raw.codigo_obra)],
    ['SAC', fmtVal(raw.nr_contrato_sic)],
    ['INÍCIO REAL', fmtDateBR(raw.data_inicio_real)],
    ['FIM PREVISTO', fmtDateBR(raw.data_fim_previsto)],
    ['FIM DA VIGÊNCIA', fmtDateBR(raw.data_fim_vigencia_contrato)],
  ];
  const contratado=[
    ['CONTRATADO', fmtVal(raw.contratada)],
    ['CNPJ CONTRATADO', fmtCNPJ(raw.cnpj_contratada)],
  ];
  const contratante=[
    ['CONTRATANTE', fmtVal(raw.contratante)],
    ['CNPJ CONTRATANTE', fmtCNPJ(raw.cnpj_contratante)],
  ];
  const valores=[
    ['VALOR ORIGINAL', fmtNumBR(raw.valor_original)],
    ['TOTAL ADITIVOS', fmtNumBR(raw.total_aditivo)],
    ['VALOR ATUAL DO CONTRATO', fmtNumBR(raw.valor_atual_contrato)],
  ];
  document.getElementById('modal').innerHTML=
    `<div class="mh"><div class="mt">DADOS DO CONTRATO Nº ${fmtContratoExt(raw.nr_contrato_ext)}</div><button class="mx" id="modalX" aria-label="Fechar">✕</button></div>
     <div class="mbody">
       <div class="mobj">${escHtml(o.objeto)}</div>
       ${mSection('Dados da obra',obra)}
       ${mSection('Comissão de fiscalização',comissao)}
       ${mSection('Dados do contrato',contrato)}
       ${mSection('Dados do contratado',contratado)}
       ${mSection('Dados do contratante',contratante)}
       ${mSection('Valores',valores)}
       <div class="mupd">Atualizado em ${fmtDateTimeBR(raw.atualizado_em)}</div>
     </div>`;
  document.getElementById('modalBg').classList.add('show');
  document.getElementById('modalX').onclick=closeModal;
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
function hasActiveFilter(){ return !!st.f.q || FILTER_DEFS.some(d=>st.f[d.key].size>0); }
function renderPanel(){
  setKPIs();
  const scope=document.getElementById('scope'), body=document.getElementById('body');
  const methodName=st.method==='do'?'Distritos Operacionais':'Regiões';
  if(st.sel && st.sel.ids.size){
    // seleção combinada (Ctrl+clique em vários distritos/regiões/municípios) tem
    // prioridade sobre o ranking/busca normais — é um recorte explícito do usuário
    const kindLabel=st.sel.kind==='group'?(st.method==='do'?'distrito':'região'):'município';
    const chips=[...st.sel.ids].map(id=>{
      const nome=st.sel.kind==='group' ? (grpById(id)?grpById(id).nome.replace(/^D\.O\.\s*/,''):id)
                                        : (DB.municipios[id]?DB.municipios[id].nome:id);
      return `<span class="chip chip-sel" role="button" tabindex="0" data-selid="${id}" title="Remover ${escHtml(nome)} da seleção">${escHtml(nome)} ✕</span>`;
    }).join('');
    const n=st.sel.ids.size;
    scope.innerHTML=`<b>${n}</b> ${kindLabel}${n===1?'':'s'} selecionado${n===1?'':'s'} — Ctrl+clique pra somar/tirar da seleção`
      +` <button class="clearf" id="clearSelBtn" style="display:inline-flex;margin-left:8px;padding:3px 10px;font-size:10px">Limpar seleção</button>`;
    document.getElementById('clearSelBtn').onclick=clearSelection;
    body.innerHTML=`<div class="chips" style="margin-bottom:14px">${chips}</div>`
      +`<div class="sec-h"><span>Contratos combinados</span></div>`+obrasCards(selectionMunIds());
  } else if(st.level<=1 && hasActiveFilter()){
    // busca/filtro ativo com o mapa ainda no nível Estado/Distritos: mostra os
    // contratos encontrados direto (em vez do ranking por distrito), cada um com
    // o município clicável — sem precisar descer manualmente até lá
    const cards=obrasCards(allIds), n=CUROBRAS.length;
    scope.innerHTML=`<b>${NUM.format(n)}</b> contrato${n===1?'':'s'} encontrado${n===1?'':'s'} — clique no município do card para localizar no mapa`;
    body.innerHTML=`<div class="sec-h"><span>Resultados da busca</span><span>${NUM.format(n)}</span></div>`+cards;
  } else if(st.level<=1){
    if(st.level===1 && st.hoverGroup!=null){
      const g=grpById(st.hoverGroup); const ids=idsOfGroup(st.hoverGroup);
      scope.innerHTML=`Região destacada — <b>clique para abrir os municípios</b>`;
      body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${g.nome}</div>`
        +`<div class="scope" style="margin-top:8px">${ids.length} municípios neste ${st.method==='do'?'distrito':'recorte'}</div>`;
    } else {
      scope.innerHTML= st.level===0 ? `Visão geral do estado — <b>clique no mapa</b> para dividir em ${methodName.toLowerCase()}`
                                    : `Estado dividido por <b>${methodName}</b> — passe o mouse ou clique para entrar`;
      const ents=groupEntries();
      body.innerHTML=`<div class="sec-h"><span>${methodName}</span><span>${ents.length}</span></div>`+rankRows(ents,'group');
    }
  } else if(st.level===2){
    const g=grpById(st.group);
    scope.innerHTML=`Distrito/Região selecionado`;
    const ids=idsOfGroup(st.group);
    const ents=cityEntries(ids);
    body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:17px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${g.nome}</div>`
      +`<div class="sec-h"><span>Cidades (${ids.length})</span><span>clique p/ abrir</span></div>`+rankRows(ents,'city')
      +`<div class="sec-h" style="margin-top:20px"><span>Contratos do distrito</span></div>`+obrasCards(ids);
  } else {
    const id=st.city, g=grpById(gidOf(id));
    scope.innerHTML=`Município selecionado · ${g.nome.replace(/^D\.O\.\s*/,'')}`;
    body.innerHTML=`<div style="font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:700;color:${TOKENS.textBrightest};text-shadow:0 0 20px rgba(${TOKENS.ngRgb},.22)">${DB.municipios[id].nome}</div>`
      +`<div class="sec-h" style="margin-top:12px"><span>Contratos</span><span>${obrasOf(id).length}</span></div>`+obrasCards([id]);
  }
}
function renderCrumb(){
  const c=document.getElementById('crumb');
  const methodName=st.method==='do'?'Distritos':'Regiões';
  // qualquer render() reconstrói a trilha do zero (innerHTML) — a âncora que o popover
  // de irmãos guardava fica órfã, então fecha aqui em vez de tentar reposicionar.
  closeSiblingPopover();
  const sibTrig=(nome)=>`<a data-nav="siblings" class="cur sib" role="button" tabindex="0" aria-haspopup="true" title="Ver outros ${st.level===2?(st.method==='do'?'distritos':'regiões'):'municípios'}"><span class="sib-text">${nome}</span> <span class="sib-caret">▾</span></a>`;
  let h='';
  if(st.level===0){h=`<span class="cur">Ceará</span>`;}
  else if(st.level===1){h=`<a data-nav="state">Ceará</a><span class="sep">›</span><span class="cur">${methodName}</span>`;}
  else if(st.level===2){h=`<a data-nav="state">Ceará</a><span class="sep">›</span><a data-nav="sub">${methodName}</a><span class="sep">›</span>${sibTrig(grpById(st.group).nome.replace(/^D\.O\.\s*/,''))}`;}
  else {h=`<a data-nav="state">Ceará</a><span class="sep">›</span><a data-nav="sub">${methodName}</a><span class="sep">›</span><a data-nav="group">${grpById(gidOf(st.city)).nome.replace(/^D\.O\.\s*/,'')}</a><span class="sep">›</span>${sibTrig(DB.municipios[st.city].nome)}`;}
  if(st.sel && st.sel.ids.size) h+=`<span class="sep">›</span><span class="cur">${st.sel.ids.size} selecionado${st.sel.ids.size===1?'':'s'}</span>`;
  c.innerHTML=h;
}
function renderFoot(){
  document.getElementById('foot').innerHTML=
    `Fluxo: <b>Ceará → ${st.method==='do'?'Distritos Operacionais':'Regiões'} → cidades</b>. Clique numa área para descer; use a trilha no topo para voltar.
     Divisão oficial dos 11 D.Os (SOP). Dados oficiais da base de contratos de obras da SOP-CE.`;
}

function render(){
  if(st.level===2) _levelMax=Math.max(1,...idsOfGroup(st.group).map(id=>mval(aggIds([id]))));
  if(st.level===1 && hasActiveFilter()){
    _groupValByGid=new Map(groupsList().map(g=>[String(g.id),mval(aggIds(idsOfGroup(g.id)))]));
    _levelMaxGroup=Math.max(1,...[..._groupValByGid.values()]);
  } else {
    _groupValByGid=new Map();
  }
  layer.setStyle(styleFeature); applyInteractivity(); updateLabels();
  // groupStyle() agora faz trabalho de verdade (idsOfGroup+aggIds) quando há filtro
  // ativo, não só devolve um objeto constante — só compensa recalcular enquanto o
  // próprio groupLayer está visível (nível 1). Ctrl+clique em grupo (st.sel.kind
  // ==='group') também só existe nesse nível (goGroup/goCity/goState/goSub sempre
  // zeram st.sel antes de sair dele), então esta guarda não perde o "reflete seleção
  // sem esperar o zoomend" que esta chamada existe pra garantir.
  if(st.level===1 && groupLayer) groupLayer.setStyle(groupStyle);
  setLayer(stateShape, st.level===0); if(st.level===0 && stateShape) stateShape.bringToFront();
  setLayer(groupLayer, st.level===1); if(st.level===1 && groupLayer) groupLayer.bringToFront();
  renderCrumb(); renderPanel(); renderFoot();
}

// ---- filtros / busca (multi-seleção) ----
const FILTER_DEFS=[
  {key:'ano',label:'Ano',get:o=>o.ano?String(o.ano):null,numeric:true},
  {key:'contratada',label:'Contratada',get:o=>(o.contratada&&o.contratada!=='—')?o.contratada:null},
  {key:'contratante',label:'Contratante',get:o=>(o.contratante&&o.contratante!=='—')?o.contratante:null},
  {key:'fiscal',label:'Fiscal',get:o=>(o.fiscal&&o.fiscal!=='—')?o.fiscal:null},
  {key:'status',label:'Status da obra',get:o=>(o.statusObra&&o.statusObra!=='—')?o.statusObra:null},
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
    const set=new Set(); all.forEach(o=>{const v=d.get(o); if(v)set.add(v);});
    const vals=[...set].sort(d.numeric?(a,b)=>b-a:(a,b)=>a.localeCompare(b,'pt-BR'));
    const opts=vals.map(v=>`<label class="msel-opt"><input type="checkbox" value="${escHtml(v)}">${escHtml(v)}</label>`).join('')
      || '<div class="msel-empty">Sem opções</div>';
    return `<div class="msel" data-key="${d.key}">
      <button type="button" class="msel-btn" data-label="${d.label}"></button>
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
// busca/filtro move a câmera sozinha: 1 município encontrado → o mapa voa até
// lá; vários municípios → a câmera se ajusta para enquadrar todos eles, sem
// exigir que o usuário clique no chip do card manualmente
let _searchNav=false; // true quando o nível "cidade" atual foi aberto pela busca (não por clique)
function autoLocateSearch(){
  const matchIds=hasActiveFilter() ? allIds.filter(id=>obrasOf(id).length>0) : [];
  if(matchIds.length===1){
    if(st.city!==matchIds[0] || st.level!==3){ _searchNav=true; goCity(matchIds[0]); }
    return;
  }
  // ao desfazer uma navegação automática (filtro/busca que tinha afunilado pra 1
  // município só), sem refit() a câmera fica presa no zoom da cidade anterior —
  // o estado lógico volta pro Estado mas o usuário continua olhando pro mesmo
  // pedaço ampliado do mapa, agora vazio (achado na verificação da Fase 4)
  if(_searchNav && st.level===3){ _searchNav=false; st.city=null; st.group=null; st.level=0; render(); refit(); }
  if(matchIds.length>1 && st.level<=1){
    const b=boundsOfIds(matchIds);
    if(b) map.flyToBounds(b,{padding:[60,60],maxZoom:10,duration:1.1,easeLinearity:.15});
  }
}
let _fSearchTimer=null;
document.getElementById('fSearch').addEventListener('input',e=>{
  // PERFORMANCE: render() reestiliza toda a camada GeoJSON + roda o algoritmo de
  // declutter de rótulos a cada chamada — sem debounce isso rodava a cada tecla digitada.
  st.f.q=e.target.value.trim().toLowerCase();
  clearTimeout(_fSearchTimer);
  _fSearchTimer=setTimeout(()=>{ invalidateAggCache(); render(); autoLocateSearch(); },150);
});
document.getElementById('clearF').onclick=()=>{
  FILTER_DEFS.forEach(d=>st.f[d.key].clear());
  st.f.q=''; document.getElementById('fSearch').value='';
  document.querySelectorAll('.msel-opt input').forEach(cb=>cb.checked=false);
  document.querySelectorAll('.msel').forEach(m=>{updateMselBtn(m.dataset.key); m.classList.remove('on'); mselResetQuery(m);});
  invalidateAggCache(); render(); autoLocateSearch();
};

// painel de filtros recolhível (recolhido por padrão)
const _ctrl=document.getElementById('ctrl'), _ctrlT=document.getElementById('ctrlToggle');
function openCtrl(o){ _ctrl.classList.toggle('show',o); _ctrlT.style.display=o?'none':''; }
_ctrlT.onclick=()=>openCtrl(true);
document.getElementById('ctrlClose').onclick=()=>openCtrl(false);
openCtrl(false);

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

// nenhum navegador permite tela cheia automática no carregamento (exige gesto do
// usuário, por segurança) — como aproximação, entra sozinho no 1º clique/tecla
// na página, sem depender de a pessoa achar o botão "Tela cheia"
function autoFullscreenOnFirstGesture(){
  document.removeEventListener('pointerdown',autoFullscreenOnFirstGesture);
  document.removeEventListener('keydown',autoFullscreenOnFirstGesture);
  requestRealFullscreen();
}
document.addEventListener('pointerdown',autoFullscreenOnFirstGesture);
document.addEventListener('keydown',autoFullscreenOnFirstGesture);

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

document.getElementById('segMethod').addEventListener('click',e=>{
  const b=e.target.closest('button'); if(!b)return;
  document.querySelectorAll('#segMethod button').forEach(x=>x.classList.remove('on')); b.classList.add('on');
  // buildGroupLayer() já chama groupStyle() por feature aqui, com _groupValByGid ainda
  // com os gids do MÉTODO ANTERIOR (ids colidem entre do/reg, ex.: gid 0 existe nos
  // dois, com grupos diferentes) — só é seguro porque render()/goSub() roda de novo,
  // síncrono, ANTES de qualquer paint do navegador (ver comentário em _groupValByGid).
  // Não trocar isso por um await/setTimeout entre as duas chamadas sem revisar de novo.
  // âncora capturada ANTES da troca de método — depois, idsOfGroup()/gidOf() já leem
  // o método novo. Sem isso, trocar Distrito<->Região sempre jogava de volta pro nível
  // 1 (Fase 8): no nível 3 não tinha necessidade nenhuma — st.city significa a mesma
  // coisa nos dois métodos, e renderCrumb() já recalcula o grupo-pai certo sozinho; no
  // nível 2, cai num grupo equivalente (o de maior valor na métrica atual dentro do
  // grupo antigo) em vez de simplesmente sair do que o usuário estava vendo.
  let anchor=null;
  if(st.level===2) anchor=idsOfGroup(st.group).sort((x,y)=>mval(aggIds([y]))-mval(aggIds([x])))[0]||null;
  st.method=b.dataset.v; rebuildGroupLabels(); buildGroupLayer();
  if(st.level===0 || st.level===3){ render(); }
  else if(st.level===2 && anchor){ goGroup(gidOf(anchor)); }
  else { goSub(); }
});
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
  if(st.level===2){ title=st.method==='do'?'Outros distritos':'Outras regiões'; entries=groupEntries().filter(e=>String(e.k)!==String(st.group)); kind='group'; }
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
stateShape=L.geoJSON(ESTADO,{style:{fillColor:TOKENS.mapStateFill,color:`rgba(${TOKENS.ngRgb},.42)`,weight:1.5,fillOpacity:.96},
  onEachFeature:(f,l)=>{
    l.on('click',()=>goSub());
    l.on('mouseover',()=>{l.setStyle({fillColor:TOKENS.mapStateHover});tip.setLatLng(l.getBounds().getCenter()).setContent('<b>Ceará</b><br>Clique para dividir').addTo(map);});
    l.on('mouseout',()=>{l.setStyle({fillColor:TOKENS.mapStateFill});tip.remove();});
  }});
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
