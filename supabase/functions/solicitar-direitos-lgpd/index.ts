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

function sanitize(value: unknown, max = 250): string {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeEmail(value: unknown): string {
  const email = sanitize(value, 320).toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function extractIp(req: Request): string {
  const candidates = [
    req.headers.get('cf-connecting-ip'),
    req.headers.get('x-real-ip'),
    req.headers.get('x-forwarded-for')?.split(',')[0],
    req.headers.get('fly-client-ip'),
  ];
  for (const c of candidates) {
    const ip = String(c ?? '').trim();
    if (ip) return ip;
  }
  return 'IP não informado';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, 405, { error: 'Método não permitido.' });

  try {
    const sbUrl = Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    if (!sbUrl || !sbKey) throw new Error('Configuração incompleta no servidor.');
    const supabaseAdmin = createClient(sbUrl, sbKey);

    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return jsonResponse(req, 400, { error: 'Payload inválido.' });
    }

    const body = payload as Record<string, unknown>;
    const requestType = sanitize(body.request_type, 40).toLowerCase();
    const requesterName = sanitize(body.requester_name, 180);
    const requesterEmail = sanitizeEmail(body.requester_email);
    const requesterDocument = sanitize(body.requester_document, 40).replace(/\D/g, '');
    const requestDetails = sanitize(body.request_details, 3000);

    const allowedTypes = new Set([
      'access',
      'correction',
      'anonymization',
      'deletion',
      'portability',
      'revocation',
      'review_automated_decision',
    ]);

    if (!allowedTypes.has(requestType)) {
      return jsonResponse(req, 400, { error: 'Tipo de solicitação inválido.' });
    }
    if (!requesterEmail) {
      return jsonResponse(req, 400, { error: 'E-mail válido é obrigatório.' });
    }

    // mitigação simples anti-abuso por IP
    const requesterIp = extractIp(req);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count: recentCount } = await supabaseAdmin
      .from('data_subject_requests')
      .select('id', { count: 'exact', head: true })
      .eq('requester_ip', requesterIp)
      .gte('created_at', oneHourAgo);
    if ((recentCount ?? 0) >= 5) {
      return jsonResponse(req, 429, { error: 'Muitas solicitações recentes. Tente novamente mais tarde.' });
    }

    const requesterDocumentHash = requesterDocument
      ? await crypto.subtle.digest('SHA-256', new TextEncoder().encode(requesterDocument)).then((digest) =>
          Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
        )
      : null;
    const requesterDocumentMasked = requesterDocument
      ? `${'*'.repeat(Math.max(0, requesterDocument.length - 4))}${requesterDocument.slice(-4)}`
      : null;

    const dueAt = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString();
    const userAgent = sanitize(req.headers.get('user-agent') ?? '', 800);

    const { data: inserted, error: insertError } = await supabaseAdmin
      .from('data_subject_requests')
      .insert({
        request_type: requestType,
        requester_name: requesterName || null,
        requester_email: requesterEmail,
        requester_document_hash: requesterDocumentHash,
        requester_document_masked: requesterDocumentMasked,
        request_details: requestDetails || null,
        due_at: dueAt,
        requester_ip: requesterIp,
        requester_user_agent: userAgent,
      })
      .select('id, due_at, created_at')
      .single();

    if (insertError) throw new Error(`Falha ao registrar solicitação: ${insertError.message}`);

    const encarregadoEmail = sanitizeEmail(Deno.env.get('ENCARREGADO_EMAIL') ?? '');
    if (encarregadoEmail) {
      const resendApiKey = Deno.env.get('RESEND_API_KEY') ?? '';
      if (resendApiKey) {
        const subject = `[NixSign][LGPD] Solicitação ${requestType} #${inserted.id}`;
        const html = `
          <div style="font-family: Arial, sans-serif; color: #1f2937;">
            <h3>Nova solicitação LGPD</h3>
            <p><strong>ID:</strong> ${inserted.id}</p>
            <p><strong>Tipo:</strong> ${requestType}</p>
            <p><strong>E-mail:</strong> ${requesterEmail}</p>
            <p><strong>Prazo:</strong> ${new Date(inserted.due_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</p>
            <p><strong>Detalhes:</strong> ${requestDetails || 'Sem detalhes adicionais'}</p>
          </div>
        `;

        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${resendApiKey}`,
          },
          body: JSON.stringify({
            from: 'NixSign <contato@altnixtecnologia.info>',
            to: [encarregadoEmail],
            subject,
            html,
          }),
        }).catch(() => {});
      }
    }

    return jsonResponse(req, 200, {
      success: true,
      request_id: inserted.id,
      due_at: inserted.due_at,
    });
  } catch (error) {
    console.error('[solicitar-direitos-lgpd] erro:', error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(req, 500, { error: message });
  }
});
