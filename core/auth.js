// core/auth.js — autenticação (Supabase) e RBAC: cadastro, login, logout, papéis e permissões.
// Extraído de main.js (Fase 2 da reorganização modular).

/* --------------------------------------------------------------
   FUNES DE AUTENTICAO (SUPABASE)
-------------------------------------------------------------- */

// Cadastro reformulado: NOME, SOBRENOME, MATRICULA, SENHA
async function signUpRequest(nome, sobrenome, matricula, senha, telefone, email) {
    try {
        // Normaliza (trim/lowercase) antes de qualquer uso: o Supabase Auth sempre grava o
        // e-mail em minúsculas, então usar a mesma normalização aqui garante que auth.users
        // e app_users fiquem com o mesmo valor e possam ser correlacionados pelo e-mail.
        email = (email || '').trim().toLowerCase();

        // Sanitiza nome/sobrenome/matrícula na entrada: esses valores acabam renderizados via
        // innerHTML em várias telas (Atividades, comentários) e também interpolados em filtros
        // .or() do PostgREST — sem essa allowlist, um nome com HTML/vírgula/parêntese vira XSS
        // armazenado ou bypass do filtro por perfil "fiscal".
        nome = String(nome || '').trim().replace(/[^\p{L}\p{M}\s'.-]/gu, '').slice(0, 60);
        sobrenome = String(sobrenome || '').trim().replace(/[^\p{L}\p{M}\s'.-]/gu, '').slice(0, 60);
        matricula = String(matricula || '').trim().replace(/[^A-Za-z0-9-]/g, '').slice(0, 20);

        if (!nome || !sobrenome || !matricula) {
            alert('Nome, sobrenome e matrícula devem conter apenas letras, números e espaços.');
            return false;
        }

        // 1. Criar usuário no Auth
        const options = {
            email: email,
            password: senha,
            options: { data: { full_name: `${nome} ${sobrenome}` } }
        };

        const { data, error } = await sbClient.auth.signUp(options);

        if (error) {
            console.error('[SIGNUP] Erro no Auth.signUp:', error);
            alert('Erro ao realizar cadastro (Auth): ' + (error.message || String(error)));
            return false;
        }

        const userId = data?.user?.id;

        // Rastreia se o perfil em app_users ficou de fato com o MESMO e-mail gravado em
        // auth.users (acima). Se essa gravação falhar silenciosamente (ex.: RLS bloqueando
        // o UPDATE/INSERT), o usuário tem uma conta de autenticação válida mas nenhum (ou um
        // desatualizado) perfil correspondente — ao ser "aprovado" pelo admin, o login
        // continuaria falhando, sem que ninguém percebesse a causa. Ver sql/fix_app_users_email_mismatch.sql
        // para o reparo de registros já afetados por essa falha no passado.
        let appUsersSynced = false;

        // 2. Buscar se já existe um registro fantasma pela matrícula
        const { data: existingGhost, error: searchError } = await sbClient
            .from('app_users')
            .select('*')
            .eq('matricula', matricula)
            .maybeSingle();

        if (existingGhost) {
            // Tenta UPDATE no registro ghost existente
            const payload = {
                email: email,
                nome: nome,
                sobrenome: sobrenome,
                telefone_whatsapp: telefone || existingGhost.telefone_whatsapp,
                role: 'pending'
            };

            const { data: updated, error: updateError } = await sbClient.from('app_users').update(payload).eq('id', existingGhost.id).select();
            // Se UPDATE falhar por RLS (0 linhas afetadas) ou erro, insere novo registro com email real
            if (updateError || !updated || updated.length === 0) {
                console.warn('[SIGNUP] UPDATE do ghost falhou (RLS?), tentando INSERT com email real:', updateError?.message);
                const { error: insertFallbackError } = await sbClient.from('app_users').insert([{ ...payload, matricula }]);
                if (insertFallbackError) {
                    console.warn('[SIGNUP] INSERT fallback também falhou:', insertFallbackError.message);
                } else {
                    appUsersSynced = true;
                }
            } else {
                appUsersSynced = true;
            }
        } else {
            // Não existe, fazer INSERT de um novo
            const payload = {
                email: email,
                matricula: matricula,
                nome: nome,
                sobrenome: sobrenome,
                telefone_whatsapp: telefone,
                role: 'pending',
                created_at: new Date().toISOString()
            };
            // NÃO gravar payload.id: app_users.id é bigint (identity) e userId é o UUID do
            // Auth — o INSERT falharia com 22P02 e o perfil não seria criado. A correlação
            // entre auth.users e app_users é feita por e-mail (normalizado em minúsculas).

            const { error: insertError } = await sbClient.from('app_users').insert([payload]);
            if (insertError) {
                console.warn('[SIGNUP] Aviso ao inserir app_users (RLS):', insertError);
            } else {
                appUsersSynced = true;
            }
        }

        const { error: noteError } = await sbClient.from('app_notifications').insert([{ type: 'new_user_request', payload: JSON.stringify({ matricula, nome: `${nome} ${sobrenome}`, email: email }), created_at: new Date().toISOString(), read: false }]);
        if (noteError) {
            console.warn('[SIGNUP] Falha ao inserir notificação:', noteError);
        }

        if (!appUsersSynced) {
            // Não mascara o problema com a mensagem de sucesso: a conta de login (Auth) foi
            // criada, mas o perfil (app_users) não foi gravado/atualizado corretamente — se o
            // admin aprovar mesmo assim, o acesso continuará falhando por e-mail divergente.
            alert(`Sua conta de acesso foi criada, mas houve uma falha ao registrar seu perfil no sistema.\n\nPor favor, entre em contato com o administrador informando sua matrícula (${matricula}) e o e-mail usado no cadastro (${email}) para que ele possa concluir seu cadastro manualmente.`);
            return true;
        }

        alert(`Solicitação enviada para a matrícula ${matricula}.\nAguarde aprovação do Admin!`);
        return true;
    } catch (err) { console.error(err); alert('Erro inesperado ao solicitar acesso.'); return false; }
}

async function signInWithEmail(email, password, opts = {}) {
    try {
        // Normaliza aqui também: garante que a busca do perfil em app_users (feita mais abaixo
        // por igualdade exata de string) bata mesmo que o usuário digite o e-mail com maiúsculas.
        email = (email || '').trim().toLowerCase();

        // Garantia: aguarda inicialização do cliente Supabase (se necessário)
        if (!sbClient) {
            const waitInit = new Promise(res => {
                const start = Date.now();
                const iv = setInterval(() => {
                    if (sbClient) { clearInterval(iv); res(true); }
                    else if (Date.now() - start > 5000) { clearInterval(iv); res(false); }
                }, 100);
            });
            const ok = await waitInit;
            if (!ok) {
                Swal.fire('Erro de Autenticação', 'Serviço de autenticação não iniciado. Recarregue a página.', 'error');
                return false;
            }
        }

        const { data, error } = await sbClient.auth.signInWithPassword({ email, password });

        if (error) {
            console.error('[ERRO] Falha Auth:', error.message);
            if (!opts.silent) {
                document.getElementById('landing-feedback').style.display = 'block';
                document.getElementById('landing-feedback').textContent = error.message;
            }
            return false;
        }

        // Busca perfil por email (app_users.id é bigserial, não UUID do Auth)
        const profile = await sbClient.from('app_users').select('*').eq('email', email).maybeSingle();
        const role = profile?.data?.role || 'pending';

        // Salva no sessionStorage
        sessionStorage.setItem('sop_user', email);
        sessionStorage.setItem('sop_role', role);

        // Busca nome completo de forma robusta
        let finalName = '';
        if (profile.data) {
            if (profile.data.full_name && !/^\d+$/.test(profile.data.full_name)) {
                finalName = profile.data.full_name;
            } else if (profile.data.nome) {
                finalName = (profile.data.nome + (profile.data.sobrenome ? ' ' + profile.data.sobrenome : '')).toUpperCase();
            }
        }

        if (finalName) {
            sessionStorage.setItem('sop_user_name', finalName);
        } else {
            sessionStorage.removeItem('sop_user_name');
        }
        applyRoleToUI(role);

        // Esconde landing
        toggleLanding(false);

        setTimeout(() => carregarDadosSupabase(), 500);
        return true;
    } catch (err) {
        console.error('[ERRO] Exceção em signInWithEmail:', err);
        if (!opts.silent) {
            document.getElementById('landing-feedback').style.display = 'block';
            document.getElementById('landing-feedback').textContent = 'Erro ao autenticar: ' + (err.message || err);
        }
        return false;
    }
}

async function signOutUser() {
    await sbClient.auth.signOut();
    sessionStorage.removeItem('sop_user');
    sessionStorage.removeItem('sop_role');
    sessionStorage.removeItem('sop_user_name');
    // Exibe landing novamente
    toggleLanding(true);
    // Atualiza UI
    applyRoleToUI('guest');
}

function applyRoleToUI(rawRole) {
    const role = (rawRole || 'guest').toLowerCase();

    // Remove role classes
    document.body.classList.remove('role-admin', 'role-gerente', 'role-fiscal', 'role-externo', 'role-pending', 'is-admin');
    document.body.classList.add(`role-${role}`);
    if (role === 'admin') document.body.classList.add('is-admin');

    // 1. Reset tabs and panes
    document.querySelectorAll('#dashboardTabs .nav-link').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('show', 'active'));

    // 2. Activate Home Tab by Default
    const homeTab = document.querySelector('[data-bs-target="#pane-home"]');
    const homePane = document.getElementById('pane-home');
    if (homeTab && homePane) {
        homeTab.classList.add('active');
        homePane.classList.add('show', 'active');
        setHeroContext('pane-home');
        updateHome();
    }

    // 1. Visibilidade de Abas e Tiles por Atributo data-roles
    // -> cards iniciais devem permanecer visíveis para todos os papéis;
    //    a lógica de restrição de acesso é tratada no showPane() e em cada função.
    document.querySelectorAll('[data-roles]').forEach(el => {
        if (el.classList.contains('home-action-card') || el.classList.contains('home-list-row')) {
            // sempre mostra o tile/linha (layout flex); a restrição de acesso é tratada no showPane()
            el.style.setProperty('display', 'flex', 'important');
            return;
        }
        const allowed = el.getAttribute('data-roles').split(',');
        if (allowed.includes(role)) {
            el.style.setProperty('display', 'block', 'important');
        } else {
            el.style.setProperty('display', 'none', 'important');
        }
    });

    // 2b. Deep-link: permite abrir uma aba específica via ?pane=pane-xxx
    // (usado pelo botão "Processos" do módulo Atividades, em cronograma.html)
    const deepLinkPane = new URLSearchParams(window.location.search).get('pane');
    if (deepLinkPane && deepLinkPane !== 'pane-home' && document.getElementById(deepLinkPane)) {
        showPane(deepLinkPane);
    }

    // Caso especial: Selecionar a primeira aba visível se a atual sumir
    const activeTab = document.querySelector('.nav-link.active');
    if (activeTab && activeTab.closest('li').style.display === 'none') {
        const firstVisible = document.querySelector('#dashboardTabs li[style*="display: block"] .nav-link');
        if (firstVisible) showPane(firstVisible.getAttribute('data-bs-target').replace('#', ''));
    }

    // Se for Pending, bloqueia acesso e volta para landing
    if (role === 'pending') {
        alert("Sua solicitação de acesso ainda está pendente de aprovação.");
        signOutUser();
        return;
    }

    // 2. Elementos .admin-only
    document.querySelectorAll('.admin-only').forEach(el => {
        if (el.id !== 'btn-nova-comp-analitica') {
            el.style.display = (role === 'admin') ? '' : 'none';
        }
    });

    // 3. Botões Específicos
    const btnNovaComp = document.getElementById('btn-nova-comp-analitica');
    if (btnNovaComp) {
        // now all authenticated roles can see the "nova composição analítica" link
        // guests and pending users will still have it hidden via their role string
        btnNovaComp.style.display = (role && role !== 'guest' && role !== 'pending') ? 'inline-block' : 'none';
    }

    // 4. Elementos Hide Fiscal
    if (role === 'fiscal') {
        document.querySelectorAll('.hide-fiscal').forEach(el => el.style.display = 'none');
    }

    // 5. Atualiza contadores e Admin Dashboard
    if (role === 'admin') {
        fetchPendingCount();
        startNotificationsPoll();
    } else {
        const badgeEl = document.getElementById('pending-badge'); if (badgeEl) badgeEl.textContent = '';
        stopNotificationsPoll();
    }

    // 6. Atualiza Header (Sair / Nome Usuário)
    const userInfoHeader = document.getElementById('user-info-header');
    if (userInfoHeader) {
        if (role === 'guest') {
            userInfoHeader.style.setProperty('display', 'none', 'important');
        } else {
            userInfoHeader.style.setProperty('display', 'flex', 'important');
            const nameEl = document.getElementById('header-user-name');
            const roleEl = document.getElementById('header-user-role');
            if (nameEl) nameEl.textContent = (sessionStorage.getItem('sop_user_name') || 'Usuário').toUpperCase();
            if (roleEl) roleEl.textContent = role;
        }
    }

    // Aplicar regras de RBAC nos painéis
    if (typeof applyRBACToPainels === 'function') {
        applyRBACToPainels();
    }
}

// --- FUNES DE CONTROLE DE RBAC (ROLE-BASED ACCESS CONTROL) ---
/**
 * Retorna o papel atual do usuário logado
 */
function getCurrentUserRole() {
    return (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
}

/**
 * Retorna o email do usuário logado
 */
function getCurrentUserEmail() {
    return sessionStorage.getItem('sop_user') || '';
}

/**
 * Busca a role atual do usuário no servidor (tabela app_users)
 * e atualiza localStorage + UI se houver alteração.
 */
async function refreshUserRole() {
    try {
        const email = getCurrentUserEmail();
        if (!email) return;
        const { data, error } = await sbClient.from('app_users').select('role').eq('email', email).single();
        if (error) {
            console.warn('[WARN] refreshUserRole: erro ao buscar role', error.message || error);
            return;
        }
        const newRole = (data?.role || 'guest').toLowerCase();
        const curRole = (sessionStorage.getItem('sop_role') || 'guest').toLowerCase();
        if (newRole !== curRole) {
            sessionStorage.setItem('sop_role', newRole);
            console.log('[INFO] Role atualizada de', curRole, 'para', newRole);
            applyRoleToUI(newRole);
        }
    } catch (err) {
        console.error('[ERRO] refreshUserRole:', err);
    }
}

/**
 * Verifica se o usuario é proprietário de uma composição/orçamento
 * @param {Object} item - O item (composição ou orçamento)
 * @returns {boolean} - True se o usuário é o dono
 */
function isItemOwner(item) {
    const userEmail = getCurrentUserEmail();
    const currentUserName = (sessionStorage.getItem('sop_user_name') || '').toUpperCase();
    const currentFiscalName = (sessionStorage.getItem('sop_fiscal_name') || '').toUpperCase();

    // Para composições, verifica criador
    const criador = item.criador_email || item.criado_por || item.created_by || '';
    const autorV1 = item.historico_versoes?.[0]?.autor || criador || item.criador_nome || item.autor || '';

    if (userEmail && autorV1.toUpperCase().includes(userEmail.toUpperCase())) return true;
    if (currentUserName && autorV1.toUpperCase().includes(currentUserName)) return true;
    if (currentFiscalName && autorV1.toUpperCase().includes(currentFiscalName)) return true;
    return false;
}

/**
 * Verifica se o usuário pode editar uma composição
 * Regra: Admin pode editar todas. Gerente/Fiscal/Externo podem editar apenas suas próprias
 */
function canEditComposition(item) {
    const role = getCurrentUserRole();
    if (role === 'admin') return true;
    if (['gerente', 'fiscal', 'externo'].includes(role)) {
        return isItemOwner(item);
    }
    return false;
}

/**
 * Verifica se o usuário pode deletar uma composição
 * Regra: Admin pode deletar todas. Gerente/Fiscal/Externo podem deletar apenas suas próprias
 */
function canDeleteComposition(item) {
    const role = getCurrentUserRole();
    if (role === 'admin') return true;
    if (['gerente', 'fiscal', 'externo'].includes(role)) {
        return isItemOwner(item);
    }
    return false;
}

/**
 * Verifica se o usuário pode ver ações em processos (botões de ação)
 * Regra: Apenas Admin e Gerente. Fiscal e Externo não podem ver
 */
function canSeeProcessActions() {
    const role = getCurrentUserRole();
    return ['admin', 'gerente'].includes(role);
}

/**
 * Verifica se o usuário pode marcar processo como prioritário
 * Regra: Apenas Admin e Gerente. Fiscal e Externo não podem
 */
function canMarkProcessAsPriority() {
    const role = getCurrentUserRole();
    // apenas administrador pode alterar prioridades
    return role === 'admin';
}

/**
 * Verifica se o usuário pode marcar data como meta
 * Regra: apenas Admin pode (
 */
function canMarkDateAsMeta() {
    const role = getCurrentUserRole();
    // gerentes não têm essa permissão
    return role === 'admin';
}

// --- WIRING DO OVERLAY DE LOGIN/CADASTRO (extraído de main.js) ---
/* --------------------------------------------------------------
   OVERLAY DE BOAS-VINDAS / LOGIN (TELA INICIAL)
-------------------------------------------------------------- */

/* HTML do overlay será injetado dinamicamente para não alterar a ordem do arquivo
   (mas já podemos defini-lo aqui para facilitar alteração futura). */

// Overlay de login agora está no HTML estático (logo após <body>).
// Aqui apenas registramos os event listeners.
document.addEventListener('DOMContentLoaded', () => {

    // Toggle Logic
    const containerLogin = document.getElementById('container-login');
    const containerReg = document.getElementById('container-register');

    const btnShowReg = document.getElementById('btn-show-register');
    const btnShowLogin = document.getElementById('btn-show-login');

    if (btnShowReg) {
        btnShowReg.addEventListener('click', (e) => {
            e.preventDefault();
            containerLogin.style.display = 'none';
            containerReg.style.display = 'block';
        });
    }

    if (btnShowLogin) {
        btnShowLogin.addEventListener('click', (e) => {
            e.preventDefault();
            containerReg.style.display = 'none';
            containerLogin.style.display = 'block';
        });
    }

    // Handle Login
    document.getElementById('landingLoginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const loginInput = document.getElementById('landing-matricula').value.trim();
        const password = document.getElementById('landing-password').value;

        if (loginInput.includes('@')) {
            // Entrada já é um email
            await signInWithEmail(loginInput, password);
        } else {
            // Entrada é matrícula: tenta gecope.app primeiro, depois busca email real no app_users
            const emailGecopeApp = `${loginInput}@gecope.app`;
            const result = await signInWithEmail(emailGecopeApp, password, { silent: true });
            if (!result) {
                // Busca email real cadastrado com essa matrícula — via função SECURITY DEFINER
                // (app_users_lookup_by_matricula), não mais SELECT direto na tabela: antes deste
                // login sequer acontecer, o usuário ainda não tem sessão, e a tabela app_users não
                // é mais publicamente legível (só essa função, que devolve apenas id/nome/sobrenome/
                // email de UMA matrícula, nunca telefone/role/a tabela inteira).
                const { data: userRecord } = await sbClient.rpc('app_users_lookup_by_matricula', { p_matricula: loginInput }).maybeSingle();
                if (userRecord?.email && userRecord.email !== emailGecopeApp) {
                    await signInWithEmail(userRecord.email, password);
                } else {
                    // Exibe o erro original (sem email alternativo encontrado)
                    await signInWithEmail(emailGecopeApp, password);
                }
            }
        }
    });

    // Toggle Password Visibility
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    const inputPassword = document.getElementById('landing-password');
    if (btnTogglePassword && inputPassword) {
        btnTogglePassword.addEventListener('click', () => {
            const type = inputPassword.getAttribute('type') === 'password' ? 'text' : 'password';
            inputPassword.setAttribute('type', type);
            const icon = btnTogglePassword.querySelector('i');
            if (icon) {
                icon.className = type === 'password' ? 'bi bi-eye' : 'bi bi-eye-slash';
            }
        });
    }

    // Handle Forgot Password
    const btnEsqueci = document.getElementById('btn-esqueci-senha');
    if (btnEsqueci) {
        btnEsqueci.addEventListener('click', async (e) => {
            e.preventDefault();
            const prefilledMatricula = document.getElementById('landing-matricula').value.trim();

            const { value: matricula } = await Swal.fire({
                title: 'Recuperar Senha',
                text: 'Informe sua matrícula cadastrada no sistema:',
                input: 'text',
                inputValue: prefilledMatricula,
                inputPlaceholder: 'Ex: 99030487',
                showCancelButton: true,
                confirmButtonColor: 'var(--sop-green)',
                confirmButtonText: 'Confirmar',
                cancelButtonText: 'Cancelar',
                inputValidator: (value) => {
                    if (!value) {
                        return 'Você precisa digitar sua matrícula!';
                    }
                }
            });

            if (matricula) {
                Swal.fire({
                    title: 'Consultando...',
                    allowOutsideClick: false,
                    didOpen: () => {
                        Swal.showLoading();
                    }
                });

                try {
                    // Verificar se a matrícula existe — via função SECURITY DEFINER, ver
                    // comentário equivalente no handler de login acima.
                    const { data: user, error: userErr } = await sbClient
                        .rpc('app_users_lookup_by_matricula', { p_matricula: matricula.trim() })
                        .maybeSingle();

                    if (userErr) throw userErr;

                    if (!user) {
                        Swal.fire('Matrícula Não Encontrada', 'A matrícula informada não está cadastrada no sistema.', 'error');
                        return;
                    }

                    const nomeCompleto = `${user.nome} ${user.sobrenome || ''}`.trim().toUpperCase();

                    const { isConfirmed } = await Swal.fire({
                        title: 'Solicitar Recuperação?',
                        html: `Deseja enviar uma solicitação de recuperação de senha para <strong>${nomeCompleto}</strong>?<br><br>O administrador do GECOPE será notificado para realizar a redefinição de sua senha.`,
                        icon: 'question',
                        showCancelButton: true,
                        confirmButtonColor: 'var(--sop-green)',
                        confirmButtonText: 'Sim, enviar solicitação',
                        cancelButtonText: 'Cancelar'
                    });

                    if (isConfirmed) {
                        Swal.fire({
                            title: 'Processando...',
                            allowOutsideClick: false,
                            didOpen: () => {
                                Swal.showLoading();
                            }
                        });

                        // Criar notificação para o Admin
                        const { error: notifErr } = await sbClient.from('app_notifications').insert([{
                            type: 'new_user_request',
                            payload: JSON.stringify({
                                matricula: matricula.trim(),
                                nome: `${nomeCompleto} - RECUPERAÇÃO DE SENHA`
                            }),
                            created_at: new Date().toISOString(),
                            read: false
                        }]);

                        if (notifErr) throw notifErr;

                        const adminMessage = `Olá! Esqueci minha senha do GECOPE. Poderia redefini-la para mim? Minha matrícula é *${matricula.trim()}* e meu nome é *${nomeCompleto}*.`;
                        const encodedMessage = encodeURIComponent(adminMessage);
                        const whatsappLink = `https://api.whatsapp.com/send?phone=558599030487&text=${encodedMessage}`;

                        Swal.fire({
                            title: 'Solicitação Enviada!',
                            html: `A solicitação foi registrada no painel do administrador.<br><br>Você também pode acelerar o processo clicando no botão abaixo para enviar uma mensagem direta via WhatsApp para o Administrador.`,
                            icon: 'success',
                            showCancelButton: true,
                            confirmButtonColor: '#25D366',
                            confirmButtonText: '<i class="bi bi-whatsapp me-1"></i> Chamar no WhatsApp',
                            cancelButtonText: 'Fechar'
                        }).then((result) => {
                            if (result.isConfirmed) {
                                window.open(whatsappLink, '_blank');
                            }
                        });
                    }
                } catch (err) {
                    console.error(err);
                    Swal.fire('Erro', 'Não foi possível processar a solicitação no momento: ' + (err.message || err), 'error');
                }
            }
        });
    }

    // Handle Register
    document.getElementById('landingRegisterForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const nome = document.getElementById('reg-nome').value.trim();
        const sobrenome = document.getElementById('reg-sobrenome').value.trim();
        const matricula = document.getElementById('reg-matricula').value.trim();
        const email = document.getElementById('reg-email').value.trim();
        const senha = document.getElementById('reg-senha').value;
        const elTel = document.getElementById('reg-telefone');
        const telefone = (elTel && elTel.value) ? elTel.value.replace(/\D/g, '') : null;

        const success = await signUpRequest(nome, sobrenome, matricula, senha, telefone, email);

        if (success) {
            // Retorna ao login apenas se o cadastro foi realizado com sucesso
            containerReg.style.display = 'none';
            containerLogin.style.display = 'block';
            document.getElementById('landingRegisterForm').reset();
        }
    });
    // Listeners de Abas
    // (PERFORMANCE: o listener dedicado que existia aqui chamava carregarComposicoes()
    // sem checar a flag de cache _composicoesCarregadas, disparando uma consulta completa
    // ao Supabase toda vez que a aba era reaberta — mesmo já tendo dados em memória. A
    // função showPane() já cuida do carregamento com cache (linha ~3196), então essa
    // chamada duplicada foi removida; showPane() é o único caminho que abre essa aba.)

    // Inicialização
    if (typeof carregarListaFiscais === 'function') carregarListaFiscais();

    // Garantir que o modal de cadastro esteja no final do body para evitar problemas de visibilidade
    try {
        const modalCadastroEl = document.getElementById('modalCadastro');
        if (modalCadastroEl && modalCadastroEl.parentElement !== document.body) {
            document.body.appendChild(modalCadastroEl);
            console.log('[INIT] modalCadastro movido para document.body');
        }
    } catch (e) { console.warn('[INIT] Falha ao mover modalCadastro:', e); }

    // Idem para o modal do checklist de documentação do aditivo (evita ficar preso
    // dentro de outro modal ainda fechado, com display:none, e nunca aparecer)
    try {
        const modalChecklistEl = document.getElementById('modalChecklistAditivo');
        if (modalChecklistEl && modalChecklistEl.parentElement !== document.body) {
            document.body.appendChild(modalChecklistEl);
            console.log('[INIT] modalChecklistAditivo movido para document.body');
        }
    } catch (e) { console.warn('[INIT] Falha ao mover modalChecklistAditivo:', e); }

    // Idem para o modal de justificativa do alerta de retorno
    try {
        const modalAlertaEl = document.getElementById('modalAlertaRetorno');
        if (modalAlertaEl && modalAlertaEl.parentElement !== document.body) {
            document.body.appendChild(modalAlertaEl);
            console.log('[INIT] modalAlertaRetorno movido para document.body');
        }
    } catch (e) { console.warn('[INIT] Falha ao mover modalAlertaRetorno:', e); }
});
