import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MASTER_ADMIN_EMAIL = 'altnixtecnologia@gmail.com';
const ALLOWED_STATUSES = new Set(['active', 'inactive', 'suspended']);

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

function sanitizeText(value: unknown, max = 200): string {
  return String(value ?? '').trim().slice(0, max);
}

function sanitizeEmail(value: unknown): string {
  const email = sanitizeText(value, 320).toLowerCase();
  if (!email) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function sanitizeUuid(value: unknown): string {
  const maybeUuid = sanitizeText(value, 80).toLowerCase();
  if (!maybeUuid) return '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(maybeUuid)
    ? maybeUuid
    : '';
}

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.get('authorization') ?? '';
  if (!authHeader.toLowerCase().startsWith('bearer ')) return '';
  return authHeader.slice(7).trim();
}

function generateSlug(input: string): string {
  const normalized = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.slice(0, 60);
}

function buildRandomPassword(length = 14): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*?';
  let out = '';
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi) return `Tmp#${Date.now()}!Aa1`;
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

async function findAuthUserByEmail(supabaseAdmin: ReturnType<typeof createClient>, email: string) {
  const perPage = 200;
  let page = 1;
  for (;;) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Erro ao listar usuários auth: ${error.message}`);
    const users = data?.users ?? [];
    const found = users.find((user) => String(user.email ?? '').toLowerCase() === email);
    if (found) return found;
    if (users.length < perPage) return null;
    page += 1;
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

    const token = extractBearerToken(req);
    if (!token) return jsonResponse(req, 401, { error: 'Sessão inválida.' });

    const { data: authData, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !authData?.user) return jsonResponse(req, 401, { error: 'Não autorizado.' });

    const requesterEmail = sanitizeEmail(authData.user.email ?? '');
    if (requesterEmail !== MASTER_ADMIN_EMAIL) {
      return jsonResponse(req, 403, { error: 'Acesso restrito ao usuário master.' });
    }

    const payload = await req.json().catch(() => null);
    const action = sanitizeText((payload as Record<string, unknown> | null)?.action ?? '', 40);
    if (!action) return jsonResponse(req, 400, { error: 'Ação não informada.' });

    if (action === 'list') {
      const { data: tenants, error: tenantError } = await supabaseAdmin
        .from('tenants')
        .select('id, slug, display_name, owner_user_id, status, created_at, updated_at')
        .order('created_at', { ascending: false });
      if (tenantError) throw new Error(`Erro ao listar empresas: ${tenantError.message}`);

      const safeTenants = (tenants ?? []).map((tenant) => ({
        id: String(tenant.id),
        slug: sanitizeText(tenant.slug, 80),
        display_name: sanitizeText(tenant.display_name, 180),
        owner_user_id: sanitizeUuid(tenant.owner_user_id),
        status: sanitizeText(tenant.status, 20),
        created_at: tenant.created_at,
        updated_at: tenant.updated_at,
      }));

      const ownerIds = [...new Set(safeTenants.map((tenant) => tenant.owner_user_id).filter(Boolean))];
      const ownersById = new Map<string, { email: string; full_name: string }>();
      if (ownerIds.length > 0) {
        const { data: profiles, error: profileError } = await supabaseAdmin
          .from('user_profiles')
          .select('user_id, email, full_name')
          .in('user_id', ownerIds);
        if (profileError) throw new Error(`Erro ao listar perfis de usuários: ${profileError.message}`);
        (profiles ?? []).forEach((profile) => {
          ownersById.set(String(profile.user_id), {
            email: sanitizeEmail(profile.email),
            full_name: sanitizeText(profile.full_name, 160),
          });
        });
      }

      const { data: memberRows, error: memberError } = await supabaseAdmin
        .from('tenant_members')
        .select('tenant_id, user_id, role, status')
        .in('tenant_id', safeTenants.map((tenant) => tenant.id));
      if (memberError) throw new Error(`Erro ao listar membros por empresa: ${memberError.message}`);

      const memberCountByTenant = new Map<string, number>();
      (memberRows ?? []).forEach((row) => {
        const tenantId = String(row.tenant_id ?? '');
        if (!tenantId) return;
        memberCountByTenant.set(tenantId, (memberCountByTenant.get(tenantId) ?? 0) + 1);
      });

      return jsonResponse(req, 200, {
        tenants: safeTenants.map((tenant) => ({
          ...tenant,
          owner_email: ownersById.get(tenant.owner_user_id)?.email ?? '',
          owner_name: ownersById.get(tenant.owner_user_id)?.full_name ?? '',
          member_count: memberCountByTenant.get(tenant.id) ?? 0,
        })),
      });
    }

    if (action === 'create') {
      const raw = payload as Record<string, unknown>;
      const displayName = sanitizeText(raw.display_name, 180);
      const ownerEmail = sanitizeEmail(raw.owner_email);
      const ownerName = sanitizeText(raw.owner_name, 160);
      const providedSlug = sanitizeText(raw.slug, 80);
      const desiredStatus = sanitizeText(raw.status, 20).toLowerCase() || 'active';
      const passwordInput = sanitizeText(raw.owner_password, 160);

      if (!displayName) return jsonResponse(req, 400, { error: 'Nome da empresa é obrigatório.' });
      if (!ownerEmail) return jsonResponse(req, 400, { error: 'E-mail do proprietário inválido.' });
      if (!ALLOWED_STATUSES.has(desiredStatus)) return jsonResponse(req, 400, { error: 'Status inválido.' });

      const tenantSlugBase = generateSlug(providedSlug || displayName) || `empresa-${Date.now()}`;
      let tenantSlug = tenantSlugBase;
      let suffix = 2;
      for (;;) {
        const { data: existingSlug, error: slugError } = await supabaseAdmin
          .from('tenants')
          .select('id')
          .eq('slug', tenantSlug)
          .maybeSingle();
        if (slugError) throw new Error(`Erro ao validar slug: ${slugError.message}`);
        if (!existingSlug) break;
        tenantSlug = `${tenantSlugBase}-${suffix}`;
        suffix += 1;
      }

      let authUser = await findAuthUserByEmail(supabaseAdmin, ownerEmail);
      let generatedPassword = '';
      if (!authUser) {
        generatedPassword = passwordInput || buildRandomPassword();
        const { data: createdUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
          email: ownerEmail,
          password: generatedPassword,
          email_confirm: true,
          user_metadata: { full_name: ownerName || null },
        });
        if (createUserError || !createdUser?.user) {
          throw new Error(`Erro ao criar usuário proprietário: ${createUserError?.message ?? 'falha desconhecida'}`);
        }
        authUser = createdUser.user;
      }

      const ownerUserId = sanitizeUuid(authUser.id);
      if (!ownerUserId) throw new Error('Usuário proprietário inválido.');

      const { data: tenant, error: tenantInsertError } = await supabaseAdmin
        .from('tenants')
        .insert({
          slug: tenantSlug,
          display_name: displayName,
          owner_user_id: ownerUserId,
          status: desiredStatus,
        })
        .select('id, slug, display_name, owner_user_id, status, created_at')
        .single();
      if (tenantInsertError) throw new Error(`Erro ao criar empresa: ${tenantInsertError.message}`);

      const { error: memberUpsertError } = await supabaseAdmin
        .from('tenant_members')
        .upsert({
          tenant_id: tenant.id,
          user_id: ownerUserId,
          role: 'owner',
          status: 'active',
        }, { onConflict: 'tenant_id,user_id' });
      if (memberUpsertError) throw new Error(`Erro ao vincular proprietário na empresa: ${memberUpsertError.message}`);

      const { error: profileUpsertError } = await supabaseAdmin
        .from('user_profiles')
        .upsert({
          user_id: ownerUserId,
          email: ownerEmail,
          full_name: ownerName || null,
          is_active: true,
        }, { onConflict: 'user_id' });
      if (profileUpsertError) throw new Error(`Erro ao atualizar perfil do proprietário: ${profileUpsertError.message}`);

      await supabaseAdmin.rpc('ensure_tenant_branding_row', { p_tenant_id: tenant.id }).catch(() => null);

      return jsonResponse(req, 200, {
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          display_name: tenant.display_name,
          owner_user_id: tenant.owner_user_id,
          status: tenant.status,
          created_at: tenant.created_at,
          owner_email: ownerEmail,
          owner_name: ownerName,
        },
        generated_password: generatedPassword || null,
      });
    }

    if (action === 'set_status') {
      const raw = payload as Record<string, unknown>;
      const tenantId = sanitizeUuid(raw.tenant_id);
      const status = sanitizeText(raw.status, 20).toLowerCase();
      if (!tenantId) return jsonResponse(req, 400, { error: 'tenant_id inválido.' });
      if (!ALLOWED_STATUSES.has(status)) return jsonResponse(req, 400, { error: 'Status inválido.' });

      const { data: updatedTenant, error: updateError } = await supabaseAdmin
        .from('tenants')
        .update({ status })
        .eq('id', tenantId)
        .select('id, status, updated_at')
        .single();
      if (updateError) throw new Error(`Erro ao atualizar status da empresa: ${updateError.message}`);

      if (status !== 'active') {
        await supabaseAdmin
          .from('tenant_members')
          .update({ status: 'disabled' })
          .eq('tenant_id', tenantId)
          .eq('status', 'active');
      }

      return jsonResponse(req, 200, { tenant: updatedTenant });
    }

    if (action === 'delete') {
      const raw = payload as Record<string, unknown>;
      const tenantId = sanitizeUuid(raw.tenant_id);
      const force = raw.force === true;
      if (!tenantId) return jsonResponse(req, 400, { error: 'tenant_id inválido.' });

      const { count: docCount, error: docCountError } = await supabaseAdmin
        .from('documentos')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);
      if (docCountError) throw new Error(`Erro ao validar documentos da empresa: ${docCountError.message}`);

      if ((docCount ?? 0) > 0 && !force) {
        return jsonResponse(req, 409, {
          error: `Empresa possui ${docCount} documento(s). Reenvie com force=true para excluir mesmo assim.`,
          requires_force: true,
          document_count: docCount,
        });
      }

      const { error: deleteError } = await supabaseAdmin
        .from('tenants')
        .delete()
        .eq('id', tenantId);
      if (deleteError) throw new Error(`Erro ao excluir empresa: ${deleteError.message}`);

      return jsonResponse(req, 200, { success: true, deleted_tenant_id: tenantId, detached_documents: docCount ?? 0 });
    }

    return jsonResponse(req, 400, { error: 'Ação inválida.' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno.';
    return jsonResponse(req, 500, { error: message });
  }
});

