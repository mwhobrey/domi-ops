#Requires -Version 7.3
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$container = "domi-mcp-auth-test-$PID"
$started = $false
$migrationLog = $null
$keys = @('DATABASE_URL', 'HOSTED_TEST_DATABASE_URL', 'MCP_TEST_DATABASE_URL', 'MCP_TEST_ADMIN_DATABASE_URL', 'MCP_TEST_TLS_KEY_FILE', 'MCP_TEST_TLS_CERT_FILE', 'NODE_EXTRA_CA_CERTS')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
$tlsDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ("domi-mcp-tls-" + [guid]::NewGuid())
Push-Location (Split-Path $PSScriptRoot -Parent)
try {
    New-Item -ItemType Directory -Path $tlsDirectory | Out-Null
    $rsa = [System.Security.Cryptography.RSA]::Create(2048)
    try {
        $certificateRequest = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=domi-mcp-loopback-test', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
        $san = [System.Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new()
        $san.AddIpAddress([System.Net.IPAddress]::Parse('127.0.0.1'))
        $san.AddDnsName('localhost')
        $certificateRequest.CertificateExtensions.Add($san.Build())
        $certificateRequest.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true, $false, 0, $true))
        $certificate = $certificateRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-1), [DateTimeOffset]::UtcNow.AddHours(2))
        $env:MCP_TEST_TLS_KEY_FILE = Join-Path $tlsDirectory 'key.pem'
        $env:MCP_TEST_TLS_CERT_FILE = Join-Path $tlsDirectory 'cert.pem'
        [System.IO.File]::WriteAllText($env:MCP_TEST_TLS_KEY_FILE, $rsa.ExportPkcs8PrivateKeyPem())
        [System.IO.File]::WriteAllText($env:MCP_TEST_TLS_CERT_FILE, $certificate.ExportCertificatePem())
        $env:NODE_EXTRA_CA_CERTS = $env:MCP_TEST_TLS_CERT_FILE
        $certificate.Dispose()
    } finally { $rsa.Dispose() }
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
    foreach ($name in @('key.pem','cert.pem')) { $tlsFile = Join-Path $tlsDirectory $name; if (Test-Path -LiteralPath $tlsFile) { Remove-Item -LiteralPath $tlsFile } }
    if (Test-Path -LiteralPath $tlsDirectory) { Remove-Item -LiteralPath $tlsDirectory }
    if ($started) {
        $label = docker inspect --format '{{index .Config.Labels "domi.task"}}' $container
        if ($LASTEXITCODE -ne 0) { throw 'Container ownership inspection failed' }
        if ($label -ne 'WHO-469') { throw 'Refusing to stop an unverified container' }
        docker stop $container | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL cleanup failed' }
    }
    Pop-Location
}
