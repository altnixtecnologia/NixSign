// supabase/functions/aplicar-marca-dagua-upload/index.ts
// FUNÇÃO FINAL CORRIGIDA - RESOLVIDO O ERRO 'NaN' NA OPACIDADE

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument } from 'https://esm.sh/pdf-lib@1.17.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// URL da Logo (Confirmada como PNG)
const LOGO_URL = "https://nlefwzyyhspyqcicfouc.supabase.co/storage/v1/object/public/logo/logo-retangular-branca.png";

// --- SERVIDOR PRINCIPAL ---
serve(async (req) => {
  console.log("[aplicar-marca-dagua] Função iniciada para PDF estático.");

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { storagePath, docId } = await req.json();
    if (!storagePath || !docId) {
      throw new Error("Caminho do Storage e ID do documento não fornecidos.");
    }
    
    const supabaseAdmin = createClient( Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SERVICE_KEY') ?? '' );

    // 1. Baixar o PDF original do Storage
    const { data: originalPdfFile, error: pdfDownloadError } = await supabaseAdmin.storage.from('documentos').download(storagePath);
    if (pdfDownloadError) throw new Error(`Erro ao baixar PDF: ${pdfDownloadError.message}`);
    const originalPdfBytes = await originalPdfFile.arrayBuffer();

    // 2. Baixar a logo (PNG)
    const logoResponse = await fetch(LOGO_URL);
    if (!logoResponse.ok) throw new Error(`Falha ao baixar logo da URL: ${LOGO_URL} | Status: ${logoResponse.status}`);
    const logoBytes = await logoResponse.arrayBuffer();
    
    // 3. Manipular PDF
    const pdfDoc = await PDFDocument.load(originalPdfBytes);
    
    // Tentamos PNG. Se o arquivo for um JPG disfarçado de PNG, ele falhará
    const logoImage = await pdfDoc.embedPng(logoBytes); 
    
    const pages = pdfDoc.getPages();
    
    const logoWidth = 450; 
    const logoOpacity = 0.2; // 20% de visibilidade

    // 4. Aplicar Marca D'Água em TODAS as páginas
    for (const page of pages) {
        const { width, height } = page.getSize();
        
        const imageWidth = logoImage.width; 
        const imageHeight = logoImage.height;
        
        // Calcular altura escalada para manter a proporção
        const scaledLogoHeight = imageHeight * (logoWidth / imageWidth);
        
        // Calcular posição centralizada
        const x = (width / 2) - (logoWidth / 2); 
        const y = (height / 2) - (scaledLogoHeight / 2);
        
        // *** CORREÇÃO AQUI ***
        // Passamos a opacidade DIRETAMENTE no objeto drawImage, 
        // em vez de usar pushOperators, para evitar o erro NaN.
        page.drawImage(logoImage, {
            x: x,
            y: y,
            width: logoWidth,
            height: scaledLogoHeight,
            opacity: logoOpacity, // Passar a opacidade diretamente no objeto
        });
    }

    // 5. Salvar e 6. Upload (Substituir o PDF original no Storage)
    const finalPdfBytes = await pdfDoc.save();
    
    const { error: uploadError } = await supabaseAdmin.storage
        .from('documentos')
        .upload(storagePath, finalPdfBytes, { 
            contentType: 'application/pdf', 
            upsert: true // Sobrescreve o arquivo original que acabamos de baixar
        });
        
    if (uploadError) throw new Error(`Erro ao fazer upload do PDF processado: ${uploadError.message}`);

    console.log(`[aplicar-marca-dagua] Marca d'água aplicada e arquivo salvo: ${storagePath}`);
    
    return new Response(JSON.stringify({ success: true, message: 'Marca d\'água aplicada.' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
        status: 200 
    });

  } catch (error) {
    // Se o erro for aqui, o log no console do Supabase será o mais claro possível.
    console.error(`!!! ERRO na função aplicar-marca-dagua-upload !!!`, error);
    return new Response(JSON.stringify({ error: error.message }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, 
      status: 500 
    });
  }
});