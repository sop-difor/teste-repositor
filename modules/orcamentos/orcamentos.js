// modules/orcamentos/orcamentos.js — módulo Orçamentos: CRUD, versionamento, comentários e fluxo de decisão.
// Extraído de main.js (Fase 3 da reorganização modular).

/* --- LGICA DE ORAMENTOS (SUPABASE STORAGE + DB) --- */

// 1. SALVAR NOVO ORAMENTO (V1) - CORRIGIDO
// Função auxiliar para remover acentos e caracteres especiais (Coloque isso fora ou antes da função salvar)
function limparStringParaPath(str) {
    if (!str) return "";
    return str
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove acentos ( -> E)
        .replace(/\s+/g, "_") // Troca espaços por underline
        .replace(/[^a-zA-Z0-9._-]/g, "") // Remove qualquer outro caractere especial
        .toUpperCase();
}

// 1. SALVAR NOVO ORAMENTO (V1) - VERSO FINAL COM CORREO DE PATH
async function salvarNovoOrcamento() {
    const form = document.getElementById('formNovoOrcamento');

    // Validação básica do HTML
    if (!form.checkValidity()) {
        form.reportValidity();
        return;
    }

    const formData = new FormData(form);
    const arquivo = document.getElementById('inputArquivoUpload').files[0];

    // Busca botão globalmente
    const btn = document.querySelector('button[onclick="salvarNovoOrcamento()"]');

    // UI Loading
    let textoOriginal = "Salvar";
    if (btn) {
        textoOriginal = btn.innerText;
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> ENVIANDO...';
    }

    try {
        if (!arquivo) {
            alert("Por favor, selecione um arquivo.");
            if (btn) { btn.disabled = false; btn.innerText = textoOriginal; }
            return;
        }

        // 1. Captura os valores originais (com acento) para o Banco de Dados
        const categoria = formData.get('CATEGORIA').trim();
        const subcategoria = formData.get('SUBCATEGORIA').trim();
        const obra = formData.get('OBRA').trim();

        // 2. Gera versões "limpas" para o caminho do Storage (sem acentos/espaços)
        const catPath = limparStringParaPath(categoria);
        const subPath = limparStringParaPath(subcategoria);
        const obraPath = limparStringParaPath(obra);
        const arquivoNomePath = limparStringParaPath(arquivo.name);

        // Caminho seguro: ESCOLAS/ENSINO_MEDIO/EEM_10_SALAS/V1_ARQUIVO.PDF
        const storagePath = `${catPath}/${subPath}/${obraPath}/V1_${arquivoNomePath}`;

        // 3. Upload para o Supabase Storage
        const { data: uploadData, error: uploadError } = await sbClient
            .storage
            .from('orcamentos')
            .upload(storagePath, arquivo, {
                cacheControl: '3600',
                upsert: false
            });

        if (uploadError) throw uploadError;

        // 4. Obter URL Pública
        const { data: publicUrlData } = sbClient
            .storage
            .from('orcamentos')
            .getPublicUrl(storagePath);

        const publicUrl = publicUrlData.publicUrl;

        // 5. Salvar Metadados no Banco de Dados (Usando os nomes Originais com acento)
        const payload = {
            categoria: categoria.toUpperCase(),       // Salva "ESCOLAS"
            subcategoria: subcategoria.toUpperCase(), // Salva "ESCOLAS DE ENSINO MDIO"
            nome_obra: obra.toUpperCase(),            // Salva "EEM - 10 SALAS"
            status: formData.get('STATUS'),
            versao_atual: 'V1',
            arquivo_url: publicUrl,
            arquivo_path: storagePath, // Salva o caminho técnico
            historico_versoes: [{
                versao: 'V1',
                data: new Date().toISOString(),
                descricao: 'Upload Inicial',
                url: publicUrl,
                autor: 'Sistema'
            }]
        };

        const { error: dbError } = await sbClient
            .from('orcamentos_biblioteca')
            .insert([payload]);

        if (dbError) throw dbError;

        alert(" Orçamento cadastrado com sucesso!");

        // Log de Atividade
        registrarAtividade('ORCAMENTO', `cadastrou o orçamento da obra ${obra}`, '', obra);

        // Limpar e Fechar
        form.reset();
        const modalEl = document.getElementById('modalNovoOrcamento');
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.hide();

        carregarOrcamentos();

    } catch (error) {
        console.error(error);
        alert("Erro ao salvar: " + error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = textoOriginal;
        }
    }
}

