// supabase/functions/url-to-pdf/index.ts
// VERSÃO FINAL CORRIGIDA - Chave correta, lógica de linhas correta, formato antigo.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// --- FUNÇÃO DE UPLOAD ---
async function uploadFileToStorage(pdfBuffer: ArrayBuffer, fileName: string) {
  const supabaseAdmin = createClient( Deno.env.get("SUPABASE_URL") ?? '', Deno.env.get("SERVICE_KEY") ?? '' );
  console.log("[url-to-pdf] Tentando upload para Storage...");
  const { data, error } = await supabaseAdmin.storage.from('documentos').upload(fileName, pdfBuffer, { contentType: 'application/pdf', upsert: true });
  if (error) throw new Error(`Falha ao fazer upload: ${error.message}`);
  if (!data?.path) throw new Error("Upload não retornou path.");
  console.log("[url-to-pdf] Upload OK:", data.path);
  return data.path;
}

// --- FUNÇÃO DE DECODIFICAR EMAIL ---
function decodeEmail(encodedString: string): string {
    try {
        if (!encodedString || encodedString.length < 2) return '';
        const key = parseInt(encodedString.substring(0, 2), 16);
        if (isNaN(key)) return '';
        let decodedEmail = '';
        for (let i = 2; i < encodedString.length; i += 2) {
            if (i + 2 > encodedString.length) break;
            const charCode = parseInt(encodedString.substring(i, i + 2), 16) ^ key;
            if (isNaN(charCode)) continue;
            decodedEmail += String.fromCharCode(charCode);
        }
        return decodedEmail;
    } catch (e) { console.error("[url-to-pdf] Erro decodificar e-mail:", e); return ''; }
}

