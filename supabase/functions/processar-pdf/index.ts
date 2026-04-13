import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import pdf from "pdf-parse";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const pdfBuffer = new Uint8Array(await req.arrayBuffer());
    const data = await pdf(pdfBuffer);
    const fullText = data.text;

    const nomeRegex = /Cliente\s*\n\s*(.*)/i;
    const osRegex = /Ordem de serviço N°\s*(\d+)/i;
    const foneRegex = /(?:Celular|Telefone|Fone):\s*([+\d\s()-]+)/i;
    
    const nomeMatch = fullText.match(nomeRegex);
    const osMatch = fullText.match(osRegex);
    const foneMatch = fullText.match(foneRegex);

    let statusDoServico = null;
    const palavrasChave = ["Concluído", "Entregue", "Garantia", "Não autorizou"];
    for (const palavra of palavrasChave) {
        if (fullText.toLowerCase().includes(palavra.toLowerCase())) {
            statusDoServico = palavra;
            break;
        }
    }

    const dadosExtraidos = {
      nome_cliente: nomeMatch ? nomeMatch[1].trim() : null,
      n_os: osMatch ? osMatch[1].trim() : null, // Renomeado para clareza
      telefone_cliente: foneMatch ? foneMatch[1].trim().replace(/\D/g, '') : null,
      status_os: statusDoServico, // Alterado de dados_adicionais para status_os
    };
    
    return new Response(JSON.stringify(dadosExtraidos), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 400,
    });
  }
});