/* --- 2. CARREGAR ORAMENTOS (CORRIGIDO VFINAL) --- */
// 2. CARREGAR ORAMENTOS (VERSO FINAL CORRIGIDA)
/* --- 2. CARREGAR ORAMENTOS (COM ORDENAO NUMRICA CORRIGIDA) --- */

async function deletarItemHistoricoOrcamento(id, index) {
    if (!confirm("️ Tem certeza que deseja excluir este registro do histórico?")) return;

    const btn = document.activeElement;
    if (btn) btn.disabled = true;

    try {
        const { data, error } = await sbClient.from('orcamentos_biblioteca').select('comentarios_revisao, versao_atual').eq('id', id).single();
        if (error) throw error;

        let historico = data.comentarios_revisao || [];

        // Remove o item pelo índice (como a lista é renderizada na ordem do array, o índice bate)
        // IMPORTANTE: splice altera o array original in-place
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
            // Se não há pendentes, checa se há versões além da V1 para manter "Atualizado" ou voltar para "Disponível"
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        if (historico.length === 0) {
            const currentV = parseInt(data.versao_atual?.replace(/[^0-9]/g, '')) || 1;
            payloadUpdate.status = (currentV > 1) ? 'Atualizado' : 'Disponível';
        }

        const { error: updateError } = await sbClient.from('orcamentos_biblioteca').update(payloadUpdate).eq('id', id);
        if (updateError) throw updateError;

        alert("Registro excluído!");
        carregarOrcamentos();

    } catch (err) {
        alert("Erro ao excluir: " + err.message);
        if (btn) btn.disabled = false;
    }
}

