#Requires -Version 7.3
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$container = "domi-mcp-auth-test-$PID"
$started = $false
$migrationLog = $null
$keys = @('DATABASE_URL', 'HOSTED_TEST_DATABASE_URL', 'MCP_TEST_DATABASE_URL', 'MCP_TEST_ADMIN_DATABASE_URL')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    docker run --rm -d --name $container --label domi.task=WHO-469 -e POSTGRES_USER=domi_ops -e POSTGRES_PASSWORD=synthetic-only -e POSTGRES_DB=domi_ops -p 127.0.0.1:55491:5432 postgres:16-alpine | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL launch failed' }
    $started = $true
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $PSNativeCommandUseErrorActionPreference = $false
        docker exec $container pg_isready -U domi_ops -d domi_ops 2>$null | Out-Null
        $ready = $LASTEXITCODE -eq 0
        $PSNativeCommandUseErrorActionPreference = $true
        if ($ready) { break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'Disposable PostgreSQL did not become ready' }
    $env:DATABASE_URL = 'postgres://domi_ops:synthetic-only@127.0.0.1:55491/domi_ops'
    $env:HOSTED_TEST_DATABASE_URL = 'postgres://domi_ops_app:domi_ops_app@127.0.0.1:55491/domi_ops'
    $env:MCP_TEST_DATABASE_URL = $env:HOSTED_TEST_DATABASE_URL
    $env:MCP_TEST_ADMIN_DATABASE_URL = $env:DATABASE_URL
    foreach ($workspace in @('config', 'crypto', 'db', 'auth', 'calendar-sync')) {
        mise exec -- npm run build -w "@domi-ops/$workspace"
        if ($LASTEXITCODE -ne 0) { throw "Build failed: $workspace" }
    }
    $migrationLog = [System.IO.Path]::GetTempFileName()
    mise exec -- npm run migrate:run -w @domi-ops/db *> $migrationLog
    if ($LASTEXITCODE -ne 0) { throw 'Database migration failed' }
    mise exec -- npm run db:create-app-role
    if ($LASTEXITCODE -ne 0) { throw 'Application role setup failed' }
    mise exec -- npx vitest run apps/api/src/routes/mcp-authorization.integration.test.ts packages/auth/src/credential-signin.integration.test.ts packages/auth/src/google-signin.integration.test.ts packages/db/src/rls-worker-scan-coverage.integration.test.ts --reporter=dot
    if ($LASTEXITCODE -ne 0) { throw 'MCP authorization regressions failed' }
} catch {
    if ($migrationLog) { Get-Content -LiteralPath $migrationLog -Tail 25 }
    throw
} finally {
    foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key], 'Process') }
    if ($migrationLog) { Remove-Item -LiteralPath $migrationLog }
    if ($started) {
        $label = docker inspect --format '{{index .Config.Labels "domi.task"}}' $container
        if ($LASTEXITCODE -ne 0) { throw 'Container ownership inspection failed' }
        if ($label -ne 'WHO-469') { throw 'Refusing to stop an unverified container' }
        docker stop $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL cleanup failed' }
    }
    Pop-Location
}
