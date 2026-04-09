# Backups de Dados (NixSign)

Objetivo: gerar backup **somente de dados** antes de mudanças críticas.

## Opção 1 (recomendada com Supabase CLI + Docker)
```bash
supabase db dump --linked --data-only --use-copy --file supabase/sql/backups/nixsign_data_YYYYMMDD_HHMMSS.sql
```

## Opção 2 (sem Docker, usando `pg_dump`)
Pré-requisitos:
- `pg_dump` instalado
- senha do banco remoto do projeto

Exemplo PowerShell:
```powershell
$env:PGPASSWORD = "SUA_SENHA_DB"
& "C:\Program Files\PostgreSQL\9.5\bin\pg_dump.exe" `
  --data-only --no-owner --no-privileges `
  --dbname "host=aws-1-sa-east-1.pooler.supabase.com port=6543 user=postgres.nlefwzyyhspyqcicfouc dbname=postgres sslmode=require" `
  --file "supabase/sql/backups/nixsign_data_$(Get-Date -Format yyyyMMdd_HHmmss).sql"
Remove-Item Env:PGPASSWORD
```

## Observações
- O arquivo de backup deve ficar em `supabase/sql/backups/`.
- Evite versionar backups completos no GitHub (contém dados sensíveis).
- Sempre valide restore em ambiente de teste.
