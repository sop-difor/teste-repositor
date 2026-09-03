// modules/tabelas/tabelas.js — módulo Tabelas: busca e renderização de composições de referência (SINAPI/SEINFRA/ORSE).
// Extraído de main.js (Fase 3 da reorganização modular).

async function executarBuscaTabela() {
    const fonte = document.getElementById('busca-fonte').value;
    const versaoBase = document.getElementById('busca-versao').value;
    const tipoRef = document.getElementById('busca-ref').value;
    const termo = document.getElementById('busca-input-termo').value.trim();
    const areaResultados = document.getElementById('area-resultados-tabela');
    const tbody = document.getElementById('tabela-precos-body');
    const contador = document.getElementById('contador-resultados');

    if (!termo || termo.length < 2) { alert("Digite ao menos dois caracteres para pesquisar."); return; }

    let nomeTabela = '', dataFormatada = '';
    if (fonte === 'SEINFRA') nomeTabela = 'seinfra_itens';
    else if (fonte === 'SINAPI') {
        nomeTabela = 'sinapi_itens';
        if (versaoBase.length === 6) dataFormatada = `${versaoBase.substring(2)}-${versaoBase.substring(0, 2)}-01`;
    } else if (fonte === 'ORSE') {
        nomeTabela = 'orse_itens';
        if (versaoBase.includes('/')) { const p = versaoBase.split('/'); dataFormatada = `${p[1]}-${p[0]}-01`; }
    }

    areaResultados.style.display = 'block';
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5"><div class="spinner-border text-success"></div><div class="mt-2 text-muted small">Buscando na base de dados...</div></td></tr>';

    try {
        // Lista explícita de colunas: a busca não usa a composição (só o modal de
        // detalhe usa). Pedir 'composicao' aqui forçaria a fachada a montar o JSON
        // analítico para cada linha do resultado — lento. Ver gecope/tabelas.md.
        let query = sbClient.from(nomeTabela).select('id,identificacao,codigo,descricao,unidade,preco_unitario,tipo_encargo,referencia,created_at,origem_preco');
        if (fonte === 'SEINFRA') query = query.eq('referencia', versaoBase);
        else query = query.eq('referencia', dataFormatada);

        // Ajuste para filtro de desoneração (SEINFRA pode usar termos diferentes)
        let filtroRef = tipoRef;
        if (fonte === 'SEINFRA') {
            // Tenta bater com 'onerada' ou 'não desonerada'
            if (tipoRef === 'onerada') {
                query = query.or('tipo_encargo.ilike.onerada,tipo_encargo.ilike.%não desonerada%');
            } else {
                query = query.ilike('tipo_encargo', 'desonerada');
            }
        } else if (fonte === 'SINAPI') {
            query = query.eq('tipo_encargo', tipoRef);
        }
        // Para ORSE, ignoramos o filtro de tipo_encargo pois a tabela não possui essa coluna

        // Busca por Código OU Descrição e limite estendido conforme solicitado (1000 itens)
        query = query.or(`codigo.ilike.%${termo}%,descricao.ilike.%${termo}%`)
            .limit(1000);

        const { data, error } = await query;
        if (error) throw error;

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-4">Nenhum item encontrado com os critérios informados.</td></tr>';
            contador.textContent = '0 itens';
            return;
        }

        currentTabelaData = data;
        renderTabelaResults(data);
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `<tr><td colspan="6" class="text-danger text-center">Erro ao buscar: ${err.message}</td></tr>`;
    }
}

function limparBuscaTabela() {
    document.getElementById('busca-input-termo').value = '';
    document.getElementById('busca-desc').value = '';
    document.getElementById('busca-bdi').value = '';
    document.getElementById('area-resultados-tabela').style.display = 'none';
    document.getElementById('tabela-precos-body').innerHTML = '';
    document.getElementById('contador-resultados').textContent = '0 itens';
    currentTabelaData = [];
}

function recalcTabela() {
    if (currentTabelaData && currentTabelaData.length > 0) renderTabelaResults(currentTabelaData);
}

function gerarLinkOrse(codigo, referencia) {
    if (!referencia || referencia.length < 10) return "#";
    try {
        const dateObj = new Date(referencia);
        const ano = dateObj.getUTCFullYear();
        const mes = dateObj.getUTCMonth() + 1;
        const codigoLimpo = codigo.replace(/^[Ss]/, '');
        return `https://orse.cehop.se.gov.br/composicao.asp?font_sg_fonte=ORSE&serv_nr_codigo=${codigoLimpo}&peri_nr_ano=${ano}&peri_nr_mes=${mes}&peri_nr_ordem=1`;
    } catch (e) { console.error("Erro gerarLinkOrse", e); return "#"; }
}

