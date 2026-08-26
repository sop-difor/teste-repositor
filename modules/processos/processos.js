
/**
 * Calcular Dias Devolução - Função faltava, adicionada
 */
function calcularDiasDevolucao() {
    try {
        const elDevolucao = document.getElementById('det_data_devolucao');
        const elBadge = document.getElementById('det_badge_dias_dev');

        if (!elDevolucao || !elBadge) {
            console.warn('[WARN] Elementos não encontrados para calcularDiasDevolucao');
            return;
        }

        const strDataDevolucao = elDevolucao.value;

        if (!strDataDevolucao) {
            elBadge.textContent = ' dias';
            return;
        }

        const dataDevolucao = isoParaDate(dataParaISO(strDataDevolucao));

        if (dataDevolucao && !isNaN(dataDevolucao)) {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const devDate = new Date(dataDevolucao);
            devDate.setHours(0, 0, 0, 0);
            const dias = Math.round((hoje - devDate) / (1000 * 60 * 60 * 24));
            elBadge.textContent = dias + ' dias';
        }
    } catch (err) {
        console.error('[ERRO] calcularDiasDevolucao:', err);
    }
}


// --- MÓDULO DE AUTOMAÇÃO GLOBAL (StatusSync) ---
window.StatusSync = {
    async verificarEAtualizarStatus(processoGecope, dadosSuite) {
        try {
            if (!sbClient) return { changed: false };
            const id = processoGecope.id;
            const nup = processoGecope.processo;
            const siglaSuite = String(dadosSuite.sigla || '').toUpperCase().trim();
            const statusGecope = String(processoGecope.status || '').toUpperCase().trim();
            let novoStatus = null;

            // Segurança: se o processo foi criado há pouco tempo, respeitar o status definido no GECOPE
            try {
                const criado = processoGecope && processoGecope.created_at ? new Date(processoGecope.created_at) : null;
                if (criado) {
                    const agora = new Date();
                    const diff = agora.getTime() - criado.getTime();
                    // Se criado nos últimos 3 minutos, não aplicar mudanças automáticas
                    if (diff >= 0 && diff < (3 * 60 * 1000)) {
                        return { changed: false, reason: 'recently_created' };
                    }
                }
            } catch (e) { /* noop */ }

            const analista = String(processoGecope.analista || '').trim().toUpperCase();

            // Melhoria: Código mais limpo e à prova de falhas para checar a inicial do analista
            const isAnalistaEspecial = analista ? ["N", "W", "H", "P", "F", "A"].includes(analista.charAt(0)) : false;

            // REGRA 2: ARQUIVAMENTO (Prioridade Máxima)
            if (siglaSuite === 'ARQUIVADO') {
                novoStatus = 'ARQUIVADO';
            }
            // REGRA 1: Aprovação Automática
            else if (statusGecope === 'AGUAR. APROVAÇÃO' &&
                isAnalistaEspecial &&
                siglaSuite !== 'DIFOR' &&
                siglaSuite !== 'GECOPE' &&
                siglaSuite !== '') {
                novoStatus = 'APROVADO';
            }
            // REGRA 3: Entrada para Reanálise (Agora mais robusta, sem depender de cache antigo)
            else if ((statusGecope === 'REANÁLISE FISCAL' || statusGecope === 'DEVOLVIDO P/ REANÁLISE FISCAL') &&
                isAnalistaEspecial &&
                siglaSuite === 'GECOPE') {
                novoStatus = 'AGUAR. REANÁLISE';
            }
            // REGRA 4: Entrada para Análise (Também ajustada)
            else if (statusGecope === 'ANÁLISE FISCAL' &&
                !isAnalistaEspecial &&
                siglaSuite === 'GECOPE') {
                novoStatus = 'AGUAR. ANÁLISE';
            }
            // REGRA 5: Retorno de Processo Aprovado para Diligência
            // Um processo já APROVADO que volta a tramitar na GECOPE precisa de
            // correções/diligências adicionais antes de seguir seu fluxo normal.
            else if (statusGecope === 'APROVADO' && siglaSuite === 'GECOPE') {
                novoStatus = 'DILIGÊNCIA';
            }

            // Se encontrou um novo status diferente do atual, envia para o banco
            if (novoStatus && novoStatus !== statusGecope) {

                // Melhoria: Payload agora atualiza a coluna 'suite' para manter o sistema e o painel consistentes
                const payload = {
                    status: novoStatus,
                    suite: siglaSuite,
                    ultima_atualizacao: new Date().toISOString(),
                    atualizado_por: 'AUTOMAÇÃO SUITE'
                };

                let query = sbClient.from('processos').update(payload);
                if (id) query = query.eq('id', id); else query = query.eq('processo', nup);

                const { data, error } = await query.select('id, status');
                if (error) {
                    console.error("[StatusSync] ERRO DETALHADO:", error.message);
                    return { changed: false, error: error.message };
                }
                return { changed: !!(data && data.length), data: data ? data[0] : null };
            }
            return { changed: false };

        } catch (e) {
            console.error("[StatusSync] Erro:", e);
            return { changed: false, error: e };
        }
    }
};

// --- ALERTA DE PRÉ-DILIGÊNCIA ---
// Setores da SOP por onde um processo já APROVADO pode voltar a tramitar antes de
// retornar formalmente à GECOPE (o que hoje só é detectado quando o SUITE marca sigla = GECOPE,
// gerando o status DILIGÊNCIA). Avisar aqui permite intervir antes de o processo chegar.
const SETORES_RISCO_DILIGENCIA = ['DIFOR', 'GEFOE', 'DIRED', 'GEDOP'];

function isSetorRiscoDiligencia(sigla) {
    const s = String(sigla || '').toUpperCase().trim();
    if (!s || s === 'GECOPE') return false;
    return SETORES_RISCO_DILIGENCIA.some(setor => s.startsWith(setor));
}

// Busca, em lote, o comentário mais recente de justificativa do alerta de retorno
// para cada processo de window.allData, e anexa em d.alertaRetornoUltimo.
async function carregarAlertasRetornoComentarios() {
    if (!sbClient || !window.allData || !window.allData.length) return;
    try {
        const ids = window.allData.filter(d => d.id).map(d => String(d.id));
        if (!ids.length) return;

        const { data, error } = await sbClient
            .from('alerta_retorno_comentarios')
            .select('*')
            .in('processo_id', ids)
            .order('created_at', { ascending: false });

        if (error) throw error;

        const ultimoPorProcesso = {};
        (data || []).forEach(reg => {
            if (!ultimoPorProcesso[reg.processo_id]) ultimoPorProcesso[reg.processo_id] = reg;
        });

        window.allData.forEach(d => {
            d.alertaRetornoUltimo = ultimoPorProcesso[String(d.id)] || null;
        });
    } catch (e) {
        console.error('[ERRO] Falha ao carregar comentários de alerta de retorno:', e);
    }
}

function montarAlertaIconeHTML(d) {
    if (d.alerta_pre_diligencia) {
        const siglaTxt = d.suite_sigla_risco ? escapeHTML(d.suite_sigla_risco) : 'setor de risco';
        return ` <i class="bi bi-exclamation-triangle-fill text-alerta-diligencia ms-1" style="cursor:pointer;" onclick="abrirModalAlertaRetorno('${escapeHTML(d.processo)}')" title="Atenção: processo aprovado tramitando em ${siglaTxt} — risco de retornar para diligência antes de chegar à GECOPE. Clique para registrar o motivo."></i>`;
    }
    if (d.alerta_retorno_resolvido && d.alertaRetornoUltimo) {
        const comentarioTxt = escapeHTML(d.alertaRetornoUltimo.comentario);
        return ` <i class="bi bi-check-circle-fill text-success ms-1" style="cursor:pointer;" onclick="abrirModalAlertaRetorno('${escapeHTML(d.processo)}')" title="${comentarioTxt}"></i>`;
    }
    return '';
}

// Atualiza o flag de risco de um processo (na linha em tela, se houver, e no window.allData)
// e mantém o contador da aba "Aprovados" sincronizado. Um processo já comentado para a
// sigla atual conta como resolvido (ícone check); se a sigla mudar para outro setor de
// risco diferente do último comentário, o alerta reabre (ícone exclamação de novo).
function aplicarAlertaPreDiligencia(d, tr, alertaIcone, sigla, stTxtParam) {
    const stTxt = (stTxtParam || d.status || '').toString().toUpperCase();
    const emRiscoBruto = stTxt.includes('APROVADO') && isSetorRiscoDiligencia(sigla);

    const ultimo = d.alertaRetornoUltimo;
    const resolvidoParaEstaSigla = !!(emRiscoBruto && ultimo && ultimo.sigla === sigla);

    d.alerta_pre_diligencia = emRiscoBruto && !resolvidoParaEstaSigla;
    d.alerta_retorno_resolvido = resolvidoParaEstaSigla;
    d.suite_sigla_risco = emRiscoBruto ? sigla : null;

    if (window.allData) {
        const globalRow = window.allData.find(x => x.processo === d.processo);
        if (globalRow) {
            globalRow.alerta_pre_diligencia = d.alerta_pre_diligencia;
            globalRow.alerta_retorno_resolvido = d.alerta_retorno_resolvido;
            globalRow.suite_sigla_risco = d.suite_sigla_risco;
        }
    }

    if (tr && alertaIcone) {
        const html = montarAlertaIconeHTML(d);
        alertaIcone.innerHTML = html;
        alertaIcone.style.display = html ? 'inline' : 'none';
        tr.classList.toggle('tr-alerta-pre-diligencia', d.alerta_pre_diligencia);
    }

    atualizarBadgeAbaAprovados();
}