async function carregarOrcamentos() {
    const container = document.getElementById('accordionOrcamentos');
    const termoBusca = document.getElementById('orcamento-search').value.toLowerCase();
    const role = (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
    const isAdmin = (document.body.classList.contains('is-admin') || role === 'admin' || role === 'gerente') && role !== 'fiscal';

    let data = [];
    let hasMore = true;
    let blockStart = 0;
    const blockSize = 1000;
    let queryError = null;

    while (hasMore) {
        const { data: bData, error } = await sbClient
            .from('orcamentos_biblioteca')
            .select('*')
            .order('categoria', { ascending: true })
            .order('subcategoria', { ascending: true })
            .order('nome_obra', { ascending: true })
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

    if (queryError) { container.innerHTML = `Erro: ${queryError.message}`; return; }

    const dataFiltrada = data.filter(item => {
        if (!termoBusca) return true;
        const nomeObra = (item.nome_obra || "").toLowerCase();
        const categoria = (item.categoria || "").toLowerCase();
        return nomeObra.includes(termoBusca) || categoria.includes(termoBusca);
    });

    // --- KPIs DO PAINEL (refletem o que está filtrado na tela) ---
    let kpiRevisao = 0, kpiAtualizado = 0;
    dataFiltrada.forEach(item => {
        let hist = [];
        try { hist = typeof item.comentarios_revisao === 'string' ? JSON.parse(item.comentarios_revisao) : (item.comentarios_revisao || []); } catch (e) { hist = []; }
        if (!Array.isArray(hist)) hist = [];
        if (hist.some(c => c.decisao === 'pendente')) kpiRevisao++;
        else if (item.status === 'Atualizado' || parseInt((item.versao_atual || '').replace(/[^0-9]/g, '')) > 1) kpiAtualizado++;
    });
    const setKpi = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setKpi('orc-kpi-total', dataFiltrada.length);
    setKpi('orc-kpi-disponivel', dataFiltrada.length - kpiRevisao - kpiAtualizado);
    setKpi('orc-kpi-revisao', kpiRevisao);
    setKpi('orc-kpi-atualizado', kpiAtualizado);

    if (data.length === 0) { container.innerHTML = `<div class="text-center mt-5 text-muted">Nenhum orçamento encontrado.</div>`; return; }

    const arvore = {};
    dataFiltrada.forEach(item => {
        const cat = item.categoria || "Sem Categoria";
        const sub = item.subcategoria || "Sem Subcategoria";

        if (!arvore[cat]) arvore[cat] = {};
        if (!arvore[cat][sub]) arvore[cat][sub] = [];
        arvore[cat][sub].push(item);
    });

    let html = '';
    let catIndex = 0;

    for (const [cat, subcats] of Object.entries(arvore)) {
        catIndex++;
        const collapseId = `collapseCat${catIndex}`;

        html += `
        <div class="accordion-custom-item">
            <h2 class="accordion-header">
                <button class="accordion-button accordion-custom-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#${collapseId}">
                    <i class="bi bi-folder2-open me-2 text-warning"></i> ${cat}
                </button>
            </h2>
            <div id="${collapseId}" class="accordion-collapse collapse">
                <div class="accordion-body bg-white pt-2">`;

        for (const [sub, itens] of Object.entries(subcats)) {
            html += `<div class="subcategoria-header" style="margin-left: 10px;">${sub}</div>`;

            // --- CORREO AQUI: ORDENAO NATURAL (6 antes de 10) ---
            itens.sort((a, b) => {
                const nomeA = a.nome_obra || "";
                const nomeB = b.nome_obra || "";
                return nomeA.localeCompare(nomeB, 'pt-BR', { numeric: true });
            });
            // -------------------------------------------------------

            itens.forEach(obra => {
                const iconClass = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? 'icon-pdf' : 'icon-xls';
                const iconSymbol = obra.arquivo_url && obra.arquivo_url.endsWith('.pdf') ? '<i class="bi bi-file-earmark-pdf"></i>' : '<i class="bi bi-file-earmark-spreadsheet"></i>';
                const dataFormatada = new Date(obra.created_at).toLocaleDateString('pt-BR');

                // --- 1. BADGES DE STATUS (DINMICO) ---
                let badgeStatus = '';
                let historicoParaStatus = [];
                try {
                    historicoParaStatus = typeof obra.comentarios_revisao === 'string' ? JSON.parse(obra.comentarios_revisao) : (obra.comentarios_revisao || []);
                    if (!Array.isArray(historicoParaStatus)) historicoParaStatus = [];
                } catch (e) { historicoParaStatus = []; }

                const temPendenteReal = historicoParaStatus.some(c => c.decisao === 'pendente');

                if (temPendenteReal) {
                    badgeStatus = `<span class="badge bg-warning text-dark ms-2" style="font-size:0.65rem">Em Revisão</span>`;
                } else if (obra.status === 'Atualizado' || parseInt(obra.versao_atual?.replace(/[^0-9]/g, '')) > 1) {
                    // Badge Azul solicitado
                    badgeStatus = `<span class="badge badge-status-atualizado">Atualizado</span>`;
                }

                // --- 2. HISTÓRICO ---
                const historico = obra.comentarios_revisao || [];
                const qtdComentarios = historico.length;
                const histId = `hist_${obra.id}`;

                let botaoHistorico = '';
                let containerHistorico = '';

                if (qtdComentarios > 0) {
                    botaoHistorico = `
                        <button class="btn-toggle-history" type="button" data-bs-toggle="collapse" data-bs-target="#${histId}">
                            <i class="bi bi-clock-history"></i> Histórico (${qtdComentarios}) <i class="bi bi-chevron-down ms-1"></i>
                        </button>`;

                    const listaComentarios = historico.map((c, index) => {
                        const dataComent = c.data ? new Date(c.data).toLocaleDateString('pt-BR') : '-';
                        let classeStatus = '';
                        let badgeDecisao = '';
                        let respostaAdminHTML = '';
                        let botoesAcaoAdmin = '';

                        const isSystemLog = (c.autor && c.autor.toLowerCase().includes('sistema')) || (c.mensagem && c.mensagem.toLowerCase().includes('gerada versão'));

                        if (isSystemLog) {
                            classeStatus = 'system-log-entry';
                        }

                        if (c.decisao === 'atendido') {
                            classeStatus = 'status-atendido';
                            badgeDecisao = `<span class="badge-decision badge-atendido"><i class="bi bi-check-lg"></i> ATENDIDO</span>`;
                            if (c.resp_admin) respostaAdminHTML = `<div class="mt-2 pt-2 border-top small text-success"><strong>Resposta:</strong> ${escapeHTML(c.resp_admin)}</div>`;
                        } else {
                            if (c.decisao === 'recusado') {
                                classeStatus = 'status-recusado';
                                badgeDecisao = `<span class="badge-decision badge-recusado"><i class="bi bi-x-lg"></i> NO ACATADO</span>`;
                                if (c.resp_admin) respostaAdminHTML = `<div class="mt-2 pt-2 border-top small text-danger"><strong>Motivo:</strong> ${escapeHTML(c.resp_admin)}</div>`;
                            } else {
                                if (isAdmin && !isSystemLog) {
                                    botoesAcaoAdmin = `
                                <div class="admin-decision-actions">
                                    <button class="btn btn-sm btn-outline-success" onclick="abrirModalAtender(${obra.id}, ${index})">
                                        <i class="bi bi-check-lg"></i> Atender
                                    </button>
                                    <button class="btn btn-sm btn-outline-danger" onclick="abrirModalRecusar(${obra.id}, ${index})">
                                        <i class="bi bi-x-lg"></i> Não Acatar
                                    </button>
                                </div>`;
                                }
                            }
                        }

                        let btnAnexo = '';
                        if (c.arquivo) {
                            btnAnexo = `<a href="${escapeHTML(c.arquivo)}" target="_blank" rel="noopener noreferrer" class="btn-history-anexo mt-2"><i class="bi bi-paperclip"></i> Ver Memória/Anexo</a>`;
                        }

                        let btnExcluirHist = '';
                        if (isAdmin) {
                            btnExcluirHist = `<button class="btn btn-sm text-danger border-0 p-0 ms-2 admin-only" title="Excluir Registro" onclick="deletarItemHistoricoOrcamento(${obra.id}, ${index})"><i class="bi bi-x-lg"></i></button>`;
                        }

                        return `
                        <div class="history-card-item ${classeStatus}">
                            <div class="history-card-header">
                                <div><strong>${escapeHTML(c.autor)}</strong> <span class="fw-normal ms-1">- ${dataComent}</span></div>
                                <div class="d-flex align-items-center">
                                    ${badgeDecisao}
                                    ${btnExcluirHist}
                                </div>
                            </div>
                            <div class="history-card-body">
                                <div>${escapeHTML(c.mensagem)}</div>
                                ${btnAnexo}
                                ${respostaAdminHTML}
                                ${botoesAcaoAdmin}
                            </div>
                        </div>`;
                    }).join('');

                    containerHistorico = `
                    <div class="collapse" id="${histId}">
                        <div class="history-collapse-box">
                            ${listaComentarios}
                        </div>
                    </div>`;
                }

                html += `
                <div class="mb-2">
                    <div class="orcamento-item-row" style="margin-bottom:0; border-radius: 8px 8px ${qtdComentarios > 0 ? '0 0' : '8px 8px'};">
                        <div class="d-flex align-items-center">
                            <div class="file-icon-box ${iconClass}">${iconSymbol}</div>
                            <div>
                                <div class="d-flex align-items-center flex-wrap">
                                    <span class="fw-bold text-dark" style="font-size:0.95rem;">${escapeHTML(obra.nome_obra)}</span>
                                    <span class="badge bg-secondary ms-2" style="font-size:0.7rem;">${obra.versao_atual}</span>
                                    ${badgeStatus}
                                </div>
                                <div class="text-muted mt-1" style="font-size:0.75rem;">Criado em: ${dataFormatada}</div>
                                ${botaoHistorico}
                            </div>
                        </div>
                        <div class="orcamento-actions">
                            <a href="${escapeHTML(obra.arquivo_url)}" target="_blank" rel="noopener noreferrer" class="btn-action-baixar" title="Baixar Arquivo"><i class="bi bi-download"></i> Baixar</a>
                            <!-- Nova Versão: ADMIN E GERENTE -->
                            <button class="btn btn-action-icon admin-gerente-only" onclick="prepararNovaVersao(${obra.id})" title="Nova Versão"><i class="bi bi-cloud-arrow-up-fill icon-cloud"></i></button>
                            <!-- Comentário: VISÍVEL PARA TODOS -->
                            <button class="btn btn-action-icon" onclick="prepararComentario(${obra.id})" title="Adicionar Comentário"><i class="bi bi-chat-left-text-fill text-warning"></i></button>
                            <!-- Excluir: ADMIN E GERENTE -->
                            <button class="btn btn-action-icon admin-gerente-only" onclick="deletarOrcamento(${obra.id}, '${obra.arquivo_path}')"><i class="bi bi-trash-fill icon-trash"></i></button>
                        </div>
                    </div>
                    ${containerHistorico}
                </div>`;
            });
        }
        html += `   </div></div></div>`;
    }
    container.innerHTML = html || `<div class="text-center mt-5 text-muted">Nenhum orçamento encontrado para "${document.getElementById('orcamento-search').value}".</div>`;
}

/* --- FUNES DE DECISO (ATUALIZADAS E SIMPLIFICADAS) --- */

// Hook para buscar ao digitar (debounce simples)
document.getElementById('orcamento-search')?.addEventListener('input', debounce(() => {
    carregarOrcamentos();
}, 500));

// Clear Listener Orçamentos
document.getElementById('btn-orc-clear')?.addEventListener('click', () => {
    const input = document.getElementById('orcamento-search');
    if (input) {
        input.value = '';
        carregarOrcamentos();
    }
});

// 3. ENVIAR NOVA VERSO (V2, V3...)
function prepararNovaVersao(id) {
    document.getElementById('update-id-orcamento').value = id;
    document.getElementById('formNovaVersao').reset();
    bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNovaVersao')).show();
}

/* --- ENVIO DE NOVA VERSO (MUDA STATUS PARA ATUALIZADO) --- */
async function enviarNovaVersao() {
    const id = document.getElementById('update-id-orcamento').value;
    const arquivo = document.getElementById('inputArquivoUpdate').files[0];
    const descricao = document.getElementById('inputDescricaoUpdate').value;

    if (!arquivo) { alert("Selecione um arquivo."); return; }

    const btn = document.querySelector('#modalNovaVersao button[onclick="enviarNovaVersao()"]');
    const txtOrig = btn.innerText;
    btn.disabled = true; btn.innerText = "Processando...";

    try {
        // 1. Pegar dados atuais
        const { data: currentData } = await sbClient.from('orcamentos_biblioteca').select('*').eq('id', id).single();

        // 2. LIMPAR ARQUIVOS DE COMENTÁRIOS RESOLVIDOS
        if (currentData.comentarios_revisao && currentData.comentarios_revisao.length > 0) {
            await limparArquivosComentariosResolvidos('orcamentos_biblioteca', 'orcamentos', currentData.comentarios_revisao);
        }

        // 3. Calcular nova versão
        const currentV = parseInt(currentData.versao_atual.replace(/[^0-9]/g, '')) || 1;
        const newVersionLabel = `V${currentV + 1}`;

        // 4. Upload Novo Arquivo
        const nomeLimpo = arquivo.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9.-]/g, "_");
        const pathParts = currentData.arquivo_path.split('/');
        if (pathParts.length > 1) pathParts.pop();
        const folderPath = pathParts.join('/');
        const newStoragePath = `${folderPath}/${newVersionLabel}_${nomeLimpo}`;

        const { error: uploadError } = await sbClient.storage.from('orcamentos').upload(newStoragePath, arquivo);
        if (uploadError) throw uploadError;

        const { data: publicUrlData } = sbClient.storage.from('orcamentos').getPublicUrl(newStoragePath);

        // 5. Atualizar Histórico de Versões
        const oldHistory = currentData.historico_versoes || [];
        oldHistory.push({
            versao: currentData.versao_atual,
            url: currentData.arquivo_url,
            data: new Date().toISOString(),
            motivo: 'Versão arquivada'
        });

        // 6. Update na Tabela -> AQUI MUDA O STATUS PARA "ATUALIZADO"
        const { error: updateError } = await sbClient
            .from('orcamentos_biblioteca')
            .update({
                versao_atual: newVersionLabel,
                arquivo_url: publicUrlData.publicUrl,
                arquivo_path: newStoragePath,
                historico_versoes: oldHistory,
                status: 'Atualizado', // <--- MUDANA AUTOMÁTICA DE STATUS
                created_at: new Date().toISOString()
            })
            .eq('id', id);

        if (updateError) throw updateError;

        // Notificação WhatsApp
        processarNotificacao('atualizacao_orcamento', {
            REF_ORCAMENTO: currentData?.obra || currentData?.processo || 'N/A'
        });

        // Se houver descrição, salva como comentário de sistema
        if (descricao) {
            await salvarComentarioNoBanco(id, 'Sistema (Versão)', `Gerada versão ${newVersionLabel}: ${descricao}`);
        }

        // Log de Atividade
        registrarAtividade('ORCAMENTO', `atualizou a versão (${newVersionLabel}) do orçamento: ${currentData?.nome_obra || 'N/A'}`, '', currentData?.nome_obra);

        alert(`Versão ${newVersionLabel} enviada! Status alterado para ATUALIZADO. Arquivos de comentários resolvidos foram limpos.`);
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalNovaVersao')).hide();
        carregarOrcamentos();

    } catch (err) {
        alert("Erro: " + err.message);
    } finally {
        btn.disabled = false; btn.innerText = txtOrig;
    }
}

