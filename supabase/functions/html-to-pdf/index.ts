import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function sanitizeFileName(name) {
  return name.toLowerCase().replace(/[^a-z0-9.]/g, '-').replace(/-+/g, '-');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { html, originalUrl } = await req.json();
    if (!html) {
        throw new Error('Conteúdo HTML não fornecido.');
    }

    const accessKey = Deno.env.get('APIFLASH_ACCESS_KEY');
    if (!accessKey) {
        throw new Error('Chave da ApiFlash não configurada.');
    }

    // Converte o HTML para Base64 para enviar via URL
    const htmlBase64 = btoa(unescape(encodeURIComponent(html)));

    // Usa o endpoint 'html' da ApiFlash, passando o HTML diretamente
    const apiUrl = `https://api.apiflash.com/v1/urltopdf?access_key=${accessKey}&url=data:text/html;base64,${htmlBase64}&format=A4`;
    
    const pdfResponse = await fetch(apiUrl);
    if (!pdfResponse.ok) {
        const errorBody = await pdfResponse.text();
        throw new Error(`Erro ao converter HTML em PDF. Status: ${pdfResponse.status}. Detalhes: ${errorBody}`);
    }
    const pdfBlob = await pdfResponse.blob();

    let fileName = 'documento-importado.pdf';
    const contentDisposition = pdfResponse.headers.get('content-disposition');
    if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename="(.+?)"/);
        if (fileNameMatch && fileNameMatch[1]) {
            fileName = fileNameMatch[1];
        }
    }
    
    const sanitizedFileName = sanitizeFileName(fileName);
    const storageFileName = `${Date.now()}-${sanitizedFileName}`;

    const supabaseAdmin = createClient(
      Deno.env.get('PROJECT_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('documentos')
      .upload(storageFileName, pdfBlob, {
        contentType: 'application/pdf',
        upsert: false,
      });

    if (uploadError) {
      throw uploadError;
    }
    
    return new Response(JSON.stringify({ path: uploadData.path, name: sanitizedFileName, originalUrl: originalUrl }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Erro na função html-to-pdf:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400,
    });
  }
});
