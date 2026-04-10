import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont, PDFImage, degrees } from 'https://esm.sh/pdf-lib@1.17.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type TenantBranding = {
  company_display_name: string;
  company_legal_name: string;
  company_tax_id: string;
  primary_email: string;
  secondary_email: string;
  watermark_enabled: boolean;
  watermark_mode: 'logo' | 'text' | 'both' | 'none';
  watermark_image_url: string;
  watermark_text: string;
  watermark_opacity: number;
  watermark_scale: number;
  company_google_numeric_id: string;
};

const DEFAULT_BRANDING: TenantBranding = {
  company_display_name: 'Altnix Tecnologia',
  company_legal_name: 'Altnix Tecnologia',
  company_tax_id: '52.691.191/0001-89',
  primary_email: 'altnixtecnologia@gmail.com',
  secondary_email: '',
  watermark_enabled: true,
  watermark_mode: 'logo',
  watermark_image_url: 'https://nlefwzyyhspyqcicfouc.supabase.co/storage/v1/object/public/logo/logo-retangular-branca.png',
  watermark_text: 'DOCUMENTO ASSINADO DIGITALMENTE',
  watermark_opacity: 0.15,
  watermark_scale: 0.30,
  company_google_numeric_id: '6022773570903540834',
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

function isSchemaMissingError(error: unknown): boolean {
  const code = String((error as { code?: string } | null)?.code ?? '');
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase();
  return code === 'PGRST205' || message.includes('could not find the table') || (message.includes('column') && message.includes('does not exist'));
}

function sanitizeText(value: unknown, max = 240): string {
  return String(value ?? '').trim().slice(0, max);
}

function toSafeNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function shouldDrawLogo(branding: TenantBranding): boolean {
  if (!branding.watermark_enabled) return false;
  return branding.watermark_mode === 'logo' || branding.watermark_mode === 'both';
}

function shouldDrawText(branding: TenantBranding): boolean {
  if (!branding.watermark_enabled) return false;
  return branding.watermark_mode === 'text' || branding.watermark_mode === 'both';
}

async function getTenantBrandingConfig(supabaseAdmin: ReturnType<typeof createClient>, tenantId: string | null): Promise<TenantBranding> {
  if (!tenantId) return DEFAULT_BRANDING;

  const { data, error } = await supabaseAdmin
    .from('tenant_branding')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) {
    if (isSchemaMissingError(error)) return DEFAULT_BRANDING;
    throw new Error(`Erro ao carregar branding do tenant: ${error.message}`);
  }

  if (!data) return DEFAULT_BRANDING;

  return {
    company_display_name: sanitizeText(data.company_display_name, 120) || DEFAULT_BRANDING.company_display_name,
    company_legal_name: sanitizeText(data.company_legal_name, 180) || sanitizeText(data.company_display_name, 120) || DEFAULT_BRANDING.company_legal_name,
    company_tax_id: sanitizeText(data.company_tax_id, 40) || DEFAULT_BRANDING.company_tax_id,
    primary_email: sanitizeText(data.primary_email, 180) || DEFAULT_BRANDING.primary_email,
    secondary_email: sanitizeText(data.secondary_email, 180) || DEFAULT_BRANDING.secondary_email,
    watermark_enabled: data.watermark_enabled !== false,
    watermark_mode: (['logo', 'text', 'both', 'none'].includes(String(data.watermark_mode)) ? data.watermark_mode : DEFAULT_BRANDING.watermark_mode) as TenantBranding['watermark_mode'],
    watermark_image_url: sanitizeText(data.watermark_image_url, 600) || sanitizeText(data.logo_public_url, 600) || DEFAULT_BRANDING.watermark_image_url,
    watermark_text: sanitizeText(data.watermark_text, 120) || DEFAULT_BRANDING.watermark_text,
    watermark_opacity: toSafeNumber(data.watermark_opacity, DEFAULT_BRANDING.watermark_opacity, 0.05, 0.50),
    watermark_scale: toSafeNumber(data.watermark_scale, DEFAULT_BRANDING.watermark_scale, 0.10, 1.00),
    company_google_numeric_id: sanitizeText(data.company_google_numeric_id, 60) || DEFAULT_BRANDING.company_google_numeric_id,
  };
}

