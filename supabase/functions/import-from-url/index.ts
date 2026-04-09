import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Importa uma biblioteca para "ler" o HTML
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json();
    if (!url || !url.includes('doc.view')) {
        throw new Error('URL do ERP inválida ou não reconhecida.');
    }

    // 1. Busca o CONTEÚDO HTML da página do ERP
    const pageResponse = await fetch(url);
    if (!pageResponse.ok) {
      throw new Error(`Não foi possível acessar a página do ERP. Status: ${pageResponse.status}`);
    }
    const htmlText = await pageResponse.text();

    // 2. Extrai os dados do HTML usando o DOMParser
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    if (!doc) throw new Error("Não foi possível parsear o HTML do ERP.");
    
    const osMatch = doc.querySelector('h2')?.textContent.match(/Nº (\d+)/);
    const numeroOs = osMatch ? osMatch[1] : '';
    
    const clienteTd = doc.querySelectorAll("table[style='text-align: left;'] td")[0];
    const clienteData = clienteTd.innerHTML.split('<br>').map(item => item.trim());
    const clienteNome = clienteData[0];
    const clienteEndereco = clienteData[2] + ', ' + clienteData[3];
    const clienteFoneMatch = clienteData[4].match(/Fone: (.*?),/);
    const clienteTelefone = clienteFoneMatch ? clienteFoneMatch[1] : '';
    const clienteEmailEl = clienteTd.querySelector('a');
    const clienteEmail = clienteEmailEl ? clienteEmailEl.textContent : '';

    const dataEmissaoEl = Array.from(doc.querySelectorAll('th')).find(th => th.textContent === 'Data');
    const dataEmissao = dataEmissaoEl ? dataEmissaoEl.nextElementSibling.textContent : '';

    const extractTableData = (headerText) => {
        const header = Array.from(doc.querySelectorAll('h4')).find(h4 => h4.textContent === headerText);
        if (!header) return { html: '', total: '0,00' };
        const table = header.nextElementSibling;
        const rows = table.querySelectorAll('tr:not(:first-child)');
        let total = 0;
        let html = '';
        if(headerText === 'Serviços') {
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                const desc = cells[0].textContent.trim();
                const valor = cells[5].textContent.trim();
                html += `<tr><td>${desc}</td><td class="text-right">${valor}</td></tr>`;
                total += parseFloat(valor.replace(',', '.'));
            });
        } else if (headerText === 'Peças') {
            rows.forEach(row => {
                const cells = row.querySelectorAll('td');
                const desc = cells[0].textContent.trim();
                const qtd = cells[2].textContent.trim();
                const precoUn = cells[4].textContent.trim();
                const valor = cells[6].textContent.trim();
                html += `<tr><td>${desc}</td><td class="text-right">${qtd}</td><td class="text-right">${precoUn}</td><td class="text-right">${valor}</td></tr>`;
                total += parseFloat(valor.replace(',', '.'));
            });
        }
        return { html, total: total.toFixed(2).replace('.', ',') };
    };
    
    const servicos = extractTableData('Serviços');
    const pecas = extractTableData('Peças');
    const totalGeralEl = Array.from(doc.querySelectorAll('th')).find(th => th.textContent === 'Total ordem de serviço');
    const totalGeral = totalGeralEl ? totalGeralEl.parentElement.nextElementSibling.querySelectorAll('td')[2].textContent.trim() : '0,00';

    // 3. Busca o template HTML do seu projeto no GitHub
    const templateUrl = `https://raw.githubusercontent.com/altnixtecnologia/assinador-os/main/template-os.html`;
    const templateResponse = await fetch(templateUrl);
    if (!templateResponse.ok) throw new Error("Não foi possível encontrar o arquivo template-os.html no GitHub.");
    let htmlTemplate = await templateResponse.text();

    // 4. Preenche o template com os dados extraídos
    htmlTemplate = htmlTemplate
        .replace('{{NUMERO_OS}}', numeroOs)
        .replace('{{DATA_EMISSAO}}', dataEmissao)
        .replace('{{CLIENTE_NOME}}', clienteNome)
        .replace('{{CLIENTE_ENDERECO}}', clienteEndereco)
        .replace('{{CLIENTE_TELEFONE}}', clienteTelefone)
        .replace('{{CLIENTE_EMAIL}}', clienteEmail)
        .replace('{{SERVICOS_ITENS}}', servicos.html)
        .replace('{{PECAS_ITENS}}', pecas.html)
        .replace('{{TOTAL_SERVICOS}}', servicos.total)
        .replace('{{TOTAL_PECAS}}', pecas.total)
        .replace('{{TOTAL_GERAL}}', totalGeral);

    // 5. Envia o HTML para o ApiFlash para gerar o PDF
    const accessKey = Deno.env.get('APIFLASH_ACCESS_KEY');
    if (!accessKey) throw new Error('Chave da ApiFlash não configurada.');
    
    const apiUrl = `https://api.apiflash.com/v1/urltopdf?access_key=${accessKey}&url=data:text/html,${encodeURIComponent(htmlTemplate)}&format=A4`;
    const pdfResponse = await fetch(apiUrl);
    if (!pdfResponse.ok) {
        const errorBody = await pdfResponse.text();
        throw new Error(`Erro ao converter HTML em PDF. Status: ${pdfResponse.status}. Detalhes: ${errorBody}`);
    }
    const pdfBlob = await pdfResponse.blob();

    // 6. Salva o PDF recém-criado no Supabase Storage
    const storageFileName = `${Date.now()}-os-${numeroOs}.pdf`;
    const supabaseAdmin = createClient(Deno.env.get('PROJECT_URL') ?? '', Deno.env.get('SERVICE_ROLE_KEY') ?? '');
    const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
      .from('documentos')
      .upload(storageFileName, pdfBlob, { contentType: 'application/pdf', upsert: false });

    if (uploadError) throw uploadError;
    
    return new Response(JSON.stringify({ path: uploadData.path, name: `os-${numeroOs}.pdf`, originalUrl: url }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200,
    });

  } catch (error) {
    console.error('Erro na função import-from-url:', error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400,
    });
  }
});