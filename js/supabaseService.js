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
            assinaturas ( nome_signatario, cpf_cnpj_signatario, email_signatario, assinado_em, imagem_assinatura_base64, data_hora_local, google_user_id, ip_signatario )
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
    const { data, error } = await supabase.from('documentos').insert(documentData).select('id').single();
    if (error) throw error;
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
    if (error) throw error;
    return data;
}