// 4. REVISES E COMENTÁRIOS
async function prepararComentario(id) {
    try {
        const modalEl = document.getElementById('modalComentarioOrcamento');
        if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);

        document.getElementById('coment-id-orcamento').value = id;
        const { data, error } = await sbClient.from('orcamentos_biblioteca').select('*').eq('id', id).single();
        if (error) throw error;

        document.getElementById('coment-nome-obra').value = data.nome_obra || '';
        document.querySelector('#formComentarioOrcamento textarea[name="MENSAGEM"]').value = '';

        const sel = document.getElementById('coment-fiscal');
        // Preenche automaticamente com o usuário logado
        const currentUserName = sessionStorage.getItem('sop_user_name') || sessionStorage.getItem('sop_user') || 'Usuário';
        sel.innerHTML = `<option value="${escapeHTML(currentUserName)}" selected>${escapeHTML(currentUserName)}</option>`;
        // Visualmente "readonly"
        sel.style.backgroundColor = '#e9ecef';
        sel.style.pointerEvents = 'none';

        const chatContainer = document.getElementById('historico-comentarios');
        const comentarios = data.comentarios_revisao || [];
        chatContainer.innerHTML = comentarios.length ? comentarios.map(c => `
                            <div class="mb-2 border-bottom pb-1">
                                <div class="d-flex justify-content-between"><strong class="text-primary" style="font-size:0.75rem">${escapeHTML(c.autor)}</strong><span class="text-muted" style="font-size:0.7rem">${c.data ? new Date(c.data).toLocaleDateString() : '-'}</span></div>
                                <div style="font-size:0.8rem">${escapeHTML(c.mensagem)}</div>
                                ${c.arquivo ? `<a href="${escapeHTML(c.arquivo)}" target="_blank" rel="noopener noreferrer" class="badge bg-light text-dark border mt-1"><i class="bi bi-paperclip"></i> Anexo</a>` : ''}
                            </div>`).join('') : '<em class="text-muted">Sem mensagens.</em>';

        bootstrap.Modal.getOrCreateInstance(modalEl).show();
    } catch (err) { alert("Erro: " + err.message); }
}

