// js/admin.js
// VERSÃO FINAL CORRIGIDA

import { SITE_BASE_URL, ITENS_PER_PAGE } from './config.js';
import * as db from './supabaseService.js';
import { extractDataFromPdf } from './pdfHandler.js';

// --- CONSTANTES ---
const DEFAULT_RECTS_PERCENT_BY_TYPE = {
    os: {
        // O.S. costuma trazer linhas manuscritas no rodapé.
        tecnico: { x: 0.06, y: 0.80, width: 0.36, height: 0.10 },
        cliente: { x: 0.54, y: 0.80, width: 0.36, height: 0.10 }
    },
    contrato: {
        tecnico: { x: 0.05, y: 0.79, width: 0.35, height: 0.07 },
        cliente: { x: 0.50, y: 0.72, width: 0.45, height: 0.12 }
    },
    proposta: {
        tecnico: { x: 0.05, y: 0.79, width: 0.35, height: 0.07 },
        cliente: { x: 0.50, y: 0.72, width: 0.45, height: 0.12 }
    },
    pedido: {
        tecnico: { x: 0.05, y: 0.79, width: 0.35, height: 0.07 },
        cliente: { x: 0.50, y: 0.72, width: 0.45, height: 0.12 }
    },
    proposta_pedido: {
        tecnico: { x: 0.05, y: 0.79, width: 0.35, height: 0.07 },
        cliente: { x: 0.50, y: 0.72, width: 0.45, height: 0.12 }
    },
    default: {
        tecnico: { x: 0.05, y: 0.79, width: 0.35, height: 0.07 },
        cliente: { x: 0.50, y: 0.72, width: 0.45, height: 0.12 }
    }
};

const TENANT_ROLE_LABEL = {
    owner: 'Proprietário',
    admin: 'Administrador',
    manager: 'Gestor',
    member: 'Membro',
    billing: 'Financeiro'
};

const MASTER_ADMIN_EMAIL = 'altnixtecnologia@gmail.com';
const PANEL_APP_VERSION = 'v.26.04';

// --- ESTADO GLOBAL ---
let adminUserData = { id: null, email: null }; 

