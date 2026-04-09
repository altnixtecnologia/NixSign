import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, PDFImage } from 'https://esm.sh/pdf-lib@1.17.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const COMPANY_DATA = {
    nome: "Altnix Tecnologia",
    cpf_cnpj: "52.691.191/0001-89",
    auth_id_admin: "562274de-3844-4e02-88cf-e63c7b63b15e", 
    google_numeric_id: "6022773570903540834", 
    logo_url: "https://nlefwzyyhspyqcicfouc.supabase.co/storage/v1/object/public/logo/logo-retangular-branca.png"
};

function formatDateBrazil(value: unknown): string {
    if (!value) return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const date = new Date(String(value));
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

async function buildVerificationCode(seed: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`.toUpperCase();
}

// --- FUNÇÃO DE DESENHO ÚNICA E PADRONIZADA ---
function drawStandardSeal(page: PDFPage, coords: { x: number, y: number, width: number, height: number }, signatureImage: PDFImage | null, font: PDFFont, details: any, verificationCode: string, isClient: boolean) {
    
    const centerX = coords.x + (coords.width / 2);
    // Começa do topo da caixa
    let currentY = coords.y + coords.height - 8; 
    const lineHeight = 7;

    const drawLine = (text: string, size: number, color: any) => {
        const textWidth = font.widthOfTextAtSize(text, size);
        page.drawText(text, { x: centerX - (textWidth / 2), y: currentY, size: size, font: font, color: color });
        currentY -= lineHeight;
    };

    // 1. TÍTULO PADRONIZADO
    // Se quiser diferenciar, pode usar: `Assinado por ${isClient ? '(LOCATÁRIO)' : '(LOCADORA)'}: ...`
    // Mas para ser genérico para OS/Pedidos, usamos apenas "Assinado por:"
    drawLine(`Assinado por: ${details.nome}`, 7, rgb(0, 0, 0));
    
    // 2. DADOS
    drawLine(`Email: ${details.email}`, 5, rgb(0.2, 0.2, 0.2));
    drawLine(`${isClient ? 'CPF/CNPJ' : 'CNPJ'}: ${details.cpf_cnpj}`, 5, rgb(0.2, 0.2, 0.2));
    
    // 3. IDs (Lógica Dupla)
    if (!isClient) {
        // Admin
        drawLine(`ID Perfil Google: ${COMPANY_DATA.google_numeric_id}`, 5, rgb(0.2, 0.2, 0.2));
        drawLine(`ID Autenticação: ${details.id_auth}`, 5, rgb(0.2, 0.2, 0.2));
    } else {
        // Cliente
        drawLine(`ID Google: ${details.id_google || 'N/A'}`, 5, rgb(0.2, 0.2, 0.2));
        drawLine(`ID Autenticação: ${details.id_auth || 'N/A'}`, 5, rgb(0.2, 0.2, 0.2));
    }

    drawLine(`IP: ${details.ip}`, 5, rgb(0.2, 0.2, 0.2));
    drawLine(`Data: ${details.data}`, 5, rgb(0.2, 0.2, 0.2));
    
    // 4. RODAPÉ DO SELO
    if (verificationCode) drawLine(`Cód. Verificação: ${verificationCode}`, 5, rgb(0.2, 0.2, 0.2));
    if (!isClient) drawLine(`Validade Jurídica: Lei 14.063/2020`, 4, rgb(0.5, 0.5, 0.5));

    // 5. IMAGEM (EM BAIXO)
    if (signatureImage) {
        const spaceRemaining = currentY - coords.y;
        if (spaceRemaining > 15) {
            const imgDims = signatureImage.scaleToFit(coords.width * 0.9, spaceRemaining - 2);
            page.drawImage(signatureImage, { 
                x: centerX - (imgDims.width / 2), 
                y: coords.y + (spaceRemaining - imgDims.height) / 2, 
                width: imgDims.width, height: imgDims.height 
            });
        }
    }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') { return new Response('ok', { headers: corsHeaders }); }
  
  try {
    const { documento_id } = await req.json();
    if (!documento_id) throw new Error("ID não fornecido.");

    const supabaseAdmin = createClient( Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' );

    // 1. Busca dados
    const { data: docData, error: docError } = await supabaseAdmin.from('documentos').select(`*, assinaturas (*)`).eq('id', documento_id).single();
    if (docError || !docData) throw new Error(`Erro buscar doc.`); 
    const signData = docData.assinaturas?.[0]; 
    if (!signData) throw new Error(`Assinatura não encontrada.`);
    
    // 1.5 Busca ID Google Numérico do Cliente
    let clientGoogleNumericId = "N/A";
    try {
        const { data: userData } = await supabaseAdmin.auth.admin.getUserById(signData.google_user_id);
        if (userData?.user?.identities) {
            const googleIdentity = userData.user.identities.find((id: any) => id.provider === 'google');
            if (googleIdentity) clientGoogleNumericId = googleIdentity.id; 
        }
    } catch (e) { /* Ignora */ }

    const signedAtBrazil = formatDateBrazil(signData.assinado_em || signData.created_at || signData.data_hora_local);
    const verificationSeed = [
      String(documento_id),
      String(signData.id ?? ''),
      String(signData.google_user_id ?? ''),
      String(signData.cpf_cnpj_signatario ?? '').replace(/\D/g, ''),
      String(signData.assinado_em ?? signData.created_at ?? signData.data_hora_local ?? ''),
    ].join('|');
    const verificationCode = await buildVerificationCode(verificationSeed);

    // 2. Downloads
    const { data: originalPdfFile, error: pdfError } = await supabaseAdmin.storage.from('documentos').download(docData.caminho_arquivo_storage); 
    if (pdfError) throw new Error(`Erro baixar PDF.`); 
    const originalPdfBytes = await originalPdfFile.arrayBuffer();

    let tecnicoSignBytes = null;
    try {
        const { data: f } = await supabaseAdmin.storage.from('assinaturas_internas').download('assinatura-tecnico.png');
        if (f) tecnicoSignBytes = await f.arrayBuffer();
    } catch (e) { /* Ignora */ }
    
    let logoBytes;
    try {
        const r = await fetch(COMPANY_DATA.logo_url);
        if (r.ok) logoBytes = await r.arrayBuffer();
    } catch (e) { /* Ignora */ }

    // 4. Manipula PDF
    const pdfDoc = await PDFDocument.load(originalPdfBytes); 
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica); 
    const pages = pdfDoc.getPages();

    // Imagens
    const clienteSignBase64 = signData.imagem_assinatura_base64.split(',')[1]; 
    const clienteSignBytes = Uint8Array.from(atob(clienteSignBase64), c => c.charCodeAt(0)); 
    const clienteSignImage = await pdfDoc.embedPng(clienteSignBytes);
    let tecnicoSignImage = tecnicoSignBytes ? await pdfDoc.embedPng(tecnicoSignBytes) : null;
    let logoImage = logoBytes ? await pdfDoc.embedPng(logoBytes) : null;

    // 5. Rodapé
    const totalPages = pdfDoc.getPageCount();
    let n_os = docData.n_os || 'S/N'; 
    if (String(n_os).startsWith('52')) n_os = 'S/N';

    let footerText = "";
    let assuntoEmail = "";
    let nomeDocFormatado = "";

    switch (docData.tipo_documento) {
        case 'contrato':
            nomeDocFormatado = String(n_os).toLowerCase().includes('contrato') ? n_os : `Contrato ${n_os}`;
            footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
            assuntoEmail = `${nomeDocFormatado} - Assinado`;
            break;
        case 'pedido':
            nomeDocFormatado = `Pedido Nº ${n_os}`;
            footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
            assuntoEmail = `Pedido Assinado (Nº ${n_os})`;
            break;
        case 'proposta':
            nomeDocFormatado = `Proposta Comercial Nº ${n_os}`;
            footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
            assuntoEmail = `Proposta Aceita (Nº ${n_os})`;
            break;
        default:
            nomeDocFormatado = `Ordem de Serviço Nº ${n_os}`;
            footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
            assuntoEmail = `Documento Assinado (O.S. ${n_os})`;
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();
      if (logoImage) {
          const dims = logoImage.scale(0.3); 
          page.drawImage(logoImage, { x: (width/2)-(dims.width/2), y: (height/2)-(dims.height/2), width: dims.width, height: dims.height, opacity: 0.15 });
      }
      page.drawText(footerText, { x: 40, y: 35, size: 8, font: helveticaFont, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(`Cód. Verificação: ${verificationCode}`, { x: 40, y: 25, size: 8, font: helveticaFont, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(`Página ${i + 1} de ${pages.length}`, { x: width - 100, y: 35, size: 8, font: helveticaFont, color: rgb(0.3, 0.3, 0.3) });
    }

    // 6. DESENHA SELOS (Usando a mesma função para ambos)
    const adminDetails = {
        nome: COMPANY_DATA.nome,
        email: docData.admin_email || "altnixtecnologia@gmail.com",
        cpf_cnpj: COMPANY_DATA.cpf_cnpj,
        data: signedAtBrazil,
        ip: docData.admin_ip || "IP não registrado",
        id_auth: (docData.admin_id && docData.admin_id !== "Admin") ? docData.admin_id : COMPANY_DATA.auth_id_admin
    };

    const clientDetails = {
        nome: signData.nome_signatario,
        email: signData.email_signatario,
        cpf_cnpj: signData.cpf_cnpj_signatario.replace(/\D/g, ''),
        data: signedAtBrazil,
        ip: signData.ip_signatario || "IP não informado",
        id_auth: signData.google_user_id,
        id_google: clientGoogleNumericId
    };

    let adminCoords = docData.tecnico_assinatura_coords;
    let clientCoords = docData.cliente_assinatura_coords || { page: 'last', x: 350, y: 150, width: 200, height: 100 };

    if (!adminCoords) adminCoords = { page: clientCoords.page, x: 50, y: clientCoords.y, width: 200, height: 100 };

    const getPage = (pg: any) => {
        let idx = (pg === 'last' || !pg) ? pages.length - 1 : Number(pg) - 1;
        if (isNaN(idx) || idx < 0) idx = pages.length - 1;
        return pages[idx];
    };

    // Desenha Admin
    drawStandardSeal(getPage(adminCoords.page), adminCoords, tecnicoSignImage, helveticaFont, adminDetails, verificationCode, false);
    
    // Desenha Cliente (Com Linha se necessário)
       drawStandardSeal(getPage(clientCoords.page), clientCoords, clienteSignImage, helveticaFont, clientDetails, verificationCode, true);

    // 7. Salva e UPLOAD
    const finalPdfBytes = await pdfDoc.save();
    const signedFileName = `assinados/${Date.now()}-assinado.pdf`;
    await supabaseAdmin.storage.from('documentos').upload(signedFileName, finalPdfBytes, { contentType: 'application/pdf', upsert: true });
    await supabaseAdmin.from('documentos').update({ caminho_arquivo_assinado: signedFileName }).eq('id', documento_id);

    // 8. EMAIL
    const resendApiKey = Deno.env.get('RESEND_API_KEY'); 
    const { data: publicUrlData } = supabaseAdmin.storage.from('documentos').getPublicUrl(signedFileName);
    
    if (resendApiKey && publicUrlData?.publicUrl && signData.email_signatario) {
      const emailHtml = `
        <div style="font-family: Helvetica, Arial, sans-serif; color: #333; line-height: 1.6;">
            <h2 style="color: #111;">Documento Assinado</h2>
            <p>Olá, ${signData.nome_signatario}.</p>
            <p>Seu documento (${nomeDocFormatado}) foi assinado com sucesso.</p>
            <br><a href="${publicUrlData.publicUrl}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Baixar Documento Assinado</a><br><br>
            <p style="font-size: 12px; color: #666;">Atenciosamente,<br>Altnix Tecnologia</p>
        </div>`;
      
      const res = await fetch('https://api.resend.com/emails', { 
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${resendApiKey}` }, 
        body: JSON.stringify({ from: 'Altnix Tecnologia <contato@altnixtecnologia.info>', to: [signData.email_signatario], subject: assuntoEmail, html: emailHtml })
      });
      if (!res.ok) console.log("Erro email:", await res.text());
      else console.log("Email enviado.");
    }

    return new Response(JSON.stringify({ success: true, message: 'PDF assinado e email enviado.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 });
  }
});