/* --- ENVIO DE COMENTÁRIO (MUDA STATUS PARA EM REVISÃO) --- */
async function enviarComentarioOrcamento() {
    const id = document.getElementById('coment-id-orcamento').value;
    const autor = document.getElementById('coment-fiscal').value;
    const msg = document.querySelector('textarea[name="MENSAGEM"]').value;
    const arquivoAnexo = document.getElementById('inputArquivoComentario').files[0];

    if (!autor || !msg) { alert("Preencha autor e mensagem."); return; }

    try {
        let anexoUrl = null;
        if (arquivoAnexo) {
            const nomeLinpo = sanitizarNomeArquivo(arquivoAnexo.name);
            const path = `anexos_comentarios/${id}_${Date.now()}_${nomeLinpo}`;
            const { error: uploadError } = await sbClient.storage.from('orcamentos').upload(path, arquivoAnexo);
            if (uploadError) throw uploadError;
            const { data } = sbClient.storage.from('orcamentos').getPublicUrl(path);
            anexoUrl = data.publicUrl;
        }

        // Buscar histórico atual
        const { data: curr } = await sbClient.from('orcamentos_biblioteca').select('comentarios_revisao, nome_obra').eq('id', id).single();
        const novoArr = curr.comentarios_revisao || [];

        novoArr.unshift({
            autor: autor,
            mensagem: msg,
            data: new Date().toISOString(),
            arquivo: anexoUrl,
            decisao: 'pendente' // Novo comentário nasce pendente
        });

        // Atualiza status para "Em Revisão"
        const { error: updateError } = await sbClient.from('orcamentos_biblioteca').update({
            comentarios_revisao: novoArr,
            status: 'Em Revisão'  // <--- FORA O STATUS DE REVISÃO
        }).eq('id', id);

        if (updateError) throw updateError;

        // Notificação WhatsApp
        processarNotificacao('novo_comentario_orcamento', {
            NOME_USUARIO: autor,
            REF_ORCAMENTO: curr?.nome_obra || 'N/A'
        });

        // Log de Atividade
        registrarAtividade('ORCAMENTO', `adicionou um comentário no orçamento: ${curr?.nome_obra || 'N/A'}`, '', curr?.nome_obra);

        alert("Solicitação enviada!");
        bootstrap.Modal.getInstance(document.getElementById('modalComentarioOrcamento')).hide();
        carregarOrcamentos();
    } catch (err) {
        alert("Erro ao enviar: " + err.message);
    }
}

