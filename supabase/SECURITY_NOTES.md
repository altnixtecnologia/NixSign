# Segurança - Assinador de Documentos

## O que foi reforçado no código
- `supabase/functions/salvar-assinatura/index.ts`
  - validação de payload (campos obrigatórios, e-mail, CPF/CNPJ, formato da assinatura)
  - prevenção de assinatura duplicada por documento
  - respostas HTTP específicas (`400`, `404`, `409`, `413`, `500`)
  - suporte a `ALLOWED_ORIGINS` para CORS mais restritivo

## Próximo passo recomendado (banco)
- Arquivo base: `supabase/sql/security_hardening.sql`
  - índice único em `assinaturas(documento_id)` para blindar duplicidade
  - bloco opcional de RLS comentado para validar antes em staging

## Checklist antes de aplicar em produção
1. Validar o SQL em ambiente de teste com cópia de dados.
2. Fazer backup completo do banco.
3. Aplicar em janela de baixo tráfego.
4. Testar:
   - geração de link no painel
   - assinatura pelo cliente
   - download de PDF assinado
   - consulta no painel
