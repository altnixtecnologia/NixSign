// js/admin.js
// VERSÃO FINAL CORRIGIDA

import { SITE_BASE_URL, ITENS_PER_PAGE } from './config.js';
import * as db from './supabaseService.js';
import { extractDataFromPdf } from './pdfHandler.js';

// --- CONSTANTES ---
const DEFAULT_RECTS_PERCENT = {
    tecnico: { x: 0.05, y: 0.79, width: 0.35, height: 0.07 },
    cliente: { x: 0.50, y: 0.72, width: 0.45, height: 0.12 }
};

// --- ESTADO GLOBAL ---
let adminUserData = { id: null, email: null }; 

// --- FUNÇÕES UTILITÁRIAS ---
async function getMyIp() {
    try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
    } catch (e) { return "IP não identificado"; }
}

function formatPhoneNumber(phone) {
    if (!phone) return ''; const digits = phone.replace(/\D/g, '');
    if (digits.length === 11) { return `(${digits.substring(0, 2)}) ${digits.substring(2, 7)}-${digits.substring(7)}`; }
    else if (digits.length === 10) { return `(${digits.substring(0, 2)}) ${digits.substring(2, 6)}-${digits.substring(6)}`; }
    else { return phone; }
}

function sanitizarNomeArquivo(nome) {
    if (!nome) return 'doc-s-nome'; const a = 'àáâãäåæçèéêëìíîïðñòóôõöøùúûüýþßŕ'; const b = 'aaaaaaaceeeeiiiionoooooouuuuybsr'; let n = nome.toLowerCase();
    for (let i = 0; i < a.length; i++) { n = n.replace(new RegExp(a.charAt(i), 'g'), b.charAt(i)); }
    return n.replace(/[^a-z0-9.\-_]/g, '-').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
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
        }
    } catch(err) { console.error("Auth:", err.message); }
    
    // --- DECLARAÇÃO DE TODOS OS ELEMENTOS ---
    const osFileInput = document.getElementById('os-file');
    const uploadInitialView = document.getElementById('initial-view');
    const showConsultationBtn = document.getElementById('show-consultation-btn');
    const preparationView = document.getElementById('preparation-view');
    const cancelPreparationBtn = document.getElementById('cancel-preparation-btn');
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
    }

    function resetPreparationView() {
        if(uploadInitialView) uploadInitialView.style.display = 'block';
        if(preparationView) preparationView.classList.add('hidden');
        if(consultationView) consultationView.classList.add('hidden');
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

            if(clienteNomeInput) clienteNomeInput.value = localExtractedData?.nome || ''; 
            if(clienteTelefoneInput) clienteTelefoneInput.value = formatPhoneNumber(localExtractedData?.telefone || ''); 
            if(clienteEmailInput) clienteEmailInput.value = localExtractedData?.email || ''; 

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
        rects.tecnico = { x: Math.round(cv.width * DEFAULT_RECTS_PERCENT.tecnico.x), y: Math.round(cv.height * DEFAULT_RECTS_PERCENT.tecnico.y), width: Math.round(cv.width * DEFAULT_RECTS_PERCENT.tecnico.width), height: Math.round(cv.height * DEFAULT_RECTS_PERCENT.tecnico.height) };
        rects.cliente = { x: Math.round(cv.width * DEFAULT_RECTS_PERCENT.cliente.x), y: Math.round(cv.height * DEFAULT_RECTS_PERCENT.cliente.y), width: Math.round(cv.width * DEFAULT_RECTS_PERCENT.cliente.width), height: Math.round(cv.height * DEFAULT_RECTS_PERCENT.cliente.height) };
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
            if(documentList) documentList.innerHTML = `<p class="text-center text-red-500 py-8">Erro ao carregar documentos: ${error.message}</p>`;
            if(pageInfo) pageInfo.textContent = 'Erro';
        } finally { if(listLoadingFeedback) listLoadingFeedback.style.display = 'none'; }
    }

    function renderizarLista(docs) {
        if(!documentList) return;
        documentList.innerHTML = '';
        if (!docs || docs.length === 0) { documentList.innerHTML = '<p class="text-center text-gray-500 py-8">Nenhum documento encontrado.</p>'; return; }
        docs.forEach(doc => {
            const card = document.createElement('div'); card.className = 'border rounded-lg p-4 bg-gray-50 shadow-sm flex flex-col sm:flex-row justify-between items-start gap-4';
            const dataEnvio = doc.created_at ? new Date(doc.created_at).toLocaleDateString('pt-BR') : 'Data indisponível';
            let nomeArquivoOriginal = 'Nome indisponível';
            if (doc.caminho_arquivo_storage) { const parts = doc.caminho_arquivo_storage.split('-'); nomeArquivoOriginal = parts.length > 1 ? parts.slice(1).join('-') : doc.caminho_arquivo_storage; }
            
            let statusHtml = '', actionsHtml = '';
            if (doc.status === 'assinado') {
                statusHtml = `<span class="text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-800 ws-nowrap">Assinado ✅</span>`;
                actionsHtml = `<button class="download-btn text-sm text-blue-600 hover:underline ws-nowrap" data-path="${doc.caminho_arquivo_storage}" title="Original">Original</button> ${doc.caminho_arquivo_assinado ? `<button class="download-btn text-sm text-green-600 hover:underline ws-nowrap" data-path="${doc.caminho_arquivo_assinado}" title="Assinado">Baixar Assinado</button>` : '<span class="text-xs text-gray-400">Ass. s/ PDF</span>'}`;
            } else {
                statusHtml = `<span class="text-xs font-medium px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800 ws-nowrap">Pendente ⏳</span>`;
                actionsHtml = `<button class="download-btn text-sm text-blue-600 hover:underline ws-nowrap" data-path="${doc.caminho_arquivo_storage}" title="Original">Original</button> <button class="copy-link-btn text-sm text-purple-600 hover:underline ws-nowrap" data-doc-id="${doc.id}" title="Copiar link">Copiar Link</button>`;
            }
            actionsHtml += ` <button class="excluir-btn text-sm text-red-600 hover:underline ws-nowrap" data-doc-id="${doc.id}" title="Excluir">Excluir</button>`;
            
            const tipoDocLabel = doc.tipo_documento === 'contrato' ? 'Contrato' : (doc.tipo_documento === 'proposta_pedido' ? 'Proposta/Pedido' : (doc.tipo_documento === 'pedido' ? 'Pedido' : (doc.tipo_documento === 'proposta' ? 'Proposta' : 'O.S.')));
            const numeroExibido = doc.n_os && doc.n_os !== 'S/N' ? doc.n_os : '';

            card.innerHTML = `<div class="flex-grow min-w-0 pr-4"><p class="font-semibold text-gray-800 break-words">${nomeArquivoOriginal}</p><p class="text-sm text-gray-500 truncate mt-1">${doc.nome_cliente || 'Cliente N/A'}</p><div class="flex gap-2 mt-1"><span class="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-100">${tipoDocLabel} ${numeroExibido}</span></div></div><div class="flex-shrink-0 flex flex-col sm:flex-row items-start sm:items-end gap-3"><div class="flex flex-col items-start sm:items-end text-right gap-1">${statusHtml}${doc.status_os ? `<span class="text-xs font-semibold text-blue-800 bg-blue-100 px-2 py-0.5 rounded-full ws-nowrap" title="Status OS">${doc.status_os}</span>` : ''}<span class="text-xs text-gray-500 ws-nowrap">Enviado: ${dataEnvio}</span></div><div class="flex flex-wrap gap-x-3 gap-y-1 justify-start sm:justify-end mt-2 sm:mt-0">${actionsHtml}</div></div>`;
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
                } catch (err) {
                    console.error(err);
                    showFeedback("Erro ao processar PDF.", "error");
                }
            }
        });
    }

    // Upload Submit
    if(uploadForm) {
        uploadForm.addEventListener('submit', async (event) => {
            event.preventDefault(); 
            setLoading(true);
            
            const adminIp = await getMyIp();
            
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
                    tipo_documento: tipoDocumento,
                    admin_ip: adminIp
                };

                const insertData = await db.saveDocumentData(record);
                const link = `${SITE_BASE_URL}/assinar.html?id=${insertData.id}`;
                
                if(linkInput) linkInput.value = link;
                await db.updateDocumentLink(insertData.id, link);
                
                if(actionsContainer) actionsContainer.classList.remove('hidden');
                if(whatsappContainer) whatsappContainer.style.display = clienteTelefoneInput?.value ? 'block' : 'none';
                
                showFeedback(`Sucesso! ${n_os}`, 'success');

            } catch (err) { 
                console.error('Erro submit:', err); 
                showFeedback(`Erro: ${err.message}`, 'error'); 
            } finally { setLoading(false); }
        });
    }
    
    // Navegação Consulta
    if(navToNewBtn) navToNewBtn.addEventListener('click', resetPreparationView);
    if(navToConsultBtn) navToConsultBtn.addEventListener('click', () => {
        if(uploadInitialView) uploadInitialView.style.display = 'none';
        if(preparationView) preparationView.classList.add('hidden');
        if(consultationView) consultationView.classList.remove('hidden');
        setTopTab('consulta');
        carregarDocumentos();
    });

    const showConsultation = document.getElementById('show-consultation-btn');
    const backToInit = document.getElementById('back-to-initial-view-btn');
    if(showConsultation) showConsultation.addEventListener('click', () => {
        if(uploadInitialView) uploadInitialView.style.display = 'none';
        if(preparationView) preparationView.classList.add('hidden');
        if(consultationView) consultationView.classList.remove('hidden');
        setTopTab('consulta');
        carregarDocumentos();
    });
    if(backToInit) backToInit.addEventListener('click', resetPreparationView);
    
    if(refreshListBtn) refreshListBtn.addEventListener('click', carregarDocumentos);
    
    if(statusFilterButtons) {
        statusFilterButtons.addEventListener('click', (e) => { 
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

    setTopTab('novo');
});
