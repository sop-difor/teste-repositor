// modules/financeiro/financeiro.js — módulo Financeiro: filtros, KPIs, gráficos e drill-down
// comparando valores da Fiscalização x GECOPE. Depende de shared/multiselect.js
// (getSelectedValues/renderMultiSelectUI/fillSelect/dashDebounce).
// Extraído de dashboard.js + main.js (Fase 3 da reorganização modular).
(function (window) {
    'use strict';

    // LOGIC: DASHBOARDS
    var fin = { status: document.getElementById("filter-status"), fiscal: document.getElementById("filter-fiscal"), contratada: document.getElementById("filter-contratada"), contratante: document.getElementById("filter-contratante"), ano: document.getElementById("filter-ano"), clear: document.getElementById("btn-clear-filters"), diffMetric: document.getElementById("metric-diff") };

    // Antes desta correção, toda recarga de window.financeiroData (inclusive a
    // disparada por criar/editar/excluir QUALQUER processo, mesmo em outra aba)
    // reconstruía as opções via fillSelect(), que sempre marca tudo como
    // selecionado — jogando um filtro específico do usuário (ex.: só um fiscal)
    // de volta para "Todos" sem ele pedir. Agora a seleção manual é capturada
    // antes do rebuild e reaplicada depois, quando ainda fizer sentido.
    function capturarSelecaoParcial(el) {
        if (!el) return null;
        const opts = Array.from(el.options);
        const selecionados = opts.filter(o => o.selected).map(o => o.value);
        if (selecionados.length === 0 || selecionados.length === opts.length) return null; // já era "Todos"/"Nenhum"
        return new Set(selecionados);
    }
    function restaurarSelecaoParcial(el, prevSet) {
        if (!el || !prevSet) return;
        const opts = Array.from(el.options);
        const algumaAindaExiste = opts.some(o => prevSet.has(o.value));
        if (!algumaAindaExiste) return; // nenhuma opção antiga sobreviveu: mantém "Todos" (padrão do fillSelect)
        opts.forEach(o => { o.selected = prevSet.has(o.value); });
        renderMultiSelectUI(el);
    }

    function populateFinanceiroFilters() {
        const base = window.financeiroData || [];
        const prev = { status: capturarSelecaoParcial(fin.status), fiscal: capturarSelecaoParcial(fin.fiscal), contratada: capturarSelecaoParcial(fin.contratada), contratante: capturarSelecaoParcial(fin.contratante), ano: capturarSelecaoParcial(fin.ano) };

        fillSelect(fin.status, base.map(d => d.status)); fillSelect(fin.fiscal, base.map(d => d.fiscal)); fillSelect(fin.contratada, base.map(d => d.contratada)); fillSelect(fin.contratante, base.map(d => d.contratante));
        const anos = Array.from(new Set(base.map(d => d.anoAbertura))); fillSelect(fin.ano, anos);

        restaurarSelecaoParcial(fin.status, prev.status);
        restaurarSelecaoParcial(fin.fiscal, prev.fiscal);
        restaurarSelecaoParcial(fin.contratada, prev.contratada);
        restaurarSelecaoParcial(fin.contratante, prev.contratante);
        restaurarSelecaoParcial(fin.ano, prev.ano);
    }

    function getFinanceiroData() {
        const sts = getSelectedValues(fin.status); const fis = getSelectedValues(fin.fiscal);
        const cts = getSelectedValues(fin.contratada); const crs = getSelectedValues(fin.contratante); const ans = getSelectedValues(fin.ano);

        const role = window.getCurrentUserRole ? window.getCurrentUserRole() : (sessionStorage.getItem('sop_role') || 'guest');
        const userFiscal = role === 'fiscal' ? sessionStorage.getItem('sop_fiscal_name') || sessionStorage.getItem('sop_user_name') || '' : '';

        return (window.financeiroData || []).filter(d => {
            if (role === 'fiscal' && userFiscal) {
                const dFiscal = (d.fiscal || "").toUpperCase().trim();
                const userFiscalUpper = userFiscal.toUpperCase().trim();
                const dFiscalNorm = dFiscal.replace(/[\.\-]+/g, ' ').trim();
                const userFiscalNorm = userFiscalUpper.replace(/[\.\-]+/g, ' ').trim();
                if (dFiscalNorm !== userFiscalNorm) return false;
            }

            if (sts.length > 0 && !sts.includes(d.status)) return false;
            if (fis.length > 0 && !fis.includes(d.fiscal)) return false;
            if (cts.length > 0 && !cts.includes(d.contratada)) return false;
            if (crs.length > 0 && !crs.includes(d.contratante)) return false;
            if (ans.length > 0 && !ans.includes(d.anoAbertura != null ? String(d.anoAbertura) : "Não informado")) return false;
            return true;
        });
    }

    function clearFinanceiro() {
        [fin.status, fin.fiscal, fin.contratada, fin.contratante, fin.ano].forEach(el => { if (el) { Array.from(el.options).forEach(o => o.selected = true); renderMultiSelectUI(el); } });
        updateFinanceiro();
    }

    function calcularTotaisFinanceiro(rows) {
        const s = fn => window.sum ? window.sum(rows, fn) : rows.reduce((a, b) => a + (fn(b) || 0), 0);
        return {
            acrescFiscal: s(d => d.acrescFiscal),
            supressFiscal: s(d => d.supressFiscal),
            repercFiscal: s(d => d.repercFiscal),
            acrescGecope: s(d => d.acrescGecope),
            supressGecope: s(d => d.supressGecope),
            repercGecope: s(d => d.repercGecope)
        };
    }

    // Calcula o nível de revisão da GECOPE processo a processo (não pelo agregado),
    // para que contratos de alto valor não mascarem o quanto os demais processos
    // foram de fato alterados. Retorna média, mediana e a taxa de processos alterados.
    // "alterados" usa tolerância de 1 centavo para não contar ruído de ponto flutuante
    // como alteração real.
    function calcularIndiceRevisao(rows, fiscalKey, gecopeKey) {
        const variacoes = [];
        let alterados = 0;
        let relevantes = 0;
        let somaFiscalAlterados = 0, somaDiffAlterados = 0;
        rows.forEach(d => {
            const fiscalVal = d[fiscalKey] || 0;
            const gecopeVal = d[gecopeKey] || 0;
            // Processo sem valor nenhum (fiscal e GECOPE) para a métrica selecionada
            // (ex.: olhando "Acréscimo" um processo que só teve supressão) não é
            // candidato a "revisão" desta métrica — não entra nem no numerador nem
            // no denominador da taxa, senão dilui artificialmente o percentual.
            if (fiscalVal === 0 && gecopeVal === 0) return;
            relevantes++;
            const diff = gecopeVal - fiscalVal;
            if (Math.abs(diff) > 0.01) {
                alterados++;
                somaFiscalAlterados += fiscalVal;
                somaDiffAlterados += diff;
            }
            if (fiscalVal !== 0) variacoes.push(Math.abs(diff) / Math.abs(fiscalVal) * 100);
        });
        variacoes.sort((a, b) => a - b);
        const media = variacoes.length ? variacoes.reduce((a, b) => a + b, 0) / variacoes.length : 0;
        const mid = Math.floor(variacoes.length / 2);
        const mediana = variacoes.length ? (variacoes.length % 2 !== 0 ? variacoes[mid] : (variacoes[mid - 1] + variacoes[mid]) / 2) : 0;
        const taxaRevisao = relevantes ? (alterados / relevantes) * 100 : 0;
        // Corte médio restrito aos processos que a GECOPE efetivamente alterou:
        // "quando a GECOPE age, corta em média X%".
        const corteMedioAlterados = somaFiscalAlterados !== 0 ? (somaDiffAlterados / Math.abs(somaFiscalAlterados)) * 100 : 0;
        return { media, mediana, taxaRevisao, alterados, total: relevantes, corteMedioAlterados };
    }

    // Redução agregada: soma tudo primeiro, depois divide.
    // É o número que reconcilia com a "Diferença Total" em reais (diferente da
    // média simples de calcularIndiceRevisao, que dá peso igual a processos de
    // qualquer valor).
    function calcularReducaoAgregada(rows, fiscalKey, gecopeKey) {
        let somaFiscal = 0, somaGecope = 0;
        rows.forEach(d => {
            somaFiscal += d[fiscalKey] || 0;
            somaGecope += d[gecopeKey] || 0;
        });
        const reducaoAbs = somaGecope - somaFiscal; // negativo = GECOPE cortou
        const reducaoPerc = somaFiscal !== 0
            ? (reducaoAbs / Math.abs(somaFiscal)) * 100
            : 0;
        return { reducaoAbs, reducaoPerc, somaFiscal, somaGecope };
    }

    // Processos de "supressão pura concordada" (sem acréscimo, GECOPE concorda com a
    // Fiscalização) são pass-through administrativo: não passam por análise aprofundada
    // e por isso não entram nos indicadores de índice de revisão (view
    // vw_processos_financeiro expõe analise_aprofundada). Os totais em R$ e gráficos
    // continuam somando todos os processos — só os 4 KPIs de revisão usam este subconjunto.
    function renderKPIsFinanceiro(rows) {
        const rowsAnalisadas = rows.filter(d => d.analiseAprofundada);
        const t = calcularTotaisFinanceiro(rows);
        const diffReperc = t.repercGecope - t.repercFiscal; const diffAcresc = t.acrescGecope - t.acrescFiscal; const diffSupress = t.supressGecope - t.supressFiscal;
        let diffAbs = 0; const metric = fin.diffMetric.value;
        let fiscalKey = "repercFiscal", gecopeKey = "repercGecope";
        if (metric === "reperc") { diffAbs = diffReperc; fiscalKey = "repercFiscal"; gecopeKey = "repercGecope"; }
        else if (metric === "acresc") { diffAbs = diffAcresc; fiscalKey = "acrescFiscal"; gecopeKey = "acrescGecope"; }
        else if (metric === "supress") { diffAbs = diffSupress; fiscalKey = "supressFiscal"; gecopeKey = "supressGecope"; }
        const indice = calcularIndiceRevisao(rowsAnalisadas, fiscalKey, gecopeKey);
        const reducao = calcularReducaoAgregada(rows, fiscalKey, gecopeKey);
        document.getElementById("kpi-acresc-fiscal").textContent = window.formatCompact ? window.formatCompact(t.acrescFiscal) : String(t.acrescFiscal);
        document.getElementById("kpi-supress-fiscal").textContent = window.formatCompact ? window.formatCompact(t.supressFiscal) : String(t.supressFiscal);
        document.getElementById("kpi-reperc-fiscal").textContent = window.formatCompact ? window.formatCompact(t.repercFiscal) : String(t.repercFiscal);
        document.getElementById("kpi-acresc-gecope").textContent = window.formatCompact ? window.formatCompact(t.acrescGecope) : String(t.acrescGecope);
        document.getElementById("kpi-supress-gecope").textContent = window.formatCompact ? window.formatCompact(t.supressGecope) : String(t.supressGecope);
        document.getElementById("kpi-reperc-gecope").textContent = window.formatCompact ? window.formatCompact(t.repercGecope) : String(t.repercGecope);
        document.getElementById("kpi-diff-abs").textContent = window.formatCompact ? window.formatCompact(diffAbs) : String(diffAbs);
        document.getElementById("kpi-diff-perc").textContent = window.formatPercentage ? window.formatPercentage(indice.media) : String(indice.media);
        const medianaEl = document.getElementById("kpi-diff-mediana");
        if (medianaEl) {
            medianaEl.textContent = "Mediana: " + (window.formatPercentage ? window.formatPercentage(indice.mediana) : String(indice.mediana));
            // Mediana 0% é um resultado válido (não um erro): significa que na metade
            // ou mais dos processos analisados a fundo a GECOPE confirmou o valor da
            // Fiscalização sem alteração. Sem essa explicação, 0% ao lado de uma média
            // maior que zero passa a impressão de dado quebrado numa apresentação.
            medianaEl.title = indice.mediana === 0 && indice.total > 0
                ? "0% é um resultado válido: significa que a GECOPE confirmou, sem alterar, o valor de pelo menos metade dos processos analisados a fundo."
                : "";
        }
        const taxaEl = document.getElementById("kpi-taxa-revisao");
        if (taxaEl) taxaEl.textContent = window.formatPercentage ? window.formatPercentage(indice.taxaRevisao) : String(indice.taxaRevisao);
        const taxaSubEl = document.getElementById("kpi-taxa-revisao-sub");
        if (taxaSubEl) taxaSubEl.textContent = `${indice.alterados} de ${indice.total} processos alterados`;
        const taxaCorteEl = document.getElementById("kpi-taxa-revisao-corte");
        if (taxaCorteEl) taxaCorteEl.textContent = "Corte médio entre alterados: " + (window.formatPercentage ? window.formatPercentage(indice.corteMedioAlterados) : String(indice.corteMedioAlterados));
        const reducaoLabelEl = document.getElementById("kpi-reducao-label");
        if (reducaoLabelEl) {
            const labelPorMetrica = { reperc: "Redução sobre a repercussão", acresc: "Redução sobre o acréscimo", supress: "Redução sobre a supressão" };
            reducaoLabelEl.textContent = labelPorMetrica[metric] || labelPorMetrica.reperc;
        }
        const reducaoPercEl = document.getElementById("kpi-reducao-perc");
        if (reducaoPercEl) reducaoPercEl.textContent = window.formatPercentage ? window.formatPercentage(reducao.reducaoPerc) : String(reducao.reducaoPerc);
        const reducaoAbsEl = document.getElementById("kpi-reducao-abs");
        if (reducaoAbsEl) reducaoAbsEl.textContent = window.formatCompact ? window.formatCompact(reducao.reducaoAbs) : String(reducao.reducaoAbs);

        renderNotaAnaliseAprofundada(rows, rowsAnalisadas);
    }

    // Nota discreta no rodapé do painel explicando por que os indicadores de revisão
    // (mas não os totais em R$) excluem processos de supressão pura concordada.
    function renderNotaAnaliseAprofundada(rows, rowsAnalisadas) {
        const el = document.getElementById("fin-nota-analise-aprofundada");
        if (!el) return;
        if (rows.length === 0) { el.innerHTML = ""; return; }
        const excluidos = rows.length - rowsAnalisadas.length;
        // Números aqui são sempre inteiros calculados internamente (nunca texto vindo
        // do usuário/banco), por isso é seguro montar via innerHTML.
        el.innerHTML = `<i class="bi bi-info-circle"></i><span>Indicadores de revisão (Taxa de Revisão, Variação Média, Mediana e Corte Médio) baseados em <strong>${rowsAnalisadas.length} de ${rows.length}</strong> processos — <strong>${excluidos}</strong> de supressão pura concordada com a Fiscalização não passam por análise aprofundada e não entram nesse cálculo. Totais em R$ e gráficos consideram todos os ${rows.length} processos.</span>`;
    }

    function renderContadorFinanceiro(rows) {
        const aprovados = rows.filter(d => String(d.status).toUpperCase() === "APROVADO").length;
        const arquivados = rows.filter(d => String(d.status).toUpperCase() === "ARQUIVADO").length;
        const totalEl = document.getElementById("fin-count-total");
        const aprovEl = document.getElementById("fin-count-aprovados");
        const arqEl = document.getElementById("fin-count-arquivados");
        if (totalEl) totalEl.textContent = `${rows.length} processos`;
        if (aprovEl) aprovEl.textContent = String(aprovados);
        if (arqEl) arqEl.textContent = String(arquivados);
    }

    // Paleta/tipografia dos gráficos Plotly do Financeiro, adaptada ao tema
    // claro/escuro do app (Plotly não lê variáveis CSS, então isso é recalculado
    // a cada render a partir da classe body.theme-dark).
    function finChartTheme() {
        const dark = document.body.classList.contains("theme-dark");
        return {
            font: { family: "Montserrat, Segoe UI, system-ui, -apple-system, Roboto, sans-serif", color: dark ? "rgba(255,255,255,0.75)" : "#475569", size: 11 },
            gridColor: dark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.07)",
            lineColor: dark ? "rgba(255,255,255,0.18)" : "rgba(15,23,42,0.14)"
        };
    }

    function renderComparativoFinanceiro(rows) {
        const t = calcularTotaisFinanceiro(rows);
        const theme = finChartTheme();
        const categorias = ["Acréscimo", "Supressão", "Repercussão"];
        const data = [
            { x: categorias, y: [t.acrescFiscal, t.supressFiscal, t.repercFiscal], name: "Fiscalização", type: "bar", marker: { color: "#008F3D" }, hovertemplate: "%{x}<br>Fiscalização: R$ %{y:,.2f}<extra></extra>" },
            { x: categorias, y: [t.acrescGecope, t.supressGecope, t.repercGecope], name: "GECOPE", type: "bar", marker: { color: "#018ABD" }, hovertemplate: "%{x}<br>GECOPE: R$ %{y:,.2f}<extra></extra>" }
        ];
        const layout = {
            margin: { l: 60, r: 20, t: 10, b: 40 },
            barmode: "group",
            bargap: 0.3,
            bargroupgap: 0.12,
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: theme.font,
            yaxis: { title: "R$", tickprefix: "R$ ", gridcolor: theme.gridColor, zerolinecolor: theme.lineColor },
            xaxis: { gridcolor: theme.gridColor, linecolor: theme.lineColor },
            legend: { orientation: "h", y: -0.18, font: theme.font },
            height: 320
        };
        if (window.Plotly) Plotly.react(document.getElementById("chart-fin-comparativo"), data, layout, { displayModeBar: false, responsive: true });
    }

    function renderWaterfallFinanceiro(rows) {
        const t = calcularTotaisFinanceiro(rows);
        const theme = finChartTheme();
        const diff = t.repercGecope - t.repercFiscal;
        const fmt = v => window.formatCompact ? window.formatCompact(v) : String(v);
        const data = [{
            type: "waterfall",
            orientation: "v",
            x: ["Fiscalização", diff >= 0 ? "Acréscimo GECOPE" : "Redução GECOPE", "GECOPE"],
            measure: ["absolute", "relative", "total"],
            y: [t.repercFiscal, diff, 0],
            text: [fmt(t.repercFiscal), (diff >= 0 ? "+" : "") + fmt(diff), fmt(t.repercGecope)],
            textposition: "outside",
            // Sem isso o Plotly recorta o texto que fica acima da barra mais alta
            // quando ele ultrapassa a área do gráfico (era o corte visto no topo).
            cliponaxis: false,
            connector: { line: { color: theme.lineColor, width: 1 } },
            increasing: { marker: { color: "#008F3D" } },
            decreasing: { marker: { color: "#dc3545" } },
            totals: { marker: { color: "#018ABD" } }
        }];
        // Dá folga acima da maior barra para o rótulo "outside" caber sem ser
        // cortado pela borda do eixo (o autorange do Plotly não reserva espaço
        // para texto, só para as barras em si).
        const valores = [0, t.repercFiscal, t.repercGecope];
        const maxV = Math.max(...valores);
        const minV = Math.min(...valores);
        const folga = Math.max((maxV - minV) * 0.22, 1);
        const layout = {
            margin: { l: 60, r: 20, t: 40, b: 40 },
            paper_bgcolor: "rgba(0,0,0,0)",
            plot_bgcolor: "rgba(0,0,0,0)",
            font: theme.font,
            showlegend: false,
            yaxis: { title: "R$", tickprefix: "R$ ", gridcolor: theme.gridColor, zerolinecolor: theme.lineColor, range: [minV < 0 ? minV - folga : 0, maxV + folga] },
            xaxis: { gridcolor: theme.gridColor, linecolor: theme.lineColor },
            height: 320
        };
        if (window.Plotly) Plotly.react(document.getElementById("chart-fin-waterfall"), data, layout, { displayModeBar: false, responsive: true });
    }

    let finDrilldownRows = [];
    let finSort = { key: "repercGecope", dir: "desc" };
    let finTableSearch = "";
    let finTableStatus = "";
    const finFmtMoney = v => window.formatCompact ? window.formatCompact(v) : String(v);
    const finFmtData = d => (d instanceof Date && !isNaN(d)) ? d.toLocaleDateString("pt-BR") : "-";
    const finNorm = v => String(v || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    function populateFinDrilldownStatusFilter(rows) {
        const sel = document.getElementById("fin-drilldown-status-filter");
        if (!sel) return;
        const atual = sel.value;
        const statusUnicos = Array.from(new Set(rows.map(d => d.status || "Não informado"))).sort((a, b) => String(a).localeCompare(String(b), "pt-BR"));
        sel.innerHTML = '<option value="">Todos os status</option>' + statusUnicos.map(s => {
            const label = window.formatStatusDisplay ? window.formatStatusDisplay(s) : s;
            return `<option value="${window.escapeHTML ? window.escapeHTML(s) : s}">${window.escapeHTML ? window.escapeHTML(label) : label}</option>`;
        }).join("");
        if (statusUnicos.includes(atual)) sel.value = atual;
    }

    function renderDrilldownFinanceiro(rows) {
        populateFinDrilldownStatusFilter(rows);

        let filtrado = rows;
        if (finTableStatus) filtrado = filtrado.filter(d => (d.status || "Não informado") === finTableStatus);
        if (finTableSearch) {
            const termo = finNorm(finTableSearch);
            filtrado = filtrado.filter(d => [d.processo, d.fiscal, d.contratada, d.nomeAnalista].some(v => finNorm(v).includes(termo)));
        }

        const withDiff = filtrado.map(d => {
            const diff = (d.repercGecope || 0) - (d.repercFiscal || 0);
            const diffPerc = d.repercFiscal ? (diff / Math.abs(d.repercFiscal)) * 100 : 0;
            return Object.assign({}, d, { _diff: diff, _diffPerc: diffPerc });
        });

        const { key, dir } = finSort;
        withDiff.sort((a, b) => {
            let va = a[key], vb = b[key];
            if (va instanceof Date) va = va.getTime(); if (vb instanceof Date) vb = vb.getTime();
            if (typeof va === "string") va = va.toLowerCase(); if (typeof vb === "string") vb = vb.toLowerCase();
            if (va === undefined || va === null) va = "";
            if (vb === undefined || vb === null) vb = "";
            if (va < vb) return dir === "asc" ? -1 : 1;
            if (va > vb) return dir === "asc" ? 1 : -1;
            return 0;
        });

        finDrilldownRows = withDiff;
        window.finDrilldownRows = withDiff;

        const countEl = document.getElementById("fin-drilldown-count");
        if (countEl) countEl.textContent = `${withDiff.length} de ${rows.length} processos · clique numa coluna para ordenar`;

        const esc = v => window.escapeHTML ? window.escapeHTML(v || "") : String(v || "");
        const tbody = document.getElementById("fin-drilldown-body");
        if (!tbody) return;
        tbody.innerHTML = withDiff.map(d => {
            const statusTxt = window.formatStatusDisplay ? window.formatStatusDisplay(d.status) : d.status;
            const statusCls = window.classeBadgeStatus ? window.classeBadgeStatus(d.status) : "";
            const diffIcon = d._diff < 0 ? "bi-arrow-down-short" : "bi-arrow-up-short";
            // Sem seta quando o valor é exatamente 0,0% — setas (para cima/para baixo) só
            // fazem sentido quando há de fato uma diferença a indicar (pedido do usuário,
            // 2026-08-14).
            const diffPercIcon = d._diffPerc === 0 ? "" : (d._diffPerc < 0 ? "bi-arrow-down-short" : "bi-arrow-up-short");
            const supressaoPuraInfo = d.analiseAprofundada ? "" : ` <i class="bi bi-info-circle fin-supressao-info" title="Supressão pura concordada com a Fiscalização — não passa por análise aprofundada, excluído dos indicadores de revisão"></i>`;
            return `
            <tr>
                <td class="fin-td-processo">${esc(d.processo)}</td>
                <td><span class="badge ${statusCls}">${esc(statusTxt)}</span>${supressaoPuraInfo}</td>
                <td>${esc(d.fiscal)}</td>
                <td>${esc(d.nomeAnalista)}</td>
                <td>${esc(d.contratada)}</td>
                <td class="fin-td-mono">${finFmtData(d.dataAbertura)}</td>
                <td class="fin-td-mono">${finFmtData(d.dataAprovacao)}</td>
                <td class="fin-td-mono">${typeof d.prazoDias === "number" && isFinite(d.prazoDias) ? d.prazoDias + "d" : "-"}</td>
                <td class="fin-td-mono">${finFmtMoney(d.repercFiscal)}</td>
                <td class="fin-td-mono">${finFmtMoney(d.repercGecope)}</td>
                <td class="fin-td-mono"><span class="fin-diff-pill ${d._diff < 0 ? "diff-neg" : "diff-pos"}"><i class="bi ${diffIcon}"></i>${finFmtMoney(Math.abs(d._diff))}</span></td>
                <td class="fin-td-mono"><span class="fin-diff-pill ${d._diffPerc < 0 ? "diff-neg" : "diff-pos"}">${diffPercIcon ? `<i class="bi ${diffPercIcon}"></i>` : ""}${Math.abs(d._diffPerc).toFixed(1)}%</span></td>
            </tr>`;
        }).join("");
    }

    (function wireFinDrilldownSort() {
        const head = document.getElementById("fin-drilldown-head");
        if (!head) return;
        function updateSortIndicators() {
            head.querySelectorAll("th[data-key]").forEach(th => {
                const active = th.getAttribute("data-key") === finSort.key;
                th.classList.toggle("fin-th-sorted", active);
                if (active) th.setAttribute("data-dir", finSort.dir); else th.removeAttribute("data-dir");
            });
        }
        head.querySelectorAll("th[data-key]").forEach(th => {
            th.addEventListener("click", () => {
                const key = th.getAttribute("data-key");
                finSort = { key, dir: (finSort.key === key && finSort.dir === "desc") ? "asc" : "desc" };
                updateSortIndicators();
                renderDrilldownFinanceiro(getFinanceiroData());
            });
        });
        updateSortIndicators();
    })();

    (function wireFinDrilldownTableFilters() {
        const searchEl = document.getElementById("fin-drilldown-search");
        const statusEl = document.getElementById("fin-drilldown-status-filter");
        if (searchEl) {
            searchEl.addEventListener("input", dashDebounce(() => {
                finTableSearch = searchEl.value;
                renderDrilldownFinanceiro(getFinanceiroData());
            }, 250));
        }
        if (statusEl) {
            statusEl.addEventListener("change", () => {
                finTableStatus = statusEl.value;
                renderDrilldownFinanceiro(getFinanceiroData());
            });
        }
    })();

    function updateFinanceiro() {
        const rows = getFinanceiroData();
        const f = getSelectedValues(fin.fiscal);
        const s = getSelectedValues(fin.status);

        let filtered = rows;
        if (f.length < (fin.fiscal?.options?.length || 0)) {
            filtered = filtered.filter(d => f.includes(d.fiscal || "Não informado"));
        }
        if (s.length < (fin.status?.options?.length || 0)) {
            filtered = filtered.filter(d => s.includes(d.status || "Não informado"));
        }

        renderKPIsFinanceiro(filtered);
        renderContadorFinanceiro(filtered);
        renderComparativoFinanceiro(filtered);
        renderWaterfallFinanceiro(filtered);
        renderDrilldownFinanceiro(filtered);
    }

    // Expor no escopo global
    window.populateFinanceiroFilters = populateFinanceiroFilters;
    window.getFinanceiroData = getFinanceiroData;
    window.clearFinanceiro = clearFinanceiro;
    window.updateFinanceiro = updateFinanceiro;
    window.fin = fin;

})(window);

