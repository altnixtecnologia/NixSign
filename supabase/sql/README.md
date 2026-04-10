# SQL Organization (NixSign)

Padrão adotado:
- Todos os arquivos `.sql` ficam em `supabase/sql`.
- Um arquivo por assunto (sem duplicatas antigas).
- Ao atualizar um assunto, manter apenas a versão final do arquivo.

Arquivos atuais:
- `multitenant_phase1_safe.sql`: estrutura SaaS multi-tenant (não destrutiva).
- `user_access_and_registry.sql`: login por usuários cadastrados, gestão de membros/convites e cadastro de clientes por tenant.
- `tenant_branding_and_watermark.sql`: identidade visual por tenant (marca, logo, marca d'água e contatos).
- `security_hardening.sql`: hardening de segurança (com bloco opcional de RLS).
- `legal_signature_hardening.sql`: trilha de evidência jurídica para assinaturas e criação de documentos.
- `lgpd_compliance_controls.sql`: controles LGPD (consentimento, minimização e solicitações de titulares).
- `backups/`: dumps de backup gerados antes de mudanças críticas.

## Ordem recomendada
1. Fazer backup de dados.
2. Executar `security_hardening.sql`.
3. Executar `legal_signature_hardening.sql`.
4. Executar `lgpd_compliance_controls.sql`.
5. Executar `multitenant_phase1_safe.sql`.
6. Executar `user_access_and_registry.sql`.
7. Executar `tenant_branding_and_watermark.sql`.

## Supabase (layout novo) - onde pegar senha/URL do banco
- No dashboard do projeto, clique em `Connect` (topo da tela) para ver as connection strings.
- Para resetar/copiar a senha do Postgres: `Project Settings` -> `Database` -> `Database password`.
- A senha do banco **nao** e a `service_role key`; sao credenciais diferentes.
