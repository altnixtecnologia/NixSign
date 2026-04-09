// js/config.js

/**
 * Arquivo de configuração central.
 * Armazena as chaves e URLs da aplicação em um único local.
 */

// URL do seu projeto Supabase
export const SUPABASE_URL = 'https://nlefwzyyhspyqcicfouc.supabase.co';

// Chave ANÔNIMA PÚBLICA do seu projeto Supabase
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5sZWZ3enl5aHNweXFjaWNmb3VjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAyMzAyMzMsImV4cCI6MjA3NTgwNjIzM30.CpKg1MKbcTtEUfmGDzcXPvZoTQH3dygUL61yYYiLPyQ';

// URL base do site onde as páginas estão hospedadas.
// Mantém fallback para GitHub Pages e detecta automaticamente domínio/caminho atual
// para facilitar deploy em ambientes como Vercel sem alterar código.
const DEFAULT_BASE_URL = 'https://altnixtecnologia.github.io/assinador-os';
const currentBaseUrl = (() => {
    if (typeof window === 'undefined') return DEFAULT_BASE_URL;
    const pathname = window.location.pathname || '/';
    const basePath = pathname.replace(/\/[^/]*$/, '');
    return `${window.location.origin}${basePath}`;
})();
export const SITE_BASE_URL = currentBaseUrl || DEFAULT_BASE_URL;

// Número de itens por página na tela de consulta
export const ITENS_PER_PAGE = 50;
