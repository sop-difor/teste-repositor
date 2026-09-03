let currentCompositionData = null;

// modules/composicoes/composicoes.js — módulo Composições: CRUD, versionamento, comentários,
// busca/cadastro de itens (SINAPI/SEINFRA/ORSE/mercado), cálculos e geração de relatório/PDF.
// Extraído de main.js (Fase 3 da reorganização modular).

async function processarAtendimentoComposicao() {
    const id = document.getElementById('atender-id-composicao').value;
    const index = document.getElementById('atender-index-comentario-comp').value;
    const resp = document.getElementById('textoAtenderComp').value;
    await processarDecisaoGenerica({
        table: 'composicoes_biblioteca', id, index, decision: 'atendido',
        respText: resp, modalId: 'modalAtenderComposicao', callback: carregarComposicoes
    });
}

async function processarRecusaComposicao() {
    const id = document.getElementById('recusar-id-composicao').value;
    const index = document.getElementById('recusar-index-comentario-comp').value;
    const resp = document.getElementById('textoRecusarComp').value;
    await processarDecisaoGenerica({
        table: 'composicoes_biblioteca', id, index, decision: 'recusado',
        respText: resp, modalId: 'modalRecusarComposicao', callback: carregarComposicoes
    });
}

async function deletarComposicao(id, path) {
    await deletarRegistroGenerico('composicoes_biblioteca', 'composicoes_biblioteca', id, path, carregarComposicoes);
}

/* ==========================================================================
   LGICA DAS NOVAS ABAS: COMPOSIÇÕES E TABELAS
   ========================================================================== */

/* --- 1. LGICA DE COMPOSIÇÕES (IDNTICA A ORAMENTOS) --- */