async function carregarDadosFinanceiro() {
    try {
        const { data, error } = await sbClient
            .from('vw_processos_financeiro')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) throw new Error(`View "vw_processos_financeiro" não acessível: ${error.message}`);
        if (!Array.isArray(data)) throw new Error('Tipo de dados inválido: esperado array');

        window.financeiroData = data.map(mapProcessoRow);
    } catch (err) {
        console.error('[ERRO] Falha ao carregar dados financeiros:', err);
        // Sem isso, o painel Financeiro ficava com KPIs zerados sem nenhuma
        // indicação de que a causa foi uma falha de carregamento (e não
        // simplesmente "nenhum processo corresponde ao filtro").
        alert('Não foi possível carregar os dados financeiros. Tente novamente em instantes.\n' + (err && err.message ? err.message : ''));
    }
}

function exportarFinanceiroExcel() {
    const rows = window.finDrilldownRows || [];
    if (rows.length === 0) {
        alert("Nenhum dado visível para exportar.");
        return;
    }
    if (typeof XLSX === 'undefined') {
        alert("Biblioteca de exportação não carregada ainda. Aguarde e tente novamente.");
        return;
    }

    const data = rows.map(d => ({
        'Processo': d.processo || '',
        'Status': d.status || '',
        'Fiscal': d.fiscal || '',
        'Analista': d.nomeAnalista || '',
        'Contratada': d.contratada || '',
        'Abertura': d.dataAbertura instanceof Date ? d.dataAbertura.toLocaleDateString('pt-BR') : '',
        'Aprovação GECOPE': d.dataAprovacao instanceof Date ? d.dataAprovacao.toLocaleDateString('pt-BR') : '',
        'Prazo (dias)': (typeof d.prazoDias === 'number' && isFinite(d.prazoDias)) ? d.prazoDias : '',
        'Repercussão Fiscal': d.repercFiscal || 0,
        'Repercussão GECOPE': d.repercGecope || 0,
        'Diferença': d._diff || 0,
        '% Revisão': typeof d._diffPerc === 'number' ? Number(d._diffPerc.toFixed(1)) : 0
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Painel Financeiro');
    const nomeArquivo = `painel_financeiro_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, nomeArquivo);
}