function gerarLinkSeinfra(codigo, ref) {
    const enc = (ref || '').toLowerCase().trim();
    // 'nao_desonerada' se contiver termos de negação ou for exatamente 'onerada'
    // Evita que 'desonerada' seja detectada como 'onerada' pelo .includes()
    const containsNao = enc.includes('não') || enc.includes('nao') || enc.includes('sem');
    const isOnerada = enc === 'onerada' || (containsNao && enc.includes('desonerada'));

    const statusUrl = isOnerada ? 'onerada' : 'desonerada';
    return `https://sin.seinfra.ce.gov.br/site-seinfra/siproce/${statusUrl}/html/${(codigo || '').trim()}.html?a=1698149826826`;
}

function renderTabelaResults(lista) {
    const tbody = document.getElementById('tabela-precos-body');
    const contador = document.getElementById('contador-resultados');
    const bdiVal = parseFloat(document.getElementById('busca-bdi').value) || 0;
    const descVal = parseFloat(document.getElementById('busca-desc').value) || 0;
    const fonte = document.getElementById('busca-fonte').value;
    const tipoRef = document.getElementById('busca-ref').value;
    const versaoBase = document.getElementById('busca-versao').value;
    contador.textContent = `${lista.length} itens`;

    // Função auxiliar para renderizar a linha
    const renderLinha = (item) => {
        let valorBase = parseFloat(item.valor_unitario || item.preco_unitario || item.valor || item.preco || 0);
        const valorFinal = valorBase * (1 + bdiVal / 100) * (1 - descVal / 100);
        const stylePreco = (bdiVal > 0 || descVal > 0) ? 'color: #d63384 !important;' : 'color: var(--sop-gray-dark);';
        // Selo "SP": preço vindo da coluna de São Paulo porque Ceará estava zerado (só SINAPI).
        const seloSP = (item.origem_preco === 'SP')
            ? ' <span class="badge bg-warning text-dark" style="font-size:0.6rem;vertical-align:middle;" title="Preço de referência de São Paulo (valor de Ceará indisponível)">SP</span>'
            : '';

        let btnAction = '';
        const btnImprimir = `<button class="btn btn-sm btn-outline-success border me-1" onclick="imprimirLinhaTabela('${item.codigo}', '${fonte}', '${versaoBase}', '${tipoRef}')" title="Imprimir Composição"><i class="bi bi-printer"></i></button>`;

        if (fonte === 'ORSE') {
            const link = gerarLinkOrse(item.codigo, item.referencia);
            btnAction = `<div class="d-flex align-items-center justify-content-end">${btnImprimir}<a href="${escapeHTML(link)}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-primary" title="Ver Composição no ORSE"><i class="bi bi-box-arrow-up-right"></i></a></div>`;
        } else {
            btnAction = `<div class="d-flex align-items-center justify-content-end">${btnImprimir}<button class="btn btn-sm btn-light border" onclick="abrirDetalheTabela('${item.codigo}', '${fonte}', '${versaoBase}', '${tipoRef}')" title="Ver Detalhes"><i class="bi bi-chevron-right"></i></button></div>`;
        }

        return `<tr>
                            <td class="text-center small fw-bold text-secondary ps-3">${item.identificacao || '-'}</td>
                            <td class="fw-bold text-primary text-center">${item.codigo}</td>
                            <td class="text-uppercase small">${item.descricao}</td>
                            <td class="text-center small fw-bold">${item.unidade}</td>
                            <td class="text-end pe-3 fw-bold" style="${stylePreco}">${valorFinal.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${seloSP}</td>
                            <td class="text-end pe-3">${btnAction}</td>
                        </tr>`;
    };

    // Agrupamento por Categoria (para SEINFRA seguir a planilha oficial)
    if (fonte === 'SEINFRA') {
        const grupos = {};
        lista.forEach(item => {
            const cat = (item.categoria || item.identificacao || 'GERAL').toUpperCase();
            if (!grupos[cat]) grupos[cat] = [];
            grupos[cat].push(item);
        });

        let html = '';
        Object.keys(grupos).sort().forEach(cat => {
            html += `
                                <tr class="bg-light shadow-sm">
                                    <td colspan="6" class="py-2 ps-3 fw-bold text-success border-bottom bg-light bg-gradient" style="font-size: 0.8rem; border-left: 4px solid #008F3D;">
                                        <i class="bi bi-tag-fill me-1"></i> ${cat}
                                    </td>
                                </tr>
                            `;
            grupos[cat].forEach(item => {
                html += renderLinha(item);
            });
        });
        tbody.innerHTML = html;
    } else {
        tbody.innerHTML = lista.map(item => renderLinha(item)).join('');
    }
}

