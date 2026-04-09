// supabase/functions/finalizar-pdf-estatico/index.ts
// ARQUIVO 2/5 - CORRIGIDO (Regra 1: Remoção Marca D'água, Regra 4: Texto "Responsável")

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { PDFDocument, rgb, StandardFonts } from 'https://esm.sh/pdf-lib@1.17.1'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  console.log("[finalizar-pdf-estatico] Função iniciada.");

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { storagePath, docId } = await req.json();
    if (!storagePath) {
      throw new Error("Caminho do Storage (storagePath) não fornecido.");
    }

    const supabaseAdmin = createClient(
      Deno.env.get('PROJECT_URL') ?? '',
      Deno.env.get('SERVICE_ROLE_KEY') ?? ''
    );

    // 1. Baixar o PDF original
    console.log(`[finalizar-pdf-estatico] Baixando PDF de: ${storagePath}`);
    const { data: pdfBlob, error: downloadError } = await supabaseAdmin.storage
      .from('documentos')
      .download(storagePath);

    if (downloadError) throw downloadError;

    const pdfBytes = await pdfBlob.arrayBuffer();
    const pdfDoc = await PDFDocument.load(pdfBytes);
    
    // ----------------------------------------------------------------------
    // LÓGICA DA MARCA D'ÁGUA REMOVIDA (Regra 1)
    // ----------------------------------------------------------------------
    // console.log("[finalizar-pdf-estatico] Lógica da marca d'água pulada (será aplicada na assinatura).");

    // ----------------------------------------------------------------------
    // 3. ADICIONAR LINHAS DE ASSINATURA NA PÁGINA 2
    // ----------------------------------------------------------------------
    if (pdfDoc.getPageCount() >= 2) {
        console.log("[finalizar-pdf-estatico] Adicionando linhas de assinatura na Página 2...");
        const page2 = pdfDoc.getPage(1); // Página 2 (índice 1)
        const { width, height } = page2.getSize();
        
        const helveticaItalicFont = await pdfDoc.embedFont(StandardFonts.HelveticaOblique);
        const fontSize = 10;
        const textHeight = helveticaItalicFont.heightAtSize(fontSize) + 2;
        const lineOpacity = 0.8;
        const textOpacity = 0.8;
        
        // Posição vertical (80px do rodapé)
        const bottomOffset = 80;
        const adjustedBaseLineY = bottomOffset;
        
        const lineThickness = 1;
        const lineColor = rgb(0, 0, 0);
        
        // --- Linha da Empresa ---
        const techLabel = "Assinatura da Empresa (Altnix)";
        const techXStart = width * 0.10;
        const techXEnd = width * 0.40;
        const techTextWidth = helveticaItalicFont.widthOfTextAtSize(techLabel, fontSize);
        
        page2.drawLine({
            start: { x: techXStart, y: adjustedBaseLineY },
            end: { x: techXEnd, y: adjustedBaseLineY },
            thickness: lineThickness,
            color: lineColor,
            opacity: lineOpacity,
        });

        page2.drawText(techLabel, {
            x: techXStart + ((techXEnd - techXStart) / 2) - (techTextWidth / 2),
            y: adjustedBaseLineY - textHeight,
            size: fontSize,
            font: helveticaItalicFont,
            color: lineColor,
            opacity: textOpacity,
        });

        // --- Linha do Cliente ---
        const clientLabel = "Assinatura do cliente";
        const clientXStart = width * 0.55;
        const clientXEnd = width * 0.85;
        const clientTextWidth = helveticaItalicFont.widthOfTextAtSize(clientLabel, fontSize);

        page2.drawLine({
            start: { x: clientXStart, y: adjustedBaseLineY },
            end: { x: clientXEnd, y: adjustedBaseLineY },
            thickness: lineThickness,
            color: lineColor,
            opacity: lineOpacity,
        });
        
        page2.drawText(clientLabel, {
            x: clientXStart + ((clientXEnd - clientXStart) / 2) - (clientTextWidth / 2),
            y: adjustedBaseLineY - textHeight,
            size: fontSize,
            font: helveticaItalicFont,
            color: lineColor,
            opacity: textOpacity,
        });
    } else {
        console.log("[finalizar-pdf-estatico] PDF tem menos de 2 páginas, linhas não adicionadas.");
    }
    
    // 4. Salvar o PDF modificado (com linhas) por cima do original
    const modifiedPdfBytes = await pdfDoc.save();

    console.log(`[finalizar-pdf-estatico] Enviando PDF (com linhas) de volta para: ${storagePath}`);
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('documentos')
      .upload(storagePath, modifiedPdfBytes, { 
          contentType: 'application/pdf', 
          upsert: true // Sobrescreve o original
      });

    if (uploadError) throw uploadError;

    return new Response(JSON.stringify({ success: true, path: uploadData.path }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error("!!! ERRO em [finalizar-pdf-estatico] !!!", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(JSON.stringify({ success: false, message: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
