$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$started = $false
$previousProbeMode = $env:MCP_M1_PG
Push-Location $PSScriptRoot
try {
    docker run --rm -d --name domi-mcp-m1-probe --label domi.mcp-m1=compatibility -e POSTGRES_USER=mcp_probe -e POSTGRES_PASSWORD=synthetic-local-probe-only -e POSTGRES_DB=mcp_probe -p 127.0.0.1:55487:5432 postgres:16-alpine
    $started = $true
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $PSNativeCommandUseErrorActionPreference = $false
        docker exec domi-mcp-m1-probe pg_isready -U mcp_probe -d mcp_probe 2>$null | Out-Null
        $ready = $LASTEXITCODE -eq 0
        $PSNativeCommandUseErrorActionPreference = $true
        if ($ready) { break }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'Disposable PostgreSQL did not become ready' }
    $env:MCP_M1_PG = '1'
    mise exec -- node probe.mjs
} finally {
    $env:MCP_M1_PG = $previousProbeMode
    if ($started) {
        $label = docker inspect --format '{{index .Config.Labels "domi.mcp-m1"}}' domi-mcp-m1-probe
        if ($label -ne 'compatibility') { throw 'Refusing to stop an unverified container' }
        docker stop domi-mcp-m1-probe | Out-Null
    }
    Pop-Location
}