function renderizarComposicaoSINAPI(dadosPai, modalBody) {
    if (!dadosPai || !dadosPai.composicao || !Array.isArray(dadosPai.composicao)) return;

    // Limpa ações extras do rodapé
    const footerExtra = document.getElementById('footer-extra-actions');
    if (footerExtra) footerExtra.innerHTML = '';

    const formatDecimal = (v, d = 3) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

    const codigo = dadosPai.codigo || 'N/A';
    const descricao = (dadosPai.descricao || 'SEM DESCRIÇÃO').toUpperCase();
    const unidade = dadosPai.unidade || 'N/A';
    const versaoRef = formatarVersao(dadosPai.referencia || '');

    // Valor oficial do pai para evitar divergência de arredondamento de centavos
    const precoOficial = parseFloat(dadosPai.preco_unitario || dadosPai.valor_unitario || dadosPai.preco || dadosPai.valor || 0);

    // Agrupamento por tipo (Insumo/Composição)
    const grupos = {};

    dadosPai.composicao.forEach(item => {
        const tipo = (item.tipo_item || 'INSUMO').toUpperCase().replace('COMPOSICAO', 'COMPOSIÇÃO');
        if (!grupos[tipo]) grupos[tipo] = [];
        const subtotal = (parseFloat(item.coeficiente) || 0) * (parseFloat(item.preco_unitario) || 0);
        grupos[tipo].push({ ...item, total: subtotal });
    });

    let tableRows = '';
    Object.keys(grupos).sort().forEach(tipo => {
        tableRows += `
                            <tr style="background-color: #e8e8e8; font-size: 0.8rem; font-weight: bold;">
                                <td colspan="8" style="padding: 0.6rem 0.5rem; color: #333; text-align: center; text-uppercase;">${tipo}</td>
                            </tr>
                        `;

        let subtotalGrupo = 0;
        grupos[tipo].forEach(item => {
            subtotalGrupo += item.total;
            tableRows += `
                                <tr style="font-size: 0.8rem; border-bottom: 1px solid #eee;">
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">SINAPI</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${versaoRef}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center; font-weight: bold;">${item.codigo_item || item.codigo}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: justify;">${(item.descricao_item || item.descricao || '').toUpperCase()}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${item.unidade || '-'}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: center;">${formatDecimal(item.coeficiente)}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: right;">${formatDecimal(item.preco_unitario, 2)}${item.origem_preco === 'SP' ? ' <span class="badge bg-warning text-dark" style="font-size:0.6rem;" title="Preço de São Paulo (Ceará indisponível)">SP</span>' : ''}</td>
                                    <td style="padding: 0.5rem 0.5rem; text-align: right; font-weight: bold;">${formatDecimal(item.total, 2)}</td>
                                </tr>
                            `;
        });

        tableRows += `
                            <tr style="font-size: 0.8rem; background-color: #f5f5f5; font-weight: bold; border-top: 1px solid #ddd;">
                                <td colspan="7" style="padding: 0.6rem 0.5rem; text-align: right; color: #666;">TOTAL ${tipo}</td>
                                <td style="padding: 0.6rem 0.5rem; text-align: right; color: #333;">${formatDecimal(subtotalGrupo, 2)}</td>
                            </tr>
                        `;
    });

    modalBody.innerHTML = `
                        <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                            <!-- Cabeçalho Institucional SOP-CE -->
                            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
                                <div class="d-flex align-items-center">
                                    <div class="text-white p-2 rounded me-3 fw-bold fs-5" style="background-color: #008F3D !important; min-width: 80px; text-align: center;">SINAPI</div>
                                    <div>
                                        <div class="fw-bold fs-6" style="color: #008F3D; line-height: 1.2;">GOVERNO FEDERAL</div>
                                        <div class="text-dark fw-bold" style="font-size: 0.75rem;">SISTEMA NACIONAL DE PESQUISA DE CUSTOS E ÍNDICES DA CONSTRUO CIVIL</div>
                                    </div>
                                </div>
                                <div class="text-end">
                                    <h5 class="fw-bold mb-0 text-dark">COMPOSIÇÃO ANALÍTICA</h5>
                                    <div class="text-muted fw-bold" style="font-size: 0.7rem;">GECOPE - GERÊNCIA DE CONTROLE DE ADITIVOS</div>
                                </div>
                            </div>

                            <!-- Metadados (Estilo SINAPI adaptado) -->
                            <div style="background: white; border: 1px solid #eee; border-left: 6px solid #008F3D; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.06); padding: 1.5rem 0rem; display: flex; align-items: stretch; min-height: 100px; margin-bottom: 2rem;">
                                <div style="flex: 0 0 8%; padding: 0 1rem; border-right: 1px solid #eee; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">CÓDIGO</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a; line-height: 1;">${codigo}</div>
                                </div>
                                <div style="flex: 1; padding: 0 2rem; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">DESCRIÇÃO DA COMPOSIÇÃO</small>
                                    <div style="font-size: 1.05rem; font-weight: 800; color: #1a1a1a; text-transform: uppercase; text-align: justify;">${descricao}</div>
                                </div>
                                <div style="flex: 0 0 8%; padding: 0 0.5rem; border-left: 1px solid #eee; display: flex; flex-direction: column; justify-content: center; text-align: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">UNIDADE</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a;">${unidade}</div>
                                </div>
                            </div>

                            <!-- Tabela de Itens SINAPI -->
                            <div class="table-responsive">
                                <table class="table table-sm align-middle" style="border-collapse: collapse; width: 100%;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; background-color: #f5f5f5; border-top: 2px solid #ddd; border-bottom: 2px solid #ddd;">
                                            <th style="width: 8%;" class="fw-bold text-uppercase p-2">FONTE</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase p-2">VERSÃO</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-center p-2">CÓDIGO</th>
                                            <th style="width: 48%;" class="fw-bold text-uppercase p-2">DESCRIÇÃO DO INSUMO</th>
                                            <th style="width: 5%;" class="fw-bold text-uppercase text-center p-2">UNID.</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase text-center p-2">COEF.</th>
                                            <th style="width: 9%;" class="fw-bold text-uppercase text-end p-2">P. UNIT.</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-end p-2">TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tableRows}
                                    </tbody>
                                </table>
                            </div>

                            <!-- Preço Total Unitário (Barra Verde SOP) -->
                            <div class="mt-4" style="padding: 1.8rem 2rem; background: linear-gradient(135deg, #008F3D 0%, #007233 100%); color: white; border-radius: 12px;">
                                <div class="row align-items-center">
                                    <div class="col-8">
                                        <small class="text-white-50 fw-bold d-block mb-1" style="font-size: 0.7rem; letter-spacing: 1.5px; text-transform: uppercase;">Preço Total Unitário (SINAPI)</small>
                                        <div style="font-size: 0.95rem; opacity: 0.9;">Versão: ${versaoRef} . Referência: ${(dadosPai.tipo_encargo || '').toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada'}</div>
                                    </div>
                                    <div class="col-4 text-end">
                                        <div style="font-size: 2.4rem; font-weight: 800;">
                                            <span style="font-size: 1.2rem; vertical-align: middle;">R$</span> ${formatDecimal(precoOficial, 2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                `;
}