// Função auxiliar usada internamente
async function salvarComentarioNoBanco(id, autor, mensagem) {
    const { data: curr } = await sbClient.from('orcamentos_biblioteca').select('comentarios_revisao').eq('id', id).single();
    const novoArr = curr.comentarios_revisao || [];
    novoArr.unshift({ autor, mensagem, data: new Date().toISOString() });
    await sbClient.from('orcamentos_biblioteca').update({ comentarios_revisao: novoArr }).eq('id', id);

    // Log de Atividade
    const { data: bData } = await sbClient.from('orcamentos_biblioteca').select('descricao').eq('id', id).single();
    registrarAtividade('ORCAMENTO', `registrou um comentário no orçamento: ${bData?.descricao || 'N/A'}`, '', bData?.descricao);
}

/* --- MOTORES GENRICOS (OTIMIZAO) --- */

async function processarAtendimento() {
    const id = document.getElementById('atender-id-orcamento').value;
    const index = document.getElementById('atender-index-comentario').value;
    const resp = document.getElementById('textoAtender').value;
    await processarDecisaoGenerica({
        table: 'orcamentos_biblioteca', id, index, decision: 'atendido',
        respText: resp, modalId: 'modalAtenderRevisao', callback: carregarOrcamentos
    });
}

async function processarRecusa() {
    const id = document.getElementById('recusar-id-orcamento').value;
    const index = document.getElementById('recusar-index-comentario').value;
    const resp = document.getElementById('textoRecusar').value;
    await processarDecisaoGenerica({
        table: 'orcamentos_biblioteca', id, index, decision: 'recusado',
        respText: resp, modalId: 'modalRecusarRevisao', callback: carregarOrcamentos
    });
}

async function deletarOrcamento(id, path) {
    await deletarRegistroGenerico('orcamentos_biblioteca', 'orcamentos', id, path, carregarOrcamentos);
}

/* --- FUNES DE DECISO CORRIGIDAS (RESOLVE TELA ESCURA) --- */

// 1. ABRIR MODAL ATENDER
function abrirModalAtender(id, index) {
    abrirModalDecisao('modalAtenderRevisao', id, index, 'atender-id-orcamento', 'atender-index-comentario', 'formAtender');
}

// 2. PROCESSAR ATENDIMENTO

// 3. ABRIR MODAL RECUSAR
function abrirModalRecusar(id, index) {
    abrirModalDecisao('modalRecusarRevisao', id, index, 'recusar-id-orcamento', 'recusar-index-comentario', 'formRecusar');
}
