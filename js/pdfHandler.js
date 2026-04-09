// js/pdfHandler.js
// VERSÃO FINAL - DETECTA PROPOSTA, PEDIDO E CONTRATO

export function setupPdfWorker() {
	pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js`;
}

function normalizeSpaces(value) {
	return (value || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

function stripAccents(value) {
	return (value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function buildLinesFromPage(textContent) {
	const positionedItems = (textContent?.items || [])
		.filter((item) => item?.str && item.str.trim())
		.map((item) => ({
			str: normalizeSpaces(item.str),
			x: item.transform?.[4] ?? 0,
			y: item.transform?.[5] ?? 0,
		}));

	positionedItems.sort((a, b) => (b.y - a.y) || (a.x - b.x));

	const lineGroups = [];
	const yTolerance = 2.8;
	for (const item of positionedItems) {
		let targetLine = null;
		for (const line of lineGroups) {
			if (Math.abs(line.y - item.y) <= yTolerance) {
				targetLine = line;
				break;
			}
		}
		if (!targetLine) {
			targetLine = { y: item.y, items: [] };
			lineGroups.push(targetLine);
		}
		targetLine.items.push(item);
	}

	return lineGroups
		.sort((a, b) => b.y - a.y)
		.map((line) =>
			normalizeSpaces(
				line.items
					.sort((a, b) => a.x - b.x)
					.map((it) => it.str)
					.join(' ')
			)
		)
		.filter(Boolean);
}

function cleanName(rawName) {
	let name = normalizeSpaces(rawName);
	if (!name) return '';

	name = name
		.replace(/^(?:para|cliente|nome|locat[aá]rio\(a\))\s*[:\-]?\s*/i, '')
		.replace(/^[:;,\-\s]+/, '')
		.replace(/[;:,.\-\s]+$/, '')
		.trim();

	name = name.split(/\b(?:endere[cç]o|rua|avenida|av\.?|bairro|cidade|cep|uf|e-?mail|email|telefone|fone|whats(?:app)?|celular|enviado por|cpf|cnpj|proposta|pedido|contrato)\b/i)[0].trim();

	if (!name || name.length < 3) return '';
	if (/^\d+$/.test(name)) return '';
	if (/[\d]{4,}/.test(name)) return '';

	return name;
}

function isNoiseForName(value) {
	const t = stripAccents(value).toLowerCase();
	return /enderec|rua|avenida|av\.|bairro|cidade|cep|uf|telefone|whatsapp|email|cpf|cnpj|enviado por|item|total|orcamento|proposta|pedido|contrato/.test(t);
}

function extractBestName(lines, fullText) {
	const candidates = [];
	const normalizedLines = lines.map((line) => normalizeSpaces(line));

	for (let i = 0; i < normalizedLines.length; i++) {
		const line = normalizedLines[i];
		if (!line) continue;

		const exactLabel = /^(?:para|cliente|nome|locat[aá]rio\(a\))\s*[:\-]?\s*$/i.test(line);
		if (exactLabel) {
			for (let j = i + 1; j < Math.min(i + 5, normalizedLines.length); j++) {
				const next = cleanName(normalizedLines[j]);
				if (!next) continue;
				if (!isNoiseForName(next)) {
					candidates.push({ value: next, score: 6 });
					break;
				}
			}
		}

		const inlineMatch = line.match(/^(?:para|cliente|nome|locat[aá]rio\(a\))\s*[:\-]?\s*(.+)$/i);
		if (inlineMatch?.[1]) {
			const cleaned = cleanName(inlineMatch[1]);
			if (cleaned) candidates.push({ value: cleaned, score: 5 });
		}
	}

	if (candidates.length === 0) {
		const fullTextCandidate = fullText.match(/(?:para|cliente|locat[aá]rio\(a\))\s*[:\-]?\s*([^\n,;]{3,90})/i);
		if (fullTextCandidate?.[1]) {
			const cleaned = cleanName(fullTextCandidate[1]);
			if (cleaned) candidates.push({ value: cleaned, score: 3 });
		}
	}

	let best = '';
	let bestScore = -Infinity;
	for (const candidate of candidates) {
		let score = candidate.score;
		const value = candidate.value;
		if (value.split(' ').length >= 2) score += 2;
		if (value.length >= 8 && value.length <= 60) score += 1;
		if (/[0-9]/.test(value)) score -= 3;
		if (isNoiseForName(value)) score -= 4;
		if (score > bestScore) {
			bestScore = score;
			best = value;
		}
	}

	return cleanName(best);
}

function normalizePhoneDigits(rawPhone) {
	let digits = (rawPhone || '').replace(/\D/g, '');
	if (digits.startsWith('55') && digits.length > 11) digits = digits.slice(2);
	if (digits.length === 10 || digits.length === 11) return digits;
	return '';
}

function pickBestEmail(lines) {
	const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
	const candidates = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const matches = line.match(emailRegex);
		if (!matches) continue;

		const lineNorm = stripAccents(line).toLowerCase();
		const isSenderLine = /enviado por|remetente|vendedor|tecnico/.test(lineNorm);
		const isClientHint = /cliente|contato|destinat/.test(lineNorm);
		const isEmailHint = /e-?mail/.test(lineNorm);

		for (const email of matches) {
			let score = 0;
			if (isClientHint) score += 3;
			if (isEmailHint) score += 2;
			if (isSenderLine) score -= 5;
			if (i < 8) score -= 1;
			candidates.push({ value: email.trim(), score });
		}
	}

	if (candidates.length === 0) return '';

	candidates.sort((a, b) => b.score - a.score);
	const best = candidates[0];
	if (best.score < 0) return '';
	return best.value;
}

function pickBestPhone(lines) {
	const phoneRegex = /(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-\s]?\d{4}/g;
	const candidates = [];

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const matches = line.match(phoneRegex);
		if (!matches) continue;

		const lineNorm = stripAccents(line).toLowerCase();
		const isPhoneHint = /whats|telefone|celular|fone/.test(lineNorm);
		const isClientHint = /cliente|contato/.test(lineNorm);
		const isSenderLine = /enviado por|remetente|vendedor|tecnico/.test(lineNorm);

		for (const rawPhone of matches) {
			const digits = normalizePhoneDigits(rawPhone);
			if (!digits) continue;
			let score = 0;
			if (isPhoneHint) score += 2;
			if (isClientHint) score += 2;
			if (isSenderLine) score -= 3;
			if (i < 8) score -= 1;
			candidates.push({ value: digits, score });
		}
	}

	if (candidates.length === 0) return '';
	candidates.sort((a, b) => b.score - a.score);
	return candidates[0].score < 0 ? '' : candidates[0].value;
}

function extractDocumentNumber(headerText, fullText) {
	const matchByType = headerText.match(/(?:ordem\s*de\s*servi[cç]o|o\.?s\.?|proposta(?:\s*comercial)?|pedido)\s*(?:n[°ºo]\s*)?(\d{1,10})/i);
	if (matchByType?.[1]) return matchByType[1].trim();

	const genericMatch = fullText.match(/(?:n[°ºo]|numero|n[uú]mero|documento)\s*[:\-]?\s*(\d{1,10})/i);
	if (genericMatch?.[1]) return genericMatch[1].trim();

	return null;
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
			const allLines = [];
			
			for (let i = 1; i <= pdfDoc.numPages; i++) {
				const page = await pdfDoc.getPage(i);
				const textContent = await page.getTextContent();
				const pageLines = buildLinesFromPage(textContent);
				allLines.push(...pageLines);
				allLines.push('');
			}

			const compactLines = allLines.map((line) => normalizeSpaces(line)).filter(Boolean);
			const fullText = compactLines.join('\n');
			const headerText = compactLines.slice(0, 25).join(' ').toLowerCase();

			// --- 1. DETECÇÃO DE TIPO (AQUI ESTAVA FALTANDO) ---
            const isContrato = /contrato/i.test(headerText);
            const isProposta = /proposta/i.test(headerText) || /orçamento/i.test(headerText);
            // Pedido é se tiver "pedido" mas não for "proposta"
            const isPedido = /pedido/i.test(headerText) && !isProposta; 

			// --- 2. EXTRAÇÃO DE NÚMERO ---
            let n_os = null;
            if (!isContrato) {
				const extractedNumber = extractDocumentNumber(headerText, fullText);
				if (extractedNumber && extractedNumber.length <= 10) {
					n_os = extractedNumber;
				}
            }

			// --- 3. EXTRAÇÃO DE NOME ---
			const extractedName = extractBestName(compactLines, fullText);

			// --- 4. Contatos ---
			const extractedEmail = pickBestEmail(compactLines);
			const extractedPhone = pickBestPhone(compactLines);

			resolve({
                isContrato,
                isPedido,    // AGORA O ADMIN.JS VAI RECEBER ISSO
                isProposta,  // E ISSO
				nome: extractedName,
				n_os: n_os, 
				email: extractedEmail,
				telefone: extractedPhone,
				status_os: 'Pendente',
			});

		} catch (error) {
			console.error("Erro na extração:", error);
			reject(error);
		}
	});
}
