param(
    [switch]$SkipSql,
    [switch]$SkipFunctions,
    [switch]$SkipVercel,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
    Write-Host "OK: $Message" -ForegroundColor Green
}

function Write-WarnLine([string]$Message) {
    Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Require-Command([string]$CommandName) {
    $cmd = Get-Command $CommandName -ErrorAction SilentlyContinue
    if (-not $cmd) {
        throw "Comando '$CommandName' nao encontrado no PATH."
    }
}

function Load-DotEnv([string]$Path) {
    $map = @{}
    if (-not (Test-Path $Path)) {
        return $map
    }

    Get-Content $Path | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith("#")) { return }

        $idx = $line.IndexOf("=")
        if ($idx -lt 1) { return }

        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()

        if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
            $val = $val.Substring(1, $val.Length - 2)
        }

        $map[$key] = $val
    }

    return $map
}

function Resolve-ProjectRef([hashtable]$EnvMap) {
    if ($EnvMap.ContainsKey("SUPABASE_PROJECT_REF") -and $EnvMap["SUPABASE_PROJECT_REF"]) {
        return $EnvMap["SUPABASE_PROJECT_REF"]
    }

    $configPath = Join-Path $PSScriptRoot "supabase/config.toml"
    if (Test-Path $configPath) {
        $configRaw = Get-Content $configPath -Raw
        $match = [regex]::Match($configRaw, 'project_id\s*=\s*"([^"]+)"')
        if ($match.Success) {
            return $match.Groups[1].Value
        }
    }

    $tempRefPath = Join-Path $PSScriptRoot "supabase/.temp/project-ref"
    if (Test-Path $tempRefPath) {
        $ref = (Get-Content $tempRefPath -Raw).Trim()
        if ($ref) { return $ref }
    }

    throw "Nao foi possivel descobrir o project_ref do Supabase."
}

function Resolve-DbUri([hashtable]$EnvMap) {
    $candidates = @(
        "SUPABASE_DB_URL",
        "DATABASE_URL",
        "POSTGRES_URL",
        "PGURL"
    )

    foreach ($name in $candidates) {
        if ($EnvMap.ContainsKey($name) -and $EnvMap[$name]) {
            return $EnvMap[$name]
        }
    }

    $poolerPath = Join-Path $PSScriptRoot "supabase/.temp/pooler-url"
    if (-not (Test-Path $poolerPath)) {
        throw "Nao encontrei SUPABASE_DB_URL no .env e nem arquivo supabase/.temp/pooler-url."
    }

    if (-not $EnvMap.ContainsKey("SUPABASE_DB_PASSWORD") -or -not $EnvMap["SUPABASE_DB_PASSWORD"]) {
        throw "SUPABASE_DB_PASSWORD nao encontrado no .env."
    }

    $uriTemplate = (Get-Content $poolerPath -Raw).Trim() -replace "`r", "" -replace "`n", ""
    if (-not $uriTemplate.Contains("[YOUR-PASSWORD]")) {
        return $uriTemplate
    }

    $encodedPassword = [uri]::EscapeDataString($EnvMap["SUPABASE_DB_PASSWORD"])
    return $uriTemplate.Replace("[YOUR-PASSWORD]", $encodedPassword)
}

function Convert-DbUriToConnMap([string]$DbUri, [hashtable]$EnvMap) {
    $uri = [System.Uri]$DbUri
    $dbHost = $uri.Host
    $dbPort = $uri.Port
    $dbName = $uri.AbsolutePath.Trim("/")

    if (-not $dbName) { $dbName = "postgres" }

    $userInfo = $uri.UserInfo
    $dbUser = ""
    $dbPasswordFromUri = ""
    if ($userInfo) {
        $userParts = $userInfo.Split(":", 2)
        $dbUser = $userParts[0]
        if ($userParts.Length -gt 1) {
            $dbPasswordFromUri = [uri]::UnescapeDataString($userParts[1])
        }
    }

    $dbPassword = ""
    if ($EnvMap.ContainsKey("SUPABASE_DB_PASSWORD") -and $EnvMap["SUPABASE_DB_PASSWORD"]) {
        $dbPassword = $EnvMap["SUPABASE_DB_PASSWORD"]
    } elseif ($dbPasswordFromUri) {
        $dbPassword = $dbPasswordFromUri
    }

    if (-not $dbUser) { throw "Usuario do banco nao encontrado na URL." }
    if (-not $dbPassword) { throw "Senha do banco nao encontrada (SUPABASE_DB_PASSWORD)." }

    $sslMode = "require"
    if ($uri.Query) {
        $query = [System.Web.HttpUtility]::ParseQueryString($uri.Query)
        if ($query["sslmode"]) { $sslMode = $query["sslmode"] }
    }

    return @{
        Host = $dbHost
        Port = $dbPort
        Name = $dbName
        User = $dbUser
        Password = $dbPassword
        SslMode = $sslMode
    }
}

