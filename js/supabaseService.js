// js/supabaseService.js
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = self.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- FUNÇÕES DO PAINEL ADMIN ---

export async function getDocuments(page, itemsPerPage, filter, searchTerm) {
    const from = page * itemsPerPage;
    const to = from + itemsPerPage - 1;

    let query = supabase
        .from('documentos')
        .select(`
            id, created_at, status, cliente_email, nome_cliente, n_os, status_os, 
            caminho_arquivo_storage, caminho_arquivo_assinado, link_assinatura, erp_link,
            admin_id, admin_email, tipo_documento,
            assinaturas ( nome_signatario, cpf_cnpj_signatario, email_signatario, assinado_em, data_hora_local, google_user_id, ip_signatario )
        `, { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(from, to);

    if (filter !== 'todos') {
        query = query.eq('status', filter);
    }
    if (searchTerm) {
        query = query.or(`caminho_arquivo_storage.ilike.%${searchTerm}%,cliente_email.ilike.%${searchTerm}%,nome_cliente.ilike.%${searchTerm}%,n_os.ilike.%${searchTerm}%,status_os.ilike.%${searchTerm}%,assinaturas.nome_signatario.ilike.%${searchTerm}%`);
    }

    const { data, count, error } = await query;

    if (error) throw error;
    return { data, count };
}

export async function uploadFile(fileName, file) {
    const { data, error } = await supabase.storage.from('documentos').upload(fileName, file);
    if (error) throw error;
    return data;
}

// Função para obter o próximo número sequencial para Contratos
export async function getNextContractNumber() {
    const { count, error } = await supabase
        .from('documentos')
        .select('*', { count: 'exact', head: true })
        .eq('tipo_documento', 'contrato');

    if (error) {
        console.error("Erro ao gerar sequência:", error);
        return '001'; 
    }
    
    const nextNum = count + 1;
    // Retorna formatado com 3 dígitos (ex: 005)
    return String(nextNum).padStart(3, '0');
}

export async function saveDocumentData(documentData) {
    const { data, error } = await supabase.functions.invoke('criar-documento-seguro', {
        body: documentData
    });
    if (error) {
        const isLocalDev = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
        if (isLocalDev) {
            console.warn('[LGPD fallback local] criar-documento-seguro indisponível, usando insert legado somente para desenvolvimento local.');
            const legacyDoc = { ...documentData };
            delete legacyDoc.site_base_url;
            const { data: legacyData, error: legacyError } = await supabase.from('documentos').insert(legacyDoc).select('id').single();
            if (legacyError) throw legacyError;
            return legacyData;
        }
        throw error;
    }
    return data;
}

// Mantida para compatibilidade (redireciona para saveDocumentData)
export async function createDocumentRecord(documentData) {
    return await saveDocumentData(documentData);
}

export async function updateDocumentLink(docId, link) {
    const { error } = await supabase
        .from('documentos')
        .update({ link_assinatura: link })
        .eq('id', docId);
    if (error) throw error;
}

export async function deleteDocument(docId) {
    // Apaga primeiro as assinaturas (chave estrangeira)
    const { error: signError } = await supabase.from('assinaturas').delete().eq('documento_id', docId);
    if (signError) throw signError;

    // Depois apaga o documento principal
    const { error: docError } = await supabase.from('documentos').delete().eq('id', docId);
    if (docError) throw docError;
}

// --- FUNÇÕES DE WORKSPACE / USUÁRIOS / CLIENTES ---

export async function ensureTenantWorkspace(displayName = null) {
    const { data, error } = await supabase.rpc('ensure_personal_tenant', {
        p_display_name: displayName,
    });
    if (error) throw error;
    return data;
}

export async function acceptPendingInvites() {
    const { data, error } = await supabase.rpc('accept_pending_invites');
    if (error) throw error;
    return data;
}

export async function getMyWorkspace() {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const user = authData?.user;
    if (!user) return null;

    const { data, error } = await supabase
        .from('tenant_members')
        .select(`
            id,
            tenant_id,
            role,
            status,
            tenants (
                id,
                slug,
                display_name,
                status
            )
        `)
        .eq('user_id', user.id)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (error) throw error;
    if (!data) return null;

    const tenant = data.tenants || {};
    return {
        membershipId: data.id,
        tenantId: data.tenant_id,
        role: data.role,
        tenantName: tenant.display_name || 'Workspace',
        tenantSlug: tenant.slug || '',
        tenantStatus: tenant.status || 'active',
    };
}

export async function upsertMyUserProfile(profileData = {}) {
    const { data: authData, error: authError } = await supabase.auth.getUser();
    if (authError) throw authError;
    const user = authData?.user;
    if (!user) throw new Error('Usuário não autenticado.');

    const payload = {
        user_id: user.id,
        email: (profileData.email || user.email || '').toLowerCase(),
        full_name: profileData.full_name || user.user_metadata?.full_name || null,
        phone: profileData.phone || null,
        avatar_url: profileData.avatar_url || user.user_metadata?.avatar_url || null,
        is_active: true,
    };

    const { data, error } = await supabase
        .from('user_profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .single();

    if (error) throw error;
    return data;
}

export async function getTenantBranding(tenantId) {
    const { data, error } = await supabase
        .from('tenant_branding')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();
    if (error) throw error;
    return data;
}

export async function upsertTenantBranding(brandingData) {
    const payload = {
        tenant_id: brandingData.tenant_id,
        company_display_name: brandingData.company_display_name || null,
        company_legal_name: brandingData.company_legal_name || null,
        company_tax_id: brandingData.company_tax_id || null,
        primary_email: brandingData.primary_email || null,
        secondary_email: brandingData.secondary_email || null,
        logo_public_url: brandingData.logo_public_url || null,
        watermark_enabled: brandingData.watermark_enabled !== false,
        watermark_mode: brandingData.watermark_mode || 'logo',
        watermark_image_url: brandingData.watermark_image_url || null,
        watermark_text: brandingData.watermark_text || null,
        watermark_opacity: brandingData.watermark_opacity ?? 0.15,
        watermark_scale: brandingData.watermark_scale ?? 0.3,
        company_google_numeric_id: brandingData.company_google_numeric_id || null,
        signature_company_label: brandingData.signature_company_label || 'Assinatura da empresa',
        signature_client_label: brandingData.signature_client_label || 'Assinatura do cliente',
    };

    const { data, error } = await supabase
        .from('tenant_branding')
        .upsert(payload, { onConflict: 'tenant_id' })
        .select('*')
        .single();
    if (error) throw error;
    return data;
}

export async function listTenantMembers(tenantId) {
    const { data, error } = await supabase
        .from('tenant_members')
        .select('id, tenant_id, user_id, role, status, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function listUserProfiles(userIds) {
    if (!Array.isArray(userIds) || userIds.length === 0) return [];
    const { data, error } = await supabase
        .from('user_profiles')
        .select('user_id, email, full_name, phone, avatar_url, is_active')
        .in('user_id', userIds);
    if (error) throw error;
    return data || [];
}

export async function updateTenantMember(memberId, patch) {
    const { data, error } = await supabase
        .from('tenant_members')
        .update(patch)
        .eq('id', memberId)
        .select('id, tenant_id, user_id, role, status, updated_at')
        .single();
    if (error) throw error;
    return data;
}

export async function listTenantInvites(tenantId) {
    const { data, error } = await supabase
        .from('tenant_invites')
        .select('id, tenant_id, email, invited_name, role, status, expires_at, created_at')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

export async function createTenantInvite({ tenantId, email, role = 'member', invitedName = null, expiresAt = null }) {
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!normalizedEmail) throw new Error('E-mail é obrigatório para convite.');

    const allowedRoles = ['owner', 'admin', 'manager', 'member', 'billing'];
    const safeRole = allowedRoles.includes(role) ? role : 'member';
    const token = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID().replace(/-/g, '')
        : `${Date.now()}${Math.random().toString(16).slice(2)}`;
    const defaultExpiry = new Date(Date.now() + (1000 * 60 * 60 * 24 * 7)).toISOString(); // +7 dias

    const { data, error } = await supabase
        .from('tenant_invites')
        .insert({
            tenant_id: tenantId,
            email: normalizedEmail,
            invited_name: invitedName,
            role: safeRole,
            token,
            status: 'pending',
            expires_at: expiresAt || defaultExpiry,
        })
        .select('id, email, role, status, expires_at, created_at')
        .single();

    if (error) throw error;
    return data;
}

export async function revokeTenantInvite(inviteId) {
    const { data, error } = await supabase
        .from('tenant_invites')
        .update({ status: 'revoked' })
        .eq('id', inviteId)
        .select('id, status')
        .single();
    if (error) throw error;
    return data;
}

export async function listTenantClients(tenantId) {
    const { data, error } = await supabase
        .from('tenant_clients')
        .select('id, tenant_id, display_name, email, phone, document_id, notes, status, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .order('display_name', { ascending: true });
    if (error) throw error;
    return data || [];
}

export async function upsertTenantClient(clientData) {
    const payload = {
        tenant_id: clientData.tenant_id,
        display_name: clientData.display_name,
        email: clientData.email || null,
        phone: clientData.phone || null,
        document_id: clientData.document_id || null,
        notes: clientData.notes || null,
        status: clientData.status || 'active',
        created_by: clientData.created_by || null,
    };

    if (clientData.id) {
        const { data, error } = await supabase
            .from('tenant_clients')
            .update(payload)
            .eq('id', clientData.id)
            .select('*')
            .single();
        if (error) throw error;
        return data;
    }

    const { data, error } = await supabase
        .from('tenant_clients')
        .insert(payload)
        .select('*')
        .single();
    if (error) throw error;
    return data;
}

export async function setTenantClientStatus(clientId, status) {
    const { data, error } = await supabase
        .from('tenant_clients')
        .update({ status })
        .eq('id', clientId)
        .select('id, status')
        .single();
    if (error) throw error;
    return data;
}

// --- FUNÇÕES MASTER (CLIENTES DO SISTEMA / EMPRESAS) ---

async function invokeMasterTenantAdmin(body) {
    const { data, error } = await supabase.functions.invoke('master-tenant-admin', { body });
    if (error) {
        let message = error.message || 'Falha na operação de administração.';
        try {
            const response = error.context;
            if (response && typeof response.json === 'function') {
                const payload = await response.json();
                if (payload?.error) message = String(payload.error);
            }
        } catch (_) {
            // mantém mensagem padrão
        }
        throw new Error(message);
    }
    return data;
}

export async function listSystemTenants() {
    return await invokeMasterTenantAdmin({ action: 'list' });
}

export async function createSystemTenant(payload) {
    return await invokeMasterTenantAdmin({ action: 'create', ...payload });
}

export async function updateSystemTenantStatus(tenantId, status) {
    return await invokeMasterTenantAdmin({ action: 'set_status', tenant_id: tenantId, status });
}

export async function updateSystemTenantProfile(payload) {
    return await invokeMasterTenantAdmin({ action: 'upsert_profile', ...payload });
}

export async function setSystemTenantGoogleAccess(tenantId, allowGoogleLogin) {
    return await invokeMasterTenantAdmin({
        action: 'set_google_login',
        tenant_id: tenantId,
        allow_google_login: allowGoogleLogin === true,
    });
}

export async function deleteSystemTenant(tenantId, force = false) {
    return await invokeMasterTenantAdmin({ action: 'delete', tenant_id: tenantId, force: force === true });
}

export function getPublicUrl(path) {
    const { data } = supabase.storage.from('documentos').getPublicUrl(path);
    return data.publicUrl;
}

// --- FUNÇÕES DA PÁGINA DE ASSINATURA ---

export async function checkIfSigned(docId) {
    const { data, error } = await supabase
        .from('assinaturas')
        .select('id')
        .eq('documento_id', docId);

    if (error) {
        console.error("Erro em checkIfSigned:", error);
        return false;
    }
    return data && data.length > 0;
}

export async function signInWithGoogle() {
    const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.href }
    });
    if (error) throw error;
}

export async function getDocumentForSigning(docId) {
    const { data, error } = await supabase.from('documentos').select('caminho_arquivo_storage').eq('id', docId).single();
    if (error) throw error;
    return data;
}

export async function submitSignature(signatureData) {
    const { data, error } = await supabase.functions.invoke('salvar-assinatura', {
        body: signatureData,
    });
    if (error) {
        let message = error.message || 'Falha ao enviar assinatura.';
        try {
            const response = error.context;
            if (response && typeof response.json === 'function') {
                const payload = await response.json();
                if (payload?.error) message = String(payload.error);
            }
        } catch (_) {
            // mantém a mensagem padrão caso não seja possível ler o body da resposta
        }
        throw new Error(message);
    }
    return data;
}
