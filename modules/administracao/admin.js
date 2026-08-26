(function (window) {
    'use strict';

    // Administração: funções movidas de main.js
    const SENHA_MESTRA = "sop2026";
    const USERS = [ { username: 'admin', password: SENHA_MESTRA, isAdmin: true } ];

    function verificarAdminSalvo() {
        const isAdm = sessionStorage.getItem('is_admin_gecope');
        if (isAdm === 'true') {
            document.body.classList.add('is-admin');
        } else {
            document.body.classList.remove('is-admin');
        }
    }

    function alternarModoAdmin() {
        if (document.body.classList.contains('is-admin')) {
            if (confirm("Deseja sair do modo Administrador?")) {
                document.body.classList.remove('is-admin');
                sessionStorage.removeItem('is_admin_gecope');
                sessionStorage.setItem('sop_role', 'guest');
                if (typeof applyRoleToUI === 'function') applyRoleToUI('guest');
                alert("Modo de visualização ativado.");
                if (document.querySelector('.modal.show')) location.reload();
            }
            return;
        }
        const modalEl = document.getElementById('modalLogin');
        if (modalEl) {
            const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
            modal.show();
        } else {
            const tentativa = prompt(" Digite a senha de administrador:");
            if (tentativa === SENHA_MESTRA) {
                document.body.classList.add('is-admin');
                sessionStorage.setItem('is_admin_gecope', 'true');
                alert(" Modo Administrador Ativado!");
            } else if (tentativa !== null) { alert(" Senha incorreta."); }
        }
    }

    function handleLoginSubmit(e) {
        e.preventDefault();
        const user = document.getElementById('login-username').value.trim();
        const pass = document.getElementById('login-password').value;
        const feedback = document.getElementById('login-feedback');
        feedback.style.display = 'none';
        const found = USERS.find(u => u.username === user && u.password === pass);
        if (found) {
            document.body.classList.add('is-admin');
            sessionStorage.setItem('is_admin_gecope', 'true');
            sessionStorage.setItem('sop_user', user);
            sessionStorage.setItem('sop_role', 'admin');
            if (typeof applyRoleToUI === 'function') applyRoleToUI('admin');
            const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('modalLogin'));
            if (modal) modal.hide();
            alert(" Modo Administrador Ativado!");
        } else {
            feedback.style.display = 'block';
        }
    }

    // --- ADMIN DASHBOARD LOGIC ---
    async function loadAllUsers() {
        const tbodyActive = document.getElementById('admin-users-table-body');
        const tbodyPending = document.getElementById('admin-pending-table-body');
        const sectionPending = document.getElementById('admin-pending-section');
        const statTotal = document.getElementById('admin-stat-total');
        const statPending = document.getElementById('admin-stat-pending');
        const statAdmins = document.getElementById('admin-stat-admins');
        const statOthers = document.getElementById('admin-stat-others');
        const pendingTabBadge = document.getElementById('admin-pending-badge-tab');

        if (!tbodyActive || !tbodyPending) return;
        tbodyActive.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4"><div class="spinner-border spinner-border-sm me-2"></div>Carregando usuários...</td></tr>';

        try {
            const { data, error } = await sbClient.from('app_users').select('*').order('created_at', { ascending: false });
            if (error) throw error;

            const pendings = data.filter(u => u.role === 'pending').sort((a, b) => {
                const nameA = (`${(a.nome || '')} ${(a.sobrenome || '')}`.trim() || a.full_name || '').toUpperCase();
                const nameB = (`${(b.nome || '')} ${(b.sobrenome || '')}`.trim() || b.full_name || '').toUpperCase();
                return nameA.localeCompare(nameB, 'pt-BR');
            });
            const actives = data.filter(u => u.role !== 'pending');

            // Also fetch new_user_request notifications to surface requests that did not create app_users
            let notifPendings = [];
            try {
                const { data: notes, error: notesErr } = await sbClient.from('app_notifications').select('id,type,payload,read,created_at').eq('type', 'new_user_request').eq('read', false).order('created_at', { ascending: false }).limit(200);
                if (!notesErr && Array.isArray(notes)) {
                    for (const n of notes) {
                        if (n.read) continue;
                        let parsed = null;
                        try { parsed = JSON.parse(n.payload || '{}'); } catch (e) { parsed = null; }
                        const matricula = parsed?.matricula || null;
                        const nome = parsed?.nome || null;
                        const email = parsed?.email || (matricula ? `${matricula}@gecope.app` : null);

                        // Check if there is an app_user with this matricula/email
                        const found = data.find(u => (u.matricula && matricula && String(u.matricula) === String(matricula)) || (u.email && email && u.email.toLowerCase() === email.toLowerCase()));

                        const isAlreadyInPendings = pendings.some(pu => pu.email === email || (pu.matricula && String(pu.matricula) === String(matricula)));

                        // Only surface if no app_user exists OR existing user is not active (not approved)
                        if (!isAlreadyInPendings && (!found || (found && found.role === 'pending'))) {
                            notifPendings.push({
                                id: found?.id || null,
                                email: email || (found ? found.email : 'N/A'),
                                matricula: matricula,
                                nome: nome,
                                created_at: n.created_at,
                                notif_id: n.id,
                                notification_raw: n
                            });
                        }
                    }
                }
            } catch (e) { console.error('Erro ao buscar notificações de cadastro:', e); }

            const roleOrder = { 'admin': 1, 'fiscal': 2, 'gerente': 3, 'externo': 4 };
            actives.sort((a, b) => {
                const orderA = roleOrder[a.role] || 99;
                const orderB = roleOrder[b.role] || 99;
                if (orderA !== orderB) return orderA - orderB;
                const nameA = (`${(a.nome || '')} ${(a.sobrenome || '')}`.trim() || a.full_name || '').toUpperCase();
                const nameB = (`${(b.nome || '')} ${(b.sobrenome || '')}`.trim() || b.full_name || '').toUpperCase();
                return nameA.localeCompare(nameB, 'pt-BR');
            });

            const totalPending = pendings.length + notifPendings.length;
            if (statTotal) statTotal.textContent = data.length;
            if (statPending) statPending.textContent = totalPending;
            if (statAdmins) statAdmins.textContent = data.filter(u => u.role === 'admin').length;
            if (statOthers) statOthers.textContent = data.filter(u => u.role !== 'admin' && u.role !== 'pending').length;
            if (pendingTabBadge) pendingTabBadge.textContent = totalPending;
            if (sectionPending) sectionPending.style.display = totalPending > 0 ? 'block' : 'none';

            tbodyPending.innerHTML = '';

            // Render pending users from app_users
            pendings.forEach(u => {
                const dataSolic = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : 'N/A';
                const nomeComp = (`${(u.nome || '')} ${(u.sobrenome || '')}`.trim() || u.full_name || 'N/A').toUpperCase();

                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td class="ps-4">
                        <div class="fw-bold text-dark">${escapeHTML(nomeComp)}</div>
                        <div class="small text-muted">${escapeHTML(u.email)}</div>
                    </td>
                    <td><span class="badge bg-light text-dark border fw-normal">${escapeHTML(u.matricula) || '-'}</span></td>
                    <td><span class="text-muted small">${dataSolic}</span></td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <select class="form-select form-select-sm" style="width: 120px;" id="role-pending-${u.id}">
                                <option value="externo">EXTERNO</option>
                                <option value="fiscal">FISCAL</option>
                                <option value="gerente">GERENTE</option>
                                <option value="admin">ADMIN</option>
                            </select>
                            <button class="btn btn-sm btn-success" data-email="${escapeHTML(u.email)}" data-role-select-id="role-pending-${u.id}" onclick="aprovarUsuario(this.dataset.email, document.getElementById(this.dataset.roleSelectId).value)">
                                <i class="bi bi-check-lg me-1"></i> Aprovar
                            </button>
                            <button class="btn btn-sm btn-outline-danger" data-email="${escapeHTML(u.email)}" onclick="excluirUsuario(this.dataset.email)" title="Recusar">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyPending.appendChild(tr);
            });

            // Render pending requests coming from notifications (not yet present in app_users)
            notifPendings.forEach((n, idx) => {
                const dataSolic = n.created_at ? new Date(n.created_at).toLocaleDateString('pt-BR') : 'N/A';
                const nomeComp = (n.nome || 'N/A').toUpperCase();
                const tr = document.createElement('tr');
                const selectId = `role-notif-${n.notif_id || idx}`;
                tr.innerHTML = `
                    <td class="ps-4">
                        <div class="fw-bold text-dark">${escapeHTML(nomeComp)} <small class="text-muted">(notificação)</small></div>
                        <div class="small text-muted">${n.matricula ? (escapeHTML(n.matricula) + '@gecope.app') : 'sem matrícula'}</div>
                    </td>
                    <td><span class="badge bg-light text-dark border fw-normal">${escapeHTML(n.matricula) || '-'}</span></td>
                    <td><span class="text-muted small">${dataSolic}</span></td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <select class="form-select form-select-sm" style="width: 120px;" id="${selectId}">
                                <option value="externo">EXTERNO</option>
                                <option value="fiscal">FISCAL</option>
                                <option value="gerente">GERENTE</option>
                                <option value="admin">ADMIN</option>
                            </select>
                            <button class="btn btn-sm btn-success" data-notif-id="${escapeHTML(n.notif_id)}" data-role-select-id="${selectId}" data-matricula="${escapeHTML(n.matricula)}" data-nome="${escapeHTML(n.nome)}" data-email="${escapeHTML(n.email)}" onclick="aprovarFromNotification(this.dataset.notifId, document.getElementById(this.dataset.roleSelectId).value, this.dataset.matricula, this.dataset.nome, this.dataset.email)">
                                <i class="bi bi-check-lg me-1"></i> Aprovar
                            </button>
                            <button class="btn btn-sm btn-outline-danger" data-notif-id="${escapeHTML(n.notif_id)}" onclick="recusarNotification(this.dataset.notifId)" title="Recusar">
                                <i class="bi bi-x-lg"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyPending.appendChild(tr);
            });

            // Contas "fantasma" (cadastradas só para disparo de WhatsApp, sem login real).
            // O disparo automático está paralisado, então essas contas não têm mais utilidade
            // aqui — ficam ocultas da lista (continuam contadas nos KPIs do topo).
            const activesVisiveis = actives.filter(u => !(u.email && u.email.includes('@sop-ghost.internal')));

            tbodyActive.innerHTML = '';
            if (activesVisiveis.length === 0) {
                tbodyActive.innerHTML = '<tr><td colspan="7" class="text-center text-muted py-4">Nenhum usuário ativo.</td></tr>';
            }

            const roleBadgeClass = {
                admin: 'badge-role-admin',
                gerente: 'badge-role-gerente',
                fiscal: 'badge-role-fiscal',
                externo: 'badge-role-externo'
            };

            activesVisiveis.forEach(u => {
                const fullNome = (`${(u.nome || '')} ${(u.sobrenome || '')}`.trim() || u.full_name || 'Não informado').toUpperCase();
                const iniciais = fullNome.split(' ').filter(Boolean).slice(0, 2).map(p => p[0]).join('') || '?';
                const roleClass = roleBadgeClass[u.role] || 'badge-role-externo';

                const tr = document.createElement('tr');
                tr.className = 'tr-processo-row';
                tr.setAttribute('data-search', `${fullNome.toLowerCase()} ${u.matricula || ''} ${u.email.toLowerCase()} ${u.gedop || ''}`);

                tr.innerHTML = `
                    <td class="ps-4">
                        <div class="d-flex align-items-center gap-2">
                            <div class="admin-user-avatar">${escapeHTML(iniciais)}</div>
                            <div class="fw-bold text-dark">${escapeHTML(fullNome)}</div>
                        </div>
                    </td>
                    <td><div class="small text-muted">${escapeHTML(u.email)}</div></td>
                    <td><div class="small fw-bold text-secondary">${escapeHTML(u.telefone_whatsapp) || '-'}</div></td>
                    <td><span class="badge bg-light text-dark border fw-normal">${escapeHTML(u.matricula) || '-'}</span></td>
                    <td><span class="badge bg-light text-dark border fw-normal">${escapeHTML(u.gedop) || '-'}</span></td>
                    <td><span class="badge rounded-pill ${roleClass} px-3" style="font-size: 0.72rem; min-width: 80px;">${u.role.toUpperCase()}</span></td>
                    <td class="text-end pe-4">
                        <div class="d-flex justify-content-end gap-2">
                            <button class="btn-action-icon" data-email="${escapeHTML(u.email)}" onclick="abrirModalEdicaoUsuario(this.dataset.email)" title="Editar Usuário">
                                <i class="bi bi-pencil icon-cloud"></i>
                            </button>
                            <button class="btn-action-icon" data-email="${escapeHTML(u.email)}" onclick="excluirUsuario(this.dataset.email)" title="Excluir Usuário">
                                <i class="bi bi-trash-fill icon-trash"></i>
                            </button>
                        </div>
                    </td>
                `;
                tbodyActive.appendChild(tr);
            });

        } catch (e) {
            console.error('Erro ao listar usuários:', e);
            tbodyActive.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Erro ao carregar banco de usuários: ${e.message}</td></tr>`;
        }
    }

    window.abrirModalEdicaoUsuario = async function(email) {
        try {
            const { data, error } = await sbClient.from('app_users').select('*').eq('email', email).single();
            if (error) throw error;

            document.getElementById('edit-user-email-original').value = data.email || '';
            document.getElementById('edit-user-nome').value = data.nome || '';
            document.getElementById('edit-user-sobrenome').value = data.sobrenome || '';
            document.getElementById('edit-user-matricula').value = data.matricula || '';
            document.getElementById('edit-user-gedop').value = data.gedop || '';
            document.getElementById('edit-user-email').value = data.email || '';
            document.getElementById('edit-user-whatsapp').value = data.telefone_whatsapp || '';
            document.getElementById('edit-user-role').value = data.role || 'externo';

            const modal = new bootstrap.Modal(document.getElementById('modalEditarUsuario'));
            modal.show();
        } catch (e) {
            console.error(e);
            alert("Erro ao buscar dados do usuário.");
        }
    };

    window.abrirModalNovoUsuario = function() {
        document.getElementById('formEditarUsuario').reset();
        document.getElementById('edit-user-email-original').value = '';
        document.getElementById('edit-user-email').value = `${Date.now()}@sop-ghost.internal`; // E-mail fictício default
        document.getElementById('edit-user-role').value = 'fiscal'; // Role default
        
        const modal = new bootstrap.Modal(document.getElementById('modalEditarUsuario'));
        modal.show();
    };

    window.salvarEdicaoUsuario = async function() {
        const emailOriginal = document.getElementById('edit-user-email-original').value;
        const nome = document.getElementById('edit-user-nome').value.trim();
        const sobrenome = document.getElementById('edit-user-sobrenome').value.trim();
        const matricula = document.getElementById('edit-user-matricula').value.trim();
        const gedop = document.getElementById('edit-user-gedop').value.trim();
        const emailNovo = document.getElementById('edit-user-email').value.trim().toLowerCase();
        const whatsapp = document.getElementById('edit-user-whatsapp').value.trim().replace(/\D/g, '');
        const role = document.getElementById('edit-user-role').value;

        if (!nome || !emailNovo) {
            alert("Nome e E-mail são obrigatórios.");
            return;
        }

        try {
            const btn = document.querySelector('#modalEditarUsuario .btn-primary');
            const originalHtml = btn.innerHTML;
            btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Salvando...';
            btn.disabled = true;

            const payload = {
                nome: nome,
                sobrenome: sobrenome,
                matricula: matricula || null,
                gedop: gedop || null,
                email: emailNovo,
                telefone_whatsapp: whatsapp || null,
                role: role,
                full_name: `${nome} ${sobrenome}`.trim()
            };

            let reqError;
            if (emailOriginal) {
                const { error } = await sbClient.from('app_users').update(payload).eq('email', emailOriginal);
                reqError = error;
            } else {
                const { error } = await sbClient.from('app_users').insert([payload]);
                reqError = error;
            }

            if (reqError) throw reqError;

            const modal = bootstrap.Modal.getInstance(document.getElementById('modalEditarUsuario'));
            if (modal) modal.hide();
            
            if (typeof showToast === 'function') showToast(emailOriginal ? "Usuário atualizado com sucesso." : "Usuário criado com sucesso.");
            
            // Recarrega lista
            loadAllUsers();
            if (typeof carregarListaFiscais === 'function') carregarListaFiscais();
            
            btn.innerHTML = originalHtml;
            btn.disabled = false;
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar edição: " + e.message);
            const btn = document.querySelector('#modalEditarUsuario .btn-primary');
            btn.innerHTML = 'Salvar Alterações';
            btn.disabled = false;
        }
    };

    let _vincularContext = null;

    document.addEventListener('DOMContentLoaded', () => {
        const btnConfirmar = document.getElementById('btn-confirmar-vinculo');
        if (btnConfirmar) {
            btnConfirmar.addEventListener('click', async () => {
                if (!_vincularContext) return;
                const select = document.getElementById('vincular-fiscal-select');
                const novoNome = select.value;
                if (!novoNome) { alert("Por favor, selecione um nome da lista."); return; }
                try {
                    btnConfirmar.disabled = true; btnConfirmar.innerHTML = "Salvando...";
                    const partes = novoNome.split(' ');
                    const nome = partes[0];
                    const sobrenome = partes.slice(1).join(' ');
                    const { error } = await sbClient.from('app_users').update({ full_name: novoNome, nome: nome, sobrenome: sobrenome }).eq('email', _vincularContext.email);
                    if (error) throw error;
                    alert(` Usuário vinculado a "${novoNome}" com sucesso!`);
                    const modalEL = document.getElementById('modalVincularFiscal');
                    const modal = bootstrap.Modal.getInstance(modalEL);
                    modal.hide();
                    if (_vincularContext.action === 'aprovar') {
                        aprovarUsuario(_vincularContext.email, _vincularContext.role, true);
                    } else if (_vincularContext.action === 'update') {
                        updateUserRole(_vincularContext.email, _vincularContext.role, true);
                    }
                } catch (e) {
                    alert("Erro ao vincular: " + e.message);
                } finally {
                    btnConfirmar.disabled = false; btnConfirmar.innerHTML = "Confirmar Vínculo";
                }
            });
        }
    });

    function abrirModalVinculo(nomeAtual, email, role, action) {
        _vincularContext = { email, role, action };
        document.getElementById('vincular-usuario-nome').textContent = nomeAtual || email;
        const sel = document.getElementById('vincular-fiscal-select');
        sel.innerHTML = '<option value="">Selecione...</option>';
        window.dynamicUsers.forEach(f => {
            const opt = document.createElement('option'); opt.value = f; opt.textContent = f; sel.appendChild(opt);
        });
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalVincularFiscal')).show();
    }

    async function aprovarUsuario(email, role = 'externo', skipConfirm = false) {
        if (!skipConfirm && !confirm(`Confirmar aprovação de ${email} como ${role.toUpperCase()}?`)) return;
        try {
            if (role === 'fiscal') {
                const { data: userData, error: userError } = await sbClient.from('app_users').select('nome, sobrenome, full_name').eq('email', email).single();
                if (!userError && userData) {
                    let nomeCompleto = '';
                    if (userData.full_name && !/^\d+$/.test(userData.full_name)) nomeCompleto = userData.full_name;
                    else if (userData.nome) nomeCompleto = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim();
                    if (nomeCompleto) {
                        const fiscalFromList = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                        if (!fiscalFromList) { abrirModalVinculo(nomeCompleto, email, role, 'aprovar'); return; }
                    }
                }
            }
            const { error } = await sbClient.from('app_users').update({ role: role }).eq('email', email);
            if (error) throw error;
            if (!skipConfirm) alert('Usuário aprovado com sucesso!');
            loadAllUsers(); if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao aprovar: ' + e.message); }
    }

    async function excluirUsuario(email) {
        if (!confirm(`Remover definitivamente o usuário ${email}?`)) return;
        try {
            const { error } = await sbClient.from('app_users').delete().eq('email', email);
            if (error) throw error; alert('Usuário removido.'); loadAllUsers(); if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao excluir: ' + e.message); }
    }

    async function aprovarFromNotification(notifId, role, matricula, nome, emailCadastro) {
        if (!notifId) return alert('Notificação inválida.');
        if (!confirm(`Confirmar aprovação de ${matricula || nome} como ${role.toUpperCase()}?`)) return;
        try {
            // 1. Tentativa prioritária: atualizar registro pendente existente diretamente no banco
            // Isso cobre o caso mais comum: usuário se cadastrou e ficou com role='pending'.
            // Normalizado (trim/lowercase) para bater com o e-mail salvo pelo Supabase Auth,
            // que sempre grava em minúsculas — evita divergência entre app_users e auth.users.
            const emailCadastroNormalizado = (emailCadastro || '').trim().toLowerCase();
            const emailReal = emailCadastroNormalizado || (matricula ? `${matricula}@gecope.app` : null);
            let updatedExisting = false;

            if (emailReal) {
                const { data: existing, error: findErr } = await sbClient.from('app_users').select('id,role').eq('email', emailReal).maybeSingle();
                if (!findErr && existing) {
                    const { data: updated, error: updateErr } = await sbClient.from('app_users').update({ role: role }).eq('email', emailReal).select();
                    if (!updateErr && updated && updated.length > 0) {
                        updatedExisting = true;
                        await sbClient.from('app_notifications').update({ read: true }).eq('id', notifId);
                        alert('Usuário aprovado com sucesso!');
                        if (typeof loadAllUsers === 'function') loadAllUsers();
                        if (typeof fetchPendingCount === 'function') fetchPendingCount();
                        return;
                    }
                    if (updateErr) console.warn('[ADMIN] Falha ao atualizar registro existente:', updateErr.message);
                }
            }

            // 2. Não existe registro pendente prévio: cria a linha diretamente. (A Edge
            // Function "approve-user" e o fallback via endpoint Netlify/Vercel foram
            // removidos em 2026-08-14 — nunca chegaram a ser implantados neste projeto;
            // esta inserção direta, protegida pela policy de INSERT de app_users que só
            // permite escrita de admin para outro e-mail, já cobre o caso sozinha.)
            const emailToCreate = emailReal || `${(nome||'user').replace(/\s+/g,'').toLowerCase()}@gecope.app`;
            const payload = {
                email: emailToCreate,
                matricula: matricula || null,
                nome: nome || null,
                sobrenome: null,
                role: role || 'externo',
                created_at: new Date().toISOString()
            };

            const { error: insertErr } = await sbClient.from('app_users').insert([payload]);
            if (insertErr) {
                throw new Error(`Erro ao criar usuário: ${insertErr.message}`);
            }

            if (notifId) {
                await sbClient.from('app_notifications').update({ read: true }).eq('id', notifId);
            }

            alert('Usuário criado e aprovado com sucesso.');
            if (typeof loadAllUsers === 'function') loadAllUsers();
            if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) {
            console.error('Erro ao aprovar via notificação:', e);
            alert('Erro ao aprovar: ' + (e.message || String(e)));
        }
    }

    async function recusarNotification(notifId) {
        if (!notifId) return;
        if (!confirm('Recusar esta solicitação?')) return;
        try {
            const { error } = await sbClient.from('app_notifications').update({ read: true }).eq('id', notifId);
            if (error) throw error;
            alert('Solicitação recusada.');
            if (typeof loadAllUsers === 'function') loadAllUsers();
            if (typeof fetchPendingCount === 'function') fetchPendingCount();
        } catch (e) { alert('Erro ao recusar: ' + (e.message || String(e))); }
    }

    function filterAdminUsers() {
        const term = document.getElementById('admin-user-search').value.toLowerCase();
        const rows = document.querySelectorAll('#admin-users-table-body tr[data-search]');
        rows.forEach(row => { row.style.display = row.getAttribute('data-search').includes(term) ? '' : 'none'; });
    }

    async function updateUserRole(email, newRole, skipConfirm = false) {
        if (!skipConfirm && !confirm(`Alterar perfil de ${email} para ${newRole.toUpperCase()}?`)) { loadAllUsers(); return; }
        try {
            if (newRole === 'fiscal') {
                const { data: userData, error: userError } = await sbClient.from('app_users').select('nome, sobrenome, full_name').eq('email', email).single();
                if (!userError && userData) {
                    let nomeCompleto = '';
                    if (userData.full_name && !/^\d+$/.test(userData.full_name)) nomeCompleto = userData.full_name;
                    else if (userData.nome) nomeCompleto = (userData.nome + (userData.sobrenome ? ' ' + userData.sobrenome : '')).trim();
                    if (nomeCompleto) {
                        const fiscalFromList = (typeof findFiscalNameInList === 'function') ? findFiscalNameInList(nomeCompleto) : null;
                        if (!fiscalFromList) { abrirModalVinculo(nomeCompleto, email, newRole, 'update'); return; }
                    }
                }
            }
            const { error } = await sbClient.from('app_users').update({ role: newRole }).eq('email', email);
            if (error) throw error; if (!skipConfirm) alert('Perfil atualizado!'); loadAllUsers();
        } catch (e) { alert('Erro ao atualizar cargo: ' + e.message); }
    }

    // Notifications polling (admin)
    let _notifIntervalId = null;
    function startNotificationsPoll() { if (_notifIntervalId) return; fetchNotifications(); _notifIntervalId = setInterval(fetchNotifications, 45000); }
    function stopNotificationsPoll() { if (_notifIntervalId) { clearInterval(_notifIntervalId); _notifIntervalId = null; } }

    async function fetchPendingCount() {
        try {
            const { data, error } = await sbClient.from('app_users').select('id').eq('role', 'pending');
            if (error) throw error; const count = Array.isArray(data) ? data.length : 0; const badgeEl = document.getElementById('pending-badge'); if (badgeEl) badgeEl.textContent = count > 0 ? String(count) : '';
        } catch (err) { console.error('Erro ao buscar pendentes', err); }
    }

    async function fetchNotifications() {
        try {
            const { data, error } = await sbClient.from('app_notifications').select('*').eq('read', false).order('created_at', { ascending: true });
            if (error) throw error;
            if (data && data.length) {
                data.forEach(async n => {
                    if (n.type === 'new_user_request') return; // Skip mark as read for new user requests so they appear in pending
                    try { console.log('Nova Notificação:', n.type, n.payload); await sbClient.from('app_notifications').update({ read: true }).eq('id', n.id); } catch (e) { console.error(e); }
                });
            }
        } catch (err) { console.error('Erro ao buscar notificações', err); }
    }

    // Open pending section (used by clickable stat card)
    async function openAdminPendings() {
        try {
            if (typeof loadAllUsers === 'function') await loadAllUsers();
            const sec = document.getElementById('admin-pending-section');
            if (sec) {
                // ensure visible even when zero so admin can see message
                sec.style.display = 'block';
                try { const closeBtn = document.getElementById('admin-pending-close-btn'); if (closeBtn) { closeBtn.style.display = 'inline-block'; const icon = closeBtn.querySelector('i'); if (icon) icon.className = 'bi bi-chevron-up'; } } catch(e){}
                sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                alert('Seção de pendentes não encontrada.');
            }
        } catch (e) { console.error('Erro ao abrir pendentes:', e); alert('Erro ao abrir pendentes: ' + (e.message || e)); }
    }

    // Diagnostic helper: fetch raw user rows and notifications (shows modal with JSON)
    async function diagnosePendingFetch() {
        try {
            const outEl = document.getElementById('admin-diag-output');
            if (outEl) outEl.textContent = 'Executando diagnóstico...';

            const results = {};

            try {
                const { data, error } = await sbClient.from('app_users').select('id,email,role,matricula,created_at').order('created_at', { ascending: false }).limit(50);
                results.users = data || null;
                results.users_error = error ? (error.message || String(error)) : null;
            } catch (e) { results.users_error = String(e); }

            try {
                const { data: notes, error: noteErr } = await sbClient.from('app_notifications').select('id,type,payload,read,created_at').order('created_at', { ascending: false }).limit(50);
                results.notifications = notes || null;
                results.notifications_error = noteErr ? (noteErr.message || String(noteErr)) : null;
            } catch (e) { results.notifications_error = String(e); }

            // Add Supabase client / auth state info
            try {
                results.sbClient_exists = !!window.sbClient;
                if (window.sbClient && window.sbClient.auth) {
                    try {
                        const sessionResp = await window.sbClient.auth.getSession();
                        results.auth_session = sessionResp || null;
                    } catch (sErr) { results.auth_session_error = String(sErr); }

                    try {
                        const userResp = await window.sbClient.auth.getUser();
                        results.auth_user = userResp || null;
                    } catch (uErr) { results.auth_user_error = String(uErr); }
                }
            } catch (e) { results.sbclient_error = String(e); }

            // Add local sessionStorage hints
            try {
                results.sessionStorage = {
                    sop_user: sessionStorage.getItem('sop_user'),
                    sop_role: sessionStorage.getItem('sop_role'),
                    is_admin_gecope: sessionStorage.getItem('is_admin_gecope')
                };
            } catch (e) { results.sessionStorage_error = String(e); }

            if (outEl) outEl.textContent = JSON.stringify(results, null, 2);
            const modalEl = document.getElementById('modalAdminDiag');
            if (modalEl) {
                const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
                modal.show();
            } else {
                alert('Diagnóstico executado. Veja console para detalhes.');
            }
        } catch (err) {
            console.error('Erro no diagnóstico:', err);
            alert('Erro ao executar diagnóstico: ' + err.message);
        }
    }

    // Expose to window
    window.verificarAdminSalvo = verificarAdminSalvo;
    window.alternarModoAdmin = alternarModoAdmin;
    window.handleLoginSubmit = handleLoginSubmit;
    window.loadAllUsers = loadAllUsers;
    window.abrirModalVinculo = abrirModalVinculo;
    window.abrirModalNovoUsuario = abrirModalNovoUsuario;
    window.aprovarUsuario = aprovarUsuario;
    window.excluirUsuario = excluirUsuario;
    window.filterAdminUsers = filterAdminUsers;
    window.updateUserRole = updateUserRole;
    window.startNotificationsPoll = startNotificationsPoll;
    window.stopNotificationsPoll = stopNotificationsPoll;
    window.fetchPendingCount = fetchPendingCount;
    window.fetchNotifications = fetchNotifications;
    window.aprovarFromNotification = aprovarFromNotification;
    window.recusarNotification = recusarNotification;
    window.diagnosePendingFetch = diagnosePendingFetch;
    window.openAdminPendings = openAdminPendings;

    // Init actions
    document.addEventListener('DOMContentLoaded', () => {
        // Wire formLogin submit if present (keeps old behavior)
        document.getElementById('formLogin')?.addEventListener('submit', handleLoginSubmit);
    });

})(window);