function renderizarComposicaoSEINFRA(dadosPai, modalBody, tipoRef) {
    if (!dadosPai) return;

    // Adiciona botão "Ver no site" no rodapé
    const footerExtra = document.getElementById('footer-extra-actions');
    if (footerExtra) {
        // Prioriza o tipo selecionado na interface para garantir o link correto
        const linkSeinfra = gerarLinkSeinfra(dadosPai.codigo, tipoRef || dadosPai.tipo_encargo);
        footerExtra.innerHTML = `<a href="${escapeHTML(linkSeinfra)}" target="_blank" rel="noopener noreferrer" class="btn btn-outline-primary btn-sm fw-bold">
                            <i class="bi bi-box-arrow-up-right me-1"></i> SEINFRA
                        </a>`;
    }

    const formatDecimal = (v, d = 3) => Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

    const codigo = dadosPai.codigo || 'N/A';
    const descricao = (dadosPai.descricao || 'SEM DESCRIÇÃO').toUpperCase();
    const unidade = dadosPai.unidade || 'N/A';
    const versaoRef = formatarVersao(dadosPai.referencia || '');

    // Valor oficial do pai para evitar divergência de arredondamento de centavos
    const precoOficial = parseFloat(dadosPai.preco_unitario || dadosPai.valor_unitario || dadosPai.preco || dadosPai.valor || 0);

    // Agrupamento por Categoria (Mão de Obra, Material, Equipamento, etc.)
    const grupos = {};
    const temComposicao = dadosPai.composicao && Array.isArray(dadosPai.composicao) && dadosPai.composicao.length > 0;

    if (temComposicao) {
        dadosPai.composicao.forEach(item => {
            // Prioriza o novo campo 'categoria', senão usa 'tipo_item' ou 'INSUMO' como fallback
            const categoria = (item.categoria || item.tipo_item || 'INSUMO').toUpperCase().replace('COMPOSICAO', 'COMPOSIÇÃO');
            if (!grupos[categoria]) grupos[categoria] = [];
            const subtotal = (parseFloat(item.coeficiente) || 0) * (parseFloat(item.preco_unitario) || 0);
            grupos[categoria].push({ ...item, total: subtotal });
        });
    }

    let tableContent = '';
    if (!temComposicao) {
        tableContent = `<tr><td colspan="8" class="text-center py-5 text-muted fw-bold">Nenhum dado de composição analítica disponível para este item.</td></tr>`;
    } else {
        // Ordenação personalizada para seguir o padrão da planilha oficial
        const ordemCategorias = ['MAO DE OBRA', 'MATERIAL', 'EQUIPAMENTO', 'SERVIO', 'ENCARGOS COMPLEMENTARES'];
        const categoriasExistentes = Object.keys(grupos).sort((a, b) => {
            const idxA = ordemCategorias.findIndex(cat => a.includes(cat));
            const idxB = ordemCategorias.findIndex(cat => b.includes(cat));
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        categoriasExistentes.forEach(cat => {
            tableContent += `
                                <tr style="background-color: #e8e8e8; font-size: 0.8rem; font-weight: bold;">
                                    <td colspan="8" style="padding: 0.6rem 0.5rem; color: #333; text-align: center; text-uppercase;">${cat}</td>
                                </tr>
                            `;

            let subtotalGrupo = 0;
            grupos[cat].forEach(item => {
                subtotalGrupo += item.total;
                tableContent += `
                                    <tr style="font-size: 0.8rem; border-bottom: 1px solid #eee;">
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">SEINFRA</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">${versaoRef}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center; font-weight: bold;">${item.codigo_item || item.codigo}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: justify;">${(item.descricao_item || item.descricao || '').toUpperCase()}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">${item.unidade || '-'}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: center;">${formatDecimal(item.coeficiente, 4)}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: right;">${formatDecimal(item.preco_unitario, 2)}</td>
                                        <td style="padding: 0.5rem 0.5rem; text-align: right; font-weight: bold;">${formatDecimal(item.valor_total || item.total, 2)}</td>
                                    </tr>
                                `;
            });

            // Adiciona linha de TOTAL por categoria (igual a planilha oficial)
            tableContent += `
                                <tr style="font-size: 0.8rem; background-color: #f9f9f9; font-weight: bold; border-top: 1px solid #ddd;">
                                    <td colspan="7" style="padding: 0.6rem 0.5rem; text-align: right; color: #666;">TOTAL ${cat}</td>
                                    <td style="padding: 0.6rem 0.5rem; text-align: right; color: #333;">${formatDecimal(subtotalGrupo, 2)}</td>
                                </tr>
                            `;
        });
    }

    modalBody.innerHTML = `
                        <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                            <!-- Cabeçalho Institucional SOP-CE / SEINFRA -->
                            <div class="d-flex justify-content-between align-items-center mb-3 border-bottom pb-2">
                                <div class="d-flex align-items-center">
                                    <div class="text-white p-2 rounded me-3 fw-bold fs-5" style="background-color: #008F3D !important; min-width: 80px; text-align: center;">SEINFRA</div>
                                    <div>
                                        <div class="fw-bold fs-6" style="color: #008F3D; line-height: 1.2;">GOVERNO DO ESTADO DO CEARÁ</div>
                                        <div class="text-dark fw-bold" style="font-size: 0.75rem;">SECRETARIA DA INFRAESTRUTURA</div>
                                    </div>
                                </div>
                                <div class="text-end">
                                    <h5 class="fw-bold mb-0 text-dark">COMPOSIÇÃO ANALÍTICA</h5>
                                    <div class="text-muted fw-bold" style="font-size: 0.7rem;">GECOPE - GERÊNCIA DE CONTROLE DE ADITIVOS</div>
                                </div>
                            </div>

                            <!-- Metadados (Estilo SEINFRA adaptado) -->
                            <div style="background: white; border: 1px solid #eee; border-left: 6px solid #008F3D; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.06); padding: 1.5rem 0rem; display: flex; align-items: stretch; min-height: 100px; margin-bottom: 2rem;">
                                <div style="flex: 0 0 8%; padding: 0 1rem; border-right: 1px solid #eee; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.5px;">CÓDIGO</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a; line-height: 1;">${codigo}</div>
                                </div>
                                <div style="flex: 1; padding: 0 2rem; display: flex; flex-direction: column; justify-content: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">DESCRIÇÃO DA COMPOSIÇÃO</small>
                                    <div style="font-size: 1.05rem; font-weight: 800; color: #1a1a1a; text-transform: uppercase; text-align: justify;">${descricao}</div>
                                </div>
                                <div style="flex: 0 0 8%; padding: 0 0.5rem; border-left: 1px solid #eee; display: flex; flex-direction: column; justify-content: center; text-align: center;">
                                    <small class="text-muted fw-bold d-block mb-1" style="font-size: 0.6rem; text-transform: uppercase;">UNIDADE</small>
                                    <div style="font-size: 1.35rem; font-weight: 800; color: #1a1a1a;">${unidade}</div>
                                </div>
                            </div>

                            <!-- Tabela de Itens SEINFRA -->
                            <div class="table-responsive">
                                <table class="table table-sm align-middle" style="border-collapse: collapse; width: 100%;">
                                    <thead>
                                        <tr style="font-size: 0.75rem; background-color: #f5f5f5; border-top: 2px solid #ddd; border-bottom: 2px solid #ddd;">
                                            <th style="width: 8%;" class="fw-bold text-uppercase p-2">FONTE</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase p-2">VERSÃO</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-center p-2">CÓDIGO</th>
                                            <th style="width: 48%;" class="fw-bold text-uppercase p-2">DESCRIÇÃO DO INSUMO</th>
                                            <th style="width: 5%;" class="fw-bold text-uppercase text-center p-2">UNID.</th>
                                            <th style="width: 7%;" class="fw-bold text-uppercase text-center p-2">COEF.</th>
                                            <th style="width: 9%;" class="fw-bold text-uppercase text-end p-2">P. UNIT.</th>
                                            <th style="width: 8%;" class="fw-bold text-uppercase text-end p-2">TOTAL</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${tableContent}
                                    </tbody>
                                </table>
                            </div>

                            <!-- Preço Total Unitário (Barra Verde SOP) -->
                            <div class="mt-4" style="padding: 1.8rem 2rem; background: linear-gradient(135deg, #008F3D 0%, #007233 100%); color: white; border-radius: 12px;">
                                <div class="row align-items-center">
                                    <div class="col-8">
                                        <small class="text-white-50 fw-bold d-block mb-1" style="font-size: 0.7rem; letter-spacing: 1.5px; text-transform: uppercase;">Preço Total Unitário (SEINFRA)</small>
                                        <div style="font-size: 0.95rem; opacity: 0.9;">Versão: ${versaoRef} . Referência: ${(tipoRef || dadosPai.tipo_encargo || '').toLowerCase().includes('deson') ? 'Desonerada' : 'Onerada'}</div>
                                    </div>
                                    <div class="col-4 text-end">
                                        <div style="font-size: 2.4rem; font-weight: 800;">
                                            <span style="font-size: 1.2rem; vertical-align: middle;">R$</span> ${formatDecimal(precoOficial, 2)}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                `;
}

async function abrirDetalheTabela(codigo, fonte, versao, tipoRef) {
    const modalEl = document.getElementById('modalDetalheComposicao');
    if (modalEl.parentElement !== document.body) document.body.appendChild(modalEl);
    const modalInstance = bootstrap.Modal.getOrCreateInstance(modalEl);
    const modalBody = modalEl.querySelector('.modal-body');

    // Limpa ações extras do rodapé no início
    const footerExtra = document.getElementById('footer-extra-actions');
    if (footerExtra) footerExtra.innerHTML = '';

    modalBody.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-success"></div><div class="mt-2 small text-muted">Carregando detalhes...</div></div>';
    modalInstance.show();

    try {
        let nomeTabela = 'seinfra_itens';
        let dataFormatada = versao;
        if (fonte === 'SINAPI') {
            nomeTabela = 'sinapi_itens';
            if (versao.length === 6) dataFormatada = `${versao.substring(2)}-${versao.substring(0, 2)}-01`;
        }

        let query = sbClient.from(nomeTabela).select('*');

        if (fonte === 'SEINFRA') {
            query = query.eq('referencia', dataFormatada);
            if (tipoRef === 'onerada') {
                query = query.or('tipo_encargo.ilike.onerada,tipo_encargo.ilike.%não desonerada%');
            } else {
                query = query.ilike('tipo_encargo', 'desonerada');
            }
        } else {
            query = query.eq('referencia', dataFormatada).eq('tipo_encargo', tipoRef);
        }

        const { data: dadosPai, error } = await query.eq('codigo', codigo).single();

        if (dadosPai) currentCompositionData = dadosPai;

        if (error || !dadosPai) {
            modalBody.innerHTML = '<div class="alert alert-warning m-4 fw-bold text-center">Composição não encontrada no banco de dados.</div>';
            return;
        }

        // ===== DESVIO PARA RENDERIZADOR SINAPI =====
        if (fonte === 'SINAPI' && dadosPai.composicao && Array.isArray(dadosPai.composicao) && dadosPai.composicao.length > 0) {
            renderizarComposicaoSINAPI(dadosPai, modalBody);
            return;
        }

        // ===== DESVIO PARA RENDERIZADOR SEINFRA (Gatilho 100% Conectado) =====
        if (fonte === 'SEINFRA') {
            renderizarComposicaoSEINFRA(dadosPai, modalBody, tipoRef);
            return;
        }

        // ===== LGICA ANTERIOR (FALLBACK PARA OUTRAS FONTES) =====
        let itens = (dadosPai && dadosPai.composicao) ? dadosPai.composicao : [];

        if (itens.length === 0) {
            const { data: itensDB } = await sbClient
                .from('tabelas_itens')
                .select('*')
                .eq('fonte', fonte)
                .eq('versao', versao)
                .eq('referencia_pai_cod', codigo);
            itens = itensDB || [];
        }

        const totalSOPResult = itens.reduce((acc, i) => acc + (parseFloat(i.valor_total || (i.coeficiente * i.preco_unitario)) || 0), 0);
        const versaoSOP = formatarVersao(versao || dadosPai.referencia || '');

        modalBody.innerHTML = `
                            <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                                <!-- Cabeçalho Padronizado -->
                                <div class="d-flex justify-content-between align-items-center mb-3">
                                    <div class="d-flex align-items-center">
                                        <div class="text-white p-2 rounded me-3 fw-bold fs-5" style="background-color: #008F3D !important; min-width: 80px; text-align: center;">SOP-CE</div>
                                        <div>
                                            <div class="fw-bold fs-6" style="color: #008F3D;">ESTADO DO CEARÁ</div>
                                            <div class="text-dark fw-bold" style="font-size: 0.75rem;">SUPERINTENDÊNCIA DE OBRAS PÚBLICAS</div>
                                        </div>
                                    </div>
                                    <div class="text-end">
                                        <h5 class="fw-bold mb-0 text-dark">DETALHE DA COMPOSIÇÃO</h5>
                                        <div class="text-muted fw-bold" style="font-size: 0.7rem;">FONTE: ${fonte} / ${versaoSOP}</div>
                                    </div>
                                </div>

                                <!-- Metadados -->
                                <div class="mb-4" style="background: white; border: 1px solid #eee; border-left: 6px solid #F28C00; border-radius: 12px; padding: 1.2rem; display: flex; align-items: center;">
                                    <div class="me-4 border-end pe-4">
                                        <small class="text-muted fw-bold d-block mb-1">CÓDIGO</small>
                                        <div class="fw-bold fs-5">${dadosPai.codigo}</div>
                                    </div>
                                    <div class="flex-grow-1">
                                        <small class="text-muted fw-bold d-block mb-1">DESCRIÇÃO</small>
                                        <div class="fw-bold text-uppercase" style="font-size: 0.95rem;">${dadosPai.descricao}</div>
                                    </div>
                                    <div class="ms-4 border-start ps-4 text-center">
                                        <small class="text-muted fw-bold d-block mb-1">UNID</small>
                                        <div class="fw-bold fs-5">${dadosPai.unidade}</div>
                                    </div>
                                </div>

                                <!-- Tabela -->
                                <div class="table-responsive">
                                    <table class="table table-sm table-bordered">
                                        <thead style="background-color: #f8f9fa;">
                                            <tr class="small fw-bold">
                                                <th class="text-center">ITEM</th>
                                                <th>DESCRIÇÃO DO INSUMO</th>
                                                <th class="text-center">UNID</th>
                                                <th class="text-center">COEF.</th>
                                                <th class="text-end">P. UNIT.</th>
                                                <th class="text-end">TOTAL</th>
                                            </tr>
                                        </thead>
                                        <tbody class="small">
                                            ${itens.map(i => `
                                                <tr>
                                                    <td class="text-center">${i.codigo_item || '-'}</td>
                                                    <td class="text-uppercase">${i.descricao_item || i.descricao}</td>
                                                    <td class="text-center">${i.unidade || '-'}</td>
                                                    <td class="text-center">${parseFloat(i.coeficiente).toLocaleString('pt-BR', { minimumFractionDigits: 4 })}</td>
                                                    <td class="text-end">${parseFloat(i.preco_unitario).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                    <td class="text-end fw-bold">${parseFloat(i.valor_total || (i.coeficiente * i.preco_unitario)).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                </tr>
                                            `).join('')}
                                        </tbody>
                                    </table>
                                </div>

                                <!-- Rodapé Total Verde -->
                                <div class="mt-3 p-3 text-white d-flex justify-content-between align-items-center" style="background: #008F3D; border-radius: 8px;">
                                    <div class="fw-bold">PREÇO TOTAL DA COMPOSIÇÃO</div>
                                    <div class="fs-4 fw-bold">R$ ${totalSOPResult.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                </div>
                            </div>
                        `;
    } catch (e) {
        modalBody.innerHTML = `<div class="alert alert-danger">Erro ao carregar: ${e.message}</div>`;
    }
}

// Nova função para imprimir diretamente da lista de tabelas
async function imprimirLinhaTabela(codigo, fonte, versao, tipoRef) {
    try {
        let nomeTabela = 'seinfra_itens';
        let dataFormatada = versao;
        if (fonte === 'SINAPI') {
            nomeTabela = 'sinapi_itens';
            if (versao.length === 6) dataFormatada = `${versao.substring(2)}-${versao.substring(0, 2)}-01`;
        }

        let query = sbClient.from(nomeTabela).select('*');
        if (fonte === 'SEINFRA') {
            query = query.eq('referencia', dataFormatada);
            if (tipoRef === 'onerada') {
                query = query.or('tipo_encargo.ilike.onerada,tipo_encargo.ilike.%não desonerada%');
            } else {
                query = query.ilike('tipo_encargo', 'desonerada');
            }
        } else {
            query = query.eq('referencia', dataFormatada).eq('tipo_encargo', tipoRef);
        }

        const { data: dadosPai, error } = await query.eq('codigo', codigo).single();
        if (error || !dadosPai) {
            alert("Dados não encontrados para impressão.");
            return;
        }

        currentCompositionData = dadosPai;
        const tempDiv = document.createElement('div');

        if (fonte === 'SINAPI' && dadosPai.composicao && Array.isArray(dadosPai.composicao)) {
            renderizarComposicaoSINAPI(dadosPai, tempDiv);
        } else if (fonte === 'SEINFRA') {
            renderizarComposicaoSEINFRA(dadosPai, tempDiv, tipoRef);
        } else {
            tempDiv.innerHTML = `
                                <div class="p-4 report-print-area" style="font-family: 'Montserrat', sans-serif;">
                                    <h4 class="fw-bold">${dadosPai.codigo} - ${dadosPai.descricao}</h4>
                                    <p class="text-muted">Unidade: ${dadosPai.unidade}</p>
                                    <p class="fw-bold">Valor Unitário: ${parseFloat(dadosPai.preco_unitario || dadosPai.valor_unitario || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>
                                </div>
                            `;
        }

        imprimirRelatorioSOP(dadosPai, tempDiv.innerHTML);

    } catch (e) {
        console.error(e);
        alert("Erro ao preparar impressão: " + e.message);
    }
}

async function atualizarSelectVersao() {
    const fonte = document.getElementById('busca-fonte').value;
    const selectVersao = document.getElementById('busca-versao');
    const selectRef = document.getElementById('busca-ref');

    if (!selectVersao) return;

    // Mostra estado de carregamento
    selectVersao.innerHTML = '<option value="">Buscando...</option>';
    selectVersao.disabled = true;

    try {
        if (fonte === 'SEINFRA') {
            // Lê as referências carregadas direto de `referencia_carregada` (rápido),
            // em vez de sondar a view item a item.
            const { data } = await sbClient.from('referencia_carregada')
                .select('referencia_label').eq('fonte', 'SEINFRA')
                .order('referencia_ord', { ascending: false });

            selectVersao.innerHTML = '';
            const valids = (data || []).map(r => r.referencia_label);
            if (valids.length > 0) {
                valids.forEach(v => selectVersao.add(new Option(`Tabela 0${v}`, v)));
            } else {
                ["28", "27"].forEach(t => selectVersao.add(new Option(`Tabela 0${t}`, t)));
            }
            selectRef.disabled = false;
        }
        else if (fonte === 'SINAPI' || fonte === 'ORSE') {
            const tabela = (fonte === 'SINAPI') ? 'sinapi_itens' : 'orse_itens';
            const mapMesLabels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

            // Verifica todos os meses realmente presentes na tabela (do mais antigo
            // ao mais recente), em vez de só os últimos 12 a partir de hoje.
            const disponiveis = await obterMesesDisponiveis(tabela);

            selectVersao.innerHTML = '';
            if (disponiveis.length > 0) {
                disponiveis.forEach(r => {
                    const mesStr = String(r.mes).padStart(2, '0');
                    const label = `${mapMesLabels[r.mes - 1]}/${r.ano}`;
                    const val = (fonte === 'SINAPI') ? `${mesStr}${r.ano}` : `${mesStr}/${r.ano}`;
                    selectVersao.add(new Option(label, val));
                });
            } else {
                // Fallback se a internet/banco falhar
                if (fonte === 'SINAPI') selectVersao.add(new Option("Dez/2025", "122025"));
                else selectVersao.add(new Option("Dez/2025", "12/2025"));
            }

            if (fonte === 'ORSE') {
                selectRef.value = 'onerada';
                selectRef.disabled = true;
            } else {
                selectRef.disabled = false;
            }
        }
    } catch (err) {
        console.error("Erro ao atualizar versões:", err);
        // Fallback genérico
        if (fonte === 'SEINFRA') {
            selectVersao.innerHTML = '';
            ["28", "27"].forEach(t => selectVersao.add(new Option(`Tabela 0${t}`, t)));
        } else {
            selectVersao.innerHTML = `<option value="${fonte === 'SINAPI' ? '122025' : '12/2025'}">Dez/2025</option>`;
        }
    } finally {
        selectVersao.disabled = false;
    }
}
document.addEventListener('DOMContentLoaded', atualizarSelectVersao);
