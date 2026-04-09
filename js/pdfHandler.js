// js/pdfHandler.js
// VERSÃO FINAL - DETECTA PROPOSTA, PEDIDO E CONTRATO

export function setupPdfWorker() {
	pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js`;
}

export async function extractDataFromPdf(source) {
	return new Promise(async (resolve, reject) => {
		try {
			let data;
			if (source instanceof File) {
				data = await source.arrayBuffer();
			} else if (typeof source === 'string') {
				const response = await fetch(source); 
				if (!response.ok) throw new Error(`Falha ao buscar PDF: ${response.statusText}`);
				data = await response.arrayBuffer();
			} else {
				return reject(new Error("Fonte PDF inválida."));
			}

			const pdfBytes = new Uint8Array(data);
			const pdfDoc = await pdfjsLib.getDocument(pdfBytes).promise;
			let fullText = "";
			
			for (let i = 1; i <= pdfDoc.numPages; i++) {
				const page = await pdfDoc.getPage(i);
				const textContent = await page.getTextContent();
				textContent.items.forEach(item => {
                    if (item && item.str) fullText += item.str + " "; 
                 });
                 fullText += "\n"; 
			}
            
            fullText = fullText.replace(/\s\s+/g, ' ').trim();
            const headerText = fullText.substring(0, 600).toLowerCase();

			// --- 1. DETECÇÃO DE TIPO (AQUI ESTAVA FALTANDO) ---
            const isContrato = /contrato/i.test(headerText);
            const isProposta = /proposta/i.test(headerText) || /orçamento/i.test(headerText);
            // Pedido é se tiver "pedido" mas não for "proposta"
            const isPedido = /pedido/i.test(headerText) && !isProposta; 

			// --- 2. EXTRAÇÃO DE NÚMERO ---
            let n_os = null;
            if (!isContrato) {
                // Ignora CNPJ (52...) e CPF
                const osMatch = fullText.match(/(?<!CNPJ\s)(?<!CPF\s)(?:N\s*[°|º|°]|Numero|Número|Documento N°)\s*(\d+)(?!\.)/i);
                if (osMatch) n_os = osMatch[1].trim();
            }

			// --- 3. EXTRAÇÃO DE NOME ---
			let nomeMatch = null;
            let fullTextCleaned = fullText.replace(/\s+/g, ' '); 

            if (isContrato) {
                const locatarioRegex = /LOCATÁRIO\(A\):\s*([^,–-]+)/i;
                const match = fullText.match(locatarioRegex);
                if (match) nomeMatch = [null, match[1].trim()];
            } 
            
            if (!nomeMatch) {
                // Tenta Proposta (Para: Cliente)
                const strongAnchorRegex = /(?:Para|Cliente)\s*[:;]?\s*([^,;–-]{3,60})/i;
                const matchOS = fullText.match(strongAnchorRegex);
                
                if (matchOS) {
                     let nomeSujo = matchOS[1].trim();
                     if (nomeSujo.includes("Enviado por")) nomeSujo = nomeSujo.split("Enviado por")[0].trim();
                     nomeMatch = [null, nomeSujo];
                } else {
                    // Fallback
                    const osPedidoRegex = /Cliente\s+([^,]{5,80}?)\s+(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|IPT)/i;
                    nomeMatch = fullTextCleaned.match(osPedidoRegex);
                }
            }

			// --- 4. Contatos ---
			let emailMatch = fullText.match(/E-mail:\s*([^,; ]+)/i); 
            if (!emailMatch) emailMatch = fullText.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/i);
			let foneMatch = fullText.match(/(?:Celular|Telefone|Fone|WhatsApp):\s*([+\d\s()-]+)/i);

            let finalName = nomeMatch ? nomeMatch[1].trim() : '';
            if (finalName) finalName = finalName.replace(/(\b[A-Z])\s+([a-z])/g, '$1$2');

			resolve({
                isContrato,
                isPedido,    // AGORA O ADMIN.JS VAI RECEBER ISSO
                isProposta,  // E ISSO
				nome: finalName,
				n_os: n_os, 
				email: emailMatch ? emailMatch[1].trim() : '',
				telefone: foneMatch ? foneMatch[1].trim().replace(/\D/g, '') : '',
				status_os: 'Pendente',
			});

		} catch (error) {
			console.error("Erro na extração:", error);
			reject(error);
		}
	});
}
