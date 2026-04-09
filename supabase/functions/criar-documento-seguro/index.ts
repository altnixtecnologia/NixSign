import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type SignatureCoords = {
  page: number | 'last';
  x: number;
  y: number;
  width: number;
  height: number;
} | null;

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

function sanitizeString(value: unknown, max = 250): string {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeEmail(value: unknown): string {
  const email = sanitizeString(value, 320).toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sanitizeStoragePath(value: unknown): string {
  const path = sanitizeString(value, 500);
  if (!path) return '';
  if (path.includes('..')) return '';
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(path)) return '';
  if (path.startsWith('assinados/')) return '';
  return path;
}

function sanitizeUuid(value: unknown): string {
  const maybeUuid = sanitizeString(value, 80).toLowerCase();
  if (!maybeUuid) return '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(maybeUuid)
    ? maybeUuid
    : '';
}

function isSchemaMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const err = error as Record<string, unknown>;
  const code = String(err.code ?? '');
  const message = String(err.message ?? '').toLowerCase();
  return code === 'PGRST205' || message.includes('could not find the table');
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sanitizeCoords(coords: unknown): SignatureCoords {
  if (!coords || typeof coords !== 'object') return null;
  const c = coords as Record<string, unknown>;
  const page = c.page;
  const x = c.x;
  const y = c.y;
  const width = c.width;
  const height = c.height;

  if (!(page === 'last' || (typeof page === 'number' && page >= 1))) return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(width) || !isFiniteNumber(height)) return null;
  if (width <= 0 || height <= 0) return null;
  if (width > 2000 || height > 2000) return null;
  if (x < -20 || y < -20) return null;

  return { page, x, y, width, height };
}