function formatPhoneNumber(phone) {
    if (!phone) return ''; const digits = phone.replace(/\D/g, '');
    if (digits.length === 11) { return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`; }
    else if (digits.length === 10) { return `(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}`; }
    else { return phone; }
}

function sanitizeAutoFilledName(value) {
    if (!value) return '';
    let name = String(value).replace(/\s+/g, ' ').trim();
    name = name.split(/\b(?:endere[cç]o|rua|avenida|av\.?|bairro|cidade|cep|e-?mail|email|telefone|whats(?:app)?|enviado por|cpf|cnpj)\b/i)[0].trim();
    return name;
}

function sanitizeAutoFilledEmail(value) {
    if (!value) return '';
    const email = String(value).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return '';
    return email;
}

function sanitizeAutoFilledPhone(value) {
    if (!value) return '';
    const digits = String(value).replace(/\D/g, '');
    if (digits.length === 10 || digits.length === 11) return digits;
    if (digits.startsWith('55') && digits.length === 12) return digits.slice(2);
    if (digits.startsWith('55') && digits.length === 13) return digits.slice(2);
    return '';
}

function sanitizarNomeArquivo(nome) {
    if (!nome) return 'doc-s-nome'; const a = 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþßŕ'; const b = 'aaaaaaaceeeeiiiionoooooouuuuybsr'; let n = nome.toLowerCase();
    for (let i = 0; i < a.length; i++) { n = n.replace(new RegExp(a.charAt(i), 'g'), b.charAt(i)); }
    return n.replace(/[^a-z0-9.\-_]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function formatDateTime(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return date.toLocaleString('pt-BR');
}

function getSelectedDocumentType() {
    const selectedTypeRadio = document.querySelector('input[name="tipo_documento"]:checked');
    return selectedTypeRadio ? selectedTypeRadio.value : 'os';
}

function getDefaultRectsForType() {
    const selectedType = getSelectedDocumentType();
    return DEFAULT_RECTS_PERCENT_BY_TYPE[selectedType] || DEFAULT_RECTS_PERCENT_BY_TYPE.default;
}

async function addWhitespaceToPdf(file) {
    try {
        if (typeof PDFLib === 'undefined') return file;
        const arrayBuffer = await file.arrayBuffer();
        const pdfDoc = await PDFLib.PDFDocument.load(arrayBuffer);
        const pages = pdfDoc.getPages();
        const lastPage = pages[pages.length - 1];
        const { width, height } = lastPage.getSize();
        lastPage.setSize(width, height + 150);
        lastPage.translateContent(0, 150);
        const pdfBytes = await pdfDoc.save();
        return new File([pdfBytes], file.name, { type: "application/pdf" });
    } catch (e) { return file; }
}

function showFeedbackGlobal(message, type = 'info', duration = 3000) {
    const c = document.body; const f = document.createElement('div'); const cl = { success: 'bg-green-100 text-green-700', error: 'bg-red-100 text-red-700', info: 'bg-blue-100 text-blue-700' };
    f.className = `fixed bottom-5 right-5 p-4 rounded-md shadow-lg text-sm z-[100] ${cl[type] || 'bg-gray-100 text-gray-700'}`;
    f.textContent = message; c.appendChild(f);
    setTimeout(() => { if (f.parentNode) f.remove(); }, duration);
}

// --- INÍCIO DO SCRIPT ---
document.addEventListener('DOMContentLoaded', async () => { 
    
    try {
        const { data: { user } } = await db.supabase.auth.getUser();
        if (user) {
            adminUserData.id = user.id;
            adminUserData.email = user.email;
        } else {
            window.location.href = 'index.html';
            return;
        }
    } catch(err) { 
        console.error("Auth:", err.message); 
        window.location.href = 'index.html';
        return;
    }
    
    // --- DECLARAÇÃO DE TODOS OS ELEMENTOS ---
    const osFileInput = document.getElementById('os-file');
    const pickPdfBtn = document.getElementById('pick-pdf-btn');
    const workspacePanel = document.querySelector('main.workspace');
    const uploadInitialView = document.getElementById('initial-view');
    const showConsultationBtn = document.getElementById('show-consultation-btn');
    const showUsersBtn = document.getElementById('show-users-btn');
    const preparationView = document.getElementById('preparation-view');
    const usersView = document.getElementById('users-view');
    const cancelPreparationBtn = document.getElementById('cancel-preparation-btn');
    const loggedUserLabel = document.getElementById('logged-user-label');
    const panelVersionLabel = document.getElementById('panel-version-label');
    const topLogoutBtn = document.getElementById('top-logout-btn');
    const instructionText = document.getElementById('instruction-text');
    const resetDrawingBtn = document.getElementById('reset-drawing-btn');
    const pdfPreviewWrapper = document.getElementById('pdf-preview-wrapper');
    const uploadForm = document.getElementById('upload-form');
    const clienteNomeInput = document.getElementById('cliente-nome');
    const clienteTelefoneInput = document.getElementById('cliente-telefone');
    const clienteEmailInput = document.getElementById('cliente-email');
    const submitButton = document.getElementById('submit-button');
    const feedbackMessage = document.getElementById('feedback-message');
    const actionsContainer = document.getElementById('actions-container');
    const linkInput = document.getElementById('link-gerado-input');
    
    // Botões Específicos (Garantidos)
    const btnCopiarLink = document.getElementById('copiar-link-btn'); 
    const whatsappBtn = document.getElementById('whatsapp-btn');
    const whatsappContainer = document.getElementById('whatsapp-container');

    // Consulta
    const consultationView = document.getElementById('consultation-view');
    const backToInitialViewBtn = document.getElementById('back-to-initial-view-btn');
    const documentList = document.getElementById('document-list');
    const listLoadingFeedback = document.getElementById('list-loading-feedback');
    const statusFilterButtons = document.getElementById('status-filter-buttons');
    const searchInput = document.getElementById('search-input');
    const prevPageBtn = document.getElementById('prev-page-btn');
    const nextPageBtn = document.getElementById('next-page-btn');
    const pageInfo = document.getElementById('page-info');
    const refreshListBtn = document.getElementById('refresh-list-btn');

    // Gestão de usuários / clientes
    const refreshUsersBtn = document.getElementById('refresh-users-btn');
    const usersFeedback = document.getElementById('users-feedback');
    const tenantUserList = document.getElementById('tenant-user-list');
    const inviteUserForm = document.getElementById('invite-user-form');
    const inviteEmailInput = document.getElementById('invite-email-input');
    const inviteNameInput = document.getElementById('invite-name-input');
    const inviteRoleSelect = document.getElementById('invite-role-select');
    const tenantInviteList = document.getElementById('tenant-invite-list');
    const clientForm = document.getElementById('client-form');
    const clientFormResetBtn = document.getElementById('client-form-reset-btn');
    const clientIdInput = document.getElementById('client-id-input');
    const clientNameInput = document.getElementById('client-name-input');
    const clientEmailInput = document.getElementById('client-email-input');
    const clientPhoneInput = document.getElementById('client-phone-input');
    const clientDocumentInput = document.getElementById('client-document-input');
    const clientNotesInput = document.getElementById('client-notes-input');
    const tenantClientList = document.getElementById('tenant-client-list');
    const accountPasswordForm = document.getElementById('account-password-form');
    const accountNewPasswordInput = document.getElementById('account-new-password-input');
    const accountNewPasswordConfirmInput = document.getElementById('account-new-password-confirm-input');

    // Modais
    const detailsModal = document.getElementById('details-modal');
    const closeModalBtn = document.getElementById('close-modal-btn');
    const deleteConfirmModal = document.getElementById('delete-confirm-modal');
    const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
    const confirmDeleteBtn = document.getElementById('confirm-delete-btn');
    const deleteCheckbox = document.getElementById('delete-checkbox');
    
    // Checkboxes e Navegação
    const skipTecnicoCheckbox = document.getElementById('skip-tecnico-checkbox');
    const skipClienteCheckbox = document.getElementById('skip-cliente-checkbox');
    const useDefaultAreasCheckbox = document.getElementById('use-default-areas-checkbox');
    const navToNewBtn = document.getElementById('nav-to-new-btn');
    const navToConsultBtn = document.getElementById('nav-to-consult-btn');

    // --- Estado ---
    let pdfDoc = null;
    let currentFile = null;
    let currentStoragePath = null;
    let currentDrawingFor = 'initial';
    let isDrawing = false;
    let startCoords = { x: 0, y: 0 };
    let rects = { tecnico: null, cliente: null };
    let pageDimensions = [];
    let allDocumentsData = [];
    let currentPage = 0;
    let totalDocuments = 0;
    let currentStatusFilter = 'todos';
    let currentSearchTerm = '';
    let debounceTimer;
    let docIdParaExcluir = null;
    let localExtractedData = {};
    let workspaceContext = null;
    let usersDataCache = [];
    let invitesDataCache = [];
    let clientsDataCache = [];

    if (panelVersionLabel) {
        panelVersionLabel.textContent = PANEL_APP_VERSION;
    }

    function updateLoggedUserLabel(roleLabel = null) {
        if (!loggedUserLabel) return;
        const email = String(adminUserData.email || 'usuario@empresa.com.br');
        loggedUserLabel.textContent = roleLabel ? `${email} · ${roleLabel}` : email;
    }

    updateLoggedUserLabel();

    // --- Funções Internas ---
    function showFeedback(message, type = 'info') {
        if(!feedbackMessage) return;
        const cl = { success: 'text-green-600', error: 'text-red-600', info: 'text-blue-600' };
        feedbackMessage.textContent = message;
        feedbackMessage.className = `mt-4 text-center text-sm ${cl[type] || 'text-gray-600'}`;
    }
    function setLoading(isLoading) {
        if(!submitButton) return;
        submitButton.disabled = isLoading;
        submitButton.innerHTML = isLoading ? `Processando...` : 'Gerar Link';
    }

    function setTopTab(tab) {
        if (backToInitialViewBtn) backToInitialViewBtn.classList.toggle('tab-active', tab === 'novo');
        if (showConsultationBtn) showConsultationBtn.classList.toggle('tab-active', tab === 'consulta');
        if (showUsersBtn) showUsersBtn.classList.toggle('tab-active', tab === 'usuarios');
    }

    function resetPreparationView() {
        if(uploadInitialView) uploadInitialView.style.display = 'block';
        if(workspacePanel) workspacePanel.classList.add('hidden');
        if(preparationView) preparationView.classList.add('hidden');
        if(consultationView) consultationView.classList.add('hidden');
        if(usersView) usersView.classList.add('hidden');
        setTopTab('novo');

        if(osFileInput) osFileInput.value = '';
        
        pdfDoc = null; currentFile = null; currentStoragePath = null;
        rects = { tecnico: null, cliente: null }; 
        if(pdfPreviewWrapper) pdfPreviewWrapper.innerHTML = '';
        if(feedbackMessage) feedbackMessage.textContent = '';
        if(actionsContainer) actionsContainer.classList.add('hidden');
        
        if(skipTecnicoCheckbox) skipTecnicoCheckbox.checked = false;
        if(skipClienteCheckbox) skipClienteCheckbox.checked = false;
        if(useDefaultAreasCheckbox) useDefaultAreasCheckbox.checked = false;
        
        if(clienteNomeInput) clienteNomeInput.value = ''; 
        if(clienteTelefoneInput) clienteTelefoneInput.value = ''; 
        if(clienteEmailInput) clienteEmailInput.value = '';
        localExtractedData = {}; currentDrawingFor = 'initial';
        const tipoOs = document.getElementById('tipo-os');
        if(tipoOs) tipoOs.checked = true;
    }

    async function preparePdfAndData(pdfSource) {
        if(uploadInitialView) uploadInitialView.style.display = 'none';
        if(workspacePanel) workspacePanel.classList.remove('hidden');
        if(preparationView) preparationView.classList.remove('hidden');
        if(consultationView) consultationView.classList.add('hidden');
        setTopTab('novo');
        
        showFeedback('Carregando PDF...', 'info'); 
        if(pdfPreviewWrapper) pdfPreviewWrapper.innerHTML = '<p class="text-center p-8">Carregando...</p>';

        try {
            let docInitParams;
            if (pdfSource instanceof File) {
                docInitParams = { data: await pdfSource.arrayBuffer() };
            } 
            else if (typeof pdfSource === 'string') { docInitParams = { url: pdfSource }; }
            else { throw new Error("Fonte PDF inválida."); }
            
            pdfDoc = await pdfjsLib.getDocument(docInitParams).promise;

            if (pdfSource instanceof File) {
                 try { 
                    localExtractedData = await extractDataFromPdf(pdfSource);
                    if (localExtractedData.isContrato) {
                        const el = document.getElementById('tipo-contrato'); if(el) el.checked = true;
                    } else if (localExtractedData.isPedido || localExtractedData.isProposta) {
                        const el = document.getElementById('tipo-proposta-pedido'); if(el) el.checked = true;
                    }
                } catch (e) { console.warn("Erro extração:", e); }
            }

            const nomeExtraido = sanitizeAutoFilledName(localExtractedData?.nome || '');
            const telefoneExtraido = sanitizeAutoFilledPhone(localExtractedData?.telefone || '');
            const emailExtraido = sanitizeAutoFilledEmail(localExtractedData?.email || '');

            if(clienteNomeInput) clienteNomeInput.value = nomeExtraido; 
            if(clienteTelefoneInput) clienteTelefoneInput.value = formatPhoneNumber(telefoneExtraido); 
            if(clienteEmailInput) clienteEmailInput.value = emailExtraido; 

            showFeedback(''); 
            await renderPdfPreview();
        } catch (error) { 
            showFeedback(`Erro ao carregar: ${error.message}`, 'error'); 
        }
    }

    function applyCheckboxLogic() {
        if (useDefaultAreasCheckbox.checked) { 
            calculateAndApplyDefaultRects(); toggleDrawingCapability(false); 
        } else { 
            toggleDrawingCapability(true); 
            updateNextDrawingStep();
        }
        updateInstructionText(); redrawAll(); 
    }

    function resetCanvas() {
        rects = { tecnico: null, cliente: null };
        updateNextDrawingStep();
        updateInstructionText();
        redrawAll();
    }

    function updateNextDrawingStep() {
        const skipTec = skipTecnicoCheckbox.checked;
        const skipCli = skipClienteCheckbox.checked;
        if (!skipTec && !rects.tecnico) { currentDrawingFor = 'tecnico'; }
        else if (!skipCli && !rects.cliente) { currentDrawingFor = 'cliente'; }
        else { currentDrawingFor = 'done'; }
    }

    function calculateAndApplyDefaultRects() {
        const cv = document.getElementById('pdf-drawing-canvas'); 
        if (!cv || cv.width === 0) { setTimeout(calculateAndApplyDefaultRects, 100); return; }
        const defaults = getDefaultRectsForType();
        rects.tecnico = { x: Math.round(cv.width * defaults.tecnico.x), y: Math.round(cv.height * defaults.tecnico.y), width: Math.round(cv.width * defaults.tecnico.width), height: Math.round(cv.height * defaults.tecnico.height) };
        rects.cliente = { x: Math.round(cv.width * defaults.cliente.x), y: Math.round(cv.height * defaults.cliente.y), width: Math.round(cv.width * defaults.cliente.width), height: Math.round(cv.height * defaults.cliente.height) };
        currentDrawingFor = 'done'; 
    }

    function toggleDrawingCapability(enable) {
        const cv = document.getElementById('pdf-drawing-canvas');
        if (cv) {
            cv.style.pointerEvents = enable ? 'auto' : 'none';
            cv.style.cursor = enable ? 'crosshair' : 'default';
        }
    }

    function updateInstructionText() {
        if(!instructionText) return;
        const skipTec = skipTecnicoCheckbox?.checked;
        const skipCli = skipClienteCheckbox?.checked;
        const useDef = useDefaultAreasCheckbox?.checked;

        if (useDef) {
            instructionText.textContent = "Áreas padrão aplicadas.";
            currentDrawingFor = 'done';
        } else {
            if (!skipTec && !rects.tecnico) {
                currentDrawingFor = 'tecnico';
                instructionText.textContent = "1/2: Desenhe a área da EMPRESA (Altnix).";
            } else if (!skipCli && !rects.cliente) {
                currentDrawingFor = 'cliente';
                instructionText.textContent = "2/2: Desenhe área do CLIENTE.";
            } else {
                currentDrawingFor = 'done';
                instructionText.textContent = "Áreas definidas. Pode gerar o link.";
            }
        }
    }
    
    async function renderPdfPreview() {
        if (!pdfDoc || !pdfPreviewWrapper) return;
        pdfPreviewWrapper.innerHTML = ''; pageDimensions = [];
        const cw = pdfPreviewWrapper.clientWidth; 
        if (cw === 0) { setTimeout(renderPdfPreview, 100); return; }
        
        const cv = document.createElement('canvas'); 
        cv.id = 'pdf-drawing-canvas'; cv.style.position = 'absolute'; cv.style.top = '0'; cv.style.left = '0'; cv.style.zIndex = '10';
        pdfPreviewWrapper.appendChild(cv);

        cv.addEventListener('mousedown', startDrawing);
        cv.addEventListener('mousemove', draw);
        cv.addEventListener('mouseup', stopDrawing);

        let th = 0; const promises = [];
        for (let i = 1; i <= pdfDoc.numPages; i++) {
            promises.push(pdfDoc.getPage(i).then(page => {
                const vp = page.getViewport({ scale: 1.0 });
                const scale = cw / vp.width;
                const svp = page.getViewport({ scale });
                const pcv = document.createElement('canvas');
                pcv.height = Math.round(svp.height); pcv.width = Math.round(svp.width); 
                pcv.style.display = 'block'; pcv.style.backgroundColor = 'white'; 
                pdfPreviewWrapper.insertBefore(pcv, cv); 
                pageDimensions[i - 1] = { num: i, width: vp.width, height: vp.height, scaledWidth: svp.width, scaledHeight: svp.height }; 
                return page.render({ canvasContext: pcv.getContext('2d'), viewport: svp }).promise;
            }));
        }
        await Promise.all(promises);
        th = pageDimensions.reduce((sum, dim) => sum + (dim?.scaledHeight || 0), 0);
        cv.width = cw; cv.height = Math.round(th);
        if(useDefaultAreasCheckbox && useDefaultAreasCheckbox.checked) applyCheckboxLogic();
        updateInstructionText();
    }

    // --- Canvas Events ---
    function getMousePos(c, e) { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left), y: (e.clientY - r.top) }; }
    function startDrawing(e) { 
        if (useDefaultAreasCheckbox?.checked || currentDrawingFor === 'done') return; 
        isDrawing = true; startCoords = getMousePos(e.target, e); 
    }
    function draw(e) { 
        if (!isDrawing) return; 
        const ctx = e.target.getContext('2d'); ctx.clearRect(0,0,e.target.width,e.target.height); redrawAllFixed(ctx); 
        const c = getMousePos(e.target, e); 
        drawRect(ctx, { x: Math.min(startCoords.x,c.x), y: Math.min(startCoords.y,c.y), width: Math.abs(c.x-startCoords.x), height: Math.abs(c.y-startCoords.y) }, currentDrawingFor === 'tecnico' ? 'rgba(255,0,0,0.4)' : 'rgba(0,0,255,0.4)'); 
    }
    function stopDrawing(e) { 
        if (!isDrawing) return; isDrawing = false; 
        const c = getMousePos(e.target, e); 
        const r = { x: Math.min(startCoords.x,c.x), y: Math.min(startCoords.y,c.y), width: Math.abs(c.x-startCoords.x), height: Math.abs(c.y-startCoords.y) }; 
        if (r.width > 10 && r.height > 10) { 
            if (currentDrawingFor === 'tecnico') rects.tecnico = r; else if (currentDrawingFor === 'cliente') rects.cliente = r; 
        } 
        updateNextDrawingStep(); updateInstructionText(); redrawAll(); 
    }
    function redrawAll() { 
        const cv = document.getElementById('pdf-drawing-canvas'); if(cv) { const ctx = cv.getContext('2d'); ctx.clearRect(0,0,cv.width,cv.height); redrawAllFixed(ctx); } 
    }
    function redrawAllFixed(ctx) { 
        if (!skipTecnicoCheckbox?.checked && rects.tecnico) drawRect(ctx, rects.tecnico, 'rgba(255,0,0,0.4)', 'Empresa (Altnix)'); 
        if (!skipClienteCheckbox?.checked && rects.cliente) drawRect(ctx, rects.cliente, 'rgba(0,0,255,0.4)', 'Cliente'); 
    }
    function drawRect(ctx, r, color, l) { 
        ctx.fillStyle = color; ctx.fillRect(r.x, r.y, r.width, r.height); 
        if (l) { ctx.fillStyle = '#fff'; ctx.font = 'bold 12px sans-serif'; ctx.fillText(l, r.x + 5, r.y + 15); } 
    }

    function setUsersFeedback(message, type = 'info') {
        if (!usersFeedback) return;
        const classes = {
            info: 'text-slate-500',
            success: 'text-green-600',
            error: 'text-red-600'
        };
        usersFeedback.className = `text-sm ${classes[type] || classes.info}`;
        usersFeedback.textContent = message || '';
    }

    function clearClientForm() {
        if (clientIdInput) clientIdInput.value = '';
        if (clientNameInput) clientNameInput.value = '';
        if (clientEmailInput) clientEmailInput.value = '';
        if (clientPhoneInput) clientPhoneInput.value = '';
        if (clientDocumentInput) clientDocumentInput.value = '';
        if (clientNotesInput) clientNotesInput.value = '';
    }

    function renderTenantUsers(members, profilesMap) {
        if (!tenantUserList) return;
        if (!members.length) {
            tenantUserList.innerHTML = '<p class="text-sm text-slate-500">Nenhum usuário na empresa.</p>';
            return;
        }

        const currentUserId = adminUserData.id;
        tenantUserList.innerHTML = members.map((member) => {
            const profile = profilesMap.get(member.user_id) || {};
            const memberName = profile.full_name || profile.email || member.user_id;
            const memberEmail = profile.email || '-';
            const statusLabel = member.status === 'active' ? 'Ativo' : (member.status === 'disabled' ? 'Desativado' : member.status);
            const statusClass = member.status === 'active'
                ? 'bg-green-100 text-green-700 border-green-200'
                : 'bg-amber-100 text-amber-700 border-amber-200';
            const isSelf = member.user_id === currentUserId;

            const roleOptions = ['owner', 'admin', 'manager', 'member', 'billing']
                .map((role) => `<option value="${role}" ${member.role === role ? 'selected' : ''}>${TENANT_ROLE_LABEL[role] || role}</option>`)
                .join('');

            return `
                <div class="rounded-lg border border-slate-200 p-3 bg-slate-50/60 space-y-2">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <p class="text-sm font-semibold text-slate-800 break-words">${escapeHtml(memberName)}</p>
                            <p class="text-xs text-slate-500 break-words">${escapeHtml(memberEmail)}</p>
                        </div>
                        <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${statusClass}">${statusLabel}</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <select data-member-role-select="${member.id}" class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs">
                            ${roleOptions}
                        </select>
                        <button data-member-role-save="${member.id}" class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">
                            Salvar Perfil
                        </button>
                        ${isSelf ? '<span class="text-xs text-slate-500">Seu usuário</span>' : `
                            <button data-member-toggle-status="${member.id}" data-next-status="${member.status === 'active' ? 'disabled' : 'active'}" class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">
                                ${member.status === 'active' ? 'Desativar' : 'Ativar'}
                            </button>
                        `}
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderTenantInvites(invites) {
        if (!tenantInviteList) return;
        const pending = invites.filter((invite) => invite.status === 'pending');
        if (!pending.length) {
            tenantInviteList.innerHTML = '<p class="text-sm text-slate-500">Nenhum convite pendente.</p>';
            return;
        }
        tenantInviteList.innerHTML = pending.map((invite) => `
            <div class="rounded-lg border border-slate-200 p-3 bg-slate-50/50 flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="text-sm font-medium text-slate-800 break-words">${escapeHtml(invite.email)}</p>
                    <p class="text-xs text-slate-500">
                        ${TENANT_ROLE_LABEL[invite.role] || invite.role} · expira em ${formatDateTime(invite.expires_at)}
                    </p>
                </div>
                <button data-revoke-invite="${invite.id}" class="text-xs text-red-600 hover:underline shrink-0">Revogar</button>
            </div>
        `).join('');
    }

    function renderTenantClients(clients) {
        if (!tenantClientList) return;
        if (!clients.length) {
            tenantClientList.innerHTML = '<p class="col-span-full text-sm text-slate-500">Nenhum cliente cadastrado.</p>';
            return;
        }
        tenantClientList.innerHTML = clients.map((client) => `
            <div class="rounded-lg border border-slate-200 bg-slate-50/60 p-3 space-y-2">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <p class="text-sm font-semibold text-slate-800 break-words">${escapeHtml(client.display_name)}</p>
                        <p class="text-xs text-slate-500 break-words">${escapeHtml(client.email || 'Sem e-mail')}</p>
                    </div>
                    <span class="inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${client.status === 'active' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200'}">
                        ${client.status === 'active' ? 'Ativo' : 'Inativo'}
                    </span>
                </div>
                <div class="text-xs text-slate-600 space-y-0.5">
                    <p>WhatsApp: ${escapeHtml(client.phone || '-')}</p>
                    <p>Documento: ${escapeHtml(client.document_id || '-')}</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button data-edit-client="${client.id}" class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">Editar</button>
                    <button data-toggle-client="${client.id}" data-next-status="${client.status === 'active' ? 'inactive' : 'active'}" class="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs hover:bg-slate-100">
                        ${client.status === 'active' ? 'Inativar' : 'Ativar'}
                    </button>
                </div>
            </div>
        `).join('');
    }

    async function bootstrapWorkspaceContext() {
        try {
            try {
                await db.upsertMyUserProfile({});
            } catch (profileError) {
                console.warn('Workspace profile (non-blocking):', profileError);
            }

            try {
                await db.acceptPendingInvites();
            } catch (inviteError) {
                console.warn('Workspace invites (non-blocking):', inviteError);
            }

            try {
                await db.ensureTenantWorkspace(null);
            } catch (ensureError) {
                console.warn('Workspace ensure (non-blocking):', ensureError);
            }
            workspaceContext = await db.getMyWorkspace();

            if (!workspaceContext?.tenantId) {
                const currentEmail = String(adminUserData.email || '').toLowerCase();
                if (currentEmail === MASTER_ADMIN_EMAIL) {
                    workspaceContext = {
                        tenantId: null,
                        role: 'owner',
                        tenantName: 'NixSign (Modo Legado)'
                    };
                    updateLoggedUserLabel('Proprietário');
                    return true;
                }
                throw new Error('Usuário sem vínculo de acesso com a empresa.');
            }

            const roleLabel = TENANT_ROLE_LABEL[workspaceContext.role] || workspaceContext.role || 'Membro';
            updateLoggedUserLabel(roleLabel);
            return true;
        } catch (error) {
            console.error('Workspace:', error);
            const errorMsg = String(error?.message || '').toLowerCase();
            const schemaMissing =
                errorMsg.includes('could not find the table') ||
                errorMsg.includes('relation') ||
                errorMsg.includes('user_profiles') ||
                errorMsg.includes('tenant_');

            if (schemaMissing) {
                const currentEmail = String(adminUserData.email || '').toLowerCase();
                if (currentEmail === MASTER_ADMIN_EMAIL) {
                    workspaceContext = {
                        tenantId: null,
                        role: 'owner',
                        tenantName: 'NixSign (Modo Legado)'
                    };
                    updateLoggedUserLabel('Proprietário');
                    return true;
                }
            }

            showFeedbackGlobal('Acesso não autorizado para este usuário.', 'error');
            try { await db.supabase.auth.signOut(); } catch (_) {}
            setTimeout(() => { window.location.href = 'index.html'; }, 900);
            return false;
        }
    }

    async function carregarGestaoUsuarios() {
        if (!workspaceContext?.tenantId) {
            setUsersFeedback('Gestão de usuários/clientes será habilitada após rodar os SQLs de tenant no banco.', 'info');
            if (tenantUserList) tenantUserList.innerHTML = '<p class="text-sm text-slate-500">Disponível após estruturar tenant_members/user_profiles.</p>';
            if (tenantInviteList) tenantInviteList.innerHTML = '<p class="text-sm text-slate-500">Disponível após estruturar tenant_invites.</p>';
            if (tenantClientList) tenantClientList.innerHTML = '<p class="col-span-full text-sm text-slate-500">Disponível após estruturar tenant_clients.</p>';
            return;
        }

        setUsersFeedback('Carregando usuários e clientes...', 'info');
        if (tenantUserList) tenantUserList.innerHTML = '<p class="text-sm text-slate-500">Carregando membros...</p>';
        if (tenantInviteList) tenantInviteList.innerHTML = '<p class="text-sm text-slate-500">Carregando convites...</p>';
        if (tenantClientList) tenantClientList.innerHTML = '<p class="col-span-full text-sm text-slate-500">Carregando clientes...</p>';

        try {
            const [members, invites, clients] = await Promise.all([
                db.listTenantMembers(workspaceContext.tenantId),
                db.listTenantInvites(workspaceContext.tenantId),
                db.listTenantClients(workspaceContext.tenantId),
            ]);

            usersDataCache = members || [];
            invitesDataCache = invites || [];
            clientsDataCache = clients || [];

            const profileIds = [...new Set(usersDataCache.map((member) => member.user_id).filter(Boolean))];
            const profiles = await db.listUserProfiles(profileIds);
            const profilesMap = new Map((profiles || []).map((profile) => [profile.user_id, profile]));

            renderTenantUsers(usersDataCache, profilesMap);
            renderTenantInvites(invitesDataCache);
            renderTenantClients(clientsDataCache);
            setUsersFeedback(`Usuários: ${usersDataCache.length} · Convites pendentes: ${invitesDataCache.filter((invite) => invite.status === 'pending').length} · Clientes: ${clientsDataCache.length}`, 'success');
        } catch (error) {
            console.error('Gestão usuários:', error);
            setUsersFeedback(`Erro ao carregar gestão de usuários: ${error.message}`, 'error');
            if (tenantUserList) tenantUserList.innerHTML = '<p class="text-sm text-red-600">Falha ao carregar membros.</p>';
        }
    }

    async function abrirGestaoUsuarios() {
        if(uploadInitialView) uploadInitialView.style.display = 'none';
        if(workspacePanel) workspacePanel.classList.remove('hidden');
        if(preparationView) preparationView.classList.add('hidden');
        if(consultationView) consultationView.classList.add('hidden');
        if(usersView) usersView.classList.remove('hidden');
        setTopTab('usuarios');
        await carregarGestaoUsuarios();
    }

    async function carregarDocumentos() {
        if(listLoadingFeedback) listLoadingFeedback.style.display = 'block'; 
        if(documentList) documentList.innerHTML = '';
        if(prevPageBtn) prevPageBtn.disabled = true; 
        if(nextPageBtn) nextPageBtn.disabled = true; 
        if(pageInfo) pageInfo.textContent = 'Carregando...';
        try {
            const { data, error, count } = await db.getDocuments(currentPage, ITENS_PER_PAGE, currentStatusFilter, currentSearchTerm);
            if (error) throw error;
            allDocumentsData = data || []; totalDocuments = count || 0;
            renderizarLista(allDocumentsData); atualizarControlesPaginacao();
        } catch (error) {
            if(documentList) documentList.innerHTML = `<p class="col-span-full text-center text-red-500 py-8">Erro ao carregar documentos: ${error.message}</p>`;
            if(pageInfo) pageInfo.textContent = 'Erro';
        } finally { if(listLoadingFeedback) listLoadingFeedback.style.display = 'none'; }
    }

    function renderizarLista(docs) {
        if(!documentList) return;
        documentList.innerHTML = '';
        if (!docs || docs.length === 0) { documentList.innerHTML = '<p class="col-span-full text-center text-gray-500 py-8">Nenhum documento encontrado.</p>'; return; }
        docs.forEach(doc => {
            const card = document.createElement('div'); card.className = 'border rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col gap-3 h-full';
            const dataEnvio = doc.created_at ? new Date(doc.created_at).toLocaleDateString('pt-BR') : 'Data indisponível';
            let nomeArquivoOriginal = 'Nome indisponível';
            if (doc.caminho_arquivo_storage) { const parts = doc.caminho_arquivo_storage.split('-'); nomeArquivoOriginal = parts.length > 1 ? parts.slice(1).join('-') : doc.caminho_arquivo_storage; }
            
            let statusHtml = '', actionsHtml = '';
            if (doc.status === 'assinado') {
                statusHtml = `<span class="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-800 ws-nowrap">Assinado ✅</span>`;
                actionsHtml = `<button class="download-btn text-sm text-blue-600 hover:underline ws-nowrap" data-path="${doc.caminho_arquivo_storage}" title="Original">Original</button> ${doc.caminho_arquivo_assinado ? `<button class="download-btn text-sm text-green-600 hover:underline ws-nowrap" data-path="${doc.caminho_arquivo_assinado}" title="Assinado">Baixar Assinado</button>` : '<span class="text-xs text-gray-400">Ass. s/ PDF</span>'}`;
            } else {
                statusHtml = `<span class="text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 ws-nowrap">Pendente de Assinatura ⏳</span>`;
                actionsHtml = `<button class="download-btn text-sm text-blue-600 hover:underline ws-nowrap" data-path="${doc.caminho_arquivo_storage}" title="Original">Original</button> <button class="copy-link-btn text-sm text-purple-600 hover:underline ws-nowrap" data-doc-id="${doc.id}" title="Copiar link">Copiar Link</button>`;
            }
            actionsHtml += ` <button class="excluir-btn text-sm text-red-600 hover:underline ws-nowrap" data-doc-id="${doc.id}" title="Excluir">Excluir</button>`;
            
            const tipoDocLabel = doc.tipo_documento === 'contrato' ? 'Contrato' : (doc.tipo_documento === 'proposta_pedido' ? 'Proposta/Pedido' : (doc.tipo_documento === 'pedido' ? 'Pedido' : (doc.tipo_documento === 'proposta' ? 'Proposta' : 'O.S.')));
            const numeroExibido = doc.n_os && doc.n_os !== 'S/N' ? doc.n_os : '';

            card.innerHTML = `<div class="min-w-0"><p class="font-semibold text-gray-800 break-words">${nomeArquivoOriginal}</p><p class="text-sm text-gray-500 truncate mt-1">${doc.nome_cliente || 'Cliente N/A'}</p><div class="flex gap-2 mt-1"><span class="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">${tipoDocLabel} ${numeroExibido}</span></div></div><div class="flex flex-col gap-1"><div class="flex flex-wrap gap-2">${statusHtml}</div><div class="flex flex-wrap gap-x-3 gap-y-1">${actionsHtml}</div><span class="text-xs text-gray-500 ws-nowrap">Enviado: ${dataEnvio}</span></div>`;
            documentList.appendChild(card);
        });
    }

    function abrirExclusaoModal(docId) {
        docIdParaExcluir = docId; 
        if(deleteCheckbox) deleteCheckbox.checked = false; 
        if(confirmDeleteBtn) { confirmDeleteBtn.disabled = true; confirmDeleteBtn.classList.add('btn-disabled'); }
        if(deleteConfirmModal) deleteConfirmModal.classList.add('active');
    }

    async function executarExclusao() {
        if (!docIdParaExcluir || !deleteCheckbox.checked) return;
        if(confirmDeleteBtn) { confirmDeleteBtn.disabled = true; confirmDeleteBtn.textContent = 'Excluindo...'; }
        try {
            await db.deleteDocument(docIdParaExcluir); 
            fecharModalExclusao(); 
            await carregarDocumentos(); 
            showFeedbackGlobal('Excluído.', 'success');
        } catch (error) {
            alert(`Erro excluir: ${error.message}`); fecharModalExclusao();
        } finally {
            if(confirmDeleteBtn) { confirmDeleteBtn.textContent = 'Confirmar Exclusão'; }
        }
    }

    function fecharModalExclusao() {
        docIdParaExcluir = null; 
        if(deleteCheckbox) deleteCheckbox.checked = false; 
        if(confirmDeleteBtn) { confirmDeleteBtn.disabled = true; confirmDeleteBtn.classList.add('btn-disabled'); }
        if(deleteConfirmModal) deleteConfirmModal.classList.remove('active');
    }

    function atualizarControlesPaginacao() {
        if(!pageInfo) return;
        const totalPages = Math.ceil(totalDocuments / ITENS_PER_PAGE); const currentPageDisplay = totalDocuments > 0 ? currentPage + 1 : 0; const totalPagesDisplay = totalPages > 0 ? totalPages : 0;
        pageInfo.textContent = `Pág ${currentPageDisplay}/${totalPagesDisplay} (${totalDocuments} doc${totalDocuments !== 1 ? 's' : ''})`;
        if(prevPageBtn) { prevPageBtn.disabled = currentPage === 0; prevPageBtn.classList.toggle('btn-disabled', currentPage === 0); }
        if(nextPageBtn) { nextPageBtn.disabled = currentPage + 1 >= totalPages; nextPageBtn.classList.toggle('btn-disabled', currentPage + 1 >= totalPages); }
    }

    // --- LISTENERS ---
    if(cancelPreparationBtn) cancelPreparationBtn.addEventListener('click', resetPreparationView);
    if(resetDrawingBtn) resetDrawingBtn.addEventListener('click', resetCanvas);
    
    if(skipTecnicoCheckbox) skipTecnicoCheckbox.addEventListener('change', applyCheckboxLogic);
    if(skipClienteCheckbox) skipClienteCheckbox.addEventListener('change', applyCheckboxLogic);
    if(useDefaultAreasCheckbox) useDefaultAreasCheckbox.addEventListener('change', applyCheckboxLogic);
    document.querySelectorAll('input[name="tipo_documento"]').forEach((inputEl) => {
        inputEl.addEventListener('change', () => {
            if (useDefaultAreasCheckbox?.checked) {
                calculateAndApplyDefaultRects();
                updateInstructionText();
                redrawAll();
            }
        });
    });
    
    if (btnCopiarLink && linkInput) {
        btnCopiarLink.addEventListener('click', () => {
            if (!linkInput.value) return;
            navigator.clipboard.writeText(linkInput.value).then(() => {
                const originalText = btnCopiarLink.textContent;
                btnCopiarLink.textContent = 'Copiado!';
                setTimeout(() => { btnCopiarLink.textContent = originalText; }, 2000);
                showFeedbackGlobal('Link copiado!', 'success', 2000);
            }).catch(err => {
                console.error('Erro copiar:', err);
                showFeedbackGlobal('Erro ao copiar.', 'error');
            });
        });
    }
    
    // Inicialização de Arquivo
    if (osFileInput) {
        osFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    console.log("Adicionando espaço ao PDF...");
                    const newFile = await addWhitespaceToPdf(file);
                    currentFile = newFile;
                    await preparePdfAndData(newFile);
                    if (pickPdfBtn) {
                        pickPdfBtn.classList.remove('is-loaded');
                        void pickPdfBtn.offsetWidth;
                        pickPdfBtn.classList.add('is-loaded');
                        setTimeout(() => pickPdfBtn.classList.remove('is-loaded'), 700);
                    }
                } catch (err) {
                    console.error(err);
                    showFeedback("Erro ao processar PDF.", "error");
                }
            }
        });
    }
    if (pickPdfBtn && osFileInput) {
        pickPdfBtn.addEventListener('click', () => osFileInput.click());
    }

    // Upload Submit
    if(uploadForm) {
        uploadForm.addEventListener('submit', async (event) => {
            event.preventDefault(); 
            setLoading(true);
            
            if (!currentFile) { showFeedback("Nenhum PDF.", "error"); setLoading(false); return; }
            
            // Valida Tipo
            const selectedTypeRadio = document.querySelector('input[name="tipo_documento"]:checked');
            let tipoDocumento = selectedTypeRadio ? selectedTypeRadio.value : 'os';
            if (tipoDocumento === 'proposta_pedido') {
                if (localExtractedData.isPedido) tipoDocumento = 'pedido';
                else if (localExtractedData.isProposta) tipoDocumento = 'proposta';
                else tipoDocumento = 'proposta_pedido'; 
            }
            
            // Valida Desenho
            const skipTec = skipTecnicoCheckbox ? skipTecnicoCheckbox.checked : false;
            const skipCli = skipClienteCheckbox ? skipClienteCheckbox.checked : false;
            
            if (useDefaultAreasCheckbox.checked) calculateAndApplyDefaultRects();

            if (!skipTec && !rects.tecnico) { showFeedback("Defina a área da EMPRESA (Altnix).", "error"); setLoading(false); return; }
            if (!skipCli && !rects.cliente) { showFeedback("Defina a área do CLIENTE.", "error"); setLoading(false); return; }

            try {
                let finalStoragePath = currentStoragePath;
                if (currentFile && !finalStoragePath) {
                    const fileName = `${Date.now()}-${sanitizarNomeArquivo(currentFile.name)}`;
                    const uploadData = await db.uploadFile(fileName, currentFile); 
                    finalStoragePath = uploadData.path;
                }

                const convert = (r) => {
                    if (!r || pageDimensions.length === 0) return null;
                    let acc = 0, idx = 0;
                    for(let i=0; i<pageDimensions.length; i++) {
                        if(r.y >= acc && r.y < acc + pageDimensions[i].scaledHeight) { idx = i; break; }
                        acc += pageDimensions[i].scaledHeight;
                    }
                    const d = pageDimensions[idx];
                    const sy = d.height / d.scaledHeight;
                    return { 
                        page: idx + 1, 
                        x: r.x * (d.width/d.scaledWidth), 
                        y: d.height - (r.y - acc)*sy - (r.height*sy), 
                        width: r.width*(d.width/d.scaledWidth), 
                        height: r.height*sy 
                    };
                };

                const tecCoords = !skipTec ? convert(rects.tecnico) : null;
                const cliCoords = !skipCli ? convert(rects.cliente) : null;

                let n_os = localExtractedData?.n_os;
                if (tipoDocumento === 'contrato') {
                    const seq = await db.getNextContractNumber();
                    n_os = `Contrato ${seq}`;
                } else {
                    if (!n_os || String(n_os).startsWith('52')) n_os = 'S/N';
                }

                const record = {
                    caminho_arquivo_storage: finalStoragePath,
                    nome_cliente: clienteNomeInput?.value || 'Cliente',
                    telefone_cliente: clienteTelefoneInput?.value || null,
                    cliente_email: clienteEmailInput?.value || null,
                    n_os: n_os,
                    status_os: 'Pendente',
                    tecnico_assinatura_coords: tecCoords,
                    cliente_assinatura_coords: cliCoords,
                    admin_id: adminUserData.id,
                    admin_email: adminUserData.email,
                    tenant_id: workspaceContext?.tenantId || null,
                    tipo_documento: tipoDocumento,
                    site_base_url: SITE_BASE_URL
                };

                const insertData = await db.saveDocumentData(record);
                const link = insertData.link_assinatura || `${SITE_BASE_URL}/assinar.html?id=${insertData.id}`;
                
                if(linkInput) linkInput.value = link;
                if (!insertData.link_assinatura) {
                    await db.updateDocumentLink(insertData.id, link);
                }
                
                if(actionsContainer) actionsContainer.classList.remove('hidden');
                if(whatsappContainer) whatsappContainer.style.display = clienteTelefoneInput?.value ? 'block' : 'none';
                
                showFeedback(`Sucesso! ${n_os}`, 'success');

            } catch (err) { 
                console.error('Erro submit:', err); 
                const errMsg = String(err?.message || err || '');
                if (errMsg.toLowerCase().includes('edge function') || errMsg.toLowerCase().includes('failed to send a request')) {
                    showFeedback('Falha na função segura de criação. Em produção, faça deploy da edge function "criar-documento-seguro".', 'error');
                } else {
                    showFeedback(`Erro: ${errMsg}`, 'error');
                }
            } finally { setLoading(false); }
        });
    }
    
    // Navegação Consulta
    if(navToNewBtn) navToNewBtn.addEventListener('click', resetPreparationView);
    if(navToConsultBtn) navToConsultBtn.addEventListener('click', () => {
        if(uploadInitialView) uploadInitialView.style.display = 'none';
        if(workspacePanel) workspacePanel.classList.remove('hidden');
        if(preparationView) preparationView.classList.add('hidden');
        if(consultationView) consultationView.classList.remove('hidden');
        if(usersView) usersView.classList.add('hidden');
        setTopTab('consulta');
        carregarDocumentos();
    });

    const showConsultation = document.getElementById('show-consultation-btn');
    const backToInit = document.getElementById('back-to-initial-view-btn');
    if(showConsultation) showConsultation.addEventListener('click', () => {
        if(uploadInitialView) uploadInitialView.style.display = 'none';
        if(workspacePanel) workspacePanel.classList.remove('hidden');
        if(preparationView) preparationView.classList.add('hidden');
        if(consultationView) consultationView.classList.remove('hidden');
        if(usersView) usersView.classList.add('hidden');
        setTopTab('consulta');
        carregarDocumentos();
    });
    if(showUsersBtn) showUsersBtn.addEventListener('click', () => {
        abrirGestaoUsuarios();
    });
    if(backToInit) backToInit.addEventListener('click', resetPreparationView);
    
    if(refreshListBtn) refreshListBtn.addEventListener('click', carregarDocumentos);
    if(refreshUsersBtn) refreshUsersBtn.addEventListener('click', carregarGestaoUsuarios);
    
    if(statusFilterButtons) {
        statusFilterButtons.addEventListener('click', (e) => { 
            if (!(e.target instanceof Element)) return;
            const targetButton = e.target.closest('button'); 
            if (targetButton && targetButton.dataset.status) { 
                currentPage = 0; 
                currentStatusFilter = targetButton.dataset.status; 
                statusFilterButtons.querySelectorAll('button').forEach(b => { 
                    b.className = "px-4 py-2 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 text-sm font-medium";
                }); 
                targetButton.className = "px-4 py-2 bg-blue-600 text-white border border-blue-600 rounded-md text-sm font-medium";
                carregarDocumentos(); 
            } 
        });
    }
    
    if(searchInput) searchInput.addEventListener('input', () => { 
        clearTimeout(debounceTimer); 
        debounceTimer = setTimeout(() => { 
            currentPage = 0; 
            currentSearchTerm = searchInput.value.trim(); 
            carregarDocumentos(); 
        }, 500); 
    });
    if(prevPageBtn) prevPageBtn.addEventListener('click', () => { if (currentPage > 0) { currentPage--; carregarDocumentos(); } });
    if(nextPageBtn) nextPageBtn.addEventListener('click', () => { const totalPages = Math.ceil(totalDocuments / ITENS_PER_PAGE); if (currentPage + 1 < totalPages) { currentPage++; carregarDocumentos(); } });

    if(closeModalBtn) closeModalBtn.addEventListener('click', () => detailsModal.classList.remove('active'));
    if(deleteCheckbox) deleteCheckbox.addEventListener('change', () => { 
        if(confirmDeleteBtn) {
            confirmDeleteBtn.disabled = !deleteCheckbox.checked; 
            confirmDeleteBtn.classList.toggle('btn-disabled', !deleteCheckbox.checked); 
        }
    });
    if(cancelDeleteBtn) cancelDeleteBtn.addEventListener('click', fecharModalExclusao);
    if(confirmDeleteBtn) confirmDeleteBtn.addEventListener('click', executarExclusao);

    if(documentList) {
        documentList.addEventListener('click', async (e) => { 
            if (!(e.target instanceof Element)) return;
            const target = e.target; 
            if (target.classList.contains('download-btn') && target.dataset.path) { 
                try { 
                    const url = db.getPublicUrl(target.dataset.path); 
                    window.open(url, '_blank'); 
                } catch (err) { showFeedbackGlobal("Erro link.", "error"); } 
            } else if (target.classList.contains('copy-link-btn') && target.dataset.docId) { 
                const id = target.dataset.docId; 
                const link = `${SITE_BASE_URL}/assinar.html?id=${id}`; 
                navigator.clipboard.writeText(link).then(() => { 
                    target.textContent = 'Copiado!'; 
                    setTimeout(() => { target.textContent = 'Copiar Link'; }, 2000); 
                    showFeedbackGlobal('Link copiado!', 'success', 2000); 
                }); 
            } else if (target.classList.contains('excluir-btn') && target.dataset.docId) { 
                abrirExclusaoModal(target.dataset.docId); 
            } 
        });
    }

    if (inviteUserForm) {
        inviteUserForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!workspaceContext?.tenantId) {
                setUsersFeedback('Workspace não identificado.', 'error');
                return;
            }

            try {
                const email = String(inviteEmailInput?.value || '').trim().toLowerCase();
                const invitedName = String(inviteNameInput?.value || '').trim();
                const role = String(inviteRoleSelect?.value || 'member');
                if (!email) throw new Error('Informe um e-mail válido.');

                await db.createTenantInvite({
                    tenantId: workspaceContext.tenantId,
                    email,
                    invitedName: invitedName || null,
                    role
                });

                if (inviteUserForm) inviteUserForm.reset();
                setUsersFeedback('Convite gerado com sucesso.', 'success');
                await carregarGestaoUsuarios();
            } catch (error) {
                setUsersFeedback(`Erro ao criar convite: ${error.message}`, 'error');
            }
        });
    }

    if (tenantUserList) {
        tenantUserList.addEventListener('click', async (event) => {
            if (!(event.target instanceof Element)) return;
            const target = event.target;
            const roleSaveBtn = target.closest('[data-member-role-save]');
            const toggleStatusBtn = target.closest('[data-member-toggle-status]');

            try {
                if (roleSaveBtn) {
                    const memberId = roleSaveBtn.getAttribute('data-member-role-save');
                    if (!memberId) return;
                    const roleSelect = tenantUserList.querySelector(`[data-member-role-select="${memberId}"]`);
                    const newRole = roleSelect ? roleSelect.value : null;
                    if (!newRole) return;
                    await db.updateTenantMember(memberId, { role: newRole });
                    setUsersFeedback('Perfil atualizado.', 'success');
                    await carregarGestaoUsuarios();
                    return;
                }

                if (toggleStatusBtn) {
                    const memberId = toggleStatusBtn.getAttribute('data-member-toggle-status');
                    const nextStatus = String(toggleStatusBtn.getAttribute('data-next-status') || '');
                    if (!memberId || !nextStatus) return;
                    await db.updateTenantMember(memberId, { status: nextStatus });
                    setUsersFeedback('Status do usuário atualizado.', 'success');
                    await carregarGestaoUsuarios();
                }
            } catch (error) {
                setUsersFeedback(`Erro ao atualizar usuário: ${error.message}`, 'error');
            }
        });
    }

    if (tenantInviteList) {
        tenantInviteList.addEventListener('click', async (event) => {
            if (!(event.target instanceof Element)) return;
            const revokeBtn = event.target.closest('[data-revoke-invite]');
            if (!revokeBtn) return;
            const inviteId = revokeBtn.getAttribute('data-revoke-invite');
            if (!inviteId) return;
            try {
                await db.revokeTenantInvite(inviteId);
                setUsersFeedback('Convite revogado.', 'success');
                await carregarGestaoUsuarios();
            } catch (error) {
                setUsersFeedback(`Erro ao revogar convite: ${error.message}`, 'error');
            }
        });
    }

    if (clientFormResetBtn) {
        clientFormResetBtn.addEventListener('click', clearClientForm);
    }

    if (clientForm) {
        clientForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (!workspaceContext?.tenantId) {
                setUsersFeedback('Workspace não identificado.', 'error');
                return;
            }

            try {
                const payload = {
                    id: clientIdInput?.value || null,
                    tenant_id: workspaceContext.tenantId,
                    display_name: String(clientNameInput?.value || '').trim(),
                    email: String(clientEmailInput?.value || '').trim().toLowerCase() || null,
                    phone: String(clientPhoneInput?.value || '').trim() || null,
                    document_id: String(clientDocumentInput?.value || '').trim() || null,
                    notes: String(clientNotesInput?.value || '').trim() || null,
                    created_by: adminUserData.id || null,
                    status: 'active'
                };

                if (!payload.display_name) throw new Error('Nome do cliente é obrigatório.');

                await db.upsertTenantClient(payload);
                clearClientForm();
                setUsersFeedback('Cliente salvo com sucesso.', 'success');
                await carregarGestaoUsuarios();
            } catch (error) {
                setUsersFeedback(`Erro ao salvar cliente: ${error.message}`, 'error');
            }
        });
    }

    if (tenantClientList) {
        tenantClientList.addEventListener('click', async (event) => {
            if (!(event.target instanceof Element)) return;
            const editBtn = event.target.closest('[data-edit-client]');
            const toggleBtn = event.target.closest('[data-toggle-client]');

            if (editBtn) {
                const clientId = editBtn.getAttribute('data-edit-client');
                const client = clientsDataCache.find((item) => item.id === clientId);
                if (!client) return;
                if (clientIdInput) clientIdInput.value = client.id;
                if (clientNameInput) clientNameInput.value = client.display_name || '';
                if (clientEmailInput) clientEmailInput.value = client.email || '';
                if (clientPhoneInput) clientPhoneInput.value = client.phone || '';
                if (clientDocumentInput) clientDocumentInput.value = client.document_id || '';
                if (clientNotesInput) clientNotesInput.value = client.notes || '';
                setUsersFeedback('Cliente carregado para edição.', 'info');
                return;
            }

            if (toggleBtn) {
                const clientId = toggleBtn.getAttribute('data-toggle-client');
                const nextStatus = toggleBtn.getAttribute('data-next-status');
                if (!clientId || !nextStatus) return;

                try {
                    await db.setTenantClientStatus(clientId, nextStatus);
                    setUsersFeedback('Status do cliente atualizado.', 'success');
                    await carregarGestaoUsuarios();
                } catch (error) {
                    setUsersFeedback(`Erro ao atualizar cliente: ${error.message}`, 'error');
                }
            }
        });
    }

    if (accountPasswordForm) {
        accountPasswordForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            try {
                const newPassword = String(accountNewPasswordInput?.value || '');
                const newPasswordConfirm = String(accountNewPasswordConfirmInput?.value || '');

                if (newPassword.length < 6) {
                    throw new Error('A nova senha deve ter ao menos 6 caracteres.');
                }
                if (newPassword !== newPasswordConfirm) {
                    throw new Error('As senhas não conferem.');
                }

                const { error } = await db.supabase.auth.updateUser({ password: newPassword });
                if (error) throw error;

                if (accountNewPasswordInput) accountNewPasswordInput.value = '';
                if (accountNewPasswordConfirmInput) accountNewPasswordConfirmInput.value = '';
                setUsersFeedback('Senha atualizada com sucesso.', 'success');
            } catch (error) {
                setUsersFeedback(`Erro ao atualizar senha: ${error.message}`, 'error');
            }
        });
    }

    if (topLogoutBtn) {
        topLogoutBtn.addEventListener('click', async () => {
            try {
                await db.supabase.auth.signOut();
            } catch (_) {
                // no-op: seguimos para a tela de login mesmo em falha de rede local.
            }
            window.location.href = 'index.html';
        });
    }

    const workspaceReady = await bootstrapWorkspaceContext();
    if (!workspaceReady) return;
    resetPreparationView();
});