// --- SERVIDOR PRINCIPAL ---
serve(async (req) => {
  console.log("[url-to-pdf] Função iniciada (vApi2Pdf, formato ANTIGO, Remoção Condicional).");
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método não permitido.' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  try {
    // Lendo o formato ANTIGO { "url": "..." } (que o seu GitHub Pages está a enviar)
    const { url } = await req.json();
    console.log("[url-to-pdf] Lendo URL do formato ANTIGO: { url: ... }");

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new Error("URL inválida.");
    }

    if (parsedUrl.protocol !== 'https:' || parsedUrl.hostname !== 'erp.tiny.com.br') {
      throw new Error("URL inválida ou não permitida.");
    }
    
    // --- [CORREÇÃO DA CHAVE] ---
    // Usando a chave correta (com o "2")
    const API2PDF_KEY = Deno.env.get('API2PDF_KEY');
    // --- [FIM DA CORREÇÃO] ---
    
    if (!API2PDF_KEY) throw new Error("Segredo API2PDF_KEY (com o 2) não encontrado.");

    // Passo 1: Buscar HTML
    const htmlResponse = await fetch(url);
    if (!htmlResponse.ok) throw new Error(`Falha ao buscar HTML: ${htmlResponse.status}`);
    const originalHtml = await htmlResponse.text();
    let modifiedHtml = originalHtml;

    // Passo 2: Corrigir [email protected]
    const emailRegexOfuscado = /<a\s+href="\/cdn-cgi\/l\/email-protection"[^>]*data-cfemail="([^"]+)"[^>]*>\[email&#160;protected\]<\/a>/i;
    const emailMatchOfuscado = originalHtml.match(emailRegexOfuscado);
    let extractedEmail = '';
    if (emailMatchOfuscado?.[1]) {
        const placeholderMatch = emailMatchOfuscado[0];
        extractedEmail = decodeEmail(emailMatchOfuscado[1]);
        if (extractedEmail) {
            modifiedHtml = modifiedHtml.replace(placeholderMatch, extractedEmail);
            console.log("[url-to-pdf] Bug [email protected] corrigido.");
        }
    }
    
    // Passo 3: Identificar o tipo de documento PRIMEIRO
    const osRegex = /(Ordem de serviço\s*N[º°o.]*\s*\d+|Pedido de Venda\s*N[º°o.]*\s*\d+|Proposta Comercial\s*N[º°o.]*\s*\d+)/i;
    const osMatch = originalHtml.match(osRegex);
    const isOS = osMatch && osMatch[0].toLowerCase().includes('ordem de serviço');

    // --- [LÓGICA CORRIGIDA] ---
    // Passo 4: Limpar o HTML (SÓ SE NÃO FOR OS)
    if (!isOS) {
        console.log("[url-to-pdf] Documento NÃO é O.S. (Pedido/Proposta). Removendo linhas/textos de assinatura...");
        const textoTecnicoParaRemover = /Assinatura do técnico/gi;
        const textoClienteParaRemover = /Assinatura do cliente/gi;
        const linhaParaRemover = /_______________________________________________/g; 
        modifiedHtml = modifiedHtml.replace(textoTecnicoParaRemover, '');
        modifiedHtml = modifiedHtml.replace(textoClienteParaRemover, '');
        modifiedHtml = modifiedHtml.replace(linhaParaRemover, '');
    } else {
        console.log("[url-to-pdf] Documento é O.S. Linhas de assinatura originais mantidas.");
    }
    // --- [FIM DA LÓGICA] ---

    // Passo 5: Enviar para Api2Pdf (Método POST)
    console.log("[url-to-pdf] Enviando HTML LIMPO para Api2Pdf...");
    const api2pdfResponse = await fetch("https://v2018.api2pdf.com/chrome/html", {
      method: 'POST',
      headers: { 'Authorization': API2PDF_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: modifiedHtml,
        inline: true,
        options: { 
            format: 'A4', 
            margin: { top: "20px", bottom: "60px", left: "20px", right: "20px" } // Margem inferior aumentada
        }
      })
    });
    const contentType = api2pdfResponse.headers.get('content-type');
    let pdfBuffer: ArrayBuffer;

    if (contentType?.includes('application/pdf')) {
        pdfBuffer = await api2pdfResponse.arrayBuffer();
    } else {
        const errorText = await api2pdfResponse.text();
        try {
            const responseData = JSON.parse(errorText);
            if (responseData.pdf) {
                // O erro "Insufficient funds" acontece aqui
                const pdfDownloadResponse = await fetch(responseData.pdf);
                if (!pdfDownloadResponse.ok) throw new Error(`Falha ao baixar PDF: ${pdfDownloadResponse.status}`);
                pdfBuffer = await pdfDownloadResponse.arrayBuffer();
            } else { throw new Error(`Api2Pdf erro: ${errorText}`); }
        } catch (e) { throw new Error(`Api2Pdf erro (não é PDF): ${errorText}`); }
    }

    // Passo 6: Fazer o upload do PDF (Limpo)
    const urlParams = new URLSearchParams(new URL(url).search);
    const docId = urlParams.get('id') || `doc-${Date.now()}`;
    const fileName = `${Date.now()}-${docId}.pdf`;
    const storagePath = await uploadFileToStorage(pdfBuffer, fileName);

    // Passo 7: Retornar o caminho E os dados extraídos
    const foneRegex = /(?:Celular|Telefone|Fone)\s*:\s*.*?(\(?\d{2}\)?\s*\d{4,5}-?\d{4})/i;
    const foneRegexMatch = originalHtml.match(foneRegex);
    let nomeMatch = null;
    const htmlLines = originalHtml.replace(/\s+/g, ' ').trim(); 

    if (osMatch && osMatch[0].toLowerCase().includes('proposta comercial')) {
        const propRegex = /Para\s+([^\n]+?)\s+\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/i;
        nomeMatch = htmlLines.match(propRegex);
    } else {
        const osPedidoRegex = /Cliente\s+([^\n]+?)\s+(?:\d{3}\.\d{3}\d{3}-\d{2}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}|IPT)/i;
        nomeMatch = htmlLines.match(osPedidoRegex);
    }
    let statusOS = null;
    const palavrasChave = ["Concluído", "Entregue", "Garantia", "Não autorizou"];
    for (const palavra of palavrasChave) { if (originalHtml.toLowerCase().includes(palavra.toLowerCase())) { statusOS = palavra; break; } }
    
    return new Response(
      JSON.stringify({
          storagePath: storagePath, 
          nome: nomeMatch ? nomeMatch[1].trim() : '', 
          telefone: foneRegexMatch ? foneRegexMatch[1].replace(/\D/g, '') : '', 
          extractedEmail: extractedEmail, 
          n_os: osMatch ? osMatch[0].trim() : '',
          status_os: statusOS || ''
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
    );

  } catch (error) {
    console.error("!!! CRITICAL ERROR in Edge Function !!!", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