function normalizeSiteBaseUrl(value: unknown): string {
  const raw = sanitizeString(value, 600);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: buildCorsHeaders(req) });
  if (req.method !== 'POST') return jsonResponse(req, 405, { error: 'Método não permitido.' });

  try {
    const sbUrl = Deno.env.get('PROJECT_URL') ?? Deno.env.get('SUPABASE_URL') ?? '';
    const sbKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY') ?? '';
    if (!sbUrl || !sbKey) throw new Error('Configuração incompleta no servidor.');
    const supabaseAdmin = createClient(sbUrl, sbKey);

    // 1) Autenticação obrigatória
    const token = extractBearerToken(req);
    if (!token) return jsonResponse(req, 401, { error: 'Sessão inválida.' });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) {
      return jsonResponse(req, 401, { error: 'Não autorizado para criar documento.' });
    }

    const authUser = authData.user;
    const adminId = authUser.id;
    const adminEmail = sanitizeEmail(authUser.email ?? '');
    if (!adminEmail) return jsonResponse(req, 400, { error: 'Usuário admin sem e-mail válido.' });

    // 2) Payload
    const payload = await req.json().catch(() => null);
    if (!payload || typeof payload !== 'object') {
      return jsonResponse(req, 400, { error: 'Payload inválido.' });
    }

    const data = payload as Record<string, unknown>;
    const caminhoArquivoStorage = sanitizeStoragePath(data.caminho_arquivo_storage);
    const nomeCliente = sanitizeString(data.nome_cliente, 180) || 'Cliente';
    const telefoneCliente = sanitizeString(data.telefone_cliente, 30).replace(/[^\d+()\-\s]/g, '');
    const clienteEmail = sanitizeEmail(data.cliente_email);
    const nOs = sanitizeString(data.n_os, 80) || 'S/N';
    const statusOs = sanitizeString(data.status_os, 80) || 'Pendente';
    const tipoDocumento = sanitizeString(data.tipo_documento, 40) || 'os';
    const tenantIdPayload = sanitizeUuid(data.tenant_id);
    const siteBaseUrl = normalizeSiteBaseUrl(data.site_base_url);
    const tecnicoCoords = sanitizeCoords(data.tecnico_assinatura_coords);
    const clienteCoords = sanitizeCoords(data.cliente_assinatura_coords);

    const allowedTypes = new Set(['os', 'contrato', 'proposta', 'pedido', 'proposta_pedido']);
    if (!allowedTypes.has(tipoDocumento)) {
      return jsonResponse(req, 400, { error: 'Tipo de documento inválido.' });
    }

    if (!caminhoArquivoStorage) {
      return jsonResponse(req, 400, { error: 'Arquivo do documento inválido.' });
    }

    const requesterIp = extractRequesterIp(req);
    const userAgent = sanitizeString(req.headers.get('user-agent') ?? '', 800);
    const acceptLanguage = sanitizeString(req.headers.get('accept-language') ?? '', 200);
    const createdAtServer = new Date();

    let tenantIdForDocument: string | null = null;
    let tenantSchemaAvailable = true;
    if (tenantIdPayload) {
      const { data: membershipByPayload, error: membershipPayloadError } = await supabaseAdmin
        .from('tenant_members')
        .select('tenant_id')
        .eq('tenant_id', tenantIdPayload)
        .eq('user_id', adminId)
        .eq('status', 'active')
        .maybeSingle();

      if (membershipPayloadError) {
        if (isSchemaMissingError(membershipPayloadError)) {
          tenantSchemaAvailable = false;
        } else {
          throw new Error(`Erro ao validar workspace: ${membershipPayloadError.message}`);
        }
      }

      if (membershipByPayload?.tenant_id) {
        tenantIdForDocument = String(membershipByPayload.tenant_id);
      }
    }

    if (!tenantIdForDocument && tenantSchemaAvailable) {
      const { data: firstMembership, error: firstMembershipError } = await supabaseAdmin
        .from('tenant_members')
        .select('tenant_id')
        .eq('user_id', adminId)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

      if (firstMembershipError) {
        if (isSchemaMissingError(firstMembershipError)) {
          tenantSchemaAvailable = false;
        } else {
          throw new Error(`Erro ao resolver workspace: ${firstMembershipError.message}`);
        }
      }

      if (firstMembership?.tenant_id) {
        tenantIdForDocument = String(firstMembership.tenant_id);
      }
    }

    if (tenantSchemaAvailable && !tenantIdForDocument) {
      return jsonResponse(req, 403, { error: 'Usuário sem acesso a uma empresa ativa.' });
    }

    // 3) Inserção segura
    const { data: insertedDoc, error: insertError } = await supabaseAdmin
      .from('documentos')
      .insert({
        caminho_arquivo_storage: caminhoArquivoStorage,
        nome_cliente: nomeCliente,
        telefone_cliente: telefoneCliente || null,
        cliente_email: clienteEmail || null,
        n_os: nOs,
        status_os: statusOs,
        tecnico_assinatura_coords: tecnicoCoords,
        cliente_assinatura_coords: clienteCoords,
        admin_id: adminId,
        admin_email: adminEmail,
        tipo_documento: tipoDocumento,
        admin_ip: requesterIp,
        tenant_id: tenantIdForDocument,
      })
      .select('id')
      .single();

    if (insertError) {
      throw new Error(`Erro ao criar documento: ${insertError.message}`);
    }

    const documentId = String(insertedDoc.id);
    const linkAssinatura = siteBaseUrl ? `${siteBaseUrl}/assinar.html?id=${documentId}` : '';

    if (linkAssinatura) {
      const { error: linkError } = await supabaseAdmin
        .from('documentos')
        .update({ link_assinatura: linkAssinatura })
        .eq('id', documentId);
      if (linkError) throw new Error(`Erro ao salvar link de assinatura: ${linkError.message}`);
    }

    // 4) Auditoria jurídica da criação (com fallback)
    const auditMetadata = {
      event: 'document_created',
      document_id: documentId,
      storage_path: caminhoArquivoStorage,
      document_type: tipoDocumento,
      admin_auth_user_id: adminId,
      admin_email: adminEmail,
      tenant_id: tenantIdForDocument,
      admin_ip: requesterIp,
      admin_user_agent: userAgent,
      admin_accept_language: acceptLanguage,
      created_at_iso: createdAtServer.toISOString(),
      created_at_br: createdAtServer.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
    };

    let persistedAudit = false;
    try {
      const { error: auditError } = await supabaseAdmin.from('audit_events').insert({
        tenant_id: tenantIdForDocument,
        actor_user_id: adminId,
        event_type: 'document_created',
        target_type: 'documentos',
        target_id: documentId,
        metadata: auditMetadata,
      });
      if (!auditError) persistedAudit = true;
    } catch {
      // fallback abaixo
    }

    if (!persistedAudit) {
      try {
        await supabaseAdmin.from('document_audit_events').insert({
          documento_id: documentId,
          event_type: 'document_created',
          actor_auth_user_id: adminId,
          actor_email: adminEmail,
          actor_ip: requesterIp,
          actor_user_agent: userAgent,
          actor_language: acceptLanguage,
          metadata: auditMetadata,
        });
      } catch (fallbackError) {
        console.warn('[criar-documento-seguro] Auditoria não persistida:', fallbackError);
      }
    }

    return jsonResponse(req, 200, {
      success: true,
      id: documentId,
      link_assinatura: linkAssinatura || null,
    });
  } catch (error) {
    console.error('[criar-documento-seguro] erro:', error);
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse(req, 500, { error: message });
  }
});
