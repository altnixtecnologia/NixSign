import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const allowOrigin = allowedOrigins.length === 0
    ? '*'
    : (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function jsonResponse(req: Request, status: number, payload: Record<string, unknown>) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...buildCorsHeaders(req), 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, 405, { error: 'Método não permitido.' });

  try {
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return jsonResponse(req, 400, { error: 'Payload inválido.' });
    }

    const { 
      documento_id, nome_signatario, email_signatario, cpf_cnpj_signatario, 
      imagem_assinatura_base64, data_hora_local, google_user_id, 
      admin_id, admin_email, admin_ip, ip_signatario
    } = payload;

    const documentoId = String(documento_id ?? '').trim();
    const nomeSignatario = String(nome_signatario ?? '').trim();
    const emailSignatario = String(email_signatario ?? '').trim().toLowerCase();
    const cpfCnpjDigits = String(cpf_cnpj_signatario ?? '').replace(/\D/g, '');
    const assinaturaBase64 = String(imagem_assinatura_base64 ?? '');
    const dataHoraLocal = String(data_hora_local ?? '').trim();
    const googleUserId = String(google_user_id ?? '').trim();

    if (!documentoId || !nomeSignatario || !emailSignatario || !assinaturaBase64 || !dataHoraLocal || !googleUserId) {
      return jsonResponse(req, 400, { error: 'Campos obrigatórios ausentes.' });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailSignatario)) {
      return jsonResponse(req, 400, { error: 'E-mail inválido.' });
    }

    if (cpfCnpjDigits.length !== 11 && cpfCnpjDigits.length !== 14) {
      return jsonResponse(req, 400, { error: 'CPF/CNPJ inválido.' });
    }

    if (!assinaturaBase64.startsWith('data:image/png;base64,')) {
      return jsonResponse(req, 400, { error: 'Formato da assinatura inválido.' });
    }

    if (assinaturaBase64.length > 2_000_000) {
      return jsonResponse(req, 413, { error: 'Assinatura excede o tamanho permitido.' });
    }

    // CHAVES DE AMBIENTE (Project URL é o padrão para Edge Functions novas)
    const sbUrl = Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    
    if (!sbUrl || !sbKey) throw new Error("Configuração incompleta no servidor.");

    const supabaseAdmin = createClient(sbUrl, sbKey);

    // 0. Valida documento e evita assinatura duplicada
    const { data: docData, error: docError } = await supabaseAdmin
      .from('documentos')
      .select('id, status')
      .eq('id', documentoId)
      .maybeSingle();

    if (docError) throw new Error(`Falha ao consultar documento: ${docError.message}`);
    if (!docData) return jsonResponse(req, 404, { error: 'Documento não encontrado.' });
    if (docData.status === 'assinado') {
      return jsonResponse(req, 409, { error: 'Documento já assinado.' });
    }

    const { count: existingCount, error: signatureCheckError } = await supabaseAdmin
      .from('assinaturas')
      .select('id', { head: true, count: 'exact' })
      .eq('documento_id', documentoId);

    if (signatureCheckError) throw new Error(`Falha ao validar assinatura: ${signatureCheckError.message}`);
    if ((existingCount ?? 0) > 0) {
      return jsonResponse(req, 409, { error: 'Este documento já possui assinatura registrada.' });
    }

    // 1. Salvar Assinatura
    const { error: insertError } = await supabaseAdmin
      .from('assinaturas')
      .insert({
        documento_id: documentoId,
        nome_signatario: nomeSignatario,
        email_signatario: emailSignatario,
        cpf_cnpj_signatario: cpfCnpjDigits,
        imagem_assinatura_base64: assinaturaBase64,
        data_hora_local: dataHoraLocal,
        google_user_id: googleUserId,
        ip_signatario: ip_signatario || req.headers.get("x-forwarded-for")?.split(',')[0]
      });
    
    if (insertError) {
      if (insertError.message?.toLowerCase().includes('duplicate')) {
        return jsonResponse(req, 409, { error: 'Documento já assinado.' });
      }
      throw new Error(`Erro ao salvar assinatura: ${insertError.message}`);
    }

    // 2. Atualizar Status (e metadados do admin se vierem)
    const { error: updateError } = await supabaseAdmin
        .from('documentos')
        .update({ 
            status: 'assinado',
            ...(admin_ip ? { admin_ip: admin_ip } : {}),
            ...(admin_id ? { admin_id: admin_id } : {}),
            ...(admin_email ? { admin_email: admin_email } : {})
        })
        .eq('id', documentoId);

    if (updateError) throw new Error(`Erro ao atualizar status do documento: ${updateError.message}`);

    // 3. CHAMA O GERADOR DE PDF (ASSÍNCRONO)
    // Não usamos await para não travar o cliente se o PDF demorar
    supabaseAdmin.functions.invoke('gerar-pdf-assinado', {
      body: { documento_id: documentoId }
    }).catch(e => console.error("Erro background PDF:", e));

    return jsonResponse(req, 200, { success: true });

  } catch (error) {
    console.error("Erro Fatal:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return jsonResponse(req, 500, { error: errorMessage });
  }
});