// Contador de alerta exibido no botão da aba "Aprovados"
function atualizarBadgeAbaAprovados() {
    const qtd = (window.allData || []).filter(d => d.alerta_pre_diligencia).length;

    const badge = document.getElementById('badge-alerta-aprovados');
    if (badge) {
        const contador = badge.querySelector('span');
        if (qtd > 0) {
            if (contador) contador.textContent = qtd > 9 ? '9+' : String(qtd);
            badge.title = `${qtd} processo(s) aprovado(s) já tramitando em setor de risco (DIFOR/GEFOE/DIRED/GEDOP) — provável retorno para diligência`;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }

    const contadorFiltro = document.getElementById('contador-filtro-alerta');
    if (contadorFiltro) contadorFiltro.textContent = String(qtd);

    // Se o filtro estava ativo e o alerta zerou (ex.: processo saiu do setor de risco), desliga sozinho
    if (qtd === 0 && window.filtroSomenteAlertaDiligencia) {
        window.filtroSomenteAlertaDiligencia = false;
        const btnFiltroAlerta = document.getElementById('btn-filtro-alerta-diligencia');
        if (btnFiltroAlerta) btnFiltroAlerta.classList.remove('active');
        if (window.currentProcessesTab === 'aprovados' && typeof updateReuniao === 'function') updateReuniao();
    }

    atualizarVisibilidadeBtnFiltroAlerta();
}

// O botão só aparece na aba Aprovados e apenas quando existe ao menos 1 processo com alerta
function atualizarVisibilidadeBtnFiltroAlerta() {
    const btnFiltroAlerta = document.getElementById('btn-filtro-alerta-diligencia');
    if (!btnFiltroAlerta) return;
    const qtd = (window.allData || []).filter(d => d.alerta_pre_diligencia).length;
    const deveMostrar = window.currentProcessesTab === 'aprovados' && qtd > 0;
    btnFiltroAlerta.style.display = deveMostrar ? 'flex' : 'none';
}

function montarHistoricoAlertaRetornoHTML(lista) {
    if (!lista || lista.length === 0) {
        return '<em class="text-muted">Nenhum comentário registrado ainda.</em>';
    }
    return lista.map(reg => {
        const dt = new Date(reg.created_at).toLocaleString('pt-BR');
        return `
            <div class="mb-2 pb-2 border-bottom border-light">
                <div class="d-flex justify-content-between">
                    <span class="fw-bold text-dark">${escapeHTML(reg.sigla)}</span>
                    <span class="text-muted" style="font-size: 0.7rem;">${dt}</span>
                </div>
                <div>${escapeHTML(reg.comentario)}</div>
                <div class="text-muted" style="font-size: 0.7rem;">${escapeHTML(reg.autor_nome || '')}</div>
            </div>
        `;
    }).join('');
}

async function abrirModalAlertaRetorno(processoStr) {
    const d = (window.allData || []).find(x => x.processo === processoStr);
    if (!d) { alert('Erro: processo não localizado.'); return; }

    document.getElementById('alerta_processo_id').value = d.id || '';
    document.getElementById('alerta_processo_nup').value = d.processo || '';
    document.getElementById('alerta_processo_label').textContent = d.processo || '';
    document.getElementById('alerta_sigla_atual').textContent = d.suite_sigla_risco || 'setor de risco';
    document.getElementById('alerta_novo_comentario').value = '';

    const podeEscrever = typeof canSeeProcessActions === 'function' && canSeeProcessActions();
    document.getElementById('alerta_form_novo_comentario').style.display = podeEscrever ? '' : 'none';
    document.getElementById('btn-salvar-alerta-retorno').style.display = podeEscrever ? '' : 'none';

    const elHistorico = document.getElementById('alerta_historico');
    elHistorico.innerHTML = '<em class="text-muted">Carregando histórico...</em>';

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalAlertaRetorno')).show();

    try {
        const { data, error } = await sbClient
            .from('alerta_retorno_comentarios')
            .select('*')
            .eq('processo_id', String(d.id))
            .order('created_at', { ascending: false });
        if (error) throw error;
        elHistorico.innerHTML = montarHistoricoAlertaRetornoHTML(data);
    } catch (err) {
        console.error('Erro ao carregar histórico do alerta de retorno:', err);
        elHistorico.innerHTML = '<em class="text-danger">Erro ao carregar histórico.</em>';
    }
}

async function salvarAlertaRetornoComentario() {
    const processoNup = document.getElementById('alerta_processo_nup').value;
    const processoId = document.getElementById('alerta_processo_id').value;
    const textarea = document.getElementById('alerta_novo_comentario');
    const comentario = textarea.value.trim();

    if (!comentario) {
        alert('Escreva um comentário antes de salvar.');
        textarea.focus();
        return;
    }

    const d = (window.allData || []).find(x => x.processo === processoNup);
    if (!d) { alert('Erro: processo não localizado.'); return; }

    const payload = {
        processo_id: String(processoId),
        processo_nup: processoNup,
        sigla: d.suite_sigla_risco || 'DESCONHECIDA',
        comentario: comentario,
        autor_nome: sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido',
        autor_email: getCurrentUserEmail()
    };

    const btn = document.getElementById('btn-salvar-alerta-retorno');
    btn.disabled = true;
    btn.innerHTML = 'SALVANDO...';

    const { data, error } = await sbClient.from('alerta_retorno_comentarios').insert([payload]).select().single();

    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check-circle me-1"></i> Registrar Comentário';

    if (error) {
        alert('Erro ao salvar comentário: ' + error.message);
        return;
    }

    d.alertaRetornoUltimo = data;
    textarea.value = '';

    const tr = document.querySelector(`tr[data-numero="${escapeHTML(processoNup)}"]`);
    const alertaIcone = tr ? tr.querySelector('.alerta-icone') : null;
    aplicarAlertaPreDiligencia(d, tr, alertaIcone, d.suite_sigla_risco, d.status);

    const elHistorico = document.getElementById('alerta_historico');
    try {
        const { data: historico, error: errHist } = await sbClient
            .from('alerta_retorno_comentarios')
            .select('*')
            .eq('processo_id', String(processoId))
            .order('created_at', { ascending: false });
        if (errHist) throw errHist;
        elHistorico.innerHTML = montarHistoricoAlertaRetornoHTML(historico);
    } catch (err) {
        console.error('Erro ao recarregar histórico do alerta de retorno:', err);
    }

    alert('Comentário registrado com sucesso!');
}

// Varredura em segundo plano: verifica TODOS os processos APROVADO no SUITE, mesmo que a
// aba "Aprovados" não esteja aberta na tela, para que o alerta apareça antes de o usuário
// precisar navegar até lá. Lê a sigla direto de window.allData (sem chamadas de rede).
let varreduraDiligenciaEmAndamento = false;
async function varrerRiscoDiligenciaSegundoPlano() {
    if (varreduraDiligenciaEmAndamento) return;
    varreduraDiligenciaEmAndamento = true;
    try {
        const candidatos = (window.allData || []).filter(d => (d.status || '').toString().toUpperCase().trim() === 'APROVADO');
        if (!candidatos.length) return;

        const trPorNumero = new Map();
        document.querySelectorAll('tr[data-numero]').forEach(tr => {
            trPorNumero.set(tr.getAttribute('data-numero'), tr);
        });

        // Lê a sigla já vinda da tabela `processos` (mantida pelo job central sincronizar-suite).
        // Zero chamadas à Edge Function.
        candidatos.forEach(d => {
            const sigla = d.suite ? String(d.suite).toUpperCase().trim() : null;
            if (!sigla) return;
            const tr = trPorNumero.get(d.processo);
            const alertaIcone = tr ? tr.querySelector('.alerta-icone') : null;
            aplicarAlertaPreDiligencia(d, tr, alertaIcone, sigla, d.status);
        });
    } catch (e) {
        console.error('[Alerta Pré-Diligência] erro na varredura:', e);
    } finally {
        varreduraDiligenciaEmAndamento = false;
    }
}

function iniciarVarreduraRiscoDiligencia() {
    varrerRiscoDiligenciaSegundoPlano();
    // Polling removido: a sigla do SUITE vem da tabela `processos`, atualizada pelo
    // job central sincronizar-suite. Sem chamadas à Edge Function no cliente.
}

// NOTE: Supabase client initialization moved to database.js (loaded before main.js)

window.dynamicUsers = [];

async function carregarListaFiscais() {
    try {
        // Mescla duas fontes vindas do banco: os usuários do sistema (app_users) e os
        // nomes distintos das comissões de fiscalização dos contratos SOP
        // (comissao_fiscalizacao) — para que o dropdown de Fiscal reflita quem de fato
        // fiscaliza as obras, sem depender de nenhuma lista fixa no código.
        const [usersRes, comissaoRes] = await Promise.all([
            sbClient.from('app_users').select('nome, sobrenome, full_name'),
            sbClient.from('comissao_fiscalizacao').select('nome_completo, nome_referencia')
        ]);

        let dbUsers = [];
        if (usersRes.data) {
            dbUsers = usersRes.data.map(u => (u.full_name || `${u.nome || ''} ${u.sobrenome || ''}`).trim().toUpperCase()).filter(n => n);
        }

        let dbComissao = [];
        if (comissaoRes.data) {
            dbComissao = comissaoRes.data.map(m => (m.nome_completo || m.nome_referencia || '').trim().toUpperCase()).filter(n => n);
        }

        const combined = colapsarVariantesFiscais(mesclarDuplicatasPorAcento([...dbUsers, ...dbComissao]));

        // Ordenação alfabética robusta que lida com caracteres latinos e acentuações do português
        combined.sort((a, b) => a.localeCompare(b, 'pt-BR'));

        window.dynamicUsers = combined;
        atualizarDropdownsFiscais();
    } catch (e) {
        console.error('Erro carregarListaFiscais:', e);
    }
}

function normalizarNomeFiscal(nome) {
    return (nome || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

// Funde entradas que representam o mesmo fiscal mas vieram de tabelas diferentes com/sem
// acentuação — ex.: "AGABE SOUSA LINHARES" (app_users, sem acento) e "ÁGABE SOUSA LINHARES"
// (comissao_fiscalizacao, com acento) normalizam para a mesma chave e não podem virar duas
// opções no dropdown. Entre as variantes de uma mesma chave, mantém a que tem acentuação
// (grafia mais correta em português).
function mesclarDuplicatasPorAcento(lista) {
    const porChave = new Map();
    lista.forEach(nome => {
        if (!nome) return;
        const chave = normalizarNomeFiscal(nome);
        const atual = porChave.get(chave);
        const nomeTemAcento = normalizarNomeFiscal(nome) !== nome;
        const atualTemAcento = atual ? normalizarNomeFiscal(atual) !== atual : false;
        if (!atual || (nomeTemAcento && !atualTemAcento)) porChave.set(chave, nome);
    });
    return [...porChave.values()];
}

// Colapsa variações do "mesmo" fiscal vindas de fontes diferentes — ex.: "DIEGO DEMÉTRIO"
// (nome curto vindo de app_users) e "DIEGO DEMÉTRIO TORRES" (nome completo vindo de
// comissao_fiscalizacao) apareciam como duas entradas distintas no dropdown.
// Heurística conservadora: descarta a variante mais curta só quando todos os seus tokens
// aparecem, na mesma ordem, dentro de uma variante mais longa já mantida E o primeiro nome
// bate — assim nomes diferentes que só compartilham o primeiro nome não são fundidos.
function colapsarVariantesFiscais(lista) {
    const tokensDe = nome => normalizarNomeFiscal(nome).split(' ').filter(Boolean);
    const ordenada = [...lista].sort((a, b) => b.length - a.length);
    const mantidos = [];
    ordenada.forEach(nome => {
        const tokensAtual = tokensDe(nome);
        const eVariacaoDeAlgumMantido = mantidos.some(mantidoNome => {
            const tokensMantido = tokensDe(mantidoNome);
            if (tokensAtual.length >= tokensMantido.length || tokensAtual[0] !== tokensMantido[0]) return false;
            let i = 0;
            tokensMantido.forEach(tok => { if (tok === tokensAtual[i]) i++; });
            return i === tokensAtual.length;
        });
        if (!eVariacaoDeAlgumMantido) mantidos.push(nome);
    });
    return mantidos;
}

// --- INTEGRAÇÃO COM CONTRATOS SOP (SIGSOP) — busca de obra por código para autopreencher o cadastro ---

// Classifica o "tipo" de um integrante da comissão de fiscalização, mesma hierarquia
// usada no Mapa de Obras (assets/js/mapa-obras.js:classifyComissao) para decidir quem
// aparece como "o fiscal" quando a comissão tem mais de um integrante:
// Presidente > Fiscal > 1º/2º/3º Membro > Suplente.
function classifyComissaoProcesso(tipoRaw) {
    const norm = (tipoRaw || '').toString().normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (norm.includes('PRESIDENTE')) return { label: 'PRESIDENTE', rank: 6 };
    if (norm.includes('FISCAL')) return { label: 'FISCAL', rank: 5 };
    // Precisa vir antes dos testes de dígito: "1º Suplente" contém "1", então SUPLENTE
    // tem que ser checado primeiro — senão seria classificado como titular "1º Membro".
    if (norm.includes('SUPLENTE')) return { label: 'SUPLENTE', rank: 1 };
    if (norm.includes('1') || norm.includes('PRIMEIRO')) return { label: '1º MEMBRO', rank: 4 };
    if (norm.includes('2') || norm.includes('SEGUNDO')) return { label: '2º MEMBRO', rank: 3 };
    if (norm.includes('3') || norm.includes('TERCEIRO')) return { label: '3º MEMBRO', rank: 2 };
    if (norm.includes('MEMBRO')) return { label: 'MEMBRO', rank: 0 };
    return { label: tipoRaw ? String(tipoRaw).toUpperCase() : 'MEMBRO', rank: -1 };
}

// Busca uma obra em contratos_edificacao pelo Código da Obra e sua comissão de
// fiscalização em comissao_fiscalizacao, para pré-preencher o cadastro/vínculo de
// processos. Nunca lança: quem chama trata { encontrado:false } como "não achou, segue
// manual" — código não encontrado nunca deve bloquear o cadastro do processo.
async function buscarObraPorCodigo(codigo) {
    const cod = (codigo || '').trim();
    if (!cod) return { encontrado: false };
    try {
        const { data: obra, error } = await sbClient
            .from('contratos_edificacao')
            .select('id_obra, codigo_obra, descricao_obra, contratada, contratante, distrito_operacional, municipio')
            .eq('codigo_obra', cod)
            .maybeSingle();

        if (error || !obra) return { encontrado: false };

        let comissaoCompleta = [];
        if (obra.id_obra != null) {
            const { data: comissao, error: errCom } = await sbClient
                .from('comissao_fiscalizacao')
                .select('nome_completo, nome_referencia, tipo')
                .eq('id_obra', obra.id_obra);
            if (!errCom && comissao) {
                comissaoCompleta = comissao
                    .map(m => ({ nome: (m.nome_completo || m.nome_referencia || '').trim(), ...classifyComissaoProcesso(m.tipo) }))
                    .filter(m => m.nome)
                    .sort((a, b) => b.rank - a.rank);
            }
        }

        return {
            encontrado: true,
            descricao_obra: obra.descricao_obra || '',
            contratante: obra.contratante || '',
            contratada: obra.contratada || '',
            distrito_operacional: obra.distrito_operacional || '',
            municipio: obra.municipio || '',
            fiscalSugerido: comissaoCompleta[0] ? comissaoCompleta[0].nome : '',
            comissaoCompleta
        };
    } catch (e) {
        console.error('[ERRO] buscarObraPorCodigo:', e);
        return { encontrado: false };
    }
}

// Garante que `nome` exista como <option> do select de Fiscal (adiciona se vier de uma
// comissão e ainda não constar na lista carregada) e o seleciona.
function garantirOpcaoFiscal(selectEl, nome) {
    if (!selectEl || !nome) return;
    const jaExiste = Array.from(selectEl.options).some(o => o.value === nome);
    if (!jaExiste) {
        const opt = document.createElement('option');
        opt.value = nome; opt.textContent = nome;
        selectEl.appendChild(opt);
    }
    selectEl.value = nome;
}

// Monta os botões da comissão completa (mostrados quando há mais de 1 integrante), para
// o usuário poder trocar o Fiscal sugerido (1º da hierarquia) por outro nome da comissão.
// O primeiro (rank mais alto) já nasce marcado como selecionado, pois é quem
// garantirOpcaoFiscal já deixou selecionado no campo Fiscal Responsável.
function montarListaComissaoHTML(comissaoCompleta, onClickFnName) {
    return comissaoCompleta.map((m, idx) =>
        `<button type="button" class="btn btn-sm ${idx === 0 ? 'btn-outline-primary' : 'btn-outline-secondary'}" onclick="${onClickFnName}(this, '${escapeHTML(m.nome).replace(/'/g, "\\'")}')">${escapeHTML(m.label)}: ${escapeHTML(m.nome)}</button>`
    ).join('');
}

// --- Cadastro (NOVO PROCESSO): busca por Código da Obra ---
async function buscarObraCadastro() {
    const codigo = document.getElementById('cad_codigo_obra').value;
    const statusEl = document.getElementById('cad_obra_status');
    const wrapComissao = document.getElementById('cad_comissao_wrap');
    const listaComissao = document.getElementById('cad_comissao_lista');
    const btn = document.getElementById('btn-buscar-obra');

    if (!codigo || !codigo.trim()) {
        statusEl.className = 'form-text text-muted';
        statusEl.textContent = 'Informe o Código da Obra para buscar.';
        return;
    }

    btn.disabled = true;
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    const resultado = await buscarObraPorCodigo(codigo);

    btn.disabled = false;
    btn.innerHTML = textoOriginal;

    if (!resultado.encontrado) {
        statusEl.className = 'form-text text-warning';
        statusEl.textContent = 'Código não encontrado na base de contratos — preencha os campos manualmente.';
        wrapComissao.style.display = 'none';
        return;
    }

    document.getElementById('cad_descricao').value = resultado.descricao_obra;
    document.getElementById('cad_contratante').value = resultado.contratante;
    document.getElementById('cad_contratada').value = resultado.contratada;
    document.getElementById('cad_distrito').value = resultado.distrito_operacional;
    document.getElementById('cad_municipio').value = resultado.municipio;
    garantirOpcaoFiscal(document.getElementById('cad-fiscal'), resultado.fiscalSugerido);

    const descCurta = (resultado.descricao_obra || '').slice(0, 80);
    statusEl.className = 'form-text text-success';
    statusEl.textContent = `Obra encontrada: ${descCurta}${(resultado.descricao_obra || '').length > 80 ? '…' : ''}`;

    if (resultado.comissaoCompleta.length > 1) {
        listaComissao.innerHTML = montarListaComissaoHTML(resultado.comissaoCompleta, 'selecionarFiscalCadastro');
        wrapComissao.style.display = '';
    } else {
        wrapComissao.style.display = 'none';
    }
}

function selecionarFiscalCadastro(btnEl, nome) {
    garantirOpcaoFiscal(document.getElementById('cad-fiscal'), nome);
    // Marcação sutil de qual integrante está selecionado: o botão clicado troca para o
    // mesmo estilo outline-primary usado no resto do app, os demais voltam a secondary.
    if (btnEl && btnEl.parentElement) {
        btnEl.parentElement.querySelectorAll('button').forEach(b => {
            b.classList.remove('btn-outline-primary');
            b.classList.add('btn-outline-secondary');
        });
        btnEl.classList.remove('btn-outline-secondary');
        btnEl.classList.add('btn-outline-primary');
    }
}

// --- Gerenciar Processo: vincular/atualizar obra de um processo já cadastrado (admin) ---
async function buscarObraDetalhes() {
    const codigo = document.getElementById('det_codigo_obra').value;
    const statusEl = document.getElementById('det_obra_status');

    if (!codigo || !codigo.trim()) {
        statusEl.className = 'form-text text-muted';
        statusEl.textContent = 'Informe o Código da Obra para vincular.';
        return;
    }

    const btn = document.getElementById('btn-vincular-obra');
    btn.disabled = true;
    const textoOriginal = btn.innerHTML;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';

    const resultado = await buscarObraPorCodigo(codigo);

    btn.disabled = false;
    btn.innerHTML = textoOriginal;

    if (!resultado.encontrado) {
        statusEl.className = 'form-text text-warning';
        statusEl.textContent = 'Código não encontrado na base de contratos.';
        return;
    }

    document.getElementById('det_descricao').value = resultado.descricao_obra;
    document.getElementById('det_contratante').value = resultado.contratante;
    document.getElementById('det_contratada').value = resultado.contratada;
    document.getElementById('det_distrito').value = resultado.distrito_operacional;
    document.getElementById('det_municipio').value = resultado.municipio;
    garantirOpcaoFiscal(document.getElementById('det_fiscal'), resultado.fiscalSugerido);

    statusEl.className = 'form-text text-success';
    statusEl.textContent = 'Obra encontrada — revise os campos e clique em "Salvar Alterações" para confirmar o vínculo.';
}

// --- LIMPAR ARQUIVOS DE COMENTÁRIOS RESOLVIDOS ---
async function limparArquivosComentariosResolvidos(table, storageBucket, comentarios) {
    if (!comentarios || !Array.isArray(comentarios)) return;

    const arquivosParaDeletar = [];

    for (const comentario of comentarios) {
        // Só deleta arquivos de comentários que foram resolvidos (atendidos ou recusados)
        if (comentario.arquivo && (comentario.decisao === 'atendido' || comentario.decisao === 'recusado')) {
            const path = extrairPathDoStorage(comentario.arquivo);
            if (path) {
                arquivosParaDeletar.push(path);
            }
        }
    }

    if (arquivosParaDeletar.length > 0) {
        try {
            console.log(`Deletando ${arquivosParaDeletar.length} arquivos de comentários resolvidos...`);
            const { error } = await sbClient.storage.from(storageBucket).remove(arquivosParaDeletar);
            if (error) {
                console.error('Erro ao deletar arquivos:', error);
            } else {
                console.log('Arquivos deletados com sucesso');
            }
        } catch (err) {
            console.error('Erro ao limpar arquivos:', err);
        }
    }
}

// --- LISTENERS GLOBAIS REMOVIDOS (CONSOLIDADO NO DOMCONTENTLOADED) ---

function atualizarDropdownsFiscais() {
    // Atualiza apenas dropdowns estáticos que precisam ser populados logo após o carregamento
    // Modais como 'share-user-select' ou 'coment-fiscal' são populados ao abrir, usando window.dynamicUsers atualizada
    const ids = ['cad-fiscal', 'det_fiscal'];

    ids.forEach(id => {
        const sel = document.getElementById(id);
        if (sel) {
            const valAtual = sel.value;
            // Limpa mantendo a primeira opção (Selecione...)
            const firstOpt = sel.options[0];
            sel.innerHTML = '';
            if (firstOpt) sel.appendChild(firstOpt);

            window.dynamicUsers.forEach(f => {
                const opt = document.createElement('option');
                opt.value = f; opt.textContent = f; sel.appendChild(opt);
            });

            // Se o valor atualmente selecionado não estiver mais na lista (ex.: era uma
            // variante de nome que colapsarVariantesFiscais descartou), preserva-o como
            // opção extra em vez de deixar o select cair silenciosamente em branco.
            if (valAtual) garantirOpcaoFiscal(sel, valAtual);
        }
    });
}

// --- FUNO: ENCONTRAR FISCAL NA LISTA (MATCHING INTELIGENTE) ---
function findFiscalNameInList(nomeCompleto) {
    if (!nomeCompleto || nomeCompleto.trim() === '') return null;

    const normalizar = (str) => {
        return str
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove acentos
            .replace(/[\s\.\-]+/g, ' '); // Normaliza espaços e hífens
    };

    const inputNormal = normalizar(nomeCompleto);

    // 1. Procura exata (depois de normalizar)
    for (const fiscal of window.dynamicUsers) {
        if (normalizar(fiscal) === inputNormal) {
            console.log('[MATCH-1 EXATO]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    // 2. Procura por partes: todos os nomes do input devem estar no fiscal
    const partes = inputNormal.split(/\s+/).filter(p => p.length > 0);
    for (const fiscal of window.dynamicUsers) {
        const fiscalNormal = normalizar(fiscal);
        if (partes.every(parte => fiscalNormal.includes(parte))) {
            console.log('[MATCH-2 PALAVRAS]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    // 3. Procura reversa: todos os nomes do fiscal devem estar no input
    for (const fiscal of window.dynamicUsers) {
        const fiscalNormal = normalizar(fiscal);
        const partesFiscal = fiscalNormal.split(/\s+/).filter(p => p.length > 0);
        if (partesFiscal.every(parte => inputNormal.includes(parte))) {
            console.log('[MATCH-3 REVERSO]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    // 4. Procura por iniciais: se o input começa com as iniciais do fiscal
    const iniciaisInput = partes.map(p => p[0]).join('');
    for (const fiscal of window.dynamicUsers) {
        const fiscalNormal = normalizar(fiscal);
        const partesFiscal = fiscalNormal.split(/\s+/).filter(p => p.length > 0);
        const iniciaisFiscal = partesFiscal.map(p => p[0]).join('');
        if (iniciaisInput === iniciaisFiscal && inputNormal.length < fiscalNormal.length) {
            console.log('[MATCH-4 INICIAIS]', nomeCompleto, '->', fiscal);
            return fiscal;
        }
    }

    console.log('[SEM MATCH]', nomeCompleto);
    return null;
}

window.allData = window.allData || [];
window.financeiroData = window.financeiroData || [];
let currentTabelaData = []; // Cache para recálculo de BDI/Desconto

// escapeHTML() é definida em utils.js (carregado antes deste arquivo) e exposta em
// window.escapeHTML — não redeclarar aqui para evitar duas cópias idênticas.

/**
 * Calcula de forma inteligente quantos dias o processo está no status atual.
 * Considera heurística de transição para dados legados (anteriores a 30/04/2026).
 */
function calcularDiasNoStatus(d) {
    if (!d) return 0;
    const getSafeDate = (val) => {
        if (val instanceof Date && !isNaN(val.getTime())) return val;
        if (!val) return null;
        const dateObj = new Date(val);
        return isNaN(dateObj.getTime()) ? null : dateObj;
    };

    let dStatus = getSafeDate(d.ultima_atualizacao) || getSafeDate(d.created_at) || new Date();
    const stNormalizado = (d.status || "").toString().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
    const ehFluxoAnalise = stNormalizado.includes("ANALISE") || stNormalizado.includes("AGUAR") || stNormalizado.includes("EM REANALISE") || stNormalizado.includes("FISCAL");

    if (ehFluxoAnalise) {
        const dEntrada = d.dataRecebimento || d.dataAbertura;
        const dataCorte = new Date('2026-04-30T00:00:00');
        if (dStatus < dataCorte && dEntrada && dEntrada instanceof Date && dEntrada.getTime() < dStatus.getTime()) {
            dStatus = dEntrada;
        }
    }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0); const dataRef = new Date(dStatus); dataRef.setHours(0, 0, 0, 0); return Math.round((hoje - dataRef) / (1000 * 60 * 60 * 24));
}

// --- FUNO DEBOUNCE (PERFORMANCE) ---
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        const context = this;
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(context, args), wait);
    };
}

// --- 3. CORE: CARREGAMENTO DE DADOS (READ) ---

function mapProcessoRow(r) {
    const dataAbertura = isoParaDate(r.data_abertura);
    const dataAprov = isoParaDate(r.data_aprovacao_gecope);
    let prazoDias = null;
    if (dataAbertura && dataAprov) {
        prazoDias = Math.round((dataAprov - dataAbertura) / (1000 * 60 * 60 * 24));
    }

    let nomeAnalista = r.analista;
    if (r.analista === "N") nomeAnalista = "Nildeno";
    else if (r.analista === "W") nomeAnalista = "Walace";
    else if (r.analista === "H") nomeAnalista = "Helder";
    else if (r.analista === "P") nomeAnalista = "Pedro";
    else if (r.analista === "F") nomeAnalista = "Felipe";
    else if (r.analista === "A") nomeAnalista = "Ada";

    return {
        id: r.id,
        processo: r.processo,
        status: r.status || "Não informado",
        tipo: r.tipo || "Não informado",
        descricao: r.descricao || "",
        fiscal: r.fiscal || "Não informado",
        contratada: r.contratada || "Não informado",
        contratante: r.contratante || "Não informado",
        codigoObra: r.codigo_obra || null,
        distritoOperacional: r.distrito_operacional || null,
        municipio: r.municipio || null,
        analista: r.analista,
        nomeAnalista: nomeAnalista,
        dataAbertura: dataAbertura,
        anoAbertura: dataAbertura ? dataAbertura.getFullYear() : null,
        mesAbertura: dataAbertura ? (dataAbertura.getMonth() + 1) : null,
        dataRecebimento: isoParaDate(r.data_recebimento),
        dataCompromissoFiscal: isoParaDate(r.data_compromisso_fiscal),
        dataAprovacao: dataAprov,
        dataDevolucaoCorrecoes: isoParaDate(r.data_devolucao_correcoes),
        prazoDias: prazoDias,
        acrescFiscal: Number(r.acresc_fiscal) || 0,
        supressFiscal: Number(r.supress_fiscal) || 0,
        repercFiscal: Number(r.reperc_fiscal) || 0,
        acrescGecope: Number(r.acresc_gecope) || 0,
        supressGecope: Number(r.supress_gecope) || 0,
        repercGecope: Number(r.reperc_gecope) || 0,
        prioritario: r.prioritario || false,
        avisoAtrasoEnviado: r.aviso_atraso_enviado || false,
        suite: r.suite || null,
        suite_data_chegada: r.suite_data_chegada || null,
        criador: r.criador,
        created_at: isoParaDate(r.created_at),
        atualizado_por: r.atualizado_por,
        ultima_atualizacao: isoParaDate(r.ultima_atualizacao),
        excluido_por: r.excluido_por,
        data_exclusao: r.data_exclusao
    };
}

async function carregarDadosSupabase() {
    const loader = document.getElementById("load-error");
    if (loader) loader.style.display = "none";

    let data = null, error = null;
    try {
        console.log('[DEBUG] Iniciando carregarDadosSupabase...');
        const response = await sbClient
            .from('processos')
            .select('*')
            .order('created_at', { ascending: false });

        data = response.data;
        error = response.error;

        if (error) throw new Error(`Tabela "processos" não acessível: ${error.message}`);
        if (!Array.isArray(data)) throw new Error('Tipo de dados inválido: esperado array');

        if (data.length > 0) {
            data = data.filter(d => d.status !== 'EXCLUÍDO' && d.status !== 'EXCLUIDO');
        }
    } catch (err) {
        console.error('[ERRO] Falha ao carregar dados:', err);
        if (loader) {
            loader.style.display = "block";
            loader.innerHTML = `<strong>Erro ao carregar dados:</strong><br><code>${err.message}</code>`;
        }
        return;
    }

    const userRole = (sessionStorage.getItem('sop_role') || 'guest').toString().trim().toLowerCase();
    const userEmail = sessionStorage.getItem('sop_user');
    const isFiscal = userRole === 'fiscal';

    if (isFiscal && userEmail) {
        try {
            let fiscalName = null;
            const { data: userData, error: userError } = await sbClient
                .from('app_users')
                .select('nome, sobrenome')
                .eq('email', userEmail)
                .single();

            if (!userError && userData && userData.nome) {
                fiscalName = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim().toUpperCase();
            }

            if (!fiscalName) {
                const namePart = userEmail.split('@')[0];
                fiscalName = namePart.replace(/\./g, ' ').toUpperCase();
            }

            sessionStorage.setItem('sop_fiscal_name', fiscalName);
        } catch (e) {
            console.error('Erro ao identificar nome do fiscal:', e);
        }
    }

    if (!Array.isArray(data)) return;

    window.allData = data.map(r => {
        const obj = mapProcessoRow(r);

        // Garantir que metas locais obsoletas sejam removidas
        try {
            const key = `meta:${r.processo}`;
            const st = (r.status || "").toString().toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const isAnaliseFiscal = st.includes("FISCAL") && st.includes("ANALIS");

            // Se o banco não tem meta ou o status atual não é Análise Fiscal,
            // removemos qualquer meta armazenada localmente para evitar persistência indevida.
            if (!r.data_compromisso_fiscal || !isAnaliseFiscal) {
                localStorage.removeItem(key);
                // sincroniza também o objeto em memória
                obj.dataCompromissoFiscal = null;
            }
        } catch (e) { /* noop */ }

        return obj;
    });

    // window.allData já foi atualizado acima; não é necessário reatribuir
    /* window.allData já foi atualizado acima */

    // Carrega o último comentário de justificativa do alerta de retorno de cada processo,
    // ANTES de qualquer polling do SUITE, para que aplicarAlertaPreDiligencia já saiba
    // se a situação atual já foi comentada ou não.
    await carregarAlertasRetornoComentarios();

    try {
        // Auto-estabelecer metas para processos em 'ANÁLISE FISCAL' sem meta
        try {
            const pendingMeta = [];
            for (const row of window.allData) {
                const st = (row.status || "").toString().toUpperCase();
                const isAnaliseFiscal = st.includes("ANÁLISE FISCAL") || (st.includes("ANALISE") && st.includes("FISCAL"));
                const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                let precisaRecalcular = false;
                if (isAnaliseFiscal && row.id) {
                    let base = null;
                    let dias = 20; // padrão para Análise
                    if (isReanalise) {
                        dias = 10;
                        base = row.dataDevolucaoCorrecoes || row.created_at || new Date();
                    } else {
                        dias = 20;
                        base = row.created_at || new Date();
                    }

                    const metaDate = calcularDataMeta(base, dias);
                    if (metaDate) {
                        // Se não tem meta, estabelece automaticamente
                        const isoAtual = row.dataCompromissoFiscal ? (row.dataCompromissoFiscal instanceof Date ? row.dataCompromissoFiscal.toISOString().substring(0, 10) : new Date(row.dataCompromissoFiscal).toISOString().substring(0, 10)) : null;

                        if (!isoAtual) {
                            precisaRecalcular = true;
                        }
                    }
                }

                if (precisaRecalcular) {
                    let base = null;
                    let dias = 20; // padrão para Análise
                    if (isReanalise) {
                        // Regra de Reanálise: Usar data de devolução para correção no cálculo da nova meta
                        dias = 10;
                        base = row.dataDevolucaoCorrecoes || row.created_at || new Date();
                    } else {
                        // Regra de Cadastro: Usar a data de cadastro no GECOPE (created_at)
                        dias = 20;
                        base = row.created_at || new Date();
                    }
                    const metaDate = calcularDataMeta(base, dias);
                    if (metaDate) {
                        const iso = metaDate.toISOString().substring(0, 10);
                        // Atualiza objeto em memória para UI imediata
                        row.dataCompromissoFiscal = isoParaDate(iso);
                        const baseDate = base instanceof Date ? base : new Date(base);
                        const est = baseDate.toISOString().substring(0, 10);
                        pendingMeta.push({ id: row.id, data_compromisso_fiscal: iso, registros: est });
                    }
                }
            }
            if (pendingMeta.length > 0) {
                // Persistir no banco (em paralelo)
                await Promise.all(pendingMeta.map(u => sbClient.from('processos').update({ data_compromisso_fiscal: u.data_compromisso_fiscal }).eq('id', u.id)));
                console.log(`[AutoMeta] metas automáticas salvas: ${pendingMeta.length}`);

                // Gravar histórico de metas em lote
                try {
                    const logs = pendingMeta.map(u => {
                        const row = window.allData.find(r => r.id === u.id);
                        const st = row ? (row.status || "").toString().toUpperCase() : "";
                        const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                        return {
                            processo_id: u.id,
                            registros: u.registros || u.data_estabelecimento,
                            dias_estipulados: isReanalise ? 10 : 20,
                            meta: u.data_compromisso_fiscal,
                            autor: 'Sistema'
                        };
                    });
                    await sbClient.from('historico_metas').insert(logs);
                } catch (errBatch) {
                    console.error('[AutoMeta] falha ao registrar lote no historico_metas:', errBatch);
                }
            }
        } catch (e) {
            console.error('[AutoMeta] falha ao estabelecer metas automáticas:', e);
        }

        await carregarDadosFinanceiro();

        populateAllTabFilters();
        renderLastUpdate();
        updateDashboard();
        // Não chamar clearFinanceiro() aqui: isso forçava "Todos" nos filtros do
        // Financeiro em toda recarga de dados (inclusive após criar/editar/excluir
        // qualquer processo em outra aba), descartando a seleção manual do usuário.
        // populateAllTabFilters() já popula/preserva os filtros; clearFinanceiro()
        // continua disponível só no botão explícito "Limpar filtros".
        updateFinanceiro();
        if (typeof carregarAtividadesResumoHome === 'function') carregarAtividadesResumoHome();
        iniciarVarreduraRiscoDiligencia();
    } catch (e) {
        console.error('Erro ao atualizar UI:', e);
    }
}

// --- 4. CORE: SALVAR NOVO PROCESSO (CREATE) ---
async function enviarParaPlanilha() {
    const form = document.getElementById('formCadastro');
    const btn = document.getElementById('btn-salvar');
    const msg = document.getElementById('msg-feedback');

    if (!form.checkValidity()) { form.reportValidity(); return; }

    const formData = new FormData(form);

    // Validações obrigatórias adicionais (campos essenciais)
    const requiredFields = [
        { key: 'PROCESSO N.', label: 'Número do Processo' },
        { key: 'STATUS', label: 'Status Inicial' },
        { key: 'TIPO', label: 'Tipologia' },
        { key: 'FISCAL', label: 'Fiscal Responsável' },
        { key: 'DESCRIÇÃO', label: 'Descrição do Objeto' },
        { key: 'CONTRATANTE', label: 'Contratante' },
        { key: 'CONTRATADA', label: 'Contratada' },
        { key: 'DATA DE ABERTURA', label: 'Data de Abertura' }
    ];

    for (const f of requiredFields) {
        const v = formData.get(f.key);
        if (!v || (typeof v === 'string' && v.trim() === '')) {
            alert(`Campo obrigatório: ${f.label}`);
            return;
        }
    }
    const numProcessoRaw = formData.get("PROCESSO N.");
    const numProcesso = numProcessoRaw ? numProcessoRaw.trim() : "";

    // 1. Validação de Formato Rigorosa (00000.000000/0000-00)
    const formatRegex = /^\d{5}\.\d{6}\/\d{4}-\d{2}$/;
    if (!formatRegex.test(numProcesso)) {
        alert("Formato inválido!\nO número deve seguir estritamente o padrão: 00000.000000/0000-00");
        return;
    }

    // 2. Verificação Local (Feedback Instantâneo)
    // Usando .trim() para evitar que falhas passadas (espaços no banco) mascarem duplicidade
    const numProcessoLimpo = numProcesso.replace(/\s+/g, "");
    const existeLocal = (window.allData || []).some(d => (d.processo || "").replace(/\s+/g, "") === numProcessoLimpo);
    if (existeLocal) {
        alert("Este número de processo já consta na lista local.");
        return;
    }

    // Salva texto/estado do botão
    btn.disabled = true;
    const btnTextoOriginal = btn.innerText;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> VERIFICANDO...';

    // 3. Verificação no Servidor (Garantia de Unicidade)
    try {
        const { data: dbCheck, error: checkError } = await sbClient
            .from('processos')
            .select('id')
            .like('processo', `${numProcesso}%`)
            .limit(1)
            .maybeSingle();

        if (checkError) {
            throw checkError; // Joga para o catch
        }

        if (dbCheck) {
            alert("ERRO CRÍTICO: Este processo já existe no banco de dados.");
            btn.disabled = false;
            btn.innerHTML = btnTextoOriginal;
            return;
        }

    } catch (err) {
        console.error("Erro ao verificar duplicidade:", err);
        alert("Erro de conexão/verificação. Tente novamente.");
        btn.disabled = false;
        btn.innerHTML = btnTextoOriginal;
        return;
    }

    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> SALVANDO...';

    const safeVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };

    const payload = {
        processo: numProcesso,
        tipo: formData.get("TIPO"),
        status: formData.get("STATUS"),
        descricao: formData.get("DESCRIÇÃO"),
        contratante: formData.get("CONTRATANTE"),
        contratada: formData.get("CONTRATADA"),
        fiscal: formData.get("FISCAL"),
        analista: formData.get("ANALISTA"),
        codigo_obra: safeVal('cad_codigo_obra').trim() || null,
        distrito_operacional: safeVal('cad_distrito').trim() || null,
        municipio: safeVal('cad_municipio').trim() || null,

        data_abertura: dataParaISO(formData.get("DATA DE ABERTURA")),
        data_recebimento: dataParaISO(formData.get("DATA RECEBIMENTO")),
        data_compromisso_fiscal: dataParaISO(formData.get("DATA COMPROMISSO FISCAL")),

        acresc_fiscal: parseMoneyInput(safeVal('acresc_fisc')),
        supress_fiscal: parseMoneyInput(safeVal('supress_fisc')),
        reperc_fiscal: parseMoneyInput(safeVal('reperc_fisc')),
        acresc_gecope: parseMoneyInput(safeVal('acresc_gec')),
        supress_gecope: parseMoneyInput(safeVal('supress_gec')),
        reperc_gecope: parseMoneyInput(safeVal('reperc_gec')),

        // Audit: Criação
        criador: sessionStorage.getItem('sop_user_name') || 'Sistema',
        ultima_atualizacao: new Date().toISOString()
    };

    // Nota: meta será estabelecida a partir do created_at retornado pelo banco
    // (ou data_devolucao_correcoes para reanálises). Não definimos meta antes do insert
    // para garantir que a base usada seja a data de cadastro persistida.

    let data = null; let error = null;
    try {
        if (!window.sbClient) throw new Error('Supabase client não inicializado');
        const res = await sbClient.from('processos').insert([payload]);
        data = res.data; error = res.error;
    } catch (e) {
        console.error('Erro ao inserir processo:', e);
        msg.style.display = 'block';
        msg.className = 'alert alert-danger mt-3';
        msg.innerHTML = `Erro ao salvar: ${e.message || e}`;
        btn.disabled = false;
        btn.innerHTML = 'SALVAR';
        return;
    }

    if (error) {
        console.error(error);
        msg.style.display = 'block';
        msg.className = 'alert alert-danger mt-3';
        msg.innerHTML = `Erro ao salvar: ${error.message}`;
        btn.disabled = false;
        btn.innerHTML = 'SALVAR';
    } else {
        msg.style.display = 'block';
        msg.className = 'alert alert-success mt-3';
        msg.innerHTML = ' Salvo com sucesso no Banco de Dados!';

        // Após inserir, calcular a meta a partir do created_at (ou data_devolucao_correcoes para reanálises)
        (async () => {
            try {
                const { data: pData, error: errP } = await sbClient.from('processos').select('id, data_devolucao_correcoes, created_at, status').eq('processo', numProcesso).maybeSingle();
                if (errP) throw errP;
                if (pData && pData.id) {
                    const st = (pData.status || '').toString().toUpperCase();
                    const isReanalise = st.includes('REANÁLISE') || st.includes('REANALISE') || st.includes('DEVOLVIDO');
                    const dias = isReanalise ? 10 : 20;
                    const baseStr = (isReanalise && pData.data_devolucao_correcoes) ? pData.data_devolucao_correcoes : pData.created_at;
                    const baseDate = baseStr ? isoParaDate(baseStr) : new Date();
                    const metaDate = calcularDataMeta(baseDate, dias);
                    if (metaDate) {
                        const iso = metaDate.toISOString().substring(0, 10);
                        // Atualiza processo com a meta correta calculada a partir do created_at
                        const { error: errUp } = await sbClient.from('processos').update({ data_compromisso_fiscal: iso }).eq('id', pData.id);
                        if (errUp) console.error('[ERRO] Falha ao atualizar processo com meta calculada:', errUp.message);

                        // Inserir histórico de metas registrando o 'registro' (data da base) e dias
                        const est = baseDate.toISOString().substring(0, 10);
                        const { error: errHist } = await sbClient.from('historico_metas').insert([{
                            processo_id: pData.id,
                            registros: est,
                            dias_estipulados: dias,
                            meta: iso,
                            autor: 'Sistema'
                        }]);
                        if (errHist) console.error('[ERRO] Falha ao registrar log de meta inicial:', errHist.message);
                    }
                }
            } catch (e) {
                console.error('[ERRO] Ao calcular/gravar meta pós-inserção:', e);
            }
        })();

        // Log de Atividade
        registrarAtividade('PROCESSO', `cadastrou o processo Nº ${numProcesso}`, numProcesso, formData.get("DESCRIÇÃO"), formData.get("FISCAL"));

        // Notificação WhatsApp (Apenas se entrar em Análise Fiscal)
        const statusInicial = formData.get("STATUS");

        // Fecha a brecha do cadastro: se o processo já nasce em AGUAR. APROVAÇÃO,
        // localiza o id recém-criado para abrir o checklist de documentação logo em seguida
        let processoIdRecemCriado = null;
        if (statusInicial === 'AGUAR. APROVAÇÃO') {
            try {
                const { data: pRow, error: errRow } = await sbClient.from('processos').select('id').eq('processo', numProcesso).maybeSingle();
                if (!errRow && pRow) processoIdRecemCriado = pRow.id;
            } catch (e) {
                console.error('[ERRO] Ao localizar processo recém-criado para o checklist:', e);
            }
        }

        if (statusInicial === 'ANÁLISE FISCAL') {
            const metaFormatada = payload.data_compromisso_fiscal ? payload.data_compromisso_fiscal.split('-').reverse().join('/') : 'Não definida';
            processarNotificacao('novo_processo', {
                NOME_FISCAL: formData.get("FISCAL") || 'Fiscal',
                NUP_PROCESSO: numProcesso,
                NOME_OBRA: formData.get("DESCRIÇÃO") || 'Obra não informada',
                DATA_META: metaFormatada
            });
        }

        // Notificação para Analistas Específicos
        const analistasAlvo = ['NILDENO', 'HELDER', 'FELIPE', 'WALACE', 'PEDRO', 'ADA'];

        let analistaExtenso = formData.get("ANALISTA") || "";
        if (analistaExtenso === "N") analistaExtenso = "Nildeno";
        else if (analistaExtenso === "W") analistaExtenso = "Walace";
        else if (analistaExtenso === "P") analistaExtenso = "Pedro";
        else if (analistaExtenso === "F") analistaExtenso = "Felipe";
        else if (analistaExtenso === "H") analistaExtenso = "Helder";
        else if (analistaExtenso === "A") analistaExtenso = "Ada";

        const analistaNome = analistaExtenso.toUpperCase();
        const usuarioAtual = (sessionStorage.getItem('sop_user_name') || "").toUpperCase();

        // Dispara se for um dos alvos e não for auto-atribuição
        if (analistasAlvo.some(alvo => analistaNome.includes(alvo))) {
            const ehAutoAtribuicao = usuarioAtual && (analistaNome.includes(usuarioAtual) || usuarioAtual.includes(analistaNome));

            if (!ehAutoAtribuicao) {
                processarNotificacao('analista_designado', {
                    ANALISTA: analistaNome,
                    NUP_PROCESSO: numProcesso,
                    NOME_OBRA: formData.get("DESCRIÇÃO") || 'Obra não informada',
                    NOVO_STATUS: 'Em Análise'
                });
            }
        }

        setTimeout(() => {
            const modal = bootstrap.Modal.getInstance(document.getElementById('modalCadastro'));
            if (modal) modal.hide();
            form.reset();
            msg.style.display = 'none';
            btn.disabled = false;
            btn.innerHTML = 'SALVAR';
            const elObraStatus = document.getElementById('cad_obra_status');
            if (elObraStatus) elObraStatus.textContent = '';
            const elComissaoWrap = document.getElementById('cad_comissao_wrap');
            if (elComissaoWrap) elComissaoWrap.style.display = 'none';
            carregarDadosSupabase();

            if (processoIdRecemCriado) {
                checklistAditivoState = {
                    processoStr: numProcesso,
                    processoId: processoIdRecemCriado,
                    descricao: formData.get("DESCRIÇÃO") || "",
                    sessionFinalized: false,
                    latestChecklist: null
                };
                abrirModalChecklistAditivo();
            }
        }, 1500);
    }
}

// --- 5. CORE: DETALHES, ATUALIZAR E EXCLUIR ---

// Ativa uma das abas de GERENCIAR PROCESSO (Geral/Financeiro/Documental/Técnica/
// Histórico) via API de Tab do Bootstrap. Usado ao reabrir o modal (sempre começa
// em "Geral") e para levar o usuário até a aba certa quando a validação falha num
// campo que está numa aba não visível no momento.
function mostrarAbaGerenciarProcesso(tabBtnId) {
    const btn = document.getElementById(tabBtnId);
    if (btn && typeof bootstrap !== 'undefined' && bootstrap.Tab) {
        bootstrap.Tab.getOrCreateInstance(btn).show();
    }
}

// IDs das abas/painéis de GERENCIAR PROCESSO, na ordem em que aparecem.
const GP_TABS = [
    { btn: 'gp-tab-geral-btn', pane: 'gp-pane-geral' },
    { btn: 'gp-tab-documental-btn', pane: 'gp-pane-documental' },
    { btn: 'gp-tab-tecnica-btn', pane: 'gp-pane-tecnica' },
    { btn: 'gp-tab-historico-btn', pane: 'gp-pane-historico' }
];

// Volta para a aba "Geral" via manipulação direta de classes (sem passar pela API
// animada bootstrap.Tab.show()). É usada ANTES do modal.show(), com o modal ainda
// oculto (display:none) — nesse estado a transição CSS do Bootstrap nunca dispara um
// transitionend real, e o fallback por timeout do bootstrap.Tab pode terminar de
// aplicar as classes só depois do modal já estar visível, deixando por um instante
// (ou, em alguns casos, permanentemente) nenhuma aba marcada como ativa — e por isso
// nenhum conteúdo aparece. Setando as classes na hora, isso não pode acontecer.
function resetarAbasGerenciarProcesso() {
    GP_TABS.forEach((tab, i) => {
        const btn = document.getElementById(tab.btn);
        const pane = document.getElementById(tab.pane);
        if (btn) {
            btn.classList.toggle('active', i === 0);
            btn.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
        }
        if (pane) {
            pane.classList.toggle('active', i === 0);
            pane.classList.toggle('show', i === 0);
        }
    });
}

// Mostra/oculta o badge numérico no rótulo de uma aba (ex.: pendências/inconsistências).
function atualizarBadgeAba(elId, count) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (count > 0) {
        el.textContent = count;
        el.style.display = '';
    } else {
        el.style.display = 'none';
    }
}

async function abrirDetalhes(processoStr) {
    // garante que a role local esteja atualizada com o servidor
    await refreshUserRole();
    const row = (window.allData || []).find(d => d.processo === processoStr);
    if (!row) { alert("Erro: Dados não encontrados na memória."); return; }

    resetarAbasGerenciarProcesso();

    document.getElementById('det_processo').value = row.processo;
    document.getElementById('det_tipo').value = row.tipo;
    document.getElementById('det_status').value = row.status;
    aplicarCorStatusSelect(document.getElementById('det_status'));
    document.getElementById('det_descricao').value = row.descricao;

    // Reseta o estado da Curva ABC para este processo
    curvaAbcProcessoState = {
        processoStr: row.processo,
        processoId: row.id,
        descricao: row.descricao || "",
        vindoDoModal: false
    };

    // Reseta o estado do checklist de documentação para este processo
    checklistAditivoState = {
        processoStr: row.processo,
        processoId: row.id,
        descricao: row.descricao || "",
        sessionFinalized: false,
        latestChecklist: null
    };
    document.getElementById('det_contratante').value = row.contratante;
    document.getElementById('det_contratada').value = row.contratada;
    if (document.getElementById('det_codigo_obra')) document.getElementById('det_codigo_obra').value = row.codigoObra || '';
    if (document.getElementById('det_distrito')) document.getElementById('det_distrito').value = row.distritoOperacional || '';
    if (document.getElementById('det_municipio')) document.getElementById('det_municipio').value = row.municipio || '';
    if (document.getElementById('det_obra_status')) document.getElementById('det_obra_status').textContent = '';

    const selFiscal = document.getElementById('det_fiscal');
    if (selFiscal.options.length <= 1) {
        window.dynamicUsers.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f; opt.textContent = f; selFiscal.appendChild(opt);
        });
    }
    // "Não informado" é o fallback de exibição do mapProcessoRow para fiscal ausente, não
    // um nome real — não deve virar opção no select (ficaria com "Selecione..." em branco).
    if (row.fiscal && row.fiscal !== 'Não informado') garantirOpcaoFiscal(selFiscal, row.fiscal);

    document.getElementById('det_data_abertura').value = dateParaInput(row.dataAbertura);
    document.getElementById('det_data_compromisso').value = dateParaInput(row.dataCompromissoFiscal);
    document.getElementById('det_data_aprovacao').value = dateParaInput(row.dataAprovacao);
    if (document.getElementById('det_data_recebimento')) document.getElementById('det_data_recebimento').value = dateParaInput(row.dataRecebimento);
    if (document.getElementById('det_analista')) document.getElementById('det_analista').value = row.analista;

    const elDevolucao = document.getElementById('det_data_devolucao');
    if (elDevolucao) { elDevolucao.value = dateParaInput(row.dataDevolucaoCorrecoes); calcularDiasDevolucao(); }

    const toInputMoney = (val) => val.toLocaleString('pt-BR', { minimumFractionDigits: 2 });
    document.getElementById('det_acresc_f').value = toInputMoney(row.acrescFiscal);
    document.getElementById('det_supress_f').value = toInputMoney(row.supressFiscal);
    document.getElementById('det_reperc_f').value = toInputMoney(row.repercFiscal);
    document.getElementById('det_acresc_g').value = toInputMoney(row.acrescGecope);
    document.getElementById('det_supress_g').value = toInputMoney(row.supressGecope);
    document.getElementById('det_reperc_g').value = toInputMoney(row.repercGecope);

    // Garante que o cálculo seja refletido visualmente logo ao abrir
    setTimeout(() => { calcularRepercussao('det'); }, 50);

    // Determina se o usuário atual é admin a partir da role mais recente
    const isAdmin = (getCurrentUserRole() === 'admin');
    const inputs = document.querySelectorAll('#formDetalhes input, #formDetalhes select, #formDetalhes textarea');
    inputs.forEach(el => { el.disabled = !isAdmin; });
    // Botão "Vincular/Atualizar Obra" não é input/select/textarea, então precisa do
    // próprio gate — religar um processo legado a um contrato é uma correção de dados,
    // mesmo padrão de restrição a admin usado em excluirChecklistAditivo (contratos.js).
    const btnVincularObra = document.getElementById('btn-vincular-obra');
    if (btnVincularObra) btnVincularObra.disabled = !isAdmin;

    document.getElementById('msg-detalhes').style.display = 'none';
    document.getElementById('btn-atualizar').innerHTML = '<i class="bi bi-check-lg"></i> SALVAR ALTERAÇÕES';
    const btnExcluirModal = document.getElementById('btn-excluir');
    btnExcluirModal.innerHTML = '<i class="bi bi-trash-fill"></i> EXCLUIR PROCESSO';
    btnExcluirModal.disabled = false;

    // Audit Info Display
    const dtCriacao = row.created_at ? new Date(row.created_at).toLocaleString('pt-BR') : '';
    const txtCriador = row.criador || 'Não Registrado';
    document.getElementById('det_criador').textContent = dtCriacao ? `${txtCriador} em ${dtCriacao}` : txtCriador;

    let txtUpdate = 'Sem alterações recentes';
    if (row.atualizado_por) {
        const dt = row.ultima_atualizacao ? new Date(row.ultima_atualizacao).toLocaleString('pt-BR') : '';
        txtUpdate = `${row.atualizado_por} em ${dt}`;
    }
    document.getElementById('det_atualizacao').textContent = txtUpdate;

    // Buscar histórico de prioridades
    carregarHistoricoPrioridades(processoStr);

    // Buscar checklist de documentação do aditivo (resumo + histórico)
    carregarChecklistAditivo(processoStr, row.id);

    // Buscar Curva ABC do processo (resumo + versões anteriores)
    if (typeof carregarCurvaAbcResumo === 'function') carregarCurvaAbcResumo(processoStr, row.id);

    const modal = new bootstrap.Modal(document.getElementById('modalDetalhes'));
    modal.show();
}

async function carregarHistoricoPrioridades(processoStr) {
    const container = document.getElementById('det_historico_prioridade');
    if (!container) return;

    container.innerHTML = '<em class="text-muted">Carregando histórico...</em>';

    try {
        const { data, error } = await sbClient
            .from('app_atividades')
            .select('usuario, descricao, created_at')
            .eq('tipo', 'PROCESSO')
            .eq('contexto', processoStr)
            .ilike('descricao', '%prioritário%')
            .order('created_at', { ascending: false });

        if (error) throw error;

        if (!data || data.length === 0) {
            container.innerHTML = '<em class="text-muted">Nenhum registro de prioridade encontrado.</em>';
            return;
        }

        container.innerHTML = data.map(registro => {
            const dt = new Date(registro.created_at).toLocaleString('pt-BR');
            const desc = registro.descricao.toLowerCase();
            const isDesmarcar = desc.includes('desmarcou');
            const icon = !isDesmarcar ? '<i class="bi bi-star-fill text-warning me-1"></i>' : '<i class="bi bi-star text-secondary me-1"></i>';
            const actionText = !isDesmarcar ? 'Marcou como prioritário' : 'Desmarcou como prioritário';

            return `
                <div class="mb-2 pb-2 border-bottom border-light">
                    <div class="d-flex align-items-center mb-1">
                        ${icon} <span class="fw-bold text-dark">${escapeHTML(registro.usuario)}</span>
                    </div>
                    <div class="ps-3 text-muted" style="font-size: 0.65rem;">
                        ${actionText} em ${dt}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error("Erro ao carregar histórico de prioridades:", err);
        container.innerHTML = '<em class="text-danger">Erro ao carregar histórico.</em>';
    }
}

// Configuração dos itens Sim/Não do checklist (chave do radio -> coluna no banco)
const CHECKLIST_ADITIVO_ITENS = [
    { key: 'chk_planilha', campo: 'planilha_orcamentaria_validada', obsCampo: 'planilha_orcamentaria_obs', label: 'Planilha Orçamentária Validada', obrigatorio: 'sempre' },
    { key: 'chk_memoria', campo: 'memoria_calculo', obsCampo: 'memoria_calculo_obs', label: 'Memória de Cálculo', obrigatorio: 'sempre' },
    { key: 'chk_parecer', campo: 'parecer_tecnico', obsCampo: 'parecer_tecnico_obs', label: 'Parecer Técnico', obrigatorio: 'sempre' },
    { key: 'chk_art_fiscalizacao', campo: 'art_fiscalizacao', obsCampo: 'art_fiscalizacao_obs', label: 'ART de Fiscalização', obrigatorio: 'primeiro_aditivo' },
    { key: 'chk_art_execucao', campo: 'art_execucao', obsCampo: 'art_execucao_obs', label: 'ART de Execução', obrigatorio: 'primeiro_aditivo' },
    { key: 'chk_portaria', campo: 'portaria_fiscalizacao', obsCampo: 'portaria_fiscalizacao_obs', label: 'Portaria de Fiscalização', obrigatorio: 'primeiro_aditivo' },
    { key: 'chk_curva_abc', campo: 'curva_abc', obsCampo: 'curva_abc_obs', label: 'Curva ABC', obrigatorio: 'sempre' },
    // pendenciaSeNao: false -> "Não" aqui só significa que a Composição Própria não foi
    // aprovada neste aditivo (nada a providenciar), então não conta como pendência nem
    // gera a observação automática de documento indispensável.
    { key: 'chk_comp_propria', campo: 'composicao_propria', obsCampo: 'composicao_propria_obs', label: 'Composição Própria (CXXXX)', obrigatorio: 'sempre', pendenciaSeNao: false },
    // Sub-pergunta condicional: só é obrigatória (e só aparece no formulário) quando
    // composicao_propria = true — se não houve Composição Própria aprovada, não faz
    // sentido perguntar se as composições estão de forma analítica.
    { key: 'chk_comp_analiticas', campo: 'composicoes_analiticas', obsCampo: 'composicoes_analiticas_obs', label: 'Composições Analíticas', obrigatorio: 'comp_propria' },
    { key: 'chk_docs_assinados', campo: 'docs_assinados_fiscalizacao', obsCampo: 'docs_assinados_fiscalizacao_obs', label: 'Documentos assinados pela Fiscalização', obrigatorio: 'sempre' }
];

function onChangeStatusDetalhes(selectEl) {
    aplicarCorStatusSelect(selectEl);
    if (!selectEl || selectEl.value !== 'AGUAR. APROVAÇÃO') return;
    if (getCurrentUserRole() !== 'admin') return;
    // Só força a abertura (e o reset) do checklist quando ele realmente precisar ser
    // refeito — evita interromper/limpar o formulário à toa quando já existe um
    // checklist válido para o processo (ver checklistValidoParaSalvar).
    if (checklistValidoParaSalvar(selectEl.value)) return;
    checklistAditivoState.sessionFinalized = false;
    abrirModalChecklistAditivo();
}

// Mesma classificação de cor por status já usada nos badges da tabela de processos
// (ver render da tabela de metas/prazos), reaproveitada aqui para colorir o próprio
// <select> de Status dentro de GERENCIAR PROCESSO — dá pra reconhecer o status de
// relance, sem precisar ler o texto.
const GP_STATUS_BADGE_CLASSES = ['badge-status-devolvido', 'badge-status-diligencia', 'badge-status-contratante',
    'badge-status-dark-blue', 'badge-status-fiscal', 'badge-status-aguar-reanalise', 'badge-status-light-blue',
    'badge-status-em-reanalise', 'badge-status-em-analise', 'badge-status-aprovado', 'badge-status-arquivado'];

function classeBadgeStatus(statusRaw) {
    const stTxt = (statusRaw || '').toString().toUpperCase().trim();
    if (stTxt.includes('DEVOLVIDO')) return 'badge-status-devolvido';
    if (stTxt.includes('DILIG')) return 'badge-status-diligencia';
    if (stTxt.includes('CONTRATANTE')) return 'badge-status-contratante';
    if (stTxt.includes('APROVAÇÃO')) return 'badge-status-dark-blue';
    if (stTxt.includes('FISCAL') && (stTxt.includes('ANÁLISE') || stTxt.includes('ANALISE'))) return 'badge-status-fiscal';
    if (stTxt.includes('AGUAR')) return stTxt.includes('REAN') ? 'badge-status-aguar-reanalise' : 'badge-status-light-blue';
    if (stTxt.startsWith('EM') && stTxt.includes('REANÁLISE')) return 'badge-status-em-reanalise';
    if (stTxt.startsWith('EM') && (stTxt.includes('ANÁLISE') || stTxt.includes('ANALISE'))) return 'badge-status-em-analise';
    if (stTxt.includes('APROVADO') || stTxt === 'SEDUC') return 'badge-status-aprovado';
    if (stTxt.includes('ARQUIVADO')) return 'badge-status-arquivado';
    return '';
}

function aplicarCorStatusSelect(selectEl) {
    if (!selectEl) return;
    GP_STATUS_BADGE_CLASSES.forEach(c => selectEl.classList.remove(c));
    const cls = classeBadgeStatus(selectEl.value);
    if (cls) selectEl.classList.add(cls);
}

async function executarAcaoDetalhes(actionType) {
    const form = document.getElementById('formDetalhes');
    const processoNome = document.getElementById('det_processo').value;

    const registroOriginal = (window.allData || []).find(d => d.processo === processoNome);
    if (!registroOriginal || !registroOriginal.id) {
        alert("Erro crítico: ID do processo não localizado.");
        return;
    }
    const idUnico = registroOriginal.id;

    if (actionType === 'delete') {
        if (!confirm("TEM CERTEZA? O processo será movido para EXCLUÍDOS e sairá da lista principal.")) return;
        const btn = document.getElementById('btn-excluir');
        btn.innerHTML = "EXCLUINDO...";
        btn.disabled = true;

        // Soft Delete com Auditoria
        const userName = sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido';
        const updates = {
            status: 'EXCLUÍDO',
            excluido_por: userName,
            data_exclusao: new Date().toISOString()
        };

        const { error } = await sbClient.from('processos').update(updates).eq('id', idUnico);

        if (error) {
            alert("Erro ao excluir: " + error.message);
            btn.disabled = false;
        } else {
            alert("Excluído com sucesso!");
            bootstrap.Modal.getInstance(document.getElementById('modalDetalhes')).hide();
            carregarDadosSupabase();
        }
        return;
    }

    if (actionType === 'update') {
        // --- VALIDAÇÕES DE CAMPOS OBRIGATÓRIOS ---
        const camposObrigatorios = [
            { id: 'det_status', nome: 'Status Atual' },
            { id: 'det_tipo', nome: 'Tipologia' },
            { id: 'det_fiscal', nome: 'Fiscal Responsável', tab: 'gp-tab-geral-btn' },
            { id: 'det_descricao', nome: 'Descrição do Objeto', tab: 'gp-tab-geral-btn' },
            { id: 'det_contratante', nome: 'Contratante', tab: 'gp-tab-geral-btn' },
            { id: 'det_contratada', nome: 'Contratada', tab: 'gp-tab-geral-btn' }
        ];

        for (const campo of camposObrigatorios) {
            const el = document.getElementById(campo.id);
            if (!el || !el.value.trim()) {
                if (campo.tab) mostrarAbaGerenciarProcesso(campo.tab);
                alert(`O campo "${campo.nome}" é obrigatório.`);
                el.focus();
                return;
            }
        }

        const statusAtual = document.getElementById('det_status').value;

        // 2.1 Se o Status for AGUAR. ANÁLISE, o campo RECEBIMENTO deve estar preenchido
        if (statusAtual === 'AGUAR. ANÁLISE') {
            const valRecebimento = document.getElementById('det_data_recebimento').value.trim();
            if (!valRecebimento) {
                mostrarAbaGerenciarProcesso('gp-tab-geral-btn');
                alert("Para o status 'AGUAR. ANÁLISE', o campo 'Recebimento' é obrigatório.");
                document.getElementById('det_data_recebimento').focus();
                return;
            }
        }

        // 2.2 Se o Status for REANÁLISE FISCAL, o campo DEVOLUÇÃO PARA CORREÇÃO deve estar preenchido
        if (statusAtual === 'DEVOLVIDO P/ REANÁLISE FISCAL') {
            const valDevolucao = document.getElementById('det_data_devolucao').value.trim();
            if (!valDevolucao) {
                mostrarAbaGerenciarProcesso('gp-tab-geral-btn');
                alert("Para o status 'REANÁLISE FISCAL', o campo 'Devolução p/ Correções' é obrigatório.");
                document.getElementById('det_data_devolucao').focus();
                return;
            }
        }

        // 2.3 Se o Status for AGUAR. APROVAÇÃO ou APROVADO, ACRÉSCIMO, SUPRESSÃO e APROVAÇÃO GECOPE obrigatórios
        if (statusAtual === 'AGUAR. APROVAÇÃO' || statusAtual === 'APROVADO') {
            const valAcrescG = document.getElementById('det_acresc_g').value.trim();
            const valSupressG = document.getElementById('det_supress_g').value.trim();
            const valAprovacaoG = document.getElementById('det_data_aprovacao').value.trim();

            if (!valAcrescG || !valSupressG || !valAprovacaoG) {
                mostrarAbaGerenciarProcesso('gp-tab-geral-btn');
                alert(`Para o status "${statusAtual}", os campos de ACRÉSCIMO (GECOPE), SUPRESSÃO (GECOPE) e APROVAÇÃO GECOPE devem estar preenchidos.`);
                return;
            }
        }

        // 2.4 Checklist de Documentação do Aditivo obrigatório para AGUAR. APROVAÇÃO/APROVADO
        if (!checklistValidoParaSalvar(statusAtual)) {
            mostrarAbaGerenciarProcesso('gp-tab-documental-btn');
            alert('É obrigatório preencher o Checklist de Documentação do Aditivo antes de salvar o processo com este status.');
            abrirModalChecklistAditivo();
            return;
        }

        const formData = new FormData(form);

        const updates = {
            tipo: formData.get("TIPO"),
            status: formData.get("STATUS"),
            descricao: formData.get("DESCRIÇÃO"),
            fiscal: document.getElementById('det_fiscal').value,
            contratante: formData.get("CONTRATANTE"),
            contratada: formData.get("CONTRATADA"),
            analista: document.getElementById('det_analista').value,
            codigo_obra: document.getElementById('det_codigo_obra').value.trim() || null,
            distrito_operacional: document.getElementById('det_distrito').value.trim() || null,
            municipio: document.getElementById('det_municipio').value.trim() || null,

            data_abertura: dataParaISO(formData.get("DATA DE ABERTURA")),
            data_recebimento: dataParaISO(formData.get("DATA RECEBIMENTO")),
            data_compromisso_fiscal: dataParaISO(formData.get("DATA COMPROMISSO FISCAL")),
            data_aprovacao_gecope: dataParaISO(formData.get("DATA APROVAÇÃO GECOPE")),
            data_devolucao_correcoes: dataParaISO(formData.get("DATA DEVOLUO CORREES")),

            acresc_fiscal: parseMoneyInput(document.getElementById('det_acresc_f').value),
            supress_fiscal: parseMoneyInput(document.getElementById('det_supress_f').value),
            reperc_fiscal: parseMoneyInput(document.getElementById('det_reperc_f').value),
            acresc_gecope: parseMoneyInput(document.getElementById('det_acresc_g').value),
            supress_gecope: parseMoneyInput(document.getElementById('det_supress_g').value),
            reperc_gecope: parseMoneyInput(document.getElementById('det_reperc_g').value),

            // Audit: Atualização (Mantém o registro de quem mexeu por último)
            atualizado_por: sessionStorage.getItem('sop_user_name') || 'Usuário Desconhecido'
            // A data 'ultima_atualizacao' não é definida aqui para não resetar o contador de dias sem mudança de status
        };

        // NOVA LÓGICA: Recalcular metas automáticas se o status mudar ou se a data de devolução for alterada
        const novoStatus = (updates.status || registroOriginal.status || "").toString().trim().toUpperCase();
        const statusAntigo = (registroOriginal.status || "").toString().trim().toUpperCase();
        const dataDevNova = updates.data_devolucao_correcoes;
        const dataDevAntiga = registroOriginal.data_devolucao_correcoes || registroOriginal.dataDevolucaoCorrecoes ?
            (isoParaDate(registroOriginal.data_devolucao_correcoes || registroOriginal.dataDevolucaoCorrecoes).toISOString().substring(0, 10)) : null;

        const statusMudou = novoStatus && novoStatus !== statusAntigo;
        const dataDevMudou = dataDevNova && dataDevNova !== dataDevAntiga;

        if (statusMudou) {
            updates.ultima_atualizacao = new Date().toISOString(); // Reinicia o contador de dias se o status mudar

            // Mantém `status_pre_arquivamento` consistente também quando o arquivamento/
            // desarquivamento é feito manualmente por aqui (não só pelo job sincronizar-suite):
            // guarda de onde veio ao arquivar, limpa ao sair do arquivado.
            if (novoStatus === 'ARQUIVADO') {
                updates.status_pre_arquivamento = registroOriginal.status || null;
            } else if (statusAntigo === 'ARQUIVADO') {
                updates.status_pre_arquivamento = null;
            }
        }

        if (statusMudou || dataDevMudou) {
            // Automação GECOPE: definir metas automáticas
            if (novoStatus === 'ANÁLISE FISCAL') {
                const base = registroOriginal.created_at || new Date();
                const metaAuto = calcularDataMeta(base, 20);
                updates.data_compromisso_fiscal = metaAuto.toISOString().substring(0, 10);
            } else if (novoStatus === 'DEVOLVIDO P/ REANÁLISE FISCAL' || novoStatus === 'REANÁLISE FISCAL') {
                // Para reanálises, usar a data de devolução informada no formulário
                let base = null;
                const devolucaoFinal = updates.data_devolucao_correcoes || dataDevAntiga;
                if (devolucaoFinal) base = isoParaDate(devolucaoFinal);
                else base = new Date();

                const metaAuto = calcularDataMeta(base, 10);
                updates.data_compromisso_fiscal = metaAuto.toISOString().substring(0, 10);
            } else if (statusMudou) {
                // Remove a meta se o status mudou para algo que não tem meta automática
                updates.data_compromisso_fiscal = null;
                const key = `meta:${processoNome}`;
                localStorage.removeItem(key);
            }
        }

        const btn = document.getElementById('btn-atualizar');
        btn.innerHTML = "SALVANDO...";
        btn.disabled = true;

        const { error } = await sbClient
            .from('processos')
            .update(updates)
            .eq('id', idUnico);

        btn.disabled = false;
        btn.innerHTML = '<i class="bi bi-check-lg"></i> SALVAR ALTERAÇÕES';

        if (error) {
            alert("Erro ao atualizar: " + error.message);
        } else {
            const msg = document.getElementById('msg-detalhes');
            msg.style.display = 'block';
            msg.className = 'alert alert-success';
            msg.innerHTML = ' Dados atualizados!';

            // Gravar log no historico_metas se a meta mudou ou foi zerada
            // registroOriginal vem de window.allData (mapProcessoRow), que expõe a data como
            // Date em dataCompromissoFiscal — não existe campo data_compromisso_fiscal aqui.
            const dataLimiteOriginal = registroOriginal.dataCompromissoFiscal
                ? registroOriginal.dataCompromissoFiscal.toISOString().substring(0, 10)
                : null;
            const dataLimiteNova = updates.data_compromisso_fiscal || null;

            if (dataLimiteNova !== dataLimiteOriginal) {
                let dias = null;
                let baseDate = new Date();
                const statusNovo = (updates.status || registroOriginal.status || "").toString().trim().toUpperCase();

                if (statusNovo === 'ANÁLISE FISCAL') {
                    dias = 20;
                    // Regra de Cadastro: Usar a data de cadastro no GECOPE (created_at)
                    baseDate = registroOriginal.created_at || new Date();
                } else if (statusNovo === 'DEVOLVIDO P/ REANÁLISE FISCAL' || statusNovo === 'REANÁLISE FISCAL') {
                    dias = 10;
                    // Regra de Reanálise: Usar data de devolução para correção no cálculo da nova meta
                    const devDate = updates.data_devolucao_correcoes || registroOriginal.dataDevolucaoCorrecoes;
                    baseDate = devDate ? (devDate instanceof Date ? devDate : isoParaDate(devDate)) : new Date();
                } else if (dataLimiteNova) {
                    // Regra Manual: Usar a data de estabelecimento da meta (hoje/agora)
                    baseDate = new Date();
                    const diffTime = Math.abs(new Date(dataLimiteNova) - baseDate);
                    dias = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                }

                const autor = sessionStorage.getItem('sop_user_name') || 'Sistema';

                const estStr = (baseDate instanceof Date ? baseDate.toISOString().substring(0, 10) : (new Date(baseDate).toISOString().substring(0, 10)));
                sbClient.from('historico_metas').insert([{
                    processo_id: idUnico,
                    registros: estStr,
                    dias_estipulados: dias,
                    meta: dataLimiteNova,
                    autor: autor
                }]).then(({ error: errHist }) => {
                    if (errHist) console.error('[ERRO] Falha ao registrar log no historico_metas (Edição):', errHist.message);
                });
            }

            // Notificação WhatsApp (Apenas para Devolução para Reanálise)
            const statusAlvo = ['DEVOLVIDO P/ REANÁLISE FISCAL'];
            if (updates.status && updates.status !== registroOriginal.status && statusAlvo.includes(updates.status)) {
                processarNotificacao('mudanca_status_processo', {
                    NUP_PROCESSO: processoNome,
                    NOME_OBRA: registroOriginal.descricao,
                    NOVO_STATUS: updates.status,
                    NOME_FISCAL: registroOriginal.fiscal || 'Fiscal'
                });
            }

            // Notificação para Analistas Específicos (Se mudou o analista ou se foi marcado agora)
            const analistasAlvo = ['NILDENO', 'HELDER', 'FELIPE', 'WALACE', 'PEDRO', 'ADA'];

            let aAtualExtenso = updates.analista || "";
            if (aAtualExtenso === "N") aAtualExtenso = "Nildeno";
            else if (aAtualExtenso === "W") aAtualExtenso = "Walace";
            else if (aAtualExtenso === "P") aAtualExtenso = "Pedro";
            else if (aAtualExtenso === "F") aAtualExtenso = "Felipe";
            else if (aAtualExtenso === "H") aAtualExtenso = "Helder";
            else if (aAtualExtenso === "A") aAtualExtenso = "Ada";
            const analistaAtual = aAtualExtenso.toUpperCase();

            let aAnteriorExtenso = registroOriginal.analista || "";
            if (aAnteriorExtenso === "N") aAnteriorExtenso = "Nildeno";
            else if (aAnteriorExtenso === "W") aAnteriorExtenso = "Walace";
            else if (aAnteriorExtenso === "P") aAnteriorExtenso = "Pedro";
            else if (aAnteriorExtenso === "F") aAnteriorExtenso = "Felipe";
            else if (aAnteriorExtenso === "H") aAnteriorExtenso = "Helder";
            else if (aAnteriorExtenso === "A") aAnteriorExtenso = "Ada";
            const analistaAnterior = aAnteriorExtenso.toUpperCase();

            const usuarioAtual = (sessionStorage.getItem('sop_user_name') || "").toUpperCase();

            if (analistaAtual && analistaAtual !== analistaAnterior && analistasAlvo.some(alvo => analistaAtual.includes(alvo))) {
                const ehAutoAtribuicao = usuarioAtual && (analistaAtual.includes(usuarioAtual) || usuarioAtual.includes(analistaAtual));

                if (!ehAutoAtribuicao) {
                    processarNotificacao('analista_designado', {
                        ANALISTA: analistaAtual,
                        NUP_PROCESSO: processoNome,
                        NOME_OBRA: registroOriginal.descricao,
                        NOVO_STATUS: 'Em Análise'
                    });
                }
            }
            setTimeout(() => {
                msg.style.display = 'none';
                bootstrap.Modal.getInstance(document.getElementById('modalDetalhes')).hide();
                carregarDadosSupabase();

                // Log de Atividade (Apenas se status mudou, ou log geral)
                if (updates.status && updates.status !== registroOriginal.status) {
                    registrarAtividade('PROCESSO', `atualizou o status do processo Nº ${processoNome} para ${updates.status}`, processoNome, registroOriginal.descricao, registroOriginal.fiscal);
                }
            }, 1000);
        }
    }
}

// --- FUNES AUXILIARES RECUPERADAS ---

function parseMoneyInput(val) {
    if (val === null || val === undefined || val === '') return 0;
    let s = val.toString().trim();
    // Normaliza múltiplos tipos de traços para o hífen padrão (ASCII 45)
    s = s.replace(/[\u2212\u2013\u2014]/g, '-');
    // Se estiver entre parênteses, trata como negativo: (1.000,00) => -1.000,00
    if (/^\(.*\)$/.test(s)) { s = '-' + s.replace(/^\(|\)$/g, ''); }
    // Remove R$, espaços normais e NBSP
    s = s.replace(/R\$|\s|\u00A0/g, '');
    // Remove quaisquer caracteres que não sejam dígito, vírgula, ponto ou sinal de menos
    s = s.replace(/[^0-9\-,.]/g, '');
    if (!s || s === '-') return 0;
    // Se formato brasileiro (com vírgula), converte para formato parseable
    if (s.includes(',')) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.split('.').length > 2) {
        // Caso tenha mais de um ponto (ex: 1.250.00), remove todos os pontos
        s = s.replace(/\./g, '');
    }
    const res = parseFloat(s);
    return isFinite(res) ? res : 0;
}

function calcularRepercussao() {
    try {
        const pairs = [
            { a: 'det_acresc_f', s: 'det_supress_f', r: 'det_reperc_f' },
            { a: 'det_acresc_g', s: 'det_supress_g', r: 'det_reperc_g' },
            { a: 'acresc_fisc', s: 'supress_fisc', r: 'reperc_fisc' },
            { a: 'acresc_gec', s: 'supress_gec', r: 'reperc_gec' }
        ];

        pairs.forEach(p => {
            const elA = document.getElementById(p.a);
            const elS = document.getElementById(p.s);
            const elR = document.getElementById(p.r);

            if (elA && elS && elR) {
                const vA = parseMoneyInput(elA.value);
                const vS = parseMoneyInput(elS.value);
                const total = Number((vA + vS).toFixed(2));

                elR.value = formatCurrencyValue(total);

                elR.classList.remove('text-danger', 'text-success', 'text-dark');
                if (total < -0.01) elR.classList.add('text-danger');
                else if (total > 0.01) elR.classList.add('text-success');
                else { elR.classList.add('text-dark'); elR.value = "0,00"; }
            }
        });
    } catch (err) {
        console.error('Erro no cálculo:', err);
    }
}

// calcularDiasDevolucao definida anteriormente (versão mais robusta)

// Dashboard/UI helpers moved to dashboard.js

// LOGIC: REUNIO
const mt = { meta: document.getElementById("meetingMetaSelect"), prioritario: document.getElementById("meetingPrioritarioSelect"), fiscal: document.getElementById("meetingFiscalSelect"), status: document.getElementById("meetingStatusSelect"), search: document.getElementById("meetingSearch"), body: document.getElementById("meetingTableBody"), note: document.getElementById("meetingFooterNote") };
let mtBase = [];
window.currentProcessesTab = 'ativos';

window.filtroSomenteAlertaDiligencia = false;

function toggleFiltroAlertaDiligencia() {
    window.filtroSomenteAlertaDiligencia = !window.filtroSomenteAlertaDiligencia;
    const btn = document.getElementById('btn-filtro-alerta-diligencia');
    if (btn) btn.classList.toggle('active', window.filtroSomenteAlertaDiligencia);
    updateReuniao();
}

function switchProcessTab(tab) {
    window.currentProcessesTab = tab;
    const tabIds = ['btn-tab-ativos', 'btn-tab-aprovados', 'btn-tab-arquivados'];
    tabIds.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('active', id === 'btn-tab-' + tab);
    });

    // Botão de filtro "somente com alerta de retorno" só faz sentido na aba Aprovados
    if (tab !== 'aprovados') {
        window.filtroSomenteAlertaDiligencia = false;
        const btnFiltroAlerta = document.getElementById('btn-filtro-alerta-diligencia');
        if (btnFiltroAlerta) btnFiltroAlerta.classList.remove('active');
    }
    atualizarVisibilidadeBtnFiltroAlerta();
    // Ao trocar de aba, garantir que os filtros de reunião estejam em "Todos"
    try {
        if (typeof mt !== 'undefined' && mt) {
            window.isResettingFilters = true; // Previne que updateReuniao rode múltiplas vezes

            // Para multiselects (status, fiscal) recria as opções selecionadas (Todos)
            if (mt.status && typeof fillSelect === 'function' && Array.isArray(window.allData)) {
                fillSelect(mt.status, window.allData.map(d => d.status));
            }
            if (mt.fiscal && typeof fillSelect === 'function' && Array.isArray(window.allData)) {
                fillSelect(mt.fiscal, window.allData.map(d => d.fiscal));
            }

            // Para selects simples (meta, prioritario) definir como vazio => Todos
            if (mt.meta) mt.meta.value = "";
            if (mt.prioritario) mt.prioritario.value = "";

            // Disparar eventos de change para atualizar labels/estado visual (ex: bootstrap-select)
            ['status', 'fiscal', 'meta', 'prioritario'].forEach(k => {
                try { mt[k]?.dispatchEvent(new Event('change')); } catch (e) { /* noop */ }
            });

            window.isResettingFilters = false;
        }
    } catch (e) {
        console.error('[switchProcessTab] erro ao resetar filtros', e);
        window.isResettingFilters = false;
    }

    updateReuniao();
}

function getMetaDate(row, setD) {
    const key = `meta:${row.processo}`;
    if (setD !== undefined) {
        // RBAC: apenas admins podem definir/excluir metas
        if (!canMarkDateAsMeta()) {
            console.warn(`[RBAC] usuário não pode alterar meta do processo ${row.processo}`);
            return null;
        }

        const valSupabase = setD ? setD.toISOString().substring(0, 10) : null;

        if (!setD) localStorage.removeItem(key);
        else localStorage.setItem(key, valSupabase);

        row.dataCompromissoFiscal = setD;

        // Sincroniza ativamente com o Supabase quando alterado pelo Painel (Tabela)
        sbClient.from('processos')
            .update({ data_compromisso_fiscal: valSupabase })
            .eq('id', row.id)
            .select('id')
            .then(({ data: updData, error }) => {
                if (error) {
                    console.error('[ERRO] Falha ao sincronizar meta na base de dados: ', error.message);
                } else if (!updData || updData.length === 0) {
                    console.error('[ERRO] Nenhuma linha atualizada ao definir meta para o processo:', row.processo);
                } else {
                    try {
                        const acao = valSupabase ? `definiu a meta para ${valSupabase.split('-').reverse().join('/')}` : 'removeu a meta';
                        registrarAtividade('PROCESSO', `Usuário ${acao} no processo Nº ${row.processo}`, row.processo, (row && row.descricao) || '', (row && row.fiscal) || '');
                    } catch (e) { }

                    // Gravar histórico de metas
                    try {
                        const autor = sessionStorage.getItem('sop_user_name') || 'Usuário';
                        let dias = null;
                        if (valSupabase) {
                            const hoje = new Date();
                            hoje.setHours(0, 0, 0, 0);
                            const limite = new Date(valSupabase);
                            limite.setHours(0, 0, 0, 0);
                            const diffTime = limite.getTime() - hoje.getTime();
                            dias = Math.round(diffTime / (1000 * 60 * 60 * 24));
                        }

                        sbClient.from('historico_metas').insert([{
                            processo_id: row.id,
                            registros: new Date().toISOString().substring(0, 10),
                            dias_estipulados: dias,
                            meta: valSupabase,
                            autor: autor
                        }]).then(({ error: errHist }) => {
                            if (errHist) console.error('[ERRO] Falha ao registrar log no historico_metas:', errHist.message);
                        });
                    } catch (e) {
                        console.error('[ERRO] Falha ao registrar histórico de metas no getMetaDate:', e);
                    }
                }
            });

        return setD;
    }
    if (row.dataCompromissoFiscal instanceof Date) return row.dataCompromissoFiscal;
    const ls = localStorage.getItem(key); if (ls) { const d = isoParaDate(ls); if (d) { row.dataCompromissoFiscal = d; return d; } }
    return null;
}
function getMetaSt(row) {
    const md = getMetaDate(row), st = (row.status || "").toUpperCase();
    if (st.includes("APROVADO")) return "Cumprido";
    if (!md) return "Sem meta";

    const mdTime = new Date(md.getFullYear(), md.getMonth(), md.getDate()).getTime();
    const todayTime = new Date().setHours(0, 0, 0, 0);
    return mdTime < todayTime ? "Atrasado" : "No prazo";
}
// Ordem ORIGINAL (para preservar a ordem de carregamento padrão da tela inicial)
function statusPriority(status) {
    const raw = (status || "").toString().toUpperCase().trim();
    const s = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // 0. DILIGÊNCIA (topo da lista: processo aprovado que retornou para correções, exige atenção prioritária)
    if (s.includes("DILIGEN")) return 0;
    // 1. EM REANÁLISE
    if (s.includes("EM REAN") || (s.startsWith("EM") && s.includes("REAN"))) return 1;
    // 2. EM ANÁLISE
    if ((s.includes("EM ANALIS") || s === "ANALISE") && !s.includes("FISCAL") && !s.includes("REAN")) return 2;
    // 3. AGUAR. REANÁLISE
    if (s.includes("AGUAR") && s.includes("REAN")) return 3;
    // 4. AGUAR. ANÁLISE
    if (s.includes("AGUAR") && s.includes("ANALIS") && !s.includes("FISCAL") && !s.includes("REAN")) return 4;
    // 5. AGUAR. APROVAÇÃO
    if (s.includes("AGUAR") && s.includes("APROVA")) return 5;
    // 6. REANÁLISE FISCAL (DEVOLVIDO P/ REANÁLISE FISCAL)
    if (s.includes("DEVOLVIDO") || (s.includes("REAN") && s.includes("FISCAL"))) return 6;
    // 7. ANÁLISE FISCAL
    if (s.includes("FISCAL") && s.includes("ANALIS") && !s.includes("DEVOLVIDO") && !s.includes("REAN")) return 7;
    // 8. CONTRATANTE
    if (s.includes("CONTRATANTE")) return 8;

    // Status adicionais (Aprovado e Arquivado)
    if (s === "APROVADO" || (s.includes("APROVADO") && !s.includes("AGUAR"))) return 9;
    if (s.includes("ARQUIVADO")) return 10;

    return 99;
}

// Ordem REVISADA (aplicada apenas ao "filtro"/setinha da coluna Status quando clicada)
function statusFilterPriority(status) {
    return statusPriority(status);
}

// Funções para gerenciar processos prioritários
function isPrioritario(row) {
    return row.prioritario === true;
}

async function setPrioritario(processo, isPriority) {
    // RBAC guard - apenas administradores podem alterar prioridade
    if (!canMarkProcessAsPriority()) {
        const role = getCurrentUserRole();
        console.warn(`[RBAC] Usuário (${role}) não tem permissão para marcar como prioritário`);
        alert('Você não tem permissão para marcar processos como prioritário.');
        return;
    }

    // 1. Atualizar imediatamente em memória (feedback visual instantâneo)
    const row = (window.allData || []).find(d => d.processo === processo);
    if (row) row.prioritario = isPriority;

    // 2. Realizar comunicação com o Supabase nos bastidores (Background Sync)
    try {
        const { error } = await sbClient
            .from('processos')
            .update({ prioritario: isPriority })
            .eq('processo', processo);

        if (error) {
            console.error('[ERRO] Falha ao marcar processo prioritário: ', error.message);
            alert("Aviso: Falha de conexão ao salvar status prioritário nas nuvens.");
        } else {
            // Registrar atividade: Admin marcou/desmarcou prioridade
            try {
                const acao = isPriority ? 'marcou como prioritário' : 'desmarcou como prioritário';
                await registrarAtividade('PROCESSO', `${acao} o processo Nº ${processo}`, processo, (row && row.descricao) || '', (row && row.fiscal) || '');
            } catch (regErr) {
                console.error('Erro ao registrar atividade de prioridade:', regErr);
            }

            // Atualiza o resumo de atividades na Home, se disponível
            if (typeof carregarAtividadesResumoHome === 'function') {
                try { carregarAtividadesResumoHome(); } catch (e) { /* noop */ }
            }
        }
    } catch (e) {
        console.error("Erro interno no setPrioritario:", e);
    }
}

function safeCompare(valA, valB, dir) {
    const isEmptyA = valA === undefined || valA === null || valA === "";
    const isEmptyB = valB === undefined || valB === null || valB === "";

    if (isEmptyA && isEmptyB) return 0;
    if (isEmptyA) return dir === 'asc' ? 1 : -1; // Envia vazios para o final
    if (isEmptyB) return dir === 'asc' ? -1 : 1;

    if (typeof valA === 'string' && typeof valB === 'string') {
        const cmp = valA.localeCompare(valB, 'pt-BR');
        return dir === 'asc' ? cmp : -cmp;
    }

    if (valA < valB) return dir === 'asc' ? -1 : 1;
    if (valA > valB) return dir === 'asc' ? 1 : -1;
    return 0;
}

let currentSort = []; // Array of { col, dir }
window.currentSort = currentSort;

function changeSort(columnKey) {
    const index = currentSort.findIndex(s => s.col === columnKey);
    if (index !== -1) {
        if (currentSort[index].dir === 'asc') {
            currentSort[index].dir = 'desc';
        } else {
            currentSort.splice(index, 1);
        }
    } else {
        currentSort.push({ col: columnKey, dir: 'asc' });
    }
    updateReuniao();
}
window.changeSort = changeSort;

function getSortIcon(columnKey) {
    const sort = currentSort.find(s => s.col === columnKey);
    const sortIndex = currentSort.findIndex(s => s.col === columnKey);
    const indexBadge = currentSort.length > 1 && sortIndex !== -1 ? `<span class="badge bg-success ms-1" style="font-size: 0.6rem; padding: 2px 4px;">${sortIndex + 1}</span>` : '';

    if (!sort) { return '<i class="bi bi-arrow-down-up text-secondary ms-1" style="font-size: 1rem; opacity: 0.4;"></i>'; }
    return (sort.dir === 'asc' ? '<i class="bi bi-sort-up text-success ms-1" style="font-size: 1.1rem;"></i>' : '<i class="bi bi-sort-down-alt text-success ms-1" style="font-size: 1.1rem;"></i>') + indexBadge;
}
window.getSortIcon = getSortIcon;

// Paleta categórica validada (contraste/CVD) para os cards de KPI de Processos —
// ver skill de dataviz. Índice 0 é o fiscal com mais processos, e assim por diante.
const KPI_BREAKDOWN_CORES = {
    light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
    dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9']
};
const KPI_BREAKDOWN_CINZA = { light: '#c3c2b7', dark: '#5c5c58' };

// Abre o modal de distribuição por fiscal ao clicar num dos cards de KPI da aba
// Processos. statusFiltro=null usa todas as linhas atualmente filtradas na tela
// (mesmo conjunto exibido pelo card "Processos").
function abrirBreakdownFiscal(statusFiltro, titulo, iconClass) {
    const todasLinhas = window.currentVisibleRows || [];
    const linhas = statusFiltro
        ? todasLinhas.filter(d => (d.status || "").toUpperCase() === statusFiltro)
        : todasLinhas;

    const contagem = new Map();
    linhas.forEach(d => {
        const nome = (d.fiscal || "").trim() || "Não informado";
        contagem.set(nome, (contagem.get(nome) || 0) + 1);
    });
    let entradas = Array.from(contagem.entries()).sort((a, b) => b[1] - a[1]);

    const total = linhas.length;
    const isDark = document.body.classList.contains('theme-dark');
    const paleta = isDark ? KPI_BREAKDOWN_CORES.dark : KPI_BREAKDOWN_CORES.light;
    const cinza = isDark ? KPI_BREAKDOWN_CINZA.dark : KPI_BREAKDOWN_CINZA.light;

    // Mais de 7 fiscais: mantém os 7 maiores e agrupa o resto em "Outros" para
    // não estourar o teto de cores categoricamente seguras (ver dataviz skill).
    let fatias = entradas;
    if (entradas.length > 8) {
        const principais = entradas.slice(0, 7);
        const somaOutros = entradas.slice(7).reduce((acc, [, qtd]) => acc + qtd, 0);
        fatias = [...principais, ["Outros", somaOutros]];
    }

    const titleEl = document.getElementById('kpiBreakdownTitulo');
    titleEl.innerHTML = `<i class="bi ${iconClass || 'bi-pie-chart'} me-2"></i>${escapeHTML(titulo)} por fiscal`;

    const conteudo = document.getElementById('kpiBreakdownConteudo');
    if (total === 0) {
        conteudo.innerHTML = `<div class="text-center text-muted py-4"><i class="bi bi-inbox fs-2 d-block mb-2"></i>Nenhum processo neste status.</div>`;
    } else {
        const r = 70, cx = 90, cy = 90, sw = 26;
        const circ = 2 * Math.PI * r;
        let acc = 0;
        const arcosSVG = fatias.map(([nome, qtd], i) => {
            const frac = qtd / total;
            const len = frac * circ;
            const dashoffset = -acc;
            acc += len;
            const cor = nome === "Outros" ? cinza : paleta[i % paleta.length];
            const pct = Math.round(frac * 1000) / 10;
            return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cor}" stroke-width="${sw}"
                stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${dashoffset}"
                transform="rotate(-90 ${cx} ${cy})"><title>${escapeHTML(nome)}: ${qtd} (${pct}%)</title></circle>`;
        }).join('');

        // A lista abaixo mostra TODOS os fiscais (não só os que viraram fatia
        // colorida própria no gráfico) — quem caiu dentro de "Outros" na rosca
        // aparece aqui com o mesmo cinza, mas com nome e quantidade individuais.
        const legendaHTML = entradas.map(([nome, qtd], i) => {
            const cor = i < 7 ? paleta[i % paleta.length] : cinza;
            const pct = Math.round((qtd / total) * 1000) / 10;
            return `<div class="d-flex align-items-center justify-content-between py-1" style="font-size:0.85rem;">
                <div class="d-flex align-items-center gap-2" style="min-width:0;">
                    <span style="width:10px;height:10px;border-radius:2px;background:${cor};flex:none;"></span>
                    <span class="text-truncate" style="color:var(--text-heading);">${escapeHTML(nome)}</span>
                </div>
                <span class="fw-bold ms-2" style="color:var(--text-heading);white-space:nowrap;">${qtd} <span class="fw-normal" style="color:var(--text-muted);">(${pct}%)</span></span>
            </div>`;
        }).join('');

        conteudo.innerHTML = `
            <div class="d-flex flex-column flex-sm-row align-items-center gap-4">
                <div style="position:relative;flex:none;">
                    <svg width="180" height="180" viewBox="0 0 180 180">${arcosSVG}</svg>
                    <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
                        <div style="font-size:1.6rem;font-weight:800;color:var(--text-heading);line-height:1;">${total}</div>
                        <div style="font-size:0.68rem;color:var(--text-muted);">processo${total === 1 ? '' : 's'}</div>
                    </div>
                </div>
                <div class="kpi-breakdown-legend" style="flex:1;min-width:0;width:100%;max-height:260px;overflow-y:auto;">${legendaHTML}</div>
            </div>`;
    }

    const modalEl = document.getElementById('modalKpiBreakdown');
    // O HTML deste projeto tem divs não fechadas em vários trechos, o que faz
    // modais definidos mais abaixo no arquivo herdarem um ancestral errado
    // (às vezes um outro .modal com display:none, colapsando para 0x0). O
    // mesmo padrão de correção já é usado em outros modais do sistema.
    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
    new bootstrap.Modal(modalEl).show();
}
window.abrirBreakdownFiscal = abrirBreakdownFiscal;

function updateReuniaoFilters(rows) { mtBase = rows; updateReuniao(); }

function updateReuniao() {
    if (window.isResettingFilters) return; // Evita loop de re-render ao resetar filtros
    if (!mt.body) return;
    const uRole = (sessionStorage.getItem('sop_role') || "").toLowerCase();

    // Prioriza sop_fiscal_name (derivado do email) sobre sop_user_name
    let uName = (sessionStorage.getItem('sop_fiscal_name') || sessionStorage.getItem('sop_user_name') || "").toUpperCase().trim();

    const fs = Array.from(new Set(mtBase.map(d => d.fiscal).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'pt-BR'));
    if (mt.fiscal.options.length <= 1) fillSelect(mt.fiscal, fs);
    let rows = mtBase.slice();

    // [PAGINAÇÃO] Filtro por Aba (Ativos vs Aprovados vs Arquivados)
    if (!window.currentProcessesTab) window.currentProcessesTab = 'ativos';

    // Com busca textual ativa, ignora a paginação por aba e busca em todas as páginas
    const isGlobalSearch = mt.search.value.trim().length > 0;

    if (!isGlobalSearch) {
        rows = rows.filter(d => {
            const st = (d.status || "").toUpperCase().trim();
            const isAprovado = st.includes("APROVADO") || st === "SEDUC";
            const isArquivado = st.includes("ARQUIVADO");

            if (window.currentProcessesTab === 'ativos') return !isAprovado && !isArquivado;
            if (window.currentProcessesTab === 'aprovados') {
                if (window.filtroSomenteAlertaDiligencia) return isAprovado && !!d.alerta_pre_diligencia;
                return isAprovado;
            }
            if (window.currentProcessesTab === 'arquivados') return isArquivado;
            return true;
        });
    }

    if (uRole === 'fiscal') {
        const nameParts = uName.trim().split(/[\s\.\-]+/).filter(p => p.length > 0);
        rows = rows.filter(d => {
            const dFiscal = (d.fiscal || "").toUpperCase().trim();
            const dFiscalNormalizado = dFiscal.replace(/[\.\-]+/g, ' ').trim();
            if (dFiscalNormalizado === uName) return true;
            if (nameParts.every(part => dFiscalNormalizado.includes(part))) return true;
            const dFiscalParts = dFiscalNormalizado.split(/\s+/).filter(p => p.length > 0);
            if (dFiscalParts.every(part => uName.includes(part))) return true;
            return false;
        });
        if (mt.fiscal && mt.fiscal.closest('.col-12.col-md-2')) {
            mt.fiscal.closest('.col-12.col-md-2').style.display = 'none';
        }
    } else {
        if (mt.fiscal && mt.fiscal.closest('.col-12.col-md-2')) {
            mt.fiscal.closest('.col-12.col-md-2').style.display = '';
        }
    }

    const f = getSelectedValues(mt.fiscal);
    const s = getSelectedValues(mt.status);
    const m = getSelectedValues(mt.meta);
    const priorFilt = getSelectedValues(mt.prioritario);
    const qRaw = mt.search.value.trim();

    const totalF = mt.fiscal.options.length;
    const totalS = mt.status.options.length;
    const totalM = mt.meta.options.length;
    const totalP = mt.prioritario.options.length;

    // Detecção robusta de "Tudo Selecionado"
    const allF = mt.fiscal.querySelectorAll('option:checked').length === totalF;
    const allS = mt.status.querySelectorAll('option:checked').length === totalS;
    const allM = mt.meta.querySelectorAll('option:checked').length === totalM;
    const allP = mt.prioritario.querySelectorAll('option:checked').length === totalP;

    if (f.length > 0 && !allF) {
        rows = rows.filter(d => f.includes(d.fiscal || "Não informado"));
    }
    if (s.length > 0 && !allS) {
        rows = rows.filter(d => s.includes(d.status || "Não informado"));
    }
    if (m.length > 0 && !allM) {
        rows = rows.filter(d => m.includes(getMetaSt(d)));
    }
    if (priorFilt.length > 0 && !allP) {
        rows = rows.filter(d => priorFilt.includes(isPrioritario(d) ? "Sim" : "Não"));
    }

    if (qRaw) {
        const normalizeText = (text) => (text || "").normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const qNormalized = normalizeText(qRaw);
        const terms = qNormalized.split(/\s+/).filter(t => t.length > 0);
        const escapeRE = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Otimização: Compila os Regex UMA vez fora do loop
        const compiledTerms = terms.map(term => ({
            term: term,
            regex: new RegExp(`\\b${escapeRE(term)}`, 'i')
        }));

        rows = rows.filter(d => {
            const proc = (d.processo || "").toLowerCase();
            const contrat = normalizeText(d.contratante);
            const desc = normalizeText(d.descricao);
            const analistaNome = normalizeText(d.nomeAnalista);
            const fiscal = normalizeText(d.fiscal);
            const status = normalizeText(d.status);
            const contratada = normalizeText(d.contratada);

            return compiledTerms.every(({ term, regex }) => {
                return proc.includes(term) ||
                    regex.test(contratada) ||
                    regex.test(contrat) ||
                    regex.test(desc) ||
                    regex.test(analistaNome) ||
                    regex.test(fiscal) ||
                    regex.test(status);
            });
        });
    }
    document.getElementById("meetingFooterNote").textContent = `Exibindo ${rows.length} processos`;
    document.getElementById("card_proc_total").textContent = rows.length;
    document.getElementById("card_proc_andamento").textContent = rows.filter(d => (d.status || "").toUpperCase() === "AGUAR. ANÁLISE").length;
    document.getElementById("card_proc_aprovados").textContent = rows.filter(d => (d.status || "").toUpperCase() === "ANÁLISE FISCAL").length;
    document.getElementById("card_proc_dias").textContent = rows.filter(d => (d.status || "").toUpperCase() === "DEVOLVIDO P/ REANÁLISE FISCAL").length;

    const btnExport = document.getElementById("btn-reuniao-export");
    if (btnExport) {
        btnExport.disabled = rows.length === 0;
        btnExport.title = rows.length === 0 ? "Nada para exportar" : "Exportar tudo do resultado filtrado para Excel";
    }
    window.currentVisibleRows = rows; // Armazena globalmente para exportação

    const columns = [
        { title: "Ações", width: "50px", key: null, align: "center" }, { title: "Prior.", width: "80px", key: "prioritario", align: "center" }, { title: "Processo", width: "200px", key: "processo", align: "start" }, { title: "Meta", width: "110px", key: "meta", align: "center" },
        { title: "Status", width: "146px", key: "status", align: "center" }, { title: "Suíte", width: "146px", key: null, align: "center" }, { title: "Analista", width: "100px", key: "analista", align: "center" }, { title: "Abertura", width: "100px", key: "abertura", align: "center" },
        { title: "Contratada", width: "100px", key: "contratada", align: "start" }, { title: "Descrição", width: "auto", key: "descricao", align: "start" }
    ];
    const thead = document.querySelector("#pane-reuniao table thead");
    let headerHTML = "<tr>";
    columns.forEach(col => {
        if (col.key) { headerHTML += `<th style="width: ${col.width}; cursor: pointer; user-select: none;" onclick="changeSort('${col.key}')" class="text-${col.align}"><div class="d-flex align-items-center justify-content-${col.align === 'center' ? 'center' : 'start'}">${col.title} ${getSortIcon(col.key)}</div></th>`; }
        else { headerHTML += `<th class="text-${col.align}" style="width: ${col.width};">${col.title}</th>`; }
    });
    headerHTML += "</tr>";
    // Só reescreve o thead quando o HTML muda de fato (ex.: seta de ordenação) — updateReuniao()
    // roda a cada filtro/busca/refresh, e o cabeçalho quase sempre é idêntico ao anterior.
    if (thead.innerHTML !== headerHTML) thead.innerHTML = headerHTML;

    rows.sort((a, b) => {
        if (currentSort.length === 0) {
            // 1. Prioridade por Status GECOPE
            const pA = statusPriority(a.status), pB = statusPriority(b.status);
            if (pA !== pB) return pA - pB;

            // 2. Regra Especial para Arquivados (Página 3): Ordenar por tempo no SUITE do mais recente para o mais antigo (menor nº de dias primeiro)
            if (pA === 10) {
                const tA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
                const tB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
                return tB - tA;
            }

            // 3. Ordenação dentro do bloco: Tempo de Abertura (Maior tempo decorrido = mais antigo primeiro)
            const dA = a.dataAbertura instanceof Date ? a.dataAbertura.getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
            const dB = b.dataAbertura instanceof Date ? b.dataAbertura.getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
            if (dA !== dB) return dA - dB;

            // 4. Fallback: Tempo no status SUITE
            const timeA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
            const timeB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
            return timeA - timeB;
        }

        for (let sort of currentSort) {
            let valA, valB;
            switch (sort.col) {
                case 'prioritario': valA = isPrioritario(a) ? 1 : 0; valB = isPrioritario(b) ? 1 : 0; break;
                case 'processo': valA = a.processo || ""; valB = b.processo || ""; break;
                case 'meta': {
                    const mA = getMetaDate(a);
                    const mB = getMetaDate(b);
                    valA = mA ? mA.getTime() : 0;
                    valB = mB ? mB.getTime() : 0;
                    break;
                }
                case 'status': valA = statusFilterPriority(a.status); valB = statusFilterPriority(b.status); break;
                case 'analista': valA = a.analista || ""; valB = b.analista || ""; break;
                case 'abertura': valA = a.dataAbertura instanceof Date ? a.dataAbertura.getTime() : 0; valB = b.dataAbertura instanceof Date ? b.dataAbertura.getTime() : 0; break;
                case 'dias': valA = a.dataAbertura instanceof Date ? -(new Date() - a.dataAbertura) : 1; valB = b.dataAbertura instanceof Date ? -(new Date() - b.dataAbertura) : 1; break;
                case 'contratante': valA = a.contratante || ""; valB = b.contratante || ""; break;
                case 'contratada': valA = a.contratada || ""; valB = b.contratada || ""; break;
                case 'descricao': valA = a.descricao || ""; valB = b.descricao || ""; break;
                default: continue;
            }
            const cmp = safeCompare(valA, valB, sort.dir);
            if (cmp !== 0) return cmp;
        }

        // Empate no sort personalizado: aplica a Ordem Normal (Status GECOPE -> Tempo Abertura) como desempate final!
        const pA = statusPriority(a.status), pB = statusPriority(b.status);
        if (pA !== pB) return pA - pB;

        if (pA === 10) {
            const tA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
            const tB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
            return tB - tA;
        }

        const dA = a.dataAbertura instanceof Date ? a.dataAbertura.getTime() : (a.created_at ? new Date(a.created_at).getTime() : 0);
        const dB = b.dataAbertura instanceof Date ? b.dataAbertura.getTime() : (b.created_at ? new Date(b.created_at).getTime() : 0);
        if (dA !== dB) return dA - dB;

        const timeA = a.suite_data_chegada ? new Date(a.suite_data_chegada).getTime() : (a.ultima_atualizacao ? new Date(a.ultima_atualizacao).getTime() : 0);
        const timeB = b.suite_data_chegada ? new Date(b.suite_data_chegada).getTime() : (b.ultima_atualizacao ? new Date(b.ultima_atualizacao).getTime() : 0);
        return timeA - timeB;
    });

    // Contagem de processos por grupo de status, para exibir no cabeçalho de cada bloco
    const statusGroupCounts = {};
    rows.forEach(d => {
        const label = formatStatusDisplay(d.status) || "SEM STATUS";
        statusGroupCounts[label] = (statusGroupCounts[label] || 0) + 1;
    });
    let lastStatusGroup = null;
    const groupedHTML = [];

    // Cor de destaque do cabeçalho de grupo, na mesma família de cor do badge de status da linha
    // — tons mais escuros/dessaturados que os do badge, para não pesar visualmente
    const groupAccentColor = {
        "badge-status-devolvido": "#a33a44",
        "badge-status-diligencia": "#a33a44",
        "badge-status-light-blue": "#3d68a3",
        "badge-status-em-reanalise": "#3f7d5c",
        "badge-status-em-analise": "#a1801f",
        "badge-status-aguar-reanalise": "#a1801f",
        "badge-status-fiscal": "#6c757d",
        "badge-status-dark-blue": "#3d68a3",
        "badge-status-aprovado": "#3f7d5c",
        "badge-status-contratante": "#8a9200",
        "badge-status-arquivado": "#7c8ba1",
    };
    // Fundo do cabeçalho: tingimento translúcido bem suave da cor de destaque, para se
    // diferenciar do fundo da tabela sem competir visualmente com o conteúdo das linhas
    const groupBgColor = {
        "badge-status-devolvido": "rgba(163, 58, 68, 0.10)",
        "badge-status-diligencia": "rgba(163, 58, 68, 0.10)",
        "badge-status-light-blue": "rgba(61, 104, 163, 0.10)",
        "badge-status-em-reanalise": "rgba(63, 125, 92, 0.10)",
        "badge-status-em-analise": "rgba(161, 128, 31, 0.10)",
        "badge-status-aguar-reanalise": "rgba(161, 128, 31, 0.10)",
        "badge-status-fiscal": "rgba(108, 117, 125, 0.10)",
        "badge-status-dark-blue": "rgba(61, 104, 163, 0.10)",
        "badge-status-aprovado": "rgba(63, 125, 92, 0.10)",
        "badge-status-contratante": "rgba(138, 146, 0, 0.10)",
        "badge-status-arquivado": "rgba(124, 139, 161, 0.10)",
    };
    // Fundo das próprias linhas do grupo: um único tom neutro para todas, independente
    // do status — só o cabeçalho de cada bloco carrega a cor de destaque
    const groupRowBgColor = "rgba(255, 255, 255, 0.035)";

    rows.forEach(d => {
        const mIso = getMetaDate(d)?.toISOString().substring(0, 10) || "";
        const mSt = getMetaSt(d);
        let mCls = "badge-meta-sem";
        if (mSt === "Cumprido") mCls = "badge-meta-cumprido";
        else if (mSt === "No prazo") mCls = "badge-meta-prazo";
        else if (mSt === "Atrasado") mCls = "badge-meta-atrasado";

        const stTxt = (d.status || "").toString().toUpperCase().trim();
        let stCls = "text-bg-light";
        if (stTxt.includes("DEVOLVIDO")) { stCls = "badge-status-devolvido"; }
        else if (stTxt.includes("DILIG")) { stCls = "badge-status-diligencia"; }
        else if (stTxt.includes("CONTRATANTE")) { stCls = "badge-status-contratante"; }
        else if (stTxt.includes("APROVAÇÃO")) { stCls = "badge-status-dark-blue"; }
        else if (stTxt.includes("FISCAL") && (stTxt.includes("ANÁLISE") || stTxt.includes("ANALISE"))) { stCls = "badge-status-fiscal"; }
        else if (stTxt.includes("AGUAR")) {
            if (stTxt.includes("REAN")) { stCls = "badge-status-aguar-reanalise"; }
            else { stCls = "badge-status-light-blue"; }
        }
        else if (stTxt.startsWith("EM") && stTxt.includes("REANÁLISE")) { stCls = "badge-status-em-reanalise"; }
        else if (stTxt.startsWith("EM") && (stTxt.includes("ANÁLISE") || stTxt.includes("ANALISE"))) { stCls = "badge-status-em-analise"; }
        else if (stTxt.includes("APROVADO") || stTxt === "SEDUC") { stCls = "badge-status-aprovado"; }
        else if (stTxt.includes("ARQUIVADO")) { stCls = "badge-status-arquivado"; }

        // Cabeçalho de grupo: insere uma linha divisória sempre que o status muda,
        // mantendo a ordenação já aplicada (mesma regra de data de abertura dentro do grupo)
        const statusGroupLabel = formatStatusDisplay(d.status) || "SEM STATUS";
        if (statusGroupLabel !== lastStatusGroup) {
            const accentColor = groupAccentColor[stCls] || "#94a3b8";
            const bgColor = groupBgColor[stCls] || "rgba(148, 163, 184, 0.16)";
            groupedHTML.push(`
        <tr class="tr-status-group-header">
            <td colspan="${columns.length}" style="background: ${bgColor}; padding: 9px 16px; border-top: 1px solid var(--sop-slate-200, #e2e8f0); border-left: 4px solid ${accentColor};">
                <span class="d-inline-flex align-items-center" style="gap: 7px;">
                    <span style="width: 7px; height: 7px; border-radius: 50%; background: ${accentColor}; flex-shrink: 0;"></span>
                    <span class="text-uppercase" style="font-size: 0.76rem; font-weight: 700; letter-spacing: 0.04em; color: var(--text-heading);">${statusGroupLabel}</span>
                    <span class="text-muted" style="font-size: 0.74rem; font-weight: 500;">${statusGroupCounts[statusGroupLabel]} processo${statusGroupCounts[statusGroupLabel] === 1 ? '' : 's'}</span>
                </span>
            </td>
        </tr>`);
            lastStatusGroup = statusGroupLabel;
        }

        const abert = dateParaInput(d.dataAbertura);
        const dias = (d.dataAbertura instanceof Date) ? Math.floor((new Date() - d.dataAbertura) / (1000 * 60 * 60 * 24)) : "";
        const fiscalNome = (d.fiscal || "").toUpperCase();

        const diasNoStatus = calcularDiasNoStatus(d);
        const labelDias = diasNoStatus <= 0 ? "Hoje" : (diasNoStatus === 1 ? "1 dia" : `${diasNoStatus} dias`);

        // Preparar botões de ação para evitar aninhamento de template strings
        const canEdit = ['admin', 'gerente'].includes(uRole);
        const btnDetalhes = canEdit ? `<button class="btn btn-sm btn-light border" onclick="abrirDetalhes('${escapeHTML(d.processo)}')" title="Ver detalhes"><i class="bi bi-eye-fill" style="color: var(--sop-blue);"></i></button>` : '';

        // Link para o SUITE (NUP apenas números para evitar 404)
        const nupLimpo = escapeHTML(d.processo).replace(/\D/g, '');
        const btnSuite = `<a href="https://suite.ce.gov.br/consultar-processo/${nupLimpo}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-light border" title="Abrir no SUITE"><i class="bi bi-box-arrow-up-right" style="color: var(--sop-green);"></i></a>`;

        // Lógica da Meta
        const metaOnclick = `window.abrirModalMeta('${escapeHTML(d.processo)}', '${mIso}')`;
        const metaStyle = 'cursor: pointer;';

        // Iniciais do Analista para o avatar circular
        const analistaIniciais = (d.analista || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0].toUpperCase()).join('') || "-";

        // Alerta de pré-diligência: aprovado, mas já sinalizado (varredura anterior) tramitando
        // em setor de risco (DIFOR/GEFOE/DIRED/GEDOP) — ver isSetorRiscoDiligencia()
        const temAlertaDiligencia = !!(d.alerta_pre_diligencia || d.alerta_retorno_resolvido);
        const alertaIconeHTML = temAlertaDiligencia ? montarAlertaIconeHTML(d) : '';
        groupedHTML.push(`
        <tr style="vertical-align: middle; --bs-table-bg: ${groupRowBgColor};" data-numero="${escapeHTML(d.processo)}" class="tr-processo-row${d.alerta_pre_diligencia ? ' tr-alerta-pre-diligencia' : ''}">
            <td class="text-center">
                <div class="d-flex flex-column gap-1 align-items-center">
                    ${btnDetalhes}
                    ${btnSuite}
                </div>
            </td>
            <td class="text-center"><i class="bi ${isPrioritario(d) ? 'bi-star-fill' : 'bi-star'} proc-star-prioritario" data-proc="${escapeHTML(d.processo)}" style="color: ${isPrioritario(d) ? 'var(--sop-orange)' : 'var(--sop-slate-200)'}; font-size: 1.1rem; cursor: ${uRole === 'admin' ? 'pointer' : 'not-allowed'};" title="${uRole === 'admin' ? (isPrioritario(d) ? 'Remover prioridade' : 'Marcar como prioritário') : 'Você não tem permissão'}"></i></td>
            <td><div style="font-weight: 700; font-size: 1rem; color: var(--text-heading); white-space: nowrap;">${escapeHTML(d.processo)}</div><div class="mt-1" style="font-size: 0.76rem; color: var(--sop-slate-700); line-height: 1.4;"><i class="bi bi-person-fill me-1"></i>${escapeHTML(fiscalNome)}</div></td>
            <td class="text-center">
                <div class="mb-1"><span class="badge rounded-pill ${mCls} badge-meta-size">${mSt}</span></div>
                <div style="font-size: 0.74rem; color: var(--sop-blue); white-space: nowrap; text-align: center; ${metaStyle}" onclick="${metaOnclick}" title="${uRole === 'admin' ? 'Alterar Meta' : 'Você não tem permissão'}">
                    <i class="bi bi-calendar-event me-1"></i>${mIso ? mIso.split('-').reverse().join('/') : "Definir"}
                </div>
            </td>
            <td class="text-center">
                <div style="white-space: nowrap;"><span class="badge rounded-pill ${stCls} badge-custom-size">${formatStatusDisplay(d.status)}</span><span class="alerta-icone" style="${temAlertaDiligencia ? '' : 'display:none;'}">${alertaIconeHTML}</span></div>
                <div class=\"mt-1 text-muted px-1\" style=\"font-size: 0.7rem; font-weight: 500; height: 1.1rem;\"></div>
            </td>
            <td class="suite-cell text-center">
                <div class="suite-badge-container"><span class="badge rounded-pill bg-light text-dark border badge-custom-size"><i class="spinner-border spinner-border-sm me-1" style="width: 0.7rem; height: 0.7rem;"></i>Consultando</span></div>
                <div class="mt-1 text-muted px-1 suite-time-container" style="font-size: 0.74rem; font-weight: 500; display: none;"><i class="bi bi-clock-history me-1"></i><span class="suite-time-text"></span></div>
            </td>
            <td class="text-center"><div class="proc-avatar" title="${escapeHTML(d.analista || "Não atribuído")}">${analistaIniciais}</div></td>
            <td class="text-center">
                <div style="font-weight: 400; font-size: 0.85rem; color: var(--text-heading);">${abert}</div>
                <div class="mt-1 text-muted" style="font-size: 0.74rem; font-weight: 500;"><i class="bi bi-calendar3 me-1"></i>${dias} dias</div>
            </td>
            <td style="max-width: 200px; font-size: 0.82rem; color: var(--sop-slate-700); line-height: 1.4;">${escapeHTML(d.contratada)}</td>
            <td style="max-width: 280px; font-size: 0.82rem; color: var(--sop-slate-700); line-height: 1.4; text-align: justify;">${escapeHTML(d.descricao)}</td>
        </tr>`);
    });
    mt.body.innerHTML = groupedHTML.join("");

    // SweetAlert para definir Meta
    window.abrirModalMeta = async function (processo, dataAtual) {
        const isAdmin = canMarkDateAsMeta();

        let historicoHTML = '';
        try {
            const { data: pData } = await sbClient.from('processos').select('id').eq('processo', processo).maybeSingle();
            if (pData && pData.id) {
                const { data: rawHistorico } = await sbClient
                    .from('historico_metas')
                    .select('*')
                    .eq('processo_id', pData.id)
                    .order('registros', { ascending: false });

                const historico = [];
                if (rawHistorico) {
                    const pRow = (window.allData || []).find(r => r.processo === processo);
                    const chavesVistas = new Set();
                    for (const h of rawHistorico) {
                        let estDate = h.registros;
                        if (h.autor === 'Sistema' && pRow && !h.registros) {
                            const st = (pRow.status || "").toString().toUpperCase();
                            const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                            if (isReanalise && pRow.dataDevolucaoCorrecoes) {
                                estDate = pRow.dataDevolucaoCorrecoes;
                            } else if (pRow.created_at) {
                                estDate = pRow.created_at;
                            }
                        }

                        // Filtra logs obsoletos ou duplicados do Sistema para a mesma data base de estabelecimento.
                        // Mantém apenas o primeiro encontrado (o mais recente/atualizado, ordenado por registros DESC).
                        const diaEst = estDate ? new Date(estDate).toISOString().substring(0, 10) : '';
                        const chave = h.autor === 'Sistema' ? `sistema_${diaEst}` : `manual_${h.meta}_${h.dias_estipulados}`;

                        if (!chavesVistas.has(chave)) {
                            historico.push(h);
                            chavesVistas.add(chave);
                        }
                    }
                }

                if (historico && historico.length > 0) {
                    const totalDiasAcumulado = historico.reduce((sum, h) => sum + (h.dias_estipulados || 0), 0);
                    // PERFORMANCE: pRow não depende de `h` — é o mesmo processo para toda
                    // linha do histórico, então é calculado 1x aqui em vez de refazer o
                    // find() em window.allData a cada iteração do .map() abaixo.
                    const pRowHistorico = (window.allData || []).find(r => r.processo === processo);
                    historicoHTML = `
                        <div class="mt-4 text-start">
                            <label class="form-label text-muted fw-bold d-flex justify-content-between align-items-center w-100" style="font-size: 0.85rem;">
                                <span><i class="bi bi-clock-history me-1"></i> Histórico de Metas</span>
                                <span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-2 py-1" style="font-size: 0.75rem; background-color: #e6f4ea !important; color: #008F3D !important; border: 1px solid #c3e6cb !important;">Acumulado: ${totalDiasAcumulado} dias</span>
                            </label>
                            <div class="table-responsive" style="max-height: 180px; overflow-y: auto;">
                                <table class="table table-sm table-hover mb-0">
                                    <thead class="table-light sticky-top" style="z-index: 1;">
                                        <tr>
                                            <th>REGISTRO</th>
                                            <th class="text-center">DIAS</th>
                                            <th>META</th>
                                            <th>AUTOR</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${historico.map(h => {
                        const pRow = pRowHistorico;
                        let estDate = h.registros;
                        if (h.autor === 'Sistema' && pRow && !h.registros) {
                            const st = (pRow.status || "").toString().toUpperCase();
                            const isReanalise = st.includes("REANÁLISE") || st.includes("REANALISE") || st.includes("DEVOLVIDO");
                            if (isReanalise && pRow.dataDevolucaoCorrecoes) {
                                estDate = pRow.dataDevolucaoCorrecoes;
                            } else if (pRow.created_at) {
                                estDate = pRow.created_at;
                            }
                        }
                        const dtEst = estDate ? new Date(estDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '-';
                        // Calcula meta exibida: usa h.meta se existir, senão tenta calcular a partir de registros + dias_estipulados
                        let metaVal = h.meta || null;
                        if (!metaVal) {
                            try {
                                const diasVal = (h.dias_estipulados === null || h.dias_estipulados === undefined) ? null : Number(h.dias_estipulados);
                                const baseIso = estDate ? (new Date(estDate)).toISOString().substring(0, 10) : null;
                                const baseDateObj = baseIso ? isoParaDate(baseIso) : null;
                                if (baseDateObj && diasVal !== null && !isNaN(diasVal)) {
                                    const computed = calcularDataMeta(baseDateObj, diasVal);
                                    if (computed) metaVal = computed.toISOString().substring(0, 10);
                                }
                            } catch (e) {
                                console.error('Erro ao calcular meta a partir de registros:', e);
                            }
                        }
                        const dtLim = metaVal ? metaVal.split('-').reverse().join('/') : 'Zerada';
                        const dias = h.dias_estipulados !== null && h.dias_estipulados !== undefined ? h.dias_estipulados : '-';
                        const autor = h.autor || 'Sistema';
                        return `
                                                <tr style="vertical-align: middle;">
                                                    <td>${dtEst}</td>
                                                    <td class="text-center font-monospace">${dias}</td>
                                                    <td>
                                                        ${h.meta ?
                                `<span class="badge bg-success-subtle text-success border border-success-subtle rounded-pill px-2 py-0.5" style="font-size: 0.75rem;">${dtLim}</span>` :
                                `<span class="badge bg-danger-subtle text-danger border border-danger-subtle rounded-pill px-2 py-0.5" style="font-size: 0.75rem;">Zerada</span>`
                            }
                                                    </td>
                                                    <td class="fw-semibold">${escapeHTML(autor)}</td>
                                                </tr>
                                            `;
                    }).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    `;
                } else {
                    historicoHTML = `
                        <div class="mt-4 text-start text-muted py-2 text-center" style="font-size: 0.8rem; border: 1px dashed #dee2e6; border-radius: 8px; background-color: #f8f9fa;">
                            <i class="bi bi-info-circle me-1"></i> Nenhum histórico de meta registrado para este processo.
                        </div>
                    `;
                }
            }
        } catch (errHist) {
            console.error('Erro ao buscar histórico de metas:', errHist);
            historicoHTML = `
                <div class="mt-4 text-start text-danger py-2 text-center" style="font-size: 0.8rem; border: 1px dashed #f8d7da; border-radius: 8px;">
                    <i class="bi bi-exclamation-triangle me-1"></i> Não foi possível carregar o histórico de metas.
                </div>
            `;
        }

        const inputDisabled = isAdmin ? '' : 'disabled';
        const inputBg = isAdmin ? '' : 'background-color: #f8f9fa; color: #666; cursor: not-allowed;';

        const htmlContent = `
                        <div class="mt-2 text-start">
                            <label for="swal-input-date" class="form-label text-muted fw-bold" style="font-size: 0.85rem;">Selecione a data máxima esperada</label>
                            <input id="swal-input-date" type="date" class="form-control form-control-lg" value="${dataAtual}" ${inputDisabled} style="border: 2px solid #e9ecef; border-radius: 8px; font-size: 1.1rem; color: #333; box-shadow: none; ${inputBg}">
                        </div>
                        ${historicoHTML}
                    `;

        const { value: formValues, isConfirmed, isDenied } = await Swal.fire({
            title: `<div style="font-size: 1.3rem; font-weight: 700; color: #1B5E20; display: flex; align-items: center;"><i class="bi bi-calendar-check text-success me-2" style="font-size: 1.5rem;"></i> ${isAdmin ? 'Definir Meta' : 'Visualizar Meta'}</div><div style="font-size: 0.9rem; color: #666; margin-top: 6px; font-weight: 500;">Processo: <span class="text-dark fw-bold">${processo}</span></div>`,
            html: htmlContent,
            showCancelButton: true,
            showConfirmButton: isAdmin,
            showDenyButton: isAdmin && !!dataAtual, // Apenas mostra o botão Remover se já existir uma meta e for admin
            confirmButtonColor: '#008F3D',
            denyButtonColor: '#feebec',
            cancelButtonColor: '#f4f4f4',
            confirmButtonText: '<i class="bi bi-check2-circle me-1"></i>Salvar',
            cancelButtonText: isAdmin ? 'Cancelar' : 'Fechar',
            denyButtonText: '<i class="bi bi-trash me-1"></i>Remover',
            customClass: {
                popup: 'rounded-4 shadow-lg border-0',
                title: 'text-start border-bottom pb-3 mb-2',
                actions: 'w-100 px-4 pb-3 justify-content-between',
                confirmButton: 'btn btn-success px-4 py-2 fw-bold text-white',
                cancelButton: 'btn btn-light px-3 py-2 text-secondary fw-semibold border',
                denyButton: 'btn px-3 py-2 text-danger fw-semibold'
            },
            buttonsStyling: false,
            focusConfirm: false,
            preConfirm: () => {
                return document.getElementById('swal-input-date').value;
            }
        });

        if (isConfirmed) {
            const novoDate = formValues ? isoParaDate(formValues) : null;
            const linha = (window.allData || []).find(d => d.processo === processo);
            if (linha) {
                getMetaDate(linha, novoDate);
                updateReuniao();
            }
        } else if (isDenied) {
            const linha = (window.allData || []).find(d => d.processo === processo);
            if (linha) {
                getMetaDate(linha, null);
                updateReuniao();
            }
        }
    };

    // Event listener para o ícone de estrela (prioritário) — somente admin pode alterar
    if (uRole === 'admin') {
        mt.body.querySelectorAll('.proc-star-prioritario').forEach(star => star.addEventListener('click', (e) => {
            const target = e.currentTarget;
            const processo = target.dataset.proc;
            const novoValor = !target.classList.contains('bi-star-fill');
            setPrioritario(processo, novoValor);
            updateReuniao();
        }));
    }

    // Buscar status do SUITE e atualizar UI
    atualizarTabelaSuite(rows);
}

// Zero chamadas à Edge Function: renderiza a partir dos dados já vindos da tabela `processos`.
function atualizarTabelaSuite(rows) {
    if (!rows || rows.length === 0) return;

    const trPorNumero = new Map();
    document.querySelectorAll('tr[data-numero]').forEach(tr => {
        trPorNumero.set(tr.getAttribute('data-numero'), tr);
    });

    rows.forEach(d => {
        const tr = trPorNumero.get(escapeHTML(d.processo));
        if (!tr) return;

        const suiteCell = tr.querySelector('.suite-badge-container');
        const suiteTime = tr.querySelector('.suite-time-container');
        const suiteTimeText = tr.querySelector('.suite-time-text');
        const alertaIcone = tr.querySelector('.alerta-icone');
        const stTxt = (d.status || "").toUpperCase();
        const sigla = d.suite ? String(d.suite).toUpperCase().trim() : null;

        if (!sigla) {
            suiteCell.innerHTML = `<span class="badge rounded-pill bg-light text-muted border badge-custom-size">—</span>`;
            return;
        }

        suiteCell.innerHTML = `<span class="badge rounded-pill bg-light text-dark border badge-custom-size" style="background-color:#f8f9fa !important;color:#212529 !important;">${escapeHTML(sigla)}</span>`;

        if (d.suite_data_chegada) {
            const diffDays = Math.floor((Date.now() - new Date(d.suite_data_chegada).getTime()) / 86400000);
            suiteTimeText.textContent = diffDays > 0 ? `${diffDays} dia${diffDays > 1 ? 's' : ''}` : "Hoje";
            suiteTime.style.display = 'block';

            const ehFiscal = stTxt.includes('ANÁLISE FISCAL') || stTxt.includes('REANÁLISE FISCAL');
            if (['GECOPE', 'GECOP'].includes(sigla) && ehFiscal) {
                tr.classList.add('tr-alerta-fiscal');
                suiteTime.innerHTML += ` <span class="badge-tramitado-pulse">Tramitado</span>`;
            }
        }
        // Independente de haver data de chegada registrada: o alerta de pré-diligência
        // (usado também por varrerRiscoDiligenciaSegundoPlano, que chama isso sem essa
        // guarda) depende só de status/sigla, nunca de suite_data_chegada. Mantê-lo preso
        // ao "if" acima fazia o ícone/contagem da aba Aprovados sumir sempre que a tabela
        // `processos` ainda não tinha a data de chegada preenchida para aquele processo.
        aplicarAlertaPreDiligencia(d, tr, alertaIcone, sigla, stTxt);
    });
}

function fillCommonStatusFilters() {
    try {
        const statuses = Array.from(new Set((window.allData || []).map(d => d.status))).filter(v => v);
        if (typeof fillSelect === 'function') {
            if (mt && mt.status) fillSelect(mt.status, statuses);
        }
    } catch (e) { console.warn('fillCommonStatusFilters error', e); }
}

function populateAllTabFilters() {
    populateFinanceiroFilters();
    fillCommonStatusFilters();

    // Força os filtros estáticos da aba Reunião a iniciarem como "Todos"
    // (são <select> simples, não multiple — marcar todas as options como selected
    // faz o navegador manter apenas a última, ex: "Sem meta"/"Não Prioritário")
    [mt.meta, mt.prioritario].forEach(el => {
        if (!el) return;
        if (el.multiple) {
            Array.from(el.options).forEach(o => o.selected = true);
            renderMultiSelectUI(el);
        } else {
            el.value = "";
        }
    });

    updateReuniaoFilters(window.allData);

    // Verifica notificações de atraso (apenas admins ou autorizados)
    if (getCurrentUserRole() === 'admin') {
        verificarNotificacoesAtraso();
    }
}

// Administração movida para admin.js — chamando inicializador se presente
if (typeof verificarAdminSalvo === 'function') verificarAdminSalvo();

// Ao carregar, aplica role salvo (se houver)
(function () {
    const savedRole = sessionStorage.getItem('sop_role') || 'guest';

    const savedEmail = sessionStorage.getItem('sop_user');
    const savedUserName = sessionStorage.getItem('sop_user_name');

    // Se não tem nome ou se o nome salvo é apenas números (matrícula), tenta buscar o nome real
    if (savedEmail && (!savedUserName || /^\d+$/.test(savedUserName))) {
        sbClient.from('app_users').select('full_name, nome, sobrenome').eq('email', savedEmail).single().then(res => {
            if (res.data) {
                let realName = '';
                if (res.data.full_name && !/^\d+$/.test(res.data.full_name)) {
                    realName = res.data.full_name;
                } else if (res.data.nome) {
                    realName = (res.data.nome + (res.data.sobrenome ? ' ' + res.data.sobrenome : '')).toUpperCase();
                }

                if (realName) {
                    sessionStorage.setItem('sop_user_name', realName);
                }
            }
        });
    }

    if (savedRole !== 'guest') {
        toggleLanding(false);
        console.log('[DEBUG] IIFE: Landing ocultado (usuário já autenticado)');
    } else {
        console.log('[DEBUG] IIFE: Nenhum usuário autenticado. Landing será exibida.');
    }
    applyRoleToUI(savedRole);
})();

// Expose helper to global (for onclick from HTML)
try { window.hideAdminPendings = hideAdminPendings; } catch (e) { /* ignore */ }

// --- FIM DA LGICA ADMINISTRATIVA ---