function drawStandardSeal(
  page: PDFPage,
  coords: { x: number; y: number; width: number; height: number },
  signatureImage: PDFImage | null,
  font: PDFFont,
  details: {
    nome: string;
    email: string;
    cpf_cnpj: string;
    data: string;
    ip: string;
    id_auth: string;
    id_google?: string;
    company_google_numeric_id?: string;
  },
  verificationCode: string,
  isClient: boolean,
) {
  const centerX = coords.x + (coords.width / 2);
  let currentY = coords.y + coords.height - 8;
  const lineHeight = 7;

  const drawLine = (text: string, size: number, color: { r: number; g: number; b: number }) => {
    const textWidth = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: centerX - (textWidth / 2), y: currentY, size, font, color });
    currentY -= lineHeight;
  };

  drawLine(`Assinado por: ${details.nome}`, 7, rgb(0, 0, 0));
  drawLine(`Email: ${details.email}`, 5, rgb(0.2, 0.2, 0.2));
  drawLine(`${isClient ? 'CPF/CNPJ' : 'CNPJ'}: ${details.cpf_cnpj}`, 5, rgb(0.2, 0.2, 0.2));

  if (!isClient) {
    drawLine(`ID Perfil Google: ${details.company_google_numeric_id || 'N/A'}`, 5, rgb(0.2, 0.2, 0.2));
    drawLine(`ID Autenticação: ${details.id_auth}`, 5, rgb(0.2, 0.2, 0.2));
  } else {
    drawLine(`ID Google: ${details.id_google || 'N/A'}`, 5, rgb(0.2, 0.2, 0.2));
    drawLine(`ID Autenticação: ${details.id_auth || 'N/A'}`, 5, rgb(0.2, 0.2, 0.2));
  }

  drawLine(`IP: ${details.ip}`, 5, rgb(0.2, 0.2, 0.2));
  drawLine(`Data: ${details.data}`, 5, rgb(0.2, 0.2, 0.2));
  if (verificationCode) drawLine(`Cód. Verificação: ${verificationCode}`, 5, rgb(0.2, 0.2, 0.2));
  if (!isClient) drawLine('Validade Jurídica: Lei 14.063/2020', 4, rgb(0.5, 0.5, 0.5));

  if (signatureImage) {
    const spaceRemaining = currentY - coords.y;
    if (spaceRemaining > 15) {
      const imgDims = signatureImage.scaleToFit(coords.width * 0.9, spaceRemaining - 2);
      page.drawImage(signatureImage, {
        x: centerX - (imgDims.width / 2),
        y: coords.y + (spaceRemaining - imgDims.height) / 2,
        width: imgDims.width,
        height: imgDims.height,
      });
    }
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { documento_id } = await req.json();
    if (!documento_id) throw new Error('ID não fornecido.');

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: docData, error: docError } = await supabaseAdmin
      .from('documentos')
      .select('*, assinaturas (*)')
      .eq('id', documento_id)
      .single();
    if (docError || !docData) throw new Error('Erro buscar doc.');

    const signData = docData.assinaturas?.[0];
    if (!signData) throw new Error('Assinatura não encontrada.');

    const tenantId = String(docData.tenant_id ?? signData.tenant_id ?? '').trim() || null;
    const branding = await getTenantBrandingConfig(supabaseAdmin, tenantId);

    let clientGoogleNumericId = 'N/A';
    try {
      const { data: userData } = await supabaseAdmin.auth.admin.getUserById(signData.google_user_id);
      const identities = userData?.user?.identities ?? [];
      const googleIdentity = identities.find((id: { provider?: string; id?: string }) => id.provider === 'google');
      if (googleIdentity?.id) clientGoogleNumericId = googleIdentity.id;
    } catch {
      // ignore
    }

    const signedAtBrazil = formatDateBrazil(signData.assinado_em || signData.created_at || signData.data_hora_local);
    const verificationSeed = [
      String(documento_id),
      String(signData.id ?? ''),
      String(signData.google_user_id ?? ''),
      String(signData.cpf_cnpj_signatario ?? '').replace(/\D/g, ''),
      String(signData.assinado_em ?? signData.created_at ?? signData.data_hora_local ?? ''),
    ].join('|');
    const verificationCode = await buildVerificationCode(verificationSeed);

    const { data: originalPdfFile, error: pdfError } = await supabaseAdmin.storage.from('documentos').download(docData.caminho_arquivo_storage);
    if (pdfError) throw new Error('Erro baixar PDF.');
    const originalPdfBytes = await originalPdfFile.arrayBuffer();

    let tecnicoSignBytes: ArrayBuffer | null = null;
    try {
      const { data: f } = await supabaseAdmin.storage.from('assinaturas_internas').download('assinatura-tecnico.png');
      if (f) tecnicoSignBytes = await f.arrayBuffer();
    } catch {
      // ignore
    }

    let logoBytes: ArrayBuffer | null = null;
    if (shouldDrawLogo(branding) && branding.watermark_image_url) {
      try {
        const response = await fetch(branding.watermark_image_url);
        if (response.ok) logoBytes = await response.arrayBuffer();
      } catch {
        // ignore
      }
    }

    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    const helveticaFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    const clienteSignBase64 = String(signData.imagem_assinatura_base64 ?? '').split(',')[1];
    const clienteSignBytes = Uint8Array.from(atob(clienteSignBase64), (c) => c.charCodeAt(0));
    const clienteSignImage = await pdfDoc.embedPng(clienteSignBytes);
    const tecnicoSignImage = tecnicoSignBytes ? await pdfDoc.embedPng(tecnicoSignBytes) : null;
    const logoImage = logoBytes ? await pdfDoc.embedPng(logoBytes) : null;

    let nOs = docData.n_os || 'S/N';
    if (String(nOs).startsWith('52')) nOs = 'S/N';

    let footerText = '';
    let assuntoEmail = '';
    let nomeDocFormatado = '';

    switch (docData.tipo_documento) {
      case 'contrato':
        nomeDocFormatado = String(nOs).toLowerCase().includes('contrato') ? nOs : `Contrato ${nOs}`;
        footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
        assuntoEmail = `${nomeDocFormatado} - Assinado`;
        break;
      case 'pedido':
        nomeDocFormatado = `Pedido Nº ${nOs}`;
        footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
        assuntoEmail = `Pedido Assinado (Nº ${nOs})`;
        break;
      case 'proposta':
        nomeDocFormatado = `Proposta Comercial Nº ${nOs}`;
        footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
        assuntoEmail = `Proposta Aceita (Nº ${nOs})`;
        break;
      default:
        nomeDocFormatado = `Ordem de Serviço Nº ${nOs}`;
        footerText = `${nomeDocFormatado} | Cliente: ${signData.nome_signatario}`;
        assuntoEmail = `Documento Assinado (O.S. ${nOs})`;
    }

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      const { width, height } = page.getSize();

      if (logoImage && shouldDrawLogo(branding)) {
        const dims = logoImage.scale(branding.watermark_scale);
        page.drawImage(logoImage, {
          x: (width / 2) - (dims.width / 2),
          y: (height / 2) - (dims.height / 2),
          width: dims.width,
          height: dims.height,
          opacity: branding.watermark_opacity,
        });
      }

      if (shouldDrawText(branding) && branding.watermark_text) {
        const wmSize = Math.max(20, Math.min(42, width * 0.045));
        const text = branding.watermark_text;
        const textWidth = helveticaFont.widthOfTextAtSize(text, wmSize);
        page.drawText(text, {
          x: (width / 2) - (textWidth / 2),
          y: height / 2,
          size: wmSize,
          font: helveticaFont,
          color: rgb(0.3, 0.3, 0.3),
          opacity: Math.max(0.08, branding.watermark_opacity - 0.03),
          rotate: degrees(35),
        });
      }

      page.drawText(footerText, { x: 40, y: 35, size: 8, font: helveticaFont, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(`Cód. Verificação: ${verificationCode}`, { x: 40, y: 25, size: 8, font: helveticaFont, color: rgb(0.3, 0.3, 0.3) });
      page.drawText(`Página ${i + 1} de ${pages.length}`, { x: width - 100, y: 35, size: 8, font: helveticaFont, color: rgb(0.3, 0.3, 0.3) });
    }

    const adminDetails = {
      nome: branding.company_legal_name || branding.company_display_name,
      email: docData.admin_email || branding.primary_email || DEFAULT_BRANDING.primary_email,
      cpf_cnpj: branding.company_tax_id || DEFAULT_BRANDING.company_tax_id,
      data: signedAtBrazil,
      ip: docData.admin_ip || 'IP não registrado',
      id_auth: String(docData.admin_id || 'Admin'),
      company_google_numeric_id: branding.company_google_numeric_id || DEFAULT_BRANDING.company_google_numeric_id,
    };

    const clientDetails = {
      nome: String(signData.nome_signatario || 'Cliente'),
      email: String(signData.email_signatario || ''),
      cpf_cnpj: String(signData.cpf_cnpj_signatario || '').replace(/\D/g, ''),
      data: signedAtBrazil,
      ip: String(signData.ip_signatario || 'IP não informado'),
      id_auth: String(signData.google_user_id || 'N/A'),
      id_google: clientGoogleNumericId,
    };

    let adminCoords = docData.tecnico_assinatura_coords;
    const clientCoords = docData.cliente_assinatura_coords || { page: 'last', x: 350, y: 150, width: 200, height: 100 };
    if (!adminCoords) adminCoords = { page: clientCoords.page, x: 50, y: clientCoords.y, width: 200, height: 100 };

    const getPage = (pg: unknown) => {
      let idx = (pg === 'last' || !pg) ? pages.length - 1 : Number(pg) - 1;
      if (Number.isNaN(idx) || idx < 0) idx = pages.length - 1;
      return pages[idx];
    };

    drawStandardSeal(getPage(adminCoords.page), adminCoords, tecnicoSignImage, helveticaFont, adminDetails, verificationCode, false);
    drawStandardSeal(getPage(clientCoords.page), clientCoords, clienteSignImage, helveticaFont, clientDetails, verificationCode, true);

    const finalPdfBytes = await pdfDoc.save();
    const signedFileName = `assinados/${Date.now()}-assinado.pdf`;
    await supabaseAdmin.storage.from('documentos').upload(signedFileName, finalPdfBytes, { contentType: 'application/pdf', upsert: true });
    await supabaseAdmin.from('documentos').update({ caminho_arquivo_assinado: signedFileName }).eq('id', documento_id);

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    const { data: publicUrlData } = supabaseAdmin.storage.from('documentos').getPublicUrl(signedFileName);

    if (resendApiKey && publicUrlData?.publicUrl && signData.email_signatario) {
      const signOffName = branding.company_display_name || DEFAULT_BRANDING.company_display_name;
      const emailHtml = `
        <div style="font-family: Helvetica, Arial, sans-serif; color: #333; line-height: 1.6;">
            <h2 style="color: #111;">Documento Assinado</h2>
            <p>Olá, ${signData.nome_signatario}.</p>
            <p>Seu documento (${nomeDocFormatado}) foi assinado com sucesso.</p>
            <br><a href="${publicUrlData.publicUrl}" style="background-color: #2563EB; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold;">Baixar Documento Assinado</a><br><br>
            <p style="font-size: 12px; color: #666;">Atenciosamente,<br>${signOffName}</p>
        </div>`;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({
          from: 'NixSign <contato@altnixtecnologia.info>',
          to: [signData.email_signatario],
          subject: assuntoEmail,
          html: emailHtml,
        }),
      });
      if (!res.ok) console.log('Erro email:', await res.text());
      else console.log('Email enviado.');
    }

    return new Response(JSON.stringify({ success: true, message: 'PDF assinado e email enviado.' }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
