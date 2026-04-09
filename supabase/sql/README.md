# SQL Organization (NixSign)

Padrão adotado:
- Todos os arquivos `.sql` ficam em `supabase/sql`.
- Um arquivo por assunto (sem duplicatas antigas).
- Ao atualizar um assunto, manter apenas a versão final do arquivo.

Arquivos atuais:
- `multitenant_phase1_safe.sql`: estrutura SaaS multi-tenant (não destrutiva).
- `security_hardening.sql`: hardening de segurança (com bloco opcional de RLS).
- `backups/`: dumps de backup gerados antes de mudanças críticas.