function Invoke-RemoteSql([string]$SqlFileName, [hashtable]$Conn) {
    $sqlDir = Join-Path $PSScriptRoot "supabase/sql"
    $sqlFile = Join-Path $sqlDir $SqlFileName
    if (-not (Test-Path $sqlFile)) {
        throw "Arquivo SQL nao encontrado: $SqlFile"
    }

    $pgConn = "host=$($Conn.Host) port=$($Conn.Port) dbname=$($Conn.Name) user=$($Conn.User) sslmode=$($Conn.SslMode)"
    $dockerArgs = @(
        "run", "--rm",
        "-e", "PGPASSWORD=$($Conn.Password)",
        "-v", "${sqlDir}:/sql",
        "postgres:16",
        "psql", $pgConn,
        "-v", "ON_ERROR_STOP=1",
        "-f", "/sql/$SqlFileName"
    )

    if ($DryRun) {
        $maskedArgs = @(
            "run", "--rm",
            "-e", "PGPASSWORD=***",
            "-v", "${sqlDir}:/sql",
            "postgres:16",
            "psql", $pgConn,
            "-v", "ON_ERROR_STOP=1",
            "-f", "/sql/$SqlFileName"
        )
        Write-Host "[DRY-RUN] docker $($maskedArgs -join ' ')"
        return
    }

    & docker @dockerArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Falha ao aplicar SQL: $SqlFileName"
    }
}

function Deploy-SupabaseFunctions([string]$ProjectRef) {
    $functionsRoot = Join-Path $PSScriptRoot "supabase/functions"
    if (-not (Test-Path $functionsRoot)) {
        throw "Diretorio de functions nao encontrado: $functionsRoot"
    }

    $functionDirs = Get-ChildItem -Path $functionsRoot -Directory | Sort-Object Name
    if (-not $functionDirs) {
        Write-WarnLine "Nenhuma edge function encontrada para deploy."
        return
    }

    foreach ($dir in $functionDirs) {
        $fn = $dir.Name
        if ($DryRun) {
            Write-Host "[DRY-RUN] supabase functions deploy $fn --project-ref $ProjectRef"
            continue
        }

        Write-Host "Deploy function: $fn"
        & supabase functions deploy $fn --project-ref $ProjectRef
        if ($LASTEXITCODE -ne 0) {
            throw "Falha ao fazer deploy da function: $fn"
        }
    }
}

function Deploy-Vercel() {
    if ($DryRun) {
        Write-Host "[DRY-RUN] vercel --prod --yes"
        return
    }

    & vercel --prod --yes
    if ($LASTEXITCODE -ne 0) {
        throw "Falha no deploy da Vercel."
    }
}

Write-Step "Validando ferramentas"
Require-Command "git"
Require-Command "supabase"
Require-Command "docker"
if (-not $SkipVercel) {
    Require-Command "vercel"
}
Write-Ok "Ferramentas encontradas"

Write-Step "Carregando variaveis do .env"
$envPath = Join-Path $PSScriptRoot ".env"
$envMap = Load-DotEnv $envPath
if ($envMap.Count -eq 0) {
    throw "Arquivo .env ausente ou vazio em $envPath"
}
Write-Ok ".env carregado"

Write-Step "Resolvendo projeto Supabase"
$projectRef = Resolve-ProjectRef $envMap
Write-Ok "Project ref: $projectRef"

if (-not $SkipSql) {
    Write-Step "Aplicando SQL remoto"
    $dbUri = Resolve-DbUri $envMap
    $conn = Convert-DbUriToConnMap -DbUri $dbUri -EnvMap $envMap

    $sqlOrder = @(
        "security_hardening.sql",
        "legal_signature_hardening.sql",
        "lgpd_compliance_controls.sql",
        "multitenant_phase1_safe.sql",
        "user_access_and_registry.sql",
        "system_tenant_registry.sql",
        "tenant_branding_and_watermark.sql",
        "tenant_rls_recursion_hotfix.sql"
    )

    foreach ($sql in $sqlOrder) {
        Write-Host "SQL: $sql"
        Invoke-RemoteSql -SqlFileName $sql -Conn $conn
    }
    Write-Ok "SQL aplicado com sucesso"
} else {
    Write-WarnLine "Etapa SQL ignorada (SkipSql)"
}

if (-not $SkipFunctions) {
    Write-Step "Deploy das Edge Functions"
    Deploy-SupabaseFunctions -ProjectRef $projectRef
    Write-Ok "Edge Functions publicadas"
} else {
    Write-WarnLine "Etapa Edge Functions ignorada (SkipFunctions)"
}

if (-not $SkipVercel) {
    Write-Step "Deploy da aplicacao na Vercel"
    Deploy-Vercel
    Write-Ok "Deploy Vercel concluido"
} else {
    Write-WarnLine "Etapa Vercel ignorada (SkipVercel)"
}

Write-Step "Deploy finalizado"
Write-Host "Comando sugerido:"
Write-Host "  .\\deploy.ps1"
Write-Host ""
Write-Host "Atalhos uteis:"
Write-Host "  .\\deploy.ps1 -SkipVercel"
Write-Host "  .\\deploy.ps1 -SkipSql -SkipFunctions"
Write-Host "  .\\deploy.ps1 -DryRun"