// 1.1 SALVAR NOVA COMPOSIÇÃO
async function salvarNovaComposicao() {
    const form = document.getElementById('formNovaComposicao');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const formData = new FormData(form);
    const arquivo = document.getElementById('inputArquivoUploadComp').files[0];
    const btn = document.querySelector('button[onclick="salvarNovaComposicao()"]');

    let textoOriginal = "Salvar";
    if (btn) {
        textoOriginal = btn.innerText;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ENVIANDO...';
    }

    try {
        if (!arquivo) throw new Error("Selecione um arquivo.");

        const categoria = formData.get('CATEGORIA').trim();
        const subcategoria = formData.get('SUBCATEGORIA').trim();
        const obra = formData.get('OBRA').trim();

        const catPath = limparStringParaPath(categoria);
        const subPath = limparStringParaPath(subcategoria);
        const obraPath = limparStringParaPath(obra);
        const arquivoNomePath = limparStringParaPath(arquivo.name);

        // Caminho no Bucket 'composicoes_biblioteca'
        const storagePath = `${catPath}/${subPath}/${obraPath}/V1_${arquivoNomePath}`;

        const { error: uploadError } = await sbClient.storage.from('composicoes_biblioteca').upload(storagePath, arquivo);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = sbClient.storage.from('composicoes_biblioteca').getPublicUrl(storagePath);

        const payload = {
            usuario: categoria.toUpperCase(),
            subcategoria: subcategoria.toUpperCase(),
            descricao: obra.toUpperCase(),
            status: formData.get('STATUS'),
            versao_atual: 'V1',
            arquivo_url: publicUrlData.publicUrl,
            arquivo_path: storagePath,
            criador_email: sessionStorage.getItem('sop_user') || 'sistema',
            criador_nome: sessionStorage.getItem('sop_user_name') || 'SISTEMA',
            criador_role: sessionStorage.getItem('sop_role') || 'fiscal',
            historico_versoes: [{
                versao: 'V1',
                data: new Date().toISOString(),
                descricao: 'Upload Inicial',
                url: publicUrlData.publicUrl,
                autor: sessionStorage.getItem('sop_user_name') || sessionStorage.getItem('sop_user') || 'Sistema'
            }]
        };

        const { error: dbError } = await sbClient.from('composicoes_biblioteca').insert([payload]);
        if (dbError) throw dbError;

        // Notificação WhatsApp
        processarNotificacao('atualizacao_composicao', {
            CODIGO_COMPOSICAO: payload.usuario || 'N/A',
            DESCRICAO: payload.descricao || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `cadastrou a composição: ${obra}`, '', obra);

        alert(" Composição cadastrada com sucesso!");
        form.reset();
        bootstrap.Modal.getInstance(document.getElementById('modalCadastrarComposicao')).hide();
        carregarComposicoes();

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar: " + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = textoOriginal; }
    }
}

// 1.2 CARREGAR COMPOSIÇÕES
function prepararNovaVersaoComposicao(id) {
    document.getElementById('update-id-composicao').value = id;
    document.getElementById('formNovaVersaoComposicao').reset();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNovaVersaoComposicao')).show();
}

async function enviarNovaVersaoComposicao() {
    const id = document.getElementById('update-id-composicao').value;
    const arquivo = document.getElementById('inputArquivoUpdateComp').files[0];
    const descricao = document.getElementById('inputDescricaoUpdateComp').value;

    if (!arquivo) return alert("Selecione um arquivo.");

    const btn = document.querySelector('#modalNovaVersaoComposicao button[onclick="enviarNovaVersaoComposicao()"]');
    const txtOrig = btn.innerText;
    btn.disabled = true; btn.innerText = "Processando...";

    try {
        const { data: currentData } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();

        // LIMPAR ARQUIVOS DE COMENTÁRIOS RESOLVIDOS
        if (currentData.comentarios_revisao && currentData.comentarios_revisao.length > 0) {
            await limparArquivosComentariosResolvidos('composicoes_biblioteca', 'composicoes_biblioteca', currentData.comentarios_revisao);
        }

        const currentV = parseInt(currentData.versao_atual.replace(/[^0-9]/g, '')) || 1;
        const newVersionLabel = `V${currentV + 1}`;

        // Upload
        const nomeLimpo = arquivo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
        const pathParts = currentData.arquivo_path.split('/');
        if (pathParts.length > 1) pathParts.pop();
        const newStoragePath = `${pathParts.join('/')}/${newVersionLabel}_${nomeLimpo}`;

        const { error: uploadError } = await sbClient.storage.from('composicoes_biblioteca').upload(newStoragePath, arquivo);
        if (uploadError) throw uploadError;

        const { data: pubUrl } = sbClient.storage.from('composicoes_biblioteca').getPublicUrl(newStoragePath);

        // Histórico
        const oldHistory = currentData.historico_versoes || [];
        oldHistory.push({ versao: currentData.versao_atual, url: currentData.arquivo_url, data: new Date().toISOString(), motivo: 'Versão arquivada' });

        // Update Table
        await sbClient.from('composicoes_biblioteca').update({
            versao_atual: newVersionLabel,
            arquivo_url: pubUrl.publicUrl,
            arquivo_path: newStoragePath,
            historico_versoes: oldHistory,
            status: 'Atualizado',
            created_at: new Date().toISOString()
        }).eq('id', id);

        if (descricao) {
            // Salvar comentário de sistema
            const { data: curr } = await sbClient.from('composicoes_biblioteca').select('comentarios_revisao').eq('id', id).single();
            const novoArr = curr.comentarios_revisao || [];
            novoArr.unshift({ autor: 'Sistema (Versão)', mensagem: `Gerada versão ${newVersionLabel}: ${descricao}`, data: new Date().toISOString() });
            await sbClient.from('composicoes_biblioteca').update({ comentarios_revisao: novoArr }).eq('id', id);
        }

        alert(`Versão ${newVersionLabel} de Composição enviada! Arquivos de comentários resolvidos foram limpos.`);

        // Notificação WhatsApp
        processarNotificacao('atualizacao_composicao', {
            CODIGO_COMPOSICAO: currentData?.codigo || 'N/A',
            DESCRICAO: currentData?.descricao || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `atualizou a versão (${newVersionLabel}) da composição: ${currentData?.descricao || 'N/A'}`, '', currentData?.descricao);

        bootstrap.Modal.getInstance(document.getElementById('modalNovaVersaoComposicao')).hide();
        carregarComposicoes();
    } catch (err) { alert("Erro: " + err.message); } finally { btn.disabled = false; btn.innerText = txtOrig; }
}

// 1.4 COMENTÁRIOS COMPOSIÇÃO
async function prepararComentarioComposicao(id) {
    try {
        const modalEl = document.getElementById('modalComentarioComposicao');
        if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);

        document.getElementById('coment-id-composicao').value = id;
        const { data, error } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById('coment-nome-composicao').value = data.descricao || '';
        document.querySelector('#formComentarioComposicao textarea[name="MENSAGEM"]').value = '';

        const sel = document.getElementById('coment-fiscal-comp');
        // Preenche automaticamente com o usuário logado
        const currentUserNameComp = sessionStorage.getItem('sop_user_name') || sessionStorage.getItem('sop_user') || 'Usuário';
        sel.innerHTML = `<option value="${escapeHTML(currentUserNameComp)}" selected>${escapeHTML(currentUserNameComp)}</option>`;
        // Visualmente "readonly"
        sel.style.backgroundColor = '#e9ecef';
        sel.style.pointerEvents = 'none';

        const chat = document.getElementById('historico-comentarios-comp');
        const comments = data.comentarios_revisao || [];

        chat.innerHTML = comments.length ? comments.map(c => `
                            <div class="mb-2 border-bottom pb-1">
                                <div class="d-flex justify-content-between"><strong class="text-primary" style="font-size:0.75rem">${escapeHTML(c.autor)}</strong><span class="text-muted" style="font-size:0.7rem">${c.data ? new Date(c.data).toLocaleDateString() : '-'}</span></div>
                                <div style="font-size:0.8rem">${escapeHTML(c.mensagem)}</div>
                                ${c.arquivo ? `<a href="${escapeHTML(c.arquivo)}" target="_blank" rel="noopener noreferrer" class="badge bg-light text-dark border mt-1"><i class="bi bi-paperclip"></i> Anexo</a>` : ''}
                            </div>`).join('') : '<em class="text-muted">Sem mensagens.</em>';

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (err) {
        alert("Erro ao carregar comentários: " + err.message);
    }
}

async function enviarComentarioComposicao() {
    const btn = document.querySelector('#modalComentarioComposicao .btn-primary');
    const txtOrig = btn.innerText;

    const id = document.getElementById('coment-id-composicao').value;
    const autor = document.getElementById('coment-fiscal-comp').value;
    const msg = document.querySelector('#formComentarioComposicao textarea[name="MENSAGEM"]').value;
    const anexo = document.getElementById('inputArquivoComentarioComp').files[0];

    if (!autor || !msg) return alert("Preencha autor e mensagem.");

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> Enviando...';

    try {
        let anexoUrl = null;
        if (anexo) {
            const nomeLinpo = sanitizarNomeArquivo(anexo.name);
            const path = `anexos_comentarios/${id}_${Date.now()}_${nomeLinpo}`;
            const { error: uploadError } = await sbClient.storage.from('composicoes_biblioteca').upload(path, anexo);
            if (uploadError) throw uploadError;
            anexoUrl = sbClient.storage.from('composicoes_biblioteca').getPublicUrl(path).data.publicUrl;
        }

        const { data: curr, error: fetchError } = await sbClient.from('composicoes_biblioteca').select('comentarios_revisao').eq('id', id).single();
        if (fetchError) throw fetchError;

        const novoArr = curr.comentarios_revisao || [];
        novoArr.unshift({ autor, mensagem: msg, data: new Date().toISOString(), arquivo: anexoUrl, decisao: 'pendente' });

        const { error: updateError } = await sbClient.from('composicoes_biblioteca').update({ comentarios_revisao: novoArr, status: 'Em Revisão' }).eq('id', id);
        if (updateError) throw updateError;

        alert("Solicitação enviada!");

        // Notificação WhatsApp
        processarNotificacao('novo_comentario_composicao', {
            AUTOR: autor,
            CODIGO_COMPOSICAO: curr?.codigo || 'N/A',
            DESCRICAO: curr?.descricao || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `adicionou um comentário na composição: ${curr?.descricao || 'N/A'}`, '', curr?.descricao);

        bootstrap.Modal.getInstance(document.getElementById('modalComentarioComposicao')).hide();
        carregarComposicoes();
    } catch (err) {
        alert("Erro ao enviar: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = txtOrig;
    }
}

function abrirModalAtenderComposicao(id, index) {
    abrirModalDecisao('modalAtenderComposicao', id, index, 'atender-id-composicao', 'atender-index-comentario-comp', 'formAtenderComp');
}

function abrirModalRecusarComposicao(id, index) {
    abrirModalDecisao('modalRecusarComposicao', id, index, 'recusar-id-composicao', 'recusar-index-comentario-comp', 'formRecusarComp');
}

async function deletarItemHistoricoComposicao(id, index) {
    if (!confirm("️ Tem certeza que deseja excluir este registro do histórico?")) return;

    const btn = document.activeElement;
    if (btn) btn.disabled = true;

    try {
        const { data, error } = await sbClient.from('composicoes_biblioteca').select('comentarios_revisao, versao_atual').eq('id', id).single();
        if (error) throw error;

        let historico = data.comentarios_revisao || [];

        if (index >= 0 && index < historico.length) {
            historico.splice(index, 1);
        } else {
            throw new Error("Item não encontrado.");
        }

        let payloadUpdate = { comentarios_revisao: historico };

        // --- LGICA DE STATUS DINMICO ---
        const temPendentes = historico.some(c => c.decisao === 'pendente');
        if (temPendentes) {
            payloadUpdate.status = 'Em Revisão';
        } else {
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        if (historico.length === 0) {
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        const { error: updateError } = await sbClient.from('composicoes_biblioteca').update(payloadUpdate).eq('id', id);
        if (updateError) throw updateError;

        alert("Registro excluído!");
        carregarComposicoes();

    } catch (err) {
        alert("Erro ao excluir: " + err.message);
        if (btn) btn.disabled = false;
    }
}

// 1.2 CARREGAR COMPOSIÇÕES (CORRIGIDO)
// O grupo SOP (OFICIAL) concentra milhares de registros (~2.800), então ele NUNCA é
// carregado por inteiro: só buscamos a contagem total (para o badge) e, quando o
// usuário digita um termo de busca, os itens filtrados diretamente no banco (server-side).
// Os demais grupos (composições próprias e de outros usuários) somam poucas dezenas de
// itens e continuam sendo carregados por completo, como antes.
const SOP_SEARCH_MIN_CHARS = 2;
const SOP_RESULT_LIMIT = 300;

async function carregarComposicoes() {
    const container = document.getElementById('accordionComposicoes');
    const termoBusca = document.getElementById('comp-search').value.trim().toLowerCase();
    const role = (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
    const isAdmin = (document.body.classList.contains('is-admin') || role === 'admin' || role === 'gerente') && role !== 'fiscal';
    const userEmail = sessionStorage.getItem('sop_user');
    const currentUserName = (sessionStorage.getItem('sop_user_name') || '').toUpperCase();
    const currentFiscalName = (sessionStorage.getItem('sop_fiscal_name') || '').toUpperCase();

    if (!container) return;
    container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-success"></div><div class="mt-2 text-secondary fw-bold">Carregando composições...</div></div>';

    try {
        let data = [];
        let hasMore = true;
        let blockStart = 0;
        const blockSize = 1000;
        let queryError = null;

        while (hasMore) {
            const { data: bData, error } = await sbClient
                .from('composicoes_biblioteca')
                .select('*')
                .neq('usuario', 'SOP')
                .order('usuario', { ascending: true })
                .order('subcategoria', { ascending: true })
                .order('descricao', { ascending: true })
                .range(blockStart, blockStart + blockSize - 1);

            if (error) {
                queryError = error;
                break;
            }

            if (bData && bData.length > 0) {
                data = data.concat(bData);
                blockStart += blockSize;
                if (bData.length < blockSize) {
                    hasMore = false;
                }
            } else {
                hasMore = false;
            }
        }

        if (queryError) {
            console.error('[ERRO Composições]', queryError);
            container.innerHTML = `<div class="alert alert-danger">Erro ao carregar banco: ${queryError.message}</div>`;
            return;
        }

        // SOP: apenas a contagem total (rápida, "head only") + busca filtrada no banco
        // quando há termo digitado. Nunca traz os ~2.800 registros de uma vez.
        const { count: sopTotalCount, error: sopCountError } = await sbClient
            .from('composicoes_biblioteca')
            .select('*', { count: 'exact', head: true })
            .eq('usuario', 'SOP');

        if (sopCountError) console.error('[ERRO Contagem SOP]', sopCountError);
        // Se a contagem falhar, usamos '?' no badge em vez de deixá-lo implicitamente
        // virar 0 (o que passaria a falsa impressão de que o grupo SOP está vazio).
        const sopCountDisplay = sopCountError ? '?' : (sopTotalCount ?? 0);

        const sopSearched = termoBusca.length >= SOP_SEARCH_MIN_CHARS;
        let sopItens = [];
        let sopTruncated = false;

        if (sopSearched) {
            const { data: sopData, error: sopError } = await sbClient
                .from('composicoes_biblioteca')
                .select('*')
                .eq('usuario', 'SOP')
                .or(`descricao.ilike.%${termoBusca}%,codigo.ilike.%${termoBusca}%`)
                .order('descricao', { ascending: true })
                .limit(SOP_RESULT_LIMIT + 1);

            if (sopError) {
                console.error('[ERRO Busca SOP]', sopError);
            } else if (sopData) {
                sopTruncated = sopData.length > SOP_RESULT_LIMIT;
                sopItens = sopTruncated ? sopData.slice(0, SOP_RESULT_LIMIT) : sopData;
            }
        }

        console.log(`[DEBUG] Composições carregadas: ${data?.length || 0} (outros) + ${sopItens.length} (SOP, de ${sopTotalCount || 0} no total).`);

        const arvore = {};
        data.forEach(item => {
            try {
                const desc = (item.descricao || "").toLowerCase();
                const user = (item.usuario || "").toLowerCase();
                const code = (item.codigo || "").toLowerCase();

                if (termoBusca && !desc.includes(termoBusca) && !user.includes(termoBusca) && !code.includes(termoBusca)) return;

                const userKey = (item.usuario || 'OUTROS').toUpperCase();
                if (!arvore[userKey]) arvore[userKey] = [];
                arvore[userKey].push(item);
            } catch (e) {
                console.error('[ERRO Item Composicao]', e, item);
            }
        });

        // SOP entra sempre na árvore (mesmo vazia) para o grupo continuar visível.
        arvore['SOP'] = sopItens;

        const sortedUsers = Object.keys(arvore).sort((a, b) => {
            if (a === 'SOP') return -1;
            if (b === 'SOP') return 1;
            const isMeA = (a === currentUserName || a === currentFiscalName || (userEmail && a.toUpperCase().includes(userEmail.toUpperCase())));
            const isMeB = (b === currentUserName || b === currentFiscalName || (userEmail && b.toUpperCase().includes(userEmail.toUpperCase())));
            if (isMeA) return -1;
            if (isMeB) return 1;
            return a.localeCompare(b, 'pt-BR');
        });

        let html = '';
        let uIndex = 2000;

        for (const userKey of sortedUsers) {
            uIndex++;
            const collapseId = `collapseCompUser${uIndex}`;
            const itens = arvore[userKey];

            const isMe = (userKey === currentUserName || userKey === currentFiscalName || (userEmail && userKey.toUpperCase().includes(userEmail.toUpperCase())));
            const isSop = (userKey === 'SOP');

            let accordionClass = '';
            let iconClassHeader = 'bi bi-folder2-open me-2 text-success';
            let titleLabel = userKey;

            if (isMe) {
                accordionClass = 'accordion-header-me';
                iconClassHeader = 'bi bi-person-fill-check me-2 text-success';
                titleLabel = `COMPOSIÇÕES PRÓPRIAS (${userKey})`;
            } else if (isSop) {
                accordionClass = 'accordion-header-sop';
                iconClassHeader = 'bi bi-building-fill-check me-2 text-primary';
                titleLabel = 'SOP (OFICIAL)';
            }

            let itensHtml = '';
            itens.sort((a, b) => {
                const codeA = (a.codigo || "").toUpperCase();
                const codeB = (b.codigo || "").toUpperCase();
                if (codeA && codeB) return codeA.localeCompare(codeB, 'pt-BR', { numeric: true });
                return (a.descricao || "").localeCompare(b.descricao || "", 'pt-BR', { numeric: true });
            });

            itens.forEach(obra => {
                const isAnalytical = !!(obra.itens && Array.isArray(obra.itens));
                const iconClassRow = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? 'icon-pdf' : (isAnalytical ? 'icon-generic' : 'icon-xls');
                const iconSymbol = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? '<i class="bi bi-file-earmark-pdf"></i>' : (isAnalytical ? '<i class="bi bi-calculator"></i>' : '<i class="bi bi-file-earmark-spreadsheet"></i>');
                const dataFormatada = new Date(obra.created_at || obra.data).toLocaleDateString('pt-BR');

                const historico = obra.comentarios_revisao || [];
                const qtdComentarios = historico.length;
                let badgeStatus = '';
                const temPendenteComp = historico.some(c => c.decisao === 'pendente');
                if (temPendenteComp) {
                    badgeStatus = `<span class="badge bg-warning text-dark ms-2" style="font-size:0.65rem">Em Revisão</span>`;
                } else if (obra.status === 'Atualizado' || parseInt(String(obra.versao_atual || '').replace(/[^0-9]/g, '')) > 1) {
                    badgeStatus = `<span class="badge badge-status-atualizado">Atualizado</span>`;
                }

                const histId = `hist_comp_v2_${obra.id}`;
                let botaoHistorico = qtdComentarios > 0 ? `<button class="btn-toggle-history" type="button" data-bs-toggle="collapse" data-bs-target="#${histId}"><i class="bi bi-clock-history"></i> Histórico (${qtdComentarios}) <i class="bi bi-chevron-down ms-1"></i></button>` : '';

                let containerHistoricoHtml = '';
                if (qtdComentarios > 0) {
                    const listaComentarios = historico.map((c, idx) => {
                        const dC = c.data ? new Date(c.data).toLocaleDateString('pt-BR') : '-';
                        let clSt = '', bD = '', rA = '', bAA = '';
                        if (c.autor && c.autor.toLowerCase().includes('sistema')) clSt = 'system-log-entry';
                        if (c.decisao === 'atendido') {
                            clSt = 'status-atendido'; bD = `<span class="badge-decision badge-atendido"><i class="bi bi-check-lg"></i> ATENDIDO</span>`;
                            if (c.resp_admin) rA = `<div class="mt-2 pt-2 border-top small text-success"><strong>Resposta:</strong> ${escapeHTML(c.resp_admin)}</div>`;
                        } else if (c.decisao === 'recusado') {
                            clSt = 'status-recusado'; bD = `<span class="badge-decision badge-recusado"><i class="bi bi-x-lg"></i> NO ACATADO</span>`;
                            if (c.resp_admin) rA = `<div class="mt-2 pt-2 border-top small text-danger"><strong>Motivo:</strong> ${escapeHTML(c.resp_admin)}</div>`;
                        } else if (isAdmin && !clSt.includes('system')) {
                            bAA = `<div class="admin-decision-actions"><button class="btn btn-sm btn-outline-success" onclick="abrirModalAtenderComposicao(${obra.id}, ${idx})"><i class="bi bi-check-lg"></i> Atender</button><button class="btn btn-sm btn-outline-danger" onclick="abrirModalRecusarComposicao(${obra.id}, ${idx})"><i class="bi bi-x-lg"></i> Não Acatar</button></div>`;
                        }
                        let bAnex = c.arquivo ? `<a href="${escapeHTML(c.arquivo)}" target="_blank" rel="noopener noreferrer" class="btn-history-anexo mt-2"><i class="bi bi-paperclip"></i> Ver Memória Anexo</a>` : '';
                        let bExc = isAdmin ? `<button class="btn btn-sm text-danger border-0 p-0 ms-2 admin-only" title="Excluir Registro" onclick="deletarItemHistoricoComposicao(${obra.id}, ${idx})"><i class="bi bi-x-lg"></i></button>` : '';
                        return `<div class="history-card-item ${clSt}"><div class="history-card-header"><div><strong>${escapeHTML(c.autor)}</strong> <span class="fw-normal ms-1">- ${dC}</span></div><div class="d-flex align-items-center">${bD}${bExc}</div></div><div class="history-card-body"><div>${escapeHTML(c.mensagem)}</div>${bAnex}${rA}${bAA}</div></div>`;
                    }).join('');
                    containerHistoricoHtml = `<div class="collapse" id="${histId}"><div class="history-collapse-box">${listaComentarios}</div></div>`;
                }

                const historicoObra = obra.historico_versoes || [];
                const autorV1 = String((historicoObra[0] && historicoObra[0].autor) ? historicoObra[0].autor : (obra.criador_nome || obra.criador_email || 'Administrador/Legado'));
                const isOwner = (userEmail && autorV1.toUpperCase().includes(userEmail.toUpperCase())) || (currentUserName && autorV1.toUpperCase().includes(currentUserName)) || (currentFiscalName && autorV1.toUpperCase().includes(currentFiscalName));

                itensHtml += `
                                <div class="mb-2">
                                    <div class="orcamento-item-row" style="margin-bottom:0; border-radius: 8px 8px ${qtdComentarios > 0 ? '0 0' : '8px 8px'};">
                                        <div class="d-flex align-items-center">
                                            <div class="file-icon-box ${iconClassRow}">${iconSymbol}</div>
                                            <div style="flex: 1; min-width: 0;">
                                                <div class="d-flex align-items-center mb-1">
                                                    <span class="text-secondary small me-2" style="font-family: monospace; font-weight: 700; letter-spacing: 0.5px;">#${obra.codigo || 'S/C'}</span>
                                                    <span class="badge bg-dark ms-1" style="font-size:0.65rem; font-weight: 700; border-radius: 4px; padding: 2px 6px;">${obra.versao_atual || 'V1'}</span>
                                                    ${badgeStatus}
                                                </div>
                                                <div class="fw-bold text-dark pe-3" style="font-size:0.95rem; text-align: justify; line-height: 1.4;">
                                                    ${escapeHTML(obra.descricao) || "Sem Descrição"}
                                                </div>
                                                <div class="text-muted mt-1" style="font-size:0.75rem;">
                                                    ${isSop ? '  Criado por: Setor de Orçamento da SOP' : `Subcategoria: ${escapeHTML(obra.subcategoria) || 'GERAL'}  Criado por: ${escapeHTML(autorV1)} em ${dataFormatada}`}
                                                </div>
                                                ${botaoHistorico}
                                            </div>
                                        </div>
                                        <div class="orcamento-actions">
                                            <button class="btn btn-action-baixar" onclick="prepararExportacaoComposicao(${obra.id}, '${obra.arquivo_url || ''}')" title="Imprimir Composição"><i class="bi bi-printer"></i> Imprimir</button>
                                            <button class="btn btn-action-icon ms-1" onclick="visualizarComposicao(${obra.id}, '${obra.arquivo_url || ''}')" title="Visualizar Documento"><i class="bi bi-eye-fill text-primary"></i></button>
                                            ${canEditComposition(obra) ? `
                                                ${isAnalytical ?
                            `<button class="btn btn-action-icon" onclick="editarComposicaoAnalitica(${obra.id})" title="Alterar Composição"><i class="bi bi-pencil-square text-primary"></i></button>` :
                            `<button class="btn btn-action-icon" onclick="prepararNovaVersaoComposicao(${obra.id})" title="Alterar Versão"><i class="bi bi-cloud-arrow-up-fill icon-cloud"></i></button>`
                        }
                                            ` : ''}
                                            <button class="btn btn-action-icon" onclick="prepararComentarioComposicao(${obra.id})" title="Adicionar Comentário"><i class="bi bi-chat-left-text-fill text-warning"></i></button>
                                            ${canDeleteComposition(obra) ? `
                                                <button class="btn btn-action-icon" onclick="deletarComposicao(${obra.id}, '${obra.arquivo_path}')" title="Excluir Composição"><i class="bi bi-trash-fill icon-trash"></i></button>
                                            ` : ''}
                                        </div>
                                    </div>
                                    ${containerHistoricoHtml}
                                </div>`;
            });

            // SOP não carrega tudo de uma vez: sem termo de busca (mín. 2 caracteres),
            // mostra um convite para buscar em vez da lista completa; com busca sem
            // resultado, avisa; com resultado truncado, avisa que há mais itens.
            if (isSop && itens.length === 0) {
                itensHtml = sopSearched
                    ? `<div class="text-center text-muted py-4 small">Nenhuma composição SOP encontrada para "${escapeHTML(termoBusca)}".</div>`
                    : `<div class="text-center text-muted py-4 small"><i class="bi bi-search me-1"></i> Utilize o campo de busca acima (mínimo ${SOP_SEARCH_MIN_CHARS} caracteres) para consultar as ${sopTotalCount ? sopTotalCount.toLocaleString('pt-BR') + ' ' : ''}composições oficiais da SOP.${sopCountError ? ' (Não foi possível carregar a contagem total agora.)' : ''}</div>`;
            } else if (isSop && sopTruncated) {
                itensHtml += `<div class="text-center text-muted small py-2 border-top mt-2"><i class="bi bi-info-circle me-1"></i> Exibindo os primeiros ${SOP_RESULT_LIMIT} resultados. Refine a busca para itens mais específicos.</div>`;
            }

            // Sem busca: badge mostra o total da biblioteca SOP (convite a explorar).
            // Com busca: badge mostra o nº de resultados encontrados (como nos demais
            // grupos), não mais o total — senão o badge nunca refletia o filtro aplicado.
            const badgeCount = isSop
                ? (sopSearched ? (sopTruncated ? `${SOP_RESULT_LIMIT}+` : itens.length) : sopCountDisplay)
                : itens.length;

            html += `
                            <div class="accordion-custom-item">
                                <h2 class="accordion-header">
                                    <button class="accordion-button accordion-custom-button collapsed ${accordionClass}" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                                        <i class="${iconClassHeader}"></i> ${titleLabel} <span class="badge bg-white text-dark ms-2 opacity-75" style="font-size: 0.65rem;">${badgeCount}</span>
                                    </button>
                                </h2>
                                <div id="${collapseId}" class="accordion-collapse collapse">
                                    <div class="accordion-body bg-white pt-2">
                                        ${itensHtml}
                                    </div>
                                </div>
                            </div>`;
        }
        container.innerHTML = html || '<div class="text-center py-5 text-muted">Nenhuma composição disponível.</div>';
    } catch (err) {
        console.error('[ERRO carregarComposicoes]', err);
        container.innerHTML = `<div class="alert alert-danger">Erro crítico ao carregar composições: ${err.message}</div>`;
    }
}

// --- GLOBAL INIT LISTENERS (Moved out to fix loop) ---
document.addEventListener('DOMContentLoaded', () => {
    // Initial Load
    carregarComposicoes();

    // Search Listener
    document.getElementById('comp-search')?.addEventListener('input', debounce(() => {
        carregarComposicoes();
    }, 500));

    // Clear Listener
    document.getElementById('btn-comp-clear')?.addEventListener('click', () => {
        const input = document.getElementById('comp-search');
        if (input) {
            input.value = '';
            carregarComposicoes();
        }
    });

    // Fix Modals Position
    const modaisParaMover = [
        'modalCadastrarComposicao', 'modalNovaVersaoComposicao', 'modalAtenderComposicao',
        'modalRecusarComposicao', 'modalCriarComposicaoAnalitica', 'modalBuscarItemComposicao',
        'modalComentarioOrcamento', 'modalComentarioComposicao', 'modalExportarComposicao',
        'modalNovaVersao', 'modalNovoOrcamento', 'modalLogin', 'modalVincularFiscal'
    ];
    modaisParaMover.forEach(id => {
        const el = document.getElementById(id);
        if (el && el.parentElement !== document.body) document.body.appendChild(el);
    });
});

// --- LÓGICA ABA COMPOSIÇÕES ---

// --- STATE MANAGEMENT ---
let currentCompositionItems = [];

// 2.1 ABRIR CRIADOR (Ensure Global Scope)
window.abrirCriadorComposicao = async function () {
    try {
        const modalEl = document.getElementById('modalCriarComposicaoAnalitica');
        if (!modalEl) {
            alert('Erro: Modal de criação não encontrado.');
            return;
        }

        // Reset State
        currentCompositionItems = [];
        const editIdEl = document.getElementById('edit-id-composicao');
        if (editIdEl) editIdEl.value = ''; // Limpa ID de edição

        const form = document.getElementById('formComposicaoAnalitica');
        if (form) form.reset();

        const tbody = document.getElementById('tbody-itens-composicao');
        if (tbody) tbody.innerHTML = '<tr class="text-center text-muted" id="placeholder-itens-vazio"><td colspan="8" class="py-4">Nenhum item adicionado. Clique em "Adicionar Item".</td></tr>';

        if (document.getElementById('total-material')) document.getElementById('total-material').textContent = 'R$ 0,00';
        if (document.getElementById('total-mao-de-obra')) document.getElementById('total-mao-de-obra').textContent = 'R$ 0,00';
        if (document.getElementById('total-equipamentos')) document.getElementById('total-equipamentos').textContent = 'R$ 0,00';
        if (document.getElementById('total-servico')) document.getElementById('total-servico').textContent = 'R$ 0,00';
        if (document.getElementById('total-geral')) document.getElementById('total-geral').textContent = 'R$ 0,00';

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (err) {
        console.error('Erro ao abrir criador:', err);
        alert('Erro ao abrir o criador de composição: ' + err.message);
    }
}

window.editarComposicaoAnalitica = async function (id) {
    try {
        const { data, error } = await sbClient
            .from('composicoes_biblioteca')
            .select('*')
            .eq('id', id)
            .single();

        if (error) throw error;

        const modalEl = document.getElementById('modalCriarComposicaoAnalitica');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

        // Preencher campos básicos
        document.getElementById('edit-id-composicao').value = data.id;
        document.getElementById('comp-codigo').value = data.codigo || '';
        document.getElementById('comp-descricao').value = data.descricao || '';
        document.getElementById('comp-unidade').value = data.unidade || '';
        document.getElementById('comp-data').value = data.data_base || '';
        document.getElementById('comp-bdi').value = data.bdi || '0,00';
        document.getElementById('comp-desconto').value = data.desconto || '0,00';

        // Carregar Itens
        currentCompositionItems = data.itens || [];
        renderizarItensComposicao();
        atualizarCalculosComposicao();

        modal.show();
    } catch (err) {
        console.error('Erro ao carregar para edição:', err);
        alert("Erro ao carregar composição: " + err.message);
    }
}

// (Função atualizarVersoesComposicao removida - Lógica movida para Modal de Busca abaixo)

// 2.2 MODAL BUSCAR ITEM
async function abrirModalBuscarItem() {
    document.getElementById('busca-item-termo').value = '';
    document.getElementById('lista-resultados-itens').innerHTML = '<div class="text-center py-3 text-muted small">Digite algo para buscar...</div>';

    // Reset Filters to Default
    document.getElementById('busca-item-fonte').value = 'SEINFRA';

    // Reset UI Mode
    toggleBuscaItemMode();

    await atualizarVersoesBusca(); // Load initial versions

    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalBuscarItemComposicao')).show();
}

window.toggleBuscaItemMode = function () {
    const fonte = document.getElementById('busca-item-fonte').value;
    const containerBusca = document.getElementById('container-busca-item');
    const listaResultados = document.getElementById('lista-resultados-itens');
    const formMercado = document.getElementById('form-cadastro-mercado');
    const formOutras = document.getElementById('form-cadastro-outras');
    const versao = document.getElementById('busca-item-versao');
    const ref = document.getElementById('busca-item-referencia');

    // Fontes com cadastro 100% manual (sem busca em tabela de referência).
    const isManual = (fonte === 'MERCADO' || fonte === 'OUTRAS');

    containerBusca.classList.toggle('d-none', isManual);
    listaResultados.classList.toggle('d-none', isManual);
    formMercado.classList.toggle('d-none', fonte !== 'MERCADO');
    formOutras.classList.toggle('d-none', fonte !== 'OUTRAS');
    versao.disabled = isManual;
    ref.disabled = isManual;

    if (!isManual) atualizarVersoesBusca();
}

// Currency Input Mask
window.formatMoneyInput = function (input) {
    let value = input.value.replace(/\D/g, '');
    if (value === '') return;

    const numberValue = parseFloat(value) / 100;
    input.value = numberValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    calcularPrecoRetroativo(); // Trigger recalc
}

window.calcularPrecoRetroativo = function () {
    const rawPreco = document.getElementById('mercado-preco').value.replace(/\./g, '').replace(',', '.');
    const preco = parseFloat(rawPreco) || 0;

    const parseIndex = (val) => {
        if (!val) return 0;
        return parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0;
    };

    const indIni = parseIndex(document.getElementById('mercado-ind-ini').value);
    const indFin = parseIndex(document.getElementById('mercado-ind-fin').value);
    const elResult = document.getElementById('mercado-preco-calc');

    if (preco > 0 && indIni > 0 && indFin > 0) {
        const novoPreco = preco * (indFin / indIni);
        elResult.textContent = novoPreco.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        elResult.dataset.value = novoPreco; // Store raw value
    } else {
        elResult.textContent = 'R$ 0,00';
        delete elResult.dataset.value;
    }
}

// Index Input Mask (3 decimals)
window.formatIndexInput = function (input) {
    let value = input.value.replace(/\D/g, '');
    if (value === '') return;

    const numberValue = parseFloat(value) / 1000;
    // Force 3 decimal places
    input.value = numberValue.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    calcularPrecoRetroativo();
}

window.adicionarLinhaFornecedor = function () {
    const container = document.getElementById('container-fornecedores');
    const div = document.createElement('div');
    div.className = 'row g-1 mb-1 align-items-center linha-fornecedor';
    div.innerHTML = `
                        <div class="col-7">
                            <input type="text" class="form-control form-control-sm input-fornecedor-nome" placeholder="Nome do Fornecedor...">
                        </div>
                        <div class="col-4">
                            <div class="input-group input-group-sm">
                                <span class="input-group-text">R$</span>
                                <input type="text" class="form-control input-fornecedor-valor" oninput="formatMoneyInput(this); calcularPrecoAdotado()" placeholder="0,00">
                            </div>
                        </div>
                        <div class="col-1 text-end">
                            <button type="button" class="btn btn-sm btn-link text-danger p-0" onclick="removerLinhaFornecedor(this)"><i class="bi bi-dash-circle"></i></button>
                        </div>
                    `;
    container.appendChild(div);
}

window.removerLinhaFornecedor = function (btn) {
    btn.closest('.linha-fornecedor').remove();
    calcularPrecoAdotado();
}

window.calcularPrecoAdotado = function () {
    const valores = Array.from(document.querySelectorAll('.input-fornecedor-valor'))
        .map(input => parseFloat(input.value.replace(/\./g, '').replace(',', '.')) || 0)
        .filter(v => v > 0);

    if (valores.length === 0) return;

    const metodo = document.querySelector('input[name="mercado-metodo-preco"]:checked').value;
    let resultado = 0;

    if (metodo === 'MENOR') {
        resultado = Math.min(...valores);
    } else {
        resultado = valores.reduce((a, b) => a + b, 0) / valores.length;
    }

    const inputPreco = document.getElementById('mercado-preco');
    inputPreco.value = resultado.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    calcularPrecoRetroativo();
}

// Listeners removed (handled by oninput)

window.adicionarItemMercadoManual = function () {
    const desc = document.getElementById('mercado-desc').value.trim();
    const unid = document.getElementById('mercado-unid').value.trim().toUpperCase();
    // Check if calculated price exists
    const calcPrice = document.getElementById('mercado-preco-calc').dataset.value;

    const rawPreco = document.getElementById('mercado-preco').value.replace(/\./g, '').replace(',', '.');
    let preco = parseFloat(rawPreco);

    if (calcPrice) {
        // FIX: Ensure 2-decimal precision to match Memory Calculation
        preco = parseFloat(parseFloat(calcPrice).toFixed(2));
    }

    const coef = parseFloat(document.getElementById('mercado-coef').value);

    // Retro Fields
    const dataIni = document.getElementById('mercado-data-ini').value;
    const indIni = document.getElementById('mercado-ind-ini').value;
    const dataFin = document.getElementById('mercado-data-fin').value;
    const indFin = document.getElementById('mercado-ind-fin').value;

    // Fields for Multiple Suppliers
    const fornecedores = Array.from(document.querySelectorAll('.linha-fornecedor')).map(div => ({
        nome: div.querySelector('.input-fornecedor-nome').value.trim(),
        valor: parseFloat(div.querySelector('.input-fornecedor-valor').value.replace(/\./g, '').replace(',', '.')) || 0
    })).filter(f => f.nome && f.valor > 0);
    const metodoPreco = document.querySelector('input[name="mercado-metodo-preco"]:checked').value;

    if (!desc) { alert("Informe a descrição."); return; }
    if (!unid) { alert("Informe a unidade."); return; }
    if (isNaN(preco) || preco <= 0) { alert("Preço inválido."); return; }
    if (isNaN(coef) || coef <= 0) { alert("Coeficiente inválido."); return; }

    // Construct detailed description if retro
    let finalDesc = desc;
    /* // Optional: Append retro info to description? User didn't ask, but it's good practice. 
       // I will stick to metadata storage for now as user just asked to fill blanks. 
    */

    adicionarItemComposicao({
        fonte: 'MERCADO',
        versao: new Date().toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase(),
        referencia: 'COTAÇÃO',
        codigo: 'COTAÇÃO',
        descricao: finalDesc,
        unidade: unid,
        preco: preco,
        tipo: 'INSUMO',
        grupo: 'MATERIAL',
        coeficiente: coef,
        anexos: [],
        retroativo: { dataIni, indIni, dataFin, indFin, base: rawPreco, fornecedores, metodoPreco }
    });

    // Reset Form
    document.getElementById('mercado-desc').value = '';
    document.getElementById('mercado-unid').value = '';
    document.getElementById('mercado-preco').value = '';
    document.getElementById('mercado-coef').value = '1.00'; // Reset validation default

    document.getElementById('mercado-data-ini').value = '';
    document.getElementById('mercado-ind-ini').value = '';
    document.getElementById('mercado-data-fin').value = '';
    document.getElementById('mercado-ind-fin').value = '';
    document.getElementById('mercado-preco-calc').textContent = 'R$ 0,00';
    delete document.getElementById('mercado-preco-calc').dataset.value;

    // Reset Fornecedores
    document.getElementById('container-fornecedores').innerHTML = '';
    document.getElementById('metodo-menor').checked = true;

    bootstrap.Modal.getInstance(document.getElementById('modalBuscarItemComposicao')).hide();
}

// Fonte "Outras": cadastro 100% manual para fontes fora de SEINFRA/SINAPI/ORSE/Mercado.
// O usuário informa Unid., Preço (unitário) e Coeficiente, igual às demais fontes (o
// preço unitário digitado é o que entra em item.preco e é multiplicado pelo Coeficiente
// no cálculo da composição). "Valor Total" (Preço × Coeficiente) é só uma prévia — mostra
// o mesmo valor que vai aparecer na coluna "Total" da tabela de itens.
window.calcularValorTotalOutras = function () {
    const rawPreco = document.getElementById('outras-preco').value.replace(/\./g, '').replace(',', '.');
    const preco = parseFloat(rawPreco) || 0;
    const coef = parseFloat(document.getElementById('outras-coef').value) || 0;
    const elResult = document.getElementById('outras-valor-total-calc');

    if (preco > 0 && coef > 0) {
        const valorTotal = preco * coef;
        elResult.textContent = valorTotal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    } else {
        elResult.textContent = 'R$ 0,00';
    }
}

window.adicionarItemOutrasManual = function () {
    const desc = document.getElementById('outras-desc').value.trim();
    const unid = document.getElementById('outras-unid').value.trim().toUpperCase();
    const rawPreco = document.getElementById('outras-preco').value.replace(/\./g, '').replace(',', '.');
    const preco = parseFloat(rawPreco);
    const coef = parseFloat(document.getElementById('outras-coef').value);

    if (!desc) { alert("Informe a descrição."); return; }
    if (!unid) { alert("Informe a unidade."); return; }
    if (isNaN(preco) || preco <= 0) { alert("Preço inválido."); return; }
    if (isNaN(coef) || coef <= 0) { alert("Coeficiente inválido."); return; }

    adicionarItemComposicao({
        fonte: 'OUTRAS',
        versao: 'MANUAL',
        referencia: 'MANUAL',
        codigo: 'MANUAL',
        descricao: desc,
        unidade: unid,
        preco: parseFloat(preco.toFixed(2)),
        tipo: 'INSUMO',
        grupo: 'MATERIAL',
        coeficiente: coef,
        anexos: []
    });

    // Reset Form
    document.getElementById('outras-desc').value = '';
    document.getElementById('outras-unid').value = '';
    document.getElementById('outras-preco').value = '';
    document.getElementById('outras-coef').value = '1.00';
    document.getElementById('outras-valor-total-calc').textContent = 'R$ 0,00';

    bootstrap.Modal.getInstance(document.getElementById('modalBuscarItemComposicao')).hide();
}

// Descobre quais meses (referencia) realmente existem numa tabela SINAPI/ORSE,
// percorrendo do mês mais antigo ao mais recente carregado no banco. Antes o
// código só verificava os últimos 12 meses a partir da data de hoje, então uma
// tabela antiga recém-carregada pelo administrador (ex.: ORSE de Jan/2025 com o
// sistema já em Ago/2026) nunca aparecia no seletor de versão.
async function obterMesesDisponiveis(tabela) {
    // Lê direto a lista de referências carregadas (tabela `referencia_carregada`,
    // ~30 linhas) em vez de varrer a view inteira de itens. Muito mais rápido.
    const fonte = tabela === 'sinapi_itens' ? 'SINAPI' : (tabela === 'orse_itens' ? 'ORSE' : 'SEINFRA');
    const { data, error } = await sbClient
        .from('referencia_carregada')
        .select('referencia_label')
        .eq('fonte', fonte)
        .order('referencia_ord', { ascending: false });
    if (error || !data?.length) return [];
    return data.map(r => {
        const [ano, mes] = String(r.referencia_label).split('-').map(Number);
        return { ano, mes, dbDate: r.referencia_label, count: 1 };
    });
}

async function atualizarVersoesBusca() {
    const fonte = document.getElementById('busca-item-fonte').value;
    const elVersao = document.getElementById('busca-item-versao');
    const elRef = document.getElementById('busca-item-referencia');

    // 1. Lock/Unlock Reference
    if (fonte === 'ORSE') {
        elRef.value = 'Onerada';
        elRef.disabled = true;
    } else {
        elRef.disabled = false;
    }

    // 2. Populate Versions
    elVersao.innerHTML = '<option value="">Carregando...</option>';
    elVersao.disabled = true;

    let tabela = '';
    if (fonte === 'SEINFRA') tabela = 'seinfra_itens';
    else if (fonte === 'SINAPI') tabela = 'sinapi_itens';
    else if (fonte === 'ORSE') tabela = 'orse_itens';

    try {
        let options = [];
        elVersao.innerHTML = '<option value="">Verificando...</option>';

        const mapMesLabels = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

        if (fonte === 'SEINFRA') {
            const { data } = await sbClient.from('referencia_carregada')
                .select('referencia_label').eq('fonte', 'SEINFRA')
                .order('referencia_ord', { ascending: false });
            options = (data || []).map(r => r.referencia_label);
            if (options.length === 0) options = ['28', '27'];
        }
        else if (fonte === 'SINAPI' || fonte === 'ORSE') {
            const disponiveis = await obterMesesDisponiveis(tabela);
            options = disponiveis.map(r => `${mapMesLabels[r.mes - 1]}/${r.ano}`);

            // Fallback if DB empty or query fails (prevents empty dropdown)
            if (options.length === 0) options = ['DEZ/2025'];
        }

        // Render
        if (options.length === 0) {
            elVersao.innerHTML = '<option value="">Sem versões</option>';
        } else {
            elVersao.innerHTML = options.map(v => `<option value="${v}">${fonte === 'SEINFRA' ? '0' + v : v}</option>`).join('');
        }

        elVersao.disabled = false;

    } catch (e) {
        console.error(e);
        elVersao.innerHTML = '<option value="Padrao">Padrão</option>';
    }
}

async function executarBuscaItemComposicao() {
    const fonte = document.getElementById('busca-item-fonte').value;
    const termo = document.getElementById('busca-item-termo').value.trim();
    const lista = document.getElementById('lista-resultados-itens');

    // Filters from Search Modal
    const versaoSelecionada = document.getElementById('busca-item-versao').value;
    const refSelecionada = document.getElementById('busca-item-referencia').value;

    if (termo.length < 2) { alert("Digite pelo menos 2 letras."); return; }

    lista.innerHTML = '<div class="text-center py-3"><div class="spinner-border spinner-border-sm text-primary"></div> Buscando...</div>';

    let tabela = '';
    if (fonte === 'SEINFRA') tabela = 'seinfra_itens';
    else if (fonte === 'SINAPI') tabela = 'sinapi_itens';
    else if (fonte === 'ORSE') tabela = 'orse_itens';

    // Colunas explícitas: a busca de item não lê a composição analítica (só campos
    // planos). Evita a fachada montar o JSON da composição por linha. Ver tabelas.md.
    const colsBusca = 'id,identificacao,codigo,descricao,unidade,preco_unitario,tipo_encargo,referencia,created_at,origem_preco';
    let query = sbClient
        .from(tabela)
        .select(colsBusca)
        .or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`);

    // Helper: Convert "DEZ/2025" -> "2025-12-01"
    function converterVersaoParaData(str) {
        if (!str) return null;
        const map = { 'JAN': '01', 'FEV': '02', 'MAR': '03', 'ABR': '04', 'MAI': '05', 'JUN': '06', 'JUL': '07', 'AGO': '08', 'SET': '09', 'OUT': '10', 'NOV': '11', 'DEZ': '12' };
        const parts = str.split('/');
        if (parts.length !== 2) return str; // Return as is if not matching format
        const mes = map[parts[0].toUpperCase()];
        const ano = parts[1];
        if (mes && ano) return `${ano}-${mes}-01`;
        return str;
    }

    // Apply Filters
    // 1. Reference (Onerada/Desonerada) -> Mapped to DB column 'tipo_encargo'
    if (fonte !== 'ORSE' && refSelecionada) {
        // Use ilike to handle Case Sensitivity (Onerada vs ONERADA)
        query = query.ilike('tipo_encargo', refSelecionada);
    }

    // 2. Version selection -> Mapped to DB column 'referencia'
    if (versaoSelecionada) {
        let val = versaoSelecionada;
        if (fonte === 'SINAPI' || fonte === 'ORSE') {
            val = converterVersaoParaData(versaoSelecionada);
        }
        query = query.eq('referencia', val);
    }

    let { data, error } = await query.limit(1000);

    // --- DIAGNOSTIC FALLBACK ---
    // If no results or error, try fetching by Term ONLY to inspect DB values
    if ((!data || data.length === 0) || error) {
        const previousError = error;
        console.warn("Search failed or empty, trying diagnostic...", error);

        // Try simple search without filters
        const { data: diagData, error: diagError } = await sbClient
            .from(tabela)
            .select(colsBusca)
            .or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
            .limit(10); // Show more results to increase chance of finding the right one

        if (diagData && diagData.length > 0) {
            // Show items with warning
            lista.innerHTML = `
                                <div class="alert alert-warning small mb-2">
                                    <i class="bi bi-exclamation-triangle"></i> <strong>Aviso:</strong> Nenhum item exato encontrado com os filtros. Mostrando resultados similares.<br>
                                    Verifique se a Versão/Ref existem no Banco.
                                </div>
                             `;
            data = diagData;
            error = null;
        } else {
            // Really nothing found
            if (previousError) {
                lista.innerHTML = `<div class="text-danger p-2">Erro BD: ${previousError.message}</div>`;
                return;
            }
        }
    }

    if (!data || data.length === 0) {
        lista.innerHTML = '<div class="text-center py-3 text-muted">Nenhum item encontrado com estes filtros.</div>';
        return;
    }

    lista.innerHTML = '';
    data.forEach(item => {
        // Padroniza campos
        const codigo = item.codigo;
        const desc = item.descricao;
        const unidade = item.unidade;
        const preco = item.preco_unitario || item.preco || 0;
        const tipo = item.tipo_item || (fonte === 'SEINFRA' ? 'INSUMO' : 'ITEM');

        // Debug visuals
        const dbRef = item.tipo_encargo || '?';
        const dbVer = item.referencia || '?';

        const el = document.createElement('button');
        el.className = 'list-group-item list-group-item-action p-2';
        el.innerHTML = `
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <div class="fw-bold small">${codigo} - ${desc}</div>
                                    <div class="text-muted" style="font-size:0.7rem">
                                        ${fonte} | ${unidade} | ${tipo} <br>
                                        <span class="text-primary">Ref: ${dbRef} | Ver: ${dbVer}</span>
                                    </div>
                                </div>
                                <div class="fw-bold text-success small">R$ ${parseFloat(preco).toFixed(2)}</div>
                            </div>
                        `;

        // Use explicit selection to ensure what we add matches strictly what we searched
        const versao = versaoSelecionada || item.versao || item.data_referencia;
        const referencia = refSelecionada || item.referencia;

        el.onclick = () => {
            adicionarItemComposicao({
                fonte,
                versao,
                referencia,
                codigo,
                descricao: desc,
                unidade,
                preco: parseFloat(preco),
                tipo,
                coeficiente: 1.00
            });
            bootstrap.Modal.getInstance(document.getElementById('modalBuscarItemComposicao')).hide();
        };
        lista.appendChild(el);
    });
}

// 2.3 ADICIONAR E GERENCIAR ITENS
function adicionarItemComposicao(item) {
    // Verifica duplicação
    const existe = currentCompositionItems.find(i => {
        // Cotações de mercado e itens de "Outras" fontes não têm código próprio (todos
        // usam o mesmo código fixo 'COTAÇÃO'/'MANUAL'), então a checagem de duplicidade
        // usa a descrição em vez do código — senão só seria possível adicionar 1 item.
        if (item.fonte === 'MERCADO' || item.fonte === 'OUTRAS') {
            return i.fonte === item.fonte && i.descricao === item.descricao;
        }
        return i.codigo === item.codigo && i.fonte === item.fonte;
    });
    if (existe) {
        alert("Este item já está na lista.");
        return;
    }

    // Auto-Detect Group based on Category, Type or Source — só quando o chamador não
    // já informou um grupo explicitamente (ex: itens de cotação de mercado sempre vêm
    // com grupo: 'MATERIAL' e não devem ser reclassificados).
    if (!item.grupo) {
        let grupo = 'MATERIAL'; // Default
        const catUpper = (item.categoria || '').toUpperCase();
        const tipoUpper = (item.tipo || item.tipo_item || '').toUpperCase();
        // \bMO\b (limite de palavra) evita falso positivo em substrings como "INSUMO"
        const temMO = /\bMO\b/.test(catUpper) || /\bMO\b/.test(tipoUpper);

        if (temMO || catUpper.includes('MAO') ||
            tipoUpper.includes('MAO') ||
            tipoUpper.includes('SERVENTE') || tipoUpper.includes('PEDREIRO')) {
            grupo = 'MAO_DE_OBRA';
        } else if (catUpper.includes('EQUIP') || tipoUpper.includes('EQUIP') ||
            tipoUpper.includes('CAMINHAO') || tipoUpper.includes('BETONEIRA')) {
            grupo = 'EQUIPAMENTOS';
        } else if (catUpper.includes('SERV') || tipoUpper.includes('SERV')) {
            grupo = 'SERVICO';
        } else if (item.fonte === 'SINAPI' && (item.tipo_item === 'COMPOSICAO' || item.tipo === 'COMPOSICAO')) {
            grupo = 'MATERIAL';
        }

        item.grupo = grupo;
    }

    currentCompositionItems.push(item);
    renderizarItensComposicao();
    atualizarCalculosComposicao();
}

function removerItemComposicao(index) {
    currentCompositionItems.splice(index, 1);
    renderizarItensComposicao();
    atualizarCalculosComposicao();
}

function toggleGrupo(index) {
    const item = currentCompositionItems[index];
    const grupos = ['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTOS', 'SERVICO'];
    const currentIndex = grupos.indexOf(item.grupo);
    const nextIndex = (currentIndex + 1) % grupos.length;
    item.grupo = grupos[nextIndex];
    renderizarItensComposicao();
    atualizarCalculosComposicao();
}

function renderizarItensComposicao() {
    const tbody = document.getElementById('tbody-itens-composicao');
    if (currentCompositionItems.length === 0) {
        tbody.innerHTML = '<tr class="text-center text-muted" id="placeholder-itens-vazio"><td colspan="8" class="py-4">Nenhum item adicionado. Clique em "Adicionar Item".</td></tr>';
        return;
    }

    // 1. Group Data
    const groups = {
        'MAO_DE_OBRA': [],
        'MATERIAL': [],
        'EQUIPAMENTOS': [],
        'SERVICO': []
    };

    currentCompositionItems.forEach((item, index) => {
        const g = item.grupo || 'MATERIAL';
        if (groups[g]) groups[g].push({ item, index });
        else groups['MATERIAL'].push({ item, index });
    });

    // 2. Render Helper
    let html = '';

    const renderSection = (key, title, bgClass) => {
        const list = groups[key];
        if (list.length === 0) return '';

        let sectionHtml = `
                            <tr class="${bgClass} text-center fw-bold text-secondary" style="font-size: 0.75rem; background-color: #e9ecef;">
                                <td colspan="8" class="py-1 border-top">${title}</td>
                            </tr>
                        `;

        let subTotal = 0;

        list.forEach(({ item, index }) => {
            const precoEfetivo = item.preco;
            const totalRow = precoEfetivo * item.coeficiente;
            subTotal += totalRow;

            const refShort = (item.referencia || '').toLowerCase().includes('desonerada') ? 'Desonerada' : 'Onerada';
            const verShort = (item.versao || '').replace('Tabela ', '');

            let sourceDisplay = '';
            if (item.fonte === 'MERCADO') {
                sourceDisplay = `<span class="badge bg-light text-secondary border me-1" style="font-size:0.65rem">MERCADO</span>`;
            } else if (item.fonte === 'OUTRAS') {
                sourceDisplay = `<span class="badge bg-light text-secondary border me-1" style="font-size:0.65rem">OUTRAS</span>`;
            } else {
                sourceDisplay = `
                                    <div class="d-flex flex-column align-items-center" style="line-height:1.1;">
                                        <div>
                                            <span class="badge bg-light text-secondary border me-1" style="font-size:0.65rem">${item.fonte}</span>
                                            <span class="fw-bold small">${verShort}</span>
                                        </div>
                                        <small class="text-muted" style="font-size:0.7rem;">${refShort}</small>
                                    </div>
                                `;
            }

            sectionHtml += `
                            <tr>
                                <td class="small text-muted text-center" style="font-size: 0.75rem;">${sourceDisplay}</td>
                                <td class="small fw-bold text-center">${item.codigo}</td>
                                <td class="small text-truncate" style="max-width: 550px;" title="${escapeHTML(item.descricao)}">${escapeHTML(item.descricao)}</td>
                                <td class="small text-center">${item.unidade}</td>
                                <td class="text-center">
                                    <input type="number" class="form-control form-control-sm text-center p-0 border-0 bg-transparent mx-auto" 
                                        style="max-width: 60px;" 
                                        value="${item.coeficiente}" step="0.0001" min="0"
                                        onchange="atualizarCoeficiente(${index}, this.value)">
                                </td>
                                <td class="text-center small" title="Base: ${item.preco.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}">${precoEfetivo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td class="text-center fw-bold small text-dark" id="total-linha-${index}">${(totalRow).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td class="text-center">
                                    <div class="d-flex justify-content-center gap-2">
                                        <button class="btn btn-sm btn-link text-secondary p-0" title="Alterar Grupo" onclick="toggleGrupo(${index})"><i class="bi bi-arrow-repeat" style="font-size: 0.9rem;"></i></button>
                                        <button class="btn btn-sm btn-link text-danger p-0" onclick="removerItemComposicao(${index})"><i class="bi bi-trash"></i></button>
                                    </div>
                                </td>
                            </tr>
                            `;
        });

        sectionHtml += `
                            <tr class="bg-light fw-bold" style="font-size: 0.75rem;">
                                <td colspan="6" class="text-end text-muted pe-3">TOTAL ${title}</td>
                                <td class="text-center text-dark">${subTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td></td>
                            </tr>
                        `;
        return sectionHtml;
    };

    html += renderSection('MAO_DE_OBRA', 'MÃO DE OBRA', 'bg-body-secondary');
    html += renderSection('MATERIAL', 'MATERIAIS', 'bg-body-secondary');
    html += renderSection('EQUIPAMENTOS', 'EQUIPAMENTOS', 'bg-body-secondary');
    html += renderSection('SERVICO', 'SERVIÇOS', 'bg-body-secondary');

    tbody.innerHTML = html;
}

function atualizarCoeficiente(index, valor) {
    const val = parseFloat(valor);
    if (isNaN(val) || val < 0) return;
    currentCompositionItems[index].coeficiente = val;
    const item = currentCompositionItems[index];
    const precoEfetivo = item.preco;
    document.getElementById(`total-linha-${index}`).textContent = `${(precoEfetivo * item.coeficiente).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    atualizarCalculosComposicao();
}

function atualizarCalculosComposicao() {
    let totalMat = 0, totalMao = 0, totalEquip = 0, totalServ = 0;
    currentCompositionItems.forEach(item => {
        const totalItem = Math.round((item.preco * item.coeficiente) * 100) / 100;
        const grupo = item.grupo || 'MATERIAL';
        if (grupo === 'MAO_DE_OBRA') totalMao = Math.round((totalMao + totalItem) * 100) / 100;
        else if (grupo === 'EQUIPAMENTOS') totalEquip = Math.round((totalEquip + totalItem) * 100) / 100;
        else if (grupo === 'SERVICO') totalServ = Math.round((totalServ + totalItem) * 100) / 100;
        else totalMat = Math.round((totalMat + totalItem) * 100) / 100;
    });
    const totalSemBDI = totalMat + totalMao + totalEquip + totalServ;
    const bdiInput = document.getElementById('comp-bdi');
    const descInput = document.getElementById('comp-desconto');
    const parseBrl = (val) => val ? parseFloat(val.replace(/\./g, '').replace(',', '.')) || 0 : 0;
    const bdiPercent = bdiInput ? parseBrl(bdiInput.value) : 0;
    const descPercent = descInput ? parseBrl(descInput.value) : 0;

    const totalComBDI = Math.round((totalSemBDI * (1 + (bdiPercent / 100))) * 100) / 100;
    const valorBDI = Math.round((totalComBDI - totalSemBDI) * 100) / 100;
    const valorDesconto = Math.round((totalComBDI * (descPercent / 100)) * 100) / 100;
    const totalFinal = Math.round((totalComBDI - valorDesconto) * 100) / 100;

    if (document.getElementById('total-material')) document.getElementById('total-material').textContent = `R$ ${totalMat.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-mao-de-obra')) document.getElementById('total-mao-de-obra').textContent = `R$ ${totalMao.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-equipamentos')) document.getElementById('total-equipamentos').textContent = `R$ ${totalEquip.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-servico')) document.getElementById('total-servico').textContent = `R$ ${totalServ.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-bdi')) document.getElementById('total-bdi').textContent = `R$ ${valorBDI.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-desconto')) document.getElementById('total-desconto').textContent = `R$ ${valorDesconto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (document.getElementById('total-geral')) document.getElementById('total-geral').textContent = `R$ ${totalFinal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 3.4 SALVAR COMPOSIÇÃO ANALÍTICA (CREATE)
async function salvarComposicaoAnalitica() {
    if (currentCompositionItems.length === 0) { alert("Adicione pelo menos um item à composição."); return; }

    const form = document.getElementById('formComposicaoAnalitica');
    if (!form.checkValidity()) { form.reportValidity(); return; }

    const btn = document.getElementById('btn-salvar-comp-analitica');
    const textoOriginal = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> SALVANDO...';

    try {
        const formData = new FormData(form);
        const nomeObra = (formData.get('descricao') || 'SEM DESCRIÇÃO').toUpperCase();

        let userEmail = sessionStorage.getItem('sop_user') || 'SISTEMA';
        let userName = sessionStorage.getItem('sop_user_name');

        if (userEmail !== 'SISTEMA' && !userEmail.includes('@')) {
            userEmail = `${userEmail.replace(/\s+/g, '')}@gecope.app`;
        }

        if (!userName || /^\d+$/.test(userName)) {
            const { data: userData } = await sbClient.from('app_users')
                .select('full_name, nome, sobrenome')
                .eq('email', userEmail)
                .maybeSingle();

            if (userData) {
                if (userData.full_name && !/^\d+$/.test(userData.full_name)) {
                    userName = userData.full_name;
                } else if (userData.nome) {
                    userName = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).toUpperCase();
                }
                if (userName) sessionStorage.setItem('sop_user_name', userName);
            }
        }

        if ((!userName || /^\d+$/.test(userName)) && userEmail !== 'SISTEMA') {
            const loginOriginal = sessionStorage.getItem('sop_user');
            if (loginOriginal && !loginOriginal.includes('@') && !/^\d+$/.test(loginOriginal)) {
                userName = loginOriginal.toUpperCase();
            } else {
                const namePart = userEmail.split('@')[0];
                userName = namePart.replace(/\./g, ' ').toUpperCase();
            }
        }

        if (/^\d+$/.test(userName)) userName = "USUÁRIO " + userName;

        const categoriaFinal = (userName || 'OUTROS').toUpperCase();
        const subcategoriaFinal = 'COMPOSIÇÕES PRÓPRIAS';

        const payload = {
            descricao: nomeObra,
            usuario: categoriaFinal,
            subcategoria: subcategoriaFinal,
            codigo: formData.get('codigo') || 'S/C',
            unidade: formData.get('unidade') || '-',
            fonte: 'PRPRIA',
            data_base: formData.get('data_base') || '',
            bdi: formData.get('bdi') || '0,00',
            desconto: formData.get('desconto') || '0,00',
            itens: currentCompositionItems,
            status: 'Em Revisão'
        };

        const idEdicao = document.getElementById('edit-id-composicao').value;
        let res;

        if (idEdicao) {
            const { data: current } = await sbClient.from('composicoes_biblioteca').select('historico_versoes').eq('id', idEdicao).single();
            const hist = current ? (current.historico_versoes || []) : [];
            hist.push({
                versao: 'Edit',
                data: new Date().toISOString(),
                descricao: 'Alteração via Editor Analítico',
                autor: userName || userEmail
            });
            payload.historico_versoes = hist;
            res = await sbClient.from('composicoes_biblioteca').update(payload).eq('id', idEdicao);
        } else {
            payload.versao_atual = 'V1';
            payload.historico_versoes = [{
                versao: 'V1',
                data: new Date().toISOString(),
                descricao: 'Criação via Criador Analítico',
                autor: userName || userEmail
            }];
            res = await sbClient.from('composicoes_biblioteca').insert([payload]);
        }

        if (res.error) throw new Error(res.error.message);

        // Log de Atividade
        registrarAtividade('COMPOSICAO', `${idEdicao ? 'editou' : 'criou manualmente'} a composição analítica: ${nomeObra}`, '', nomeObra);

        alert(" Composição salva com sucesso!");
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalCriarComposicaoAnalitica')).hide();
        form.reset();
        currentCompositionItems = [];
        if (typeof renderItemsTable === 'function') renderItemsTable();
        carregarComposicoes();

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar: " + error.message);
    } finally {
        if (btn) { btn.disabled = false; btn.innerHTML = textoOriginal; }
    }
}

// --- LGICA EXPORTAO E TABELAS ---
// currentTabelaData já declarado globalmente
let compositionDataToExport = null;
window.exportarComposicao = exportarComposicao;

// Removida baixarComposicaoPDF pois agora usamos a impressão HTML unificada

async function prepararExportacaoComposicao(id, urlArquivo) {
    try {
        let docData = null;

        // 1. Se não temos URL ou ela é nula (Composição Analítica Direta no Banco)
        if (!urlArquivo || urlArquivo === 'undefined' || urlArquivo === 'null' || urlArquivo === '') {
            const { data, error } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();
            if (error || !data) throw new Error("Documento não encontrado no banco.");

            if (data.itens) {
                docData = {
                    meta: {
                        codigo: data.codigo || 'S/C',
                        descricao: data.descricao,
                        unidade: data.unidade || '-',
                        data_base: data.data_base,
                        bdi: data.bdi,
                        desconto: data.desconto,
                        totais: null
                    },
                    itens: data.itens || []
                };
            } else {
                urlArquivo = data.arquivo_url;
            }
        }

        // 2. Se temos URL e NO termina em .json, é um arquivo direto (PDF/XLS) -> BAIXAR DIRETO
        if (urlArquivo && !urlArquivo.toLowerCase().includes('.json')) {
            const link = document.createElement('a');
            link.href = urlArquivo;
            link.download = ''; // Sugere o nome original do arquivo
            link.target = '_blank';
            link.click();
            return;
        }

        // 3. Se temos URL e  um .json, buscamos o conteúdo
        if (urlArquivo && urlArquivo.toLowerCase().includes('.json')) {
            const finalUrl = `${urlArquivo}?t=${new Date().getTime()}`;
            const response = await fetch(finalUrl);
            if (!response.ok) throw new Error("Erro ao baixar dados da composição.");
            docData = await response.json();
        }

        if (docData) {
            const meta = docData.meta || {};
            const dados = {
                codigo: meta.codigo || 'S/C',
                descricao: meta.descricao,
                unidade: meta.unidade || '-',
                data_base: meta.data_base,
                bdi: meta.bdi,
                desconto: meta.desconto,
                itens: docData.itens || [],
                totais: meta.totais,
                versao_atual: meta.versao || ''
            };
            imprimirRelatorioSOP(dados);
        } else {
            alert("Esta composição não possui arquivo nem dados analíticos.");
        }
    } catch (e) {
        console.error(e);
        alert("Erro ao carregar: " + e.message);
    }
}

const formatarVersao = (texto) => {
    if (!texto || texto === '-') return '-';
    const txt = texto.toString().toUpperCase().trim();

    // Lista de abreviações dos meses
    const mesesAbrev = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

    // Mapa de nomes completos para abreviações
    const mesesMap = {
        'JANEIRO': 'Jan', 'FEVEREIRO': 'Fev', 'MARÇO': 'Mar', 'ABRIL': 'Abr',
        'MAIO': 'Mai', 'JUNHO': 'Jun', 'JULHO': 'Jul', 'AGOSTO': 'Ago',
        'SETEMBRO': 'Set', 'OUTUBRO': 'Out', 'NOVEMBRO': 'Nov', 'DEZEMBRO': 'Dez'
    };

    // Caso 1: Detecção de números de versão (Ex: "28.1", "30") -> Manter inalterado
    if (/^\d+(\.\d+)?$/.test(txt)) return txt;

    // Caso 2: Tenta encontrar nome do mês por extenso ou abreviado (Ex: "SETEMBRO DE 2024" ou "FEV. DE 2026")
    const mesesAbrevMap = {
        'JAN': 'Jan', 'FEV': 'Fev', 'MAR': 'Mar', 'ABR': 'Abr',
        'MAI': 'Mai', 'JUN': 'Jun', 'JUL': 'Jul', 'AGO': 'Ago',
        'SET': 'Set', 'OUT': 'Out', 'NOV': 'Nov', 'DEZ': 'Dez'
    };

    // Primeiro tenta meses completos (para não casar "MAR" em "MARO")
    for (let mes in mesesMap) {
        if (txt.includes(mes)) {
            const anoMatch = txt.match(/\d{4}/);
            if (anoMatch) return `${mesesMap[mes]}/${anoMatch[0].substring(2)}`;
        }
    }

    // Depois tenta abreviações
    for (let abrev in mesesAbrevMap) {
        if (txt.includes(abrev)) {
            const anoMatch = txt.match(/\d{4}/);
            if (anoMatch) return `${mesesAbrevMap[abrev]}/${anoMatch[0].substring(2)}`;
        }
    }

    // Caso 3: Parse de datas ISO (YYYY-MM-DD) ou BR (DD/MM/YYYY)
    let d = null;
    if (txt.includes('-')) {
        const p = txt.split('-');
        if (p.length === 3) d = new Date(p[0], p[1] - 1, p[2]);
        else if (p.length === 2) d = new Date(p[0], p[1] - 1, 1);
    } else if (txt.includes('/')) {
        const p = txt.split('/');
        if (p.length === 3) d = new Date(p[2], p[1] - 1, p[0]);
        else if (p.length === 2) {
            // Se for MM/YYYY (SINAPI/ORSE)
            const mes = parseInt(p[0]);
            const ano = p[1];
            if (mes >= 1 && mes <= 12 && ano.length === 4) {
                return `${mesesAbrev[mes - 1]}/${ano.substring(2)}`;
            }
        }
    }

    if (d && !isNaN(d.getTime())) {
        return `${mesesAbrev[d.getMonth()]}/${d.getFullYear().toString().substring(2)}`;
    }

    return texto; // Retorno padrão
};

const normalizarItemParaPDF = (item) => {
    const precoUnit = Number(item.preco_unitario || item.preco || item.p || 0);
    const coef = Number(item.coeficiente || item.coef || item.c || 0);
    const total = Number(item.total || item.total_item || item.t || (precoUnit * coef)) || 0;

    // Mapeamento de nomes de grupo para padrão de exibição
    const rawGrupo = (item.tipo_grupo || item.grupo || item.g || 'GERAL').toUpperCase();
    let grupoDisplay = rawGrupo;
    if (rawGrupo === 'MÃO_DE_OBRA' || rawGrupo === 'MÃO DE OBRA') grupoDisplay = 'MÃO DE OBRA';
    else if (rawGrupo === 'SERVIÇO' || rawGrupo === 'SERVIÇOS') grupoDisplay = 'SERVIÇO';
    else if (rawGrupo === 'MATERIAL' || rawGrupo === 'MATERIAIS') grupoDisplay = 'MATERIAL';
    else if (rawGrupo === 'COMPOSIÇÃO' || rawGrupo === 'COMPOSIÇÕESS') grupoDisplay = 'COMPOSIÇÃO';

    // Fallbacks para Código e Descrição
    const codigo = item.codigo_insumo || item.codigo_item || item.codigo || item.cod || '-';
    const descricao = item.descricao_insumo || item.descricao_item || item.descricao || item.desc || '-';
    const fonte = item.origem || item.fonte || item.fonte_insumo || item.tabela || (item.retroativo ? 'COTAO' : '-');

    return {
        origem: fonte,
        versao: formatarVersao(item.versao || item.data_tabela || item.data_referencia || item.referencia_tabela || item.retroativo?.dataIni || '-'),
        codigo: codigo,
        descricao: descricao,
        unidade: item.unidade || item.unid || '-',
        coeficiente: coef,
        preco_unitario: precoUnit,
        total: total,
        grupo: grupoDisplay,
        referencia: item.referencia || item.tipo_encargo || '',
        retroativo: item.retroativo || null
    };
};

// --------------------------------------------------------------
// FUNO GERAR PDF (MANTIDA COMO FALLBACK SE NECESSÁRIO)
// --------------------------------------------------------------
async function gerarPDF_Profissional(rawInput) {
    if (!rawInput) return;

    // Feedback visual instantâneo
    const btnsBaixar = document.querySelectorAll('.btn-action-baixar, .btn-outline-success');
    const originalTexts = Array.from(btnsBaixar).map(b => b.innerHTML);
    btnsBaixar.forEach(b => {
        b.disabled = true;
        b.innerHTML = '<span class="spinner-border spinner-border-sm"></span>';
    });

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const verdeSOP = [0, 143, 61];
        const cinzaHeader = [242, 242, 242];
        const cinzaTexto = [100, 100, 100];

        const fCur = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const fNum4 = (v) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

        // 1. Cabeçalho Institucional SOP (Fidelidade Absoluta com a Modal)
        doc.setFillColor(...verdeSOP); doc.roundedRect(14, 10, 20, 10, 1, 1, 'F');
        doc.setTextColor(255, 255, 255); doc.setFontSize(9); doc.setFont("helvetica", "bold");
        doc.text("SOP-CE", 24, 16.5, { align: "center" });

        doc.setTextColor(...verdeSOP); doc.setFontSize(10); doc.text("ESTADO DO CEARÁ", 38, 14);
        doc.setTextColor(60, 60, 60); doc.setFontSize(7); doc.text("SUPERINTENDÊNCIA DE OBRAS PÚBLICAS", 38, 18);

        doc.setTextColor(0, 0, 0); doc.setFontSize(11); doc.text("COMPOSIÇÃO ANALÍTICA", 196, 14, { align: "right" });
        doc.setTextColor(...cinzaTexto); doc.setFontSize(6); doc.text("GEROA - GERÊNCIA DE ORAMENTOS E AVALIAO DE IMVEIS", 196, 18, { align: "right" });

        doc.setDrawColor(200); doc.line(14, 22, 196, 22);

        // 2. Metadados Grid - Clone idêntico da Imagem 01 (Otimização Máxima de Espaço Central)
        doc.setDrawColor(220); doc.setFillColor(255);
        doc.rect(14, 25, 182, 17, 'D');
        doc.line(34, 25, 34, 42); // Barra 1 (Muito Reduzido)
        doc.line(170, 25, 170, 42); // Barra 2 (Máximo Expandida: Descrição)
        doc.line(182, 25, 182, 42); // Barra 3 (Mínimo Unit)

        doc.setFontSize(5); doc.setTextColor(150); doc.setFont("helvetica", "bold");
        doc.text("CDIGO / VERSO", 15.5, 29);
        doc.text("DESCRIÇÃO DA COMPOSIÇÃO", 36, 29);
        doc.text("UNID:", 171, 29);

        doc.setFontSize(8.5); doc.setTextColor(0); doc.setFont("helvetica", "bold");
        doc.text(rawInput.codigo || 'S/C', 15.5, 35);
        if (rawInput.versao_atual) {
            doc.setFontSize(5); doc.roundedRect(26.5, 33, 6, 3, 0.5, 0.5, 'D');
            doc.text(rawInput.versao_atual, 29.5, 35.2, { align: "center" });
        }

        doc.setFontSize(8.5); doc.setTextColor(0);
        const descLines = doc.splitTextToSize((rawInput.descricao || '').toUpperCase(), 130);
        doc.text(descLines, 36, 34, { align: "justify" });

        doc.setFontSize(10); doc.text(rawInput.unidade || '-', 176, 37.5, { align: "center" });

        // Área BDI (182 a 196)
        doc.setFontSize(6.5);
        doc.setTextColor(120); doc.text("BDI:", 183.5, 33);
        doc.setTextColor(0, 80, 200); doc.setFont("helvetica", "bold"); doc.text(`${rawInput.bdi || '0,00'}%`, 194.5, 33, { align: "right" });
        doc.setTextColor(120); doc.setFont("helvetica", "normal"); doc.text("DESC:", 183.5, 38.5);
        doc.setTextColor(200, 0, 0); doc.setFont("helvetica", "bold"); doc.text(`${rawInput.desconto || '0,00'}%`, 194.5, 38.5, { align: "right" });

        // 3. Preparação dos Itens (Utilizando normalizarItemParaPDF para consistência total com a Modal)
        const itensRaw = rawInput.itens || [];
        const itens = itensRaw.map(normalizarItemParaPDF);
        const retroativos = [];

        const body = [];
        const ordemGrupos = ['MÃO DE OBRA', 'MATERIAL', 'EQUIPAMENTOS', 'SERVIÇO', 'GERAL'];
        const itensAgrupados = itens.reduce((acc, item) => {
            const g = item.grupo || 'GERAL';
            if (!acc[g]) acc[g] = [];
            acc[g].push(item);
            return acc;
        }, {});

        const gruposDisponiveis = Object.keys(itensAgrupados).sort((a, b) => {
            const idxA = ordemGrupos.indexOf(a);
            const idxB = ordemGrupos.indexOf(b);
            return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
        });

        let totalSimples = 0;

        gruposDisponiveis.forEach(g => {
            body.push([{ content: g.toUpperCase(), colSpan: 8, styles: { halign: 'center', fillColor: cinzaHeader, fontStyle: 'bold', textColor: 0 } }]);

            let subtotalGrupo = 0;
            itensAgrupados[g].forEach(i => {
                let fonteStr = i.origem;
                if ((i.origem === 'SEINFRA' || i.origem === 'SINAPI') && i.referencia) {
                    const refLabel = i.referencia.toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada';
                    fonteStr += `\n${refLabel}`;
                }

                body.push([
                    fonteStr,
                    i.versao || '-',
                    i.codigo || '-',
                    i.descricao || '-',
                    i.unidade || '-',
                    fNum4(i.coeficiente),
                    fCur(i.preco_unitario),
                    fCur(i.total)
                ]);
                subtotalGrupo += i.total;
                totalSimples += i.total;
                if (i.retroativo) retroativos.push({ ...i, codInsumo: i.codigo, descInsumo: i.descricao });
            });

            body.push([{
                content: `TOTAL ${g}`,
                colSpan: 7,
                styles: { halign: 'right', fontStyle: 'bold', textColor: cinzaTexto, fontSize: 6.5 }
            }, {
                content: fCur(subtotalGrupo),
                styles: { halign: 'right', fontStyle: 'bold' }
            }]);
        });

        doc.autoTable({
            startY: 45,
            head: [['FONTE', 'VERSÃO', 'CÓDIGO', 'DESCRIÇÃO DO INSUMO', 'UNID', 'COEF.', 'P. UNIT.', 'TOTAL']],
            body: body,
            theme: 'grid',
            styles: { fontSize: 7, cellPadding: 1.5, valign: 'middle', overflow: 'linebreak' },
            headStyles: { fillColor: cinzaHeader, textColor: 0, halign: 'center', fontStyle: 'bold' },
            columnStyles: {
                0: { halign: 'center', cellWidth: 'auto' }, // FONTE
                1: { halign: 'center', cellWidth: 'auto' }, // VERSÃO
                2: { halign: 'center', cellWidth: 'auto' }, // CÓDIGO
                3: { cellWidth: '*' }, // DESCRIÇÃO DO INSUMO (Ocupa o resto)
                4: { halign: 'center', cellWidth: 'auto' }, // UNID
                5: { halign: 'center', cellWidth: 'auto' }, // COEF.
                6: { halign: 'right', cellWidth: 'auto' },  // P. UNIT.
                7: { halign: 'right', cellWidth: 'auto' }   // TOTAL
            },
            margin: { left: 14, right: 14 },
            didDrawPage: (data) => {
                doc.setFontSize(6); doc.setTextColor(150);
                doc.text(`Painel GECOPE/SOP | Página ${data.pageNumber} | Código: ${rawInput.codigo || '-'}`, 14, 285);
            }
        });

        // 4. Totais Finais
        let y = (doc.lastAutoTable ? doc.lastAutoTable.finalY : 45) + 6;
        const drawTot = (label, val, col = [0, 0, 0], bold = false) => {
            if (y > 270) { doc.addPage(); y = 20; }
            doc.setTextColor(...col); doc.setFontSize(bold ? 10 : 7); doc.setFont("helvetica", bold ? "bold" : "normal");
            doc.text(label.toUpperCase(), 155, y, { align: 'right' });
            doc.text(`R$ ${fCur(val)}`, 196, y, { align: 'right' });
            y += bold ? 8 : 5;
        };

        const bdiVal = (totalSimples * (parseFloat(rawInput.bdi || 0) / 100));
        const tBDI = totalSimples + bdiVal;
        const descVal = (tBDI * (parseFloat(rawInput.desconto || 0) / 100));
        const pFinal = tBDI - descVal;

        drawTot("Total Simples", totalSimples);
        if (bdiVal > 0) drawTot(`(+) BDI (${rawInput.bdi}%)`, bdiVal, [0, 80, 200]);
        if (descVal > 0) drawTot(`(-) Desconto (${rawInput.desconto}%)`, descVal, [200, 0, 0]);
        doc.setDrawColor(...verdeSOP); doc.line(135, y - 2, 196, y - 2); y += 3;
        drawTot("Preço Total Unitário", pFinal, verdeSOP, true);

        // 5. Memória de Cálculo (Página Extra conforme Modal)
        if (retroativos.length > 0) {
            doc.addPage();
            doc.setTextColor(...verdeSOP); doc.setFontSize(12); doc.setFont("helvetica", "bold");
            doc.text("METODOLOGIA DE CÁLCULO (RETROAO DE PREOS)", 14, 20);

            doc.setTextColor(80, 80, 80); doc.setFontSize(8); doc.setFont("helvetica", "normal");
            const intro = "Os custos obtidos via cotação de mercado foram retroagidos financeiramente para a Data-Base do orçamento, garantindo a homogeneidade temporal dos preços.";
            doc.text(doc.splitTextToSize(intro, 182), 14, 26);

            let currentY = 35;
            retroativos.forEach(r => {
                if (currentY > 220) { doc.addPage(); currentY = 20; }
                doc.setTextColor(0); doc.setFontSize(9); doc.setFont("helvetica", "bold");
                doc.text(`Item: ${r.codInsumo} - ${r.descInsumo}`, 14, currentY);
                currentY += 5;

                const ret = r.retroativo;

                // Tabela de Fornecedores (se houver)
                if (ret.fornecedores && ret.fornecedores.length > 0) {
                    doc.setFontSize(7.5); doc.setTextColor(80);
                    doc.text(`Detalhamento das Coletas (${ret.metodoPreco === 'MEDIA' ? 'Média Aritmética' : 'Menor Preço Adotado'}):`, 14, currentY);
                    currentY += 2;

                    doc.autoTable({
                        startY: currentY,
                        head: [['Fornecedor', 'Valor Cotado']],
                        body: ret.fornecedores.map(f => [f.nome, `R$ ${fCur(f.valor)}`]),
                        theme: 'grid',
                        styles: { fontSize: 7, cellPadding: 1.5 },
                        headStyles: { fillColor: cinzaHeader, textColor: 0 },
                        margin: { left: 14, right: 100 }
                    });
                    currentY = doc.lastAutoTable.finalY + 6;
                }

                doc.setFontSize(7.5); doc.setTextColor(80);
                doc.text(`Compatibilidade Temporal (Retroação):`, 14, currentY);
                currentY += 2;

                const fator = (Number(ret.indFin) / Number(ret.indIni)) || 1;
                doc.autoTable({
                    startY: currentY,
                    head: [['Parâmetro', 'Descrição / Valor']],
                    body: [
                        ['Valor de Mercado / Base (A)', `R$ ${fCur(ret.base)}`],
                        ['Data Cotação / Índice (C)', `${ret.dataIni?.split('-').reverse().join('/') || '-'} | ${fNum4(ret.indIni)}`],
                        ['Data-Base / Índice (E)', `${ret.dataFin?.split('-').reverse().join('/') || '-'} | ${fNum4(ret.indFin)}`],
                        ['Fator (E/C)', fator.toFixed(4)],
                        ['Preço Adotado Final (A x Fator)', { content: `R$ ${fCur(Number(ret.base) * fator)}`, styles: { fontStyle: 'bold', textColor: verdeSOP } }]
                    ],
                    theme: 'grid',
                    styles: { fontSize: 8, cellPadding: 2 },
                    headStyles: { fillColor: cinzaHeader, textColor: 0 },
                    margin: { left: 14, right: 70 }
                });
                currentY = doc.lastAutoTable.finalY + 12;
            });
        }

        doc.save(`${rawInput.codigo || 'SOP'}_Analitica.pdf`);
    } catch (e) {
        alert("Erro: " + e.message);
    } finally {
        btnsBaixar.forEach((b, i) => { b.disabled = false; b.innerHTML = originalTexts[i]; });
    }
}

// NOVA FUNO: VISUALIZAR COMPOSIÇÃO (Fetch JSON -> Gerar PDF Blob)
// NOVA FUNO: VISUALIZAR COMPOSIÇÃO (SOP) - Versão Relatório Professional
async function visualizarComposicao(id, url, options = {}) {
    try {
        const modalEl = document.getElementById('modalDetalheComposicao');
        if (!modalEl) {
            console.error("Modal modalDetalheComposicao não encontrado!");
            return;
        }

        // Garante que o modal esteja no body para evitar problemas de posicionamento
        if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);

        const modalBody = document.getElementById('modal-report-body');

        // Limpa e mostra loader
        if (modalBody) {
            modalBody.innerHTML = `
                                <div class="p-5 text-center text-muted">
                                    <div class="spinner-border text-success mb-3" style="width: 3rem; height: 3rem;"></div>
                                    <h5 class="fw-bold">Carregando Relatório SOP...</h5>
                                    <p>Aguarde enquanto processamos os dados técnicos.</p>
                                </div>
                            `;
            let docData = null;

            // 1. Caso 1: Composição Analítica elaborada no sistema (Direto do Banco)
            if (!url || url === 'undefined' || url === 'null' || url === '') {
                const { data, error } = await sbClient.from('composicoes_biblioteca').select('*').eq('id', id).single();
                if (error || !data) throw new Error("Documento não encontrado no banco.");

                if (data.itens) {
                    docData = data; // Passamos o objeto completo
                } else {
                    url = data.arquivo_url;
                }
            }

            // 2. Arquivos PDF/XLS Diretos
            if (url && !url.toLowerCase().includes('.json')) {
                window.open(url, '_blank');
                return;
            }

            // 3. Caso 2: Composição Importada (JSON SOP)
            if (url && url.toLowerCase().includes('.json')) {
                const finalUrl = `${url}?t=${new Date().getTime()}`;
                const response = await fetch(finalUrl);
                if (!response.ok) throw new Error("Erro ao baixar arquivo JSON.");

                const json = await response.json();
                const meta = json.meta || {};
                docData = {
                    ...json, // Mantém todos os campos originais
                    codigo: meta.codigo || 'S/C',
                    descricao: meta.descricao,
                    unidade: meta.unidade,
                    data_base: meta.data_base,
                    bdi: meta.bdi,
                    desconto: meta.desconto,
                    versao_atual: meta.versao || meta.versao_projeto || '',
                    itens: json.itens || [],
                    usuario: 'SOP' // Identificador de Composição Oficial
                };
            }

            if (docData) {
                currentCompositionData = docData; // Salva para download via modal
                if (docData.itens && Array.isArray(docData.itens)) {
                    // Versão Relatório HTML Premium (Imagem 01)
                    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
                    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);

                    // Inicializa os inputs de BDI e Desconto no cabeçalho do Modal
                    const inputBdi = document.getElementById('modal-report-bdi');
                    const inputDesc = document.getElementById('modal-report-desc');
                    if (inputBdi) inputBdi.value = (docData.bdi || 0).toString().replace(',', '.');
                    if (inputDesc) inputDesc.value = (docData.desconto || 0).toString().replace(',', '.');

                    // Mostra loader
                    modalBody.innerHTML = `<div class="p-5 text-center text-muted"><div class="spinner-border text-success mb-3"></div><p>Carregando Relatório GECOPE...</p></div>`;
                    modal.show();

                    renderizarRelatorioSOP_HTML(docData, modalBody);
                } else {
                    // Caso não seja analítica (ex: apenas arquivo PDF/XLS arquivado)
                    if (url) window.open(url, '_blank');
                    else throw new Error("Documento não possui dados analíticos.");
                }
            } else {
                if (!url) {
                    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
                    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                    modalBody.innerHTML = '<div class="alert alert-warning m-4 fw-bold text-center">Esta composição não possui arquivo nem dados analíticos para visualização.</div>';
                    modal.show();
                }
            }
        }

    } catch (err) {
        console.error(err);
        // Garante que o modal feche se houver erro para não travar a tela, apenas se estiver aberto
        const modalEl = document.getElementById('modalDetalheComposicao');
        const inst = bootstrap.Modal.getInstance(modalEl);
        if (inst && inst._isShown) inst.hide();
        alert("Erro ao visualizar: " + err.message);
    }
}
