import * as db from './supabaseService.js';
import { setupPdfWorker } from './pdfHandler.js';

setupPdfWorker();

document.addEventListener('DOMContentLoaded', () => {
 	// --- Elementos da UI ---
 	const loadingView = document.getElementById('loading-view');
 	const mainContent = document.getElementById('main-content');
 	const loginStep = document.getElementById('login-step');
 	const signingStep = document.getElementById('signing-step');
 	const successStep = document.getElementById('success-step');
 	const googleLoginBtn = document.getElementById('google-login-btn');
 	const loginError = document.getElementById('login-error');
 	const feedbackContainer = document.getElementById('feedback-container');

 	// --- Elementos do Formulário ---
 	const signatureForm = document.getElementById('signature-form');
 	const userNameInput = document.getElementById('user-name');
 	const userEmailInput = document.getElementById('user-email');
 	const userCpfInput = document.getElementById('user-cpf');
 	const clearSignatureBtn = document.getElementById('clear-signature-btn');
 	const submitSignatureBtn = document.getElementById('submit-signature-btn');
 	const signaturePadCanvas = document.getElementById('signature-pad');
 	let signaturePad = null; 

 	// --- Modais ---
 	const modalErro = document.getElementById('modalErro');
 	const modalMensagemErro = document.getElementById('modalMensagemErro');
 	const btnFecharModalErro = document.getElementById('btnFecharModalErro');
 	
 	const modalPdfViewer = document.getElementById('modalPdfViewer');
 	const btnAbrirPdf = document.getElementById('btnAbrirPdf');
 	const btnAceitarDocumento = document.getElementById('btnAceitarDocumento');
 	const pdfViewer = document.getElementById('pdf-viewer');
 	const zoomInBtn = document.getElementById('zoom-in-btn');
 	const zoomOutBtn = document.getElementById('zoom-out-btn');
 	
 	// --- Estado ---
 	let currentDocumentId = null;
 	let currentUser = null;
 	let pdfDoc = null; 
 	let pdfScale = 1.0; 
 	let isRendering = false;
 	let pdfCarregado = false;
 	let documentoAceito = false;

 	// --- Controle de Visão ---
 	function showView(viewToShow) {
 		loadingView.classList.add('hidden');
 		mainContent.classList.remove('hidden');
 		[loginStep, signingStep, successStep].forEach(view => {
 			if (!view) return;
 			if (view.id === viewToShow) view.classList.remove('hidden');
 			else view.classList.add('hidden');
 		});
 	}

 	function showFeedback(message, type = 'error', duration = 4000) {
 		const bgColor = type === 'success' ? 'bg-green-500' : 'bg-red-500';
 		const feedbackEl = document.createElement('div');
 		feedbackEl.className = `p-4 ${bgColor} text-white rounded-lg shadow-lg mb-2`;
 		feedbackEl.textContent = message;
 		feedbackContainer.appendChild(feedbackEl);
 		setTimeout(() => feedbackEl.remove(), duration);
 	}

 	// --- Modais ---
 	function openErrorModal(mensagem) {
 		modalMensagemErro.textContent = mensagem;
 		modalErro.classList.remove('hidden');
 		modalErro.classList.add('flex'); 
 	}
 	function closeErrorModal() {
 		modalErro.classList.add('hidden'); 
 		modalErro.classList.remove('flex'); 
 	}

 	async function openModalPdf() {
 		modalPdfViewer.classList.remove('hidden');
 		modalPdfViewer.classList.add('flex'); 
 		
 		if (!pdfCarregado) {
 			try {
 				const doc = await db.getDocumentForSigning(currentDocumentId);
 				if (!doc || !doc.caminho_arquivo_storage) throw new Error("Documento não encontrado.");
 				
 				const publicUrl = db.getPublicUrl(doc.caminho_arquivo_storage);
 				if (!publicUrl) throw new Error("URL do documento indisponível.");
 				
 				await loadAndRenderPdf(publicUrl);
 				pdfCarregado = true;
 			} catch (error) {
 				console.error("Erro PDF:", error);
 				pdfViewer.innerHTML = `<p class="text-red-500 p-4">Erro ao carregar: ${error.message}</p>`;
 			}
 		}
 	}
 	function closeModalPdf() {
 		modalPdfViewer.classList.add('hidden'); 
 		modalPdfViewer.classList.remove('flex'); 
 	}

 	function habilitarFormulario() {
 		documentoAceito = true;
 		btnAbrirPdf.textContent = '✅ Documento Verificado e Aceito';
 		btnAbrirPdf.disabled = true;
 		btnAbrirPdf.classList.add('bg-green-600', 'opacity-70');
 		btnAbrirPdf.classList.remove('bg-blue-600', 'hover:bg-blue-700');

 		userCpfInput.disabled = false;
 		userCpfInput.placeholder = 'Digite seu CPF ou CNPJ';
 		userCpfInput.classList.remove('bg-gray-100', 'opacity-50', 'cursor-not-allowed');

 		signaturePadCanvas.classList.remove('bg-gray-100', 'opacity-50', 'cursor-not-allowed');
 		clearSignatureBtn.disabled = false;
 		clearSignatureBtn.classList.remove('opacity-50', 'cursor-not-allowed');
 		
 		submitSignatureBtn.disabled = false;
 		submitSignatureBtn.classList.remove('opacity-50', 'cursor-not-allowed');
 		submitSignatureBtn.classList.add('hover:bg-green-700');

 		userCpfInput.focus();
 	}
 	
 	// --- PDF Render ---
 	function initializeSignaturePad() {
 	    if (signaturePadCanvas && !signaturePad) {
 	        try {
                signaturePad = new SignaturePad(signaturePadCanvas);
                requestAnimationFrame(() => setTimeout(resizeCanvas, 50));
            } catch (e) { console.error("Erro SigPad:", e); }
 	    } else if (signaturePad) {
 	         requestAnimationFrame(() => setTimeout(resizeCanvas, 50));
 	    }
 	}

 	function resizeCanvas() {
 		if (!signaturePadCanvas || !signaturePad) return; 
 		if (!signaturePadCanvas.offsetParent) return; 
 		try {
 		    const ratio = Math.max(window.devicePixelRatio || 1, 1);
 		    if (signaturePadCanvas.offsetWidth > 0) {
                signaturePadCanvas.width = signaturePadCanvas.offsetWidth * ratio;
                signaturePadCanvas.height = signaturePadCanvas.offsetHeight * ratio;
                signaturePadCanvas.getContext("2d").scale(ratio, ratio);
                signaturePad.clear(); 
 		    }
        } catch (e) { console.error("Erro resize:", e); }
 	}

 	async function loadAndRenderPdf(url) {
 		if (isRendering) return;
 		isRendering = true;
 		pdfViewer.innerHTML = '<div class="flex justify-center items-center h-full"><div class="loader"></div></div>';
 		try {
 			pdfDoc = await pdfjsLib.getDocument(url).promise;
 			const firstPage = await pdfDoc.getPage(1);
 			await new Promise(resolve => setTimeout(resolve, 50)); 

 			const containerWidth = pdfViewer.clientWidth;
 			if (containerWidth <= 0) {
 				isRendering = false;
 				setTimeout(() => loadAndRenderPdf(url), 100); 
 				return;
 			}
 			const viewport = firstPage.getViewport({ scale: 1.0 });
 			pdfScale = containerWidth / viewport.width; 
 			await renderAllPdfPages();
 		} catch (error) {
 			console.error("Erro loadPdf:", error);
 			pdfViewer.innerHTML = `<p class="text-red-500 p-4">Erro: ${error.message}</p>`;
 		} finally {
 			if (isRendering) isRendering = false;
 		}
 	}
 	
 	async function renderAllPdfPages() {
 		if (!pdfDoc) return;
 		pdfViewer.innerHTML = ''; 
 		try {
 			for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
 				const page = await pdfDoc.getPage(pageNum);
 				const viewport = page.getViewport({ scale: pdfScale });
 				const canvas = document.createElement('canvas');
 				canvas.style.display = 'block';
 				canvas.style.margin = '0 auto 1rem auto';
 				canvas.height = viewport.height;
 				canvas.width = viewport.width;
 				pdfViewer.appendChild(canvas);
 				const context = canvas.getContext('2d');
 				await page.render({ canvasContext: context, viewport }).promise;
 			}
 		} catch (renderError) { console.error("Erro render pages:", renderError); }
 	}

 	// --- Inicialização ---
 	async function initializePage() {
 		const params = new URLSearchParams(window.location.search);
 		currentDocumentId = params.get('id');

 		// Verifica sessionStorage (Sucesso anterior)
 		if (sessionStorage.getItem(`signed_${currentDocumentId}`) === 'true') {
 			showView('success-step');
 			setTimeout(() => { window.close(); }, 15000); 
 			return; 
 		}

 		if (!currentDocumentId) {
 			loadingView.innerHTML = `<p class="text-red-500 font-bold">ERRO: ID não encontrado.</p>`;
 			return;
 		}

 		try {
 			// Verifica DB
 			const isSigned = await db.checkIfSigned(currentDocumentId);
 			if (isSigned) {
 				sessionStorage.setItem(`signed_${currentDocumentId}`, 'true');
 				showView('success-step');
                setTimeout(() => { window.close(); }, 15000); 
 				return;
 			}

 			const { data: { session }, error: sessionError } = await db.supabase.auth.getSession();
 			if (sessionError) throw sessionError;

 			if (session) {
 				await setupSigningView(session.user);
 			} else {
 				showView('login-step');
 			}
 		} catch (error) {
 			console.error("Erro init:", error); 
 			loadingView.innerHTML = `<p class="text-red-500 font-bold">Erro ao carregar. Tente recarregar a página.</p>`;
 		}
 	}
 	
 	async function setupSigningView(user) {
 		currentUser = user;
 		userNameInput.value = user.user_metadata.full_name || '';
 		userEmailInput.value = user.email || '';
 		showView('signing-step');
 		initializeSignaturePad();
 	}
 	
 	async function handleSignatureSubmit(event) {
 		event.preventDefault();

 		if (!documentoAceito) { openErrorModal("Você precisa primeiro ler e aceitar o documento."); return; }
 		if (!signaturePad || signaturePad.isEmpty()) { openErrorModal("Por favor, assine no campo tracejado."); return; }

 		const valorDigitado = userCpfInput.value;
 		const docLimpo = valorDigitado.replace(/\D/g, '');
 		let ehValido = false;

 		if (docLimpo.length === 11) ehValido = validarCPF(docLimpo);
 		else if (docLimpo.length === 14) ehValido = validarCNPJ(docLimpo);
 		else { openErrorModal('CPF (11 dígitos) ou CNPJ (14 dígitos) inválido.'); return; }

 		if (!ehValido) { openErrorModal(`Documento inválido. Verifique os números.`); return; }

 		submitSignatureBtn.disabled = true;
 		submitSignatureBtn.innerHTML = '<div class="loader mx-auto"></div>';

 		try {
 			const signatureImage = signaturePad.toDataURL('image/png');
 			const dataHoraLocalFormatada = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
 			
 			await db.submitSignature({
 				documento_id: currentDocumentId,
 				nome_signatario: currentUser.user_metadata.full_name,
 				email_signatario: currentUser.email,
 				cpf_cnpj_signatario: userCpfInput.value,
 				imagem_assinatura_base64: signatureImage,
 				data_hora_local: dataHoraLocalFormatada,
 				google_user_id: currentUser.id,
 			});

 			sessionStorage.setItem(`signed_${currentDocumentId}`, 'true');
 			showView('success-step');
            setTimeout(() => { window.close(); }, 15000);

 		} catch (error) {
 			console.error("Erro submit:", error); 
 			openErrorModal(`Erro ao salvar: ${error.message}`);
 			submitSignatureBtn.disabled = false;
 			submitSignatureBtn.textContent = 'Assinar e Finalizar';
 		} 
 	}

 	// --- Event Listeners ---
 	googleLoginBtn.addEventListener('click', async () => {
 	 	try { 
            // [CORREÇÃO CRÍTICA AQUI] 
            // Adicionado redirectTo para garantir que volte para a página de assinatura
 	 		const { error } = await db.supabase.auth.signInWithOAuth({
 	 			provider: 'google',
 	 			options: {
                    redirectTo: window.location.href, // <--- ESTA LINHA EVITA O ERRO 404
 	 				queryParams: { prompt: 'select_account' }
 	 			}
 	 		});
            if (error) throw error; 
 	 	} catch (error) { 
 	 		console.error("Erro login Google:", error);
 	 		loginError.textContent = `Erro: ${error.message}`; 
 	 	}
 	});

 	btnAbrirPdf.addEventListener('click', openModalPdf);

 	btnAceitarDocumento.addEventListener('click', () => {
 		closeModalPdf();
 		habilitarFormulario();
 	});

 	zoomInBtn.addEventListener('click', () => {
 		if (!pdfDoc) return;
 		pdfScale += 0.2;
 		try { renderAllPdfPages(); } catch (e) {}
 	});
 	zoomOutBtn.addEventListener('click', () => {
 		if (!pdfDoc || pdfScale <= 0.4) return; 
 		pdfScale -= 0.2;
 		try { renderAllPdfPages(); } catch (e) {}
 	});

 	signatureForm.addEventListener('submit', handleSignatureSubmit);
 	clearSignatureBtn.addEventListener('click', () => {
 		if (documentoAceito && signaturePad) signaturePad.clear();
 	});
 	window.addEventListener('resize', () => requestAnimationFrame(resizeCanvas));
 	
 	btnFecharModalErro.addEventListener('click', closeErrorModal);
 	modalErro.addEventListener('click', (e) => { if (e.target === modalErro) closeErrorModal(); });
 	
 	db.supabase.auth.onAuthStateChange((event, session) => {
 		if (event === 'SIGNED_IN' && session) {
 			setupSigningView(session.user).catch(console.error);
 		}
 	});
 	
 	// --- Validações ---
 	function validarCPF(cpf) {
 		if (typeof cpf !== 'string') return false;
 		cpf = cpf.replace(/[^\d]/g, '');
 		if (cpf.length !== 11) return false;
 		if (/^(\d)\1{10}$/.test(cpf)) return false;
 		let soma = 0, resto;
 		for (let i = 1; i <= 9; i++) soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
 		resto = (soma * 10) % 11;
 		if (resto === 10 || resto === 11) resto = 0;
 		if (resto !== parseInt(cpf.substring(9, 10))) return false;
 		soma = 0;
 		for (let i = 1; i <= 10; i++) soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
 		resto = (soma * 10) % 11;
 		if (resto === 10 || resto === 11) resto = 0;
 		if (resto !== parseInt(cpf.substring(10, 11))) return false;
 		return true;
 	}
 		
 	function validarCNPJ(cnpj) {
 		if (typeof cnpj !== 'string') return false;
 		cnpj = cnpj.replace(/[^\d]/g, '');
 		if (cnpj.length !== 14) return false;
 		if (/^(\d)\1{13}$/.test(cnpj)) return false;
 		let tamanho = cnpj.length - 2;
 		let numeros = cnpj.substring(0, tamanho);
 		let digitos = cnpj.substring(tamanho);
 		let soma = 0;
 		let pos = tamanho - 7;
 		for (let i = tamanho; i >= 1; i--) {
 			soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
 			if (pos < 2) pos = 9;
 		}
 		let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
 		if (resultado !== parseInt(digitos.charAt(0))) return false;
 		tamanho += 1;
 		numeros = cnpj.substring(0, tamanho);
 		soma = 0;
 		pos = tamanho - 7;
 		for (let i = tamanho; i >= 1; i--) {
 			soma += parseInt(numeros.charAt(tamanho - i)) * pos--;
 			if (pos < 2) pos = 9;
 		}
 		resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
 		if (resultado !== parseInt(digitos.charAt(1))) return false;
 		return true;
 	}

 	try {
 		initializePage();
 	} catch (initError) {
 		console.error("Erro GERAL:", initError);
 		loadingView.innerHTML = `<p class="text-red-500 font-bold">ERRO CRÍTICO. Recarregue a página.</p>`;
 	}
});
