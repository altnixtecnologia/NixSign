// supabase/functions/test-key/index.ts

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (_req) => {
  // Lida com a requisição pre-flight (CORS)
  if (_req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // 1. Tenta ler o segredo
    const API_KEY = Deno.env.get('BROWSERLESS_API_KEY');
    if (!API_KEY) {
      throw new Error("O segredo 'BROWSERLESS_API_KEY' não foi encontrado no ambiente da função.");
    }

    // 2. Faz uma chamada simples para um endpoint de status do Browserless
    const response = await fetch("https://chrome.browserless.io/api/v1/status", {
      method: 'GET',
      headers: {
        // A autenticação para a API REST é via Header 'Authorization'
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    // 3. Retorna um resultado claro
    if (response.ok) {
      return new Response(
        JSON.stringify({ 
          status: "SUCESSO", 
          message: "A chave API é válida e a conexão com o Browserless funcionou." 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    } else {
      // Se a chave for inválida, o status será 403
      throw new Error(`Falha na autenticação com o Browserless. Status: ${response.status} - ${response.statusText}`);
    }

  } catch (error) {
    return new Response(
      JSON.stringify({ 
        status: "ERRO", 
        message: error.message 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});