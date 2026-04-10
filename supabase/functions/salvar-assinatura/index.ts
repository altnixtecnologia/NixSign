import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

function buildCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin);
  const allowOrigin = allowedOrigins.length === 0
    ? (origin || '*')
    : (allowedOrigins.includes(origin) || isLocalOrigin ? origin : allowedOrigins[0]);

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

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

function extractRequesterIp(req: Request): string {
  const candidates = [
    req.headers.get('cf-connecting-ip'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for')?.split(',')[0],
    req.headers.get('fly-client-ip'),
  ];

  for (const candidate of candidates) {
    const ip = String(candidate ?? '').trim();
    if (ip) return ip;
  }

  return 'IP não informado';
}

function isMissingColumnError(error: unknown): boolean {
  const message = String((error as { message?: string } | null)?.message ?? '').toLowerCase();
  return (
    (message.includes('column') && message.includes('does not exist')) ||
    (message.includes('could not find') && message.includes('column')) ||
    message.includes('schema cache')
  );
}

function isTrueEnv(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
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
      documento_id,
      nome_signatario,
      email_signatario,
      cpf_cnpj_signatario,
      imagem_assinatura_base64,
      google_user_id,
      consent_accepted,
      consent_version,
      consent_text_hash,
      legal_basis,
      treatment_purpose,
      client_meta,
    } = payload as Record<string, unknown>;

    const documentoId = String(documento_id ?? '').trim();
    const nomeSignatarioPayload = String(nome_signatario ?? '').trim();
    const emailSignatarioPayload = String(email_signatario ?? '').trim().toLowerCase();
    const cpfCnpjDigits = String(cpf_cnpj_signatario ?? '').replace(/\D/g, '');
    const assinaturaBase64 = String(imagem_assinatura_base64 ?? '');
    const googleUserIdPayload = String(google_user_id ?? '').trim();
    const consentAccepted = consent_accepted === true;
    const consentVersion = String(consent_version ?? '').trim();
    const consentTextHash = String(consent_text_hash ?? '').trim().toLowerCase();
    const legalBasis = String(legal_basis ?? '').trim().toLowerCase() || 'execucao_de_contrato_e_exercicio_regular_de_direitos';
    const treatmentPurpose = String(treatment_purpose ?? '').trim().toLowerCase() || 'assinatura_eletronica_documental';

    if (!documentoId || !assinaturaBase64) {
      return jsonResponse(req, 400, { error: 'Campos obrigatórios ausentes.' });
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

    if (!consentAccepted || !consentVersion) {
      return jsonResponse(req, 400, { error: 'Consentimento LGPD obrigatório para assinatura.' });
    }

    if (consentTextHash && !/^[a-f0-9]{64}$/.test(consentTextHash)) {
      return jsonResponse(req, 400, { error: 'Hash do consentimento inválido.' });
    }

    const sbUrl = Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    if (!sbUrl || !sbKey) throw new Error('Configuração incompleta no servidor.');

    const supabaseAdmin = createClient(sbUrl, sbKey);

    // 1) Usuário autenticado é obrigatório e precisa ser login Google
    const token = extractBearerToken(req);
    if (!token) {
      return jsonResponse(req, 401, { error: 'Sessão inválida. Faça login novamente.' });
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      return jsonResponse(req, 401, { error: 'Não autorizado para assinar.' });
    }

    const authUser = authData.user;
    const identities = Array.isArray(authUser.identities) ? authUser.identities : [];
    const googleIdentity = identities.find((identity) => identity.provider === 'google');
    if (!googleIdentity) {
      return jsonResponse(req, 403, { error: 'Assinatura exige autenticação com Google.' });
    }

    if (googleUserIdPayload && googleUserIdPayload !== authUser.id) {
      return jsonResponse(req, 403, { error: 'Identidade de assinatura inválida.' });
    }

    const emailAutenticado = String(authUser.email ?? '').trim().toLowerCase();
    if (!emailAutenticado || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailAutenticado)) {
      return jsonResponse(req, 400, { error: 'E-mail do usuário autenticado inválido.' });
    }

    const nomeAutenticado = String(authUser.user_metadata?.full_name ?? '').trim();
    const nomeSignatarioFinal = (nomeAutenticado || nomeSignatarioPayload).trim();
    if (!nomeSignatarioFinal) {
      return jsonResponse(req, 400, { error: 'Nome do signatário não identificado.' });
    }

    // 2) Documento deve existir e ainda estar pendente
    let docData: Record<string, unknown> | null = null;
    let docError: Error | null = null;

    const documentoSelectCandidates = [
      'id, status, cliente_email, tenant_id',
      'id, status, cliente_email',
      'id, status_os, cliente_email, tenant_id',
      'id, status_os, cliente_email',
    ];

    for (const selectColumns of documentoSelectCandidates) {
      const docAttempt = await supabaseAdmin
        .from('documentos')
        .select(selectColumns)
        .eq('id', documentoId)
        .maybeSingle();

      if (!docAttempt.error) {
        docData = docAttempt.data as Record<string, unknown> | null;
        docError = null;
        break;
      }

      if (!isMissingColumnError(docAttempt.error)) {
        docError = docAttempt.error as Error;
        break;
      }

      docError = docAttempt.error as Error;
    }

    if (docError) throw new Error(`Falha ao consultar documento: ${docError.message}`);
    if (!docData) return jsonResponse(req, 404, { error: 'Documento não encontrado.' });
    const docStatus = String((docData as Record<string, unknown>).status ?? (docData as Record<string, unknown>).status_os ?? '').toLowerCase();
    if (docStatus === 'assinado') {
      return jsonResponse(req, 409, { error: 'Documento já assinado.' });
    }

    // Modo flexível: por padrão, não bloqueia assinatura por e-mail diferente.
    // Se quiser endurecer depois, definir ENFORCE_SIGNER_EMAIL_MATCH=true na function.
    const emailClienteDocumento = String((docData as Record<string, unknown>).cliente_email ?? '').trim().toLowerCase();
    const enforceEmailMatch = isTrueEnv(Deno.env.get('ENFORCE_SIGNER_EMAIL_MATCH'), false);
    const signerEmailMismatch = Boolean(emailClienteDocumento && emailClienteDocumento !== emailAutenticado);
    if (enforceEmailMatch && signerEmailMismatch) {
      return jsonResponse(req, 403, { error: 'Este link está vinculado a outro e-mail de assinatura.' });
    }

    const { count: existingCount, error: signatureCheckError } = await supabaseAdmin
      .from('assinaturas')
      .select('id', { head: true, count: 'exact' })
      .eq('documento_id', documentoId);

    if (signatureCheckError) throw new Error(`Falha ao validar assinatura: ${signatureCheckError.message}`);
    if ((existingCount ?? 0) > 0) {
      return jsonResponse(req, 409, { error: 'Este documento já possui assinatura registrada.' });
    }

    // 3) Evidências de rede e sessão coletadas no servidor
    const ipServidor = extractRequesterIp(req);
    const userAgent = String(req.headers.get('user-agent') ?? '').slice(0, 800);
    const acceptLanguage = String(req.headers.get('accept-language') ?? '').slice(0, 200);
    const clientMetaObj = (client_meta && typeof client_meta === 'object')
      ? (client_meta as Record<string, unknown>)
      : {};
    const timezoneCliente = String(clientMetaObj.timezone ?? '').slice(0, 120);

    const signedAt = new Date();
    const dataHoraServidorBR = signedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

    // 4) Salva Assinatura (dados de identidade vêm do servidor)
    const signatureInsertBase = {
      documento_id: documentoId,
      nome_signatario: nomeSignatarioFinal,
      email_signatario: emailAutenticado,
      cpf_cnpj_signatario: cpfCnpjDigits,
      imagem_assinatura_base64: assinaturaBase64,
      data_hora_local: dataHoraServidorBR,
      google_user_id: authUser.id,
      ip_signatario: ipServidor,
    };

    const signatureInsertLgpd = {
      ...signatureInsertBase,
      consent_version: consentVersion,
      consent_text_hash: consentTextHash || null,
      consent_accepted_at: signedAt.toISOString(),
      consent_ip: ipServidor,
      consent_user_agent: userAgent,
      legal_basis: legalBasis,
      treatment_purpose: treatmentPurpose,
    };

    let assinaturaCriada: { id: string } | null = null;
    let insertError: Error | null = null;

    const attemptLgpdInsert = await supabaseAdmin
      .from('assinaturas')
      .insert(signatureInsertLgpd)
      .select('id')
      .single();

    if (attemptLgpdInsert.error && isMissingColumnError(attemptLgpdInsert.error)) {
      const fallbackInsert = await supabaseAdmin
        .from('assinaturas')
        .insert(signatureInsertBase)
        .select('id')
        .single();
      assinaturaCriada = fallbackInsert.data as { id: string } | null;
      insertError = fallbackInsert.error as Error | null;
    } else {
      assinaturaCriada = attemptLgpdInsert.data as { id: string } | null;
      insertError = attemptLgpdInsert.error as Error | null;
    }

    if (insertError) {
      if (insertError.message?.toLowerCase().includes('duplicate')) {
        return jsonResponse(req, 409, { error: 'Documento já assinado.' });
      }
      throw new Error(`Erro ao salvar assinatura: ${insertError.message}`);
    }

    // 5) Atualiza status do documento
    let updateError: Error | null = null;
    const updateStatus = await supabaseAdmin
      .from('documentos')
      .update({ status: 'assinado' })
      .eq('id', documentoId);

    if (updateStatus.error && isMissingColumnError(updateStatus.error)) {
      const updateStatusOs = await supabaseAdmin
        .from('documentos')
        .update({ status_os: 'assinado' })
        .eq('id', documentoId);
      updateError = updateStatusOs.error as Error | null;
    } else {
      updateError = updateStatus.error as Error | null;
    }

    if (updateError) throw new Error(`Erro ao atualizar status do documento: ${updateError.message}`);

    // 6) Tentativa de auditoria jurídica (com fallback)
    const auditMetadata = {
      assinatura_id: assinaturaCriada?.id ?? null,
      signer_name: nomeSignatarioFinal,
      signer_email: emailAutenticado,
      signer_ip: ipServidor,
      signer_user_agent: userAgent,
      signer_accept_language: acceptLanguage,
      signer_timezone: timezoneCliente,
      auth_user_id: authUser.id,
      auth_provider: 'google',
      auth_email: emailAutenticado,
      auth_email_confirmed_at: authUser.email_confirmed_at ?? null,
      google_provider_user_id: String(googleIdentity.id ?? ''),
      consent_accepted: consentAccepted,
      consent_version: consentVersion,
      consent_text_hash: consentTextHash || null,
      legal_basis: legalBasis,
      treatment_purpose: treatmentPurpose,
      payload_email: emailSignatarioPayload || null,
      document_recipient_email: emailClienteDocumento || null,
      signer_email_mismatch: signerEmailMismatch,
      signer_email_match_enforced: enforceEmailMatch,
      signed_at_iso: signedAt.toISOString(),
      signed_at_br: dataHoraServidorBR,
    };

    const docTenantId = (docData as Record<string, unknown>).tenant_id ?? null;

    let persistedAudit = false;
    try {
      const { error: auditError } = await supabaseAdmin.from('audit_events').insert({
        tenant_id: docTenantId,
        actor_user_id: authUser.id,
        event_type: 'document_signed',
        target_type: 'documentos',
        target_id: documentoId,
        metadata: auditMetadata,
      });
      if (!auditError) persistedAudit = true;
    } catch {
      // Fallback abaixo
    }

    if (!persistedAudit) {
      try {
        await supabaseAdmin.from('signature_audit_events').insert({
          documento_id: documentoId,
          assinatura_id: assinaturaCriada?.id ?? null,
          event_type: 'document_signed',
          signer_auth_user_id: authUser.id,
          signer_email: emailAutenticado,
          signer_ip: ipServidor,
          signer_user_agent: userAgent,
          signer_language: acceptLanguage,
          signer_timezone: timezoneCliente,
          google_provider_user_id: String(googleIdentity.id ?? ''),
          metadata: auditMetadata,
        });
      } catch (auditFallbackError) {
        console.warn('[salvar-assinatura] Auditoria não persistida:', auditFallbackError);
      }
    }

    // 7) Gera PDF assinado em background
    supabaseAdmin.functions.invoke('gerar-pdf-assinado', {
      body: { documento_id: documentoId },
    }).catch((e) => console.error('Erro background PDF:', e));

    return jsonResponse(req, 200, { success: true });
  } catch (error) {
    console.error('Erro Fatal:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return jsonResponse(req, 500, { error: errorMessage });
  }
});
