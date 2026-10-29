# Shared paths and helpers for TibiaAI scripts. Dot-source: . "$PSScriptRoot\lib.ps1"
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$Lock = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'infra\versions.lock.json') | ConvertFrom-Json

$Vendor = Join-Path $Root 'vendor'
$Runtime = Join-Path $Root 'runtime'
$Downloads = Join-Path $Vendor 'downloads'
$CanarySrc = Join-Path $Vendor ("canary-src\canary-" + $Lock.canary.commit)
$CanaryExe = Join-Path $Vendor 'canary-bin\canary.exe'
$MariaDbHome = Join-Path $Vendor ("mariadb\mariadb-" + $Lock.mariadb.version + "-winx64")
$OtclientDir = Join-Path $Vendor ("otclient\otclient-" + $Lock.otclient.commit)
$LoginServerExe = Join-Path $Vendor 'login-server-bin\login-server.exe'
$DbData = Join-Path $Runtime 'mariadb\data'
$DbTmp = Join-Path $Runtime 'mariadb\tmp'
$ServerDir = Join-Path $Runtime 'server'
$LogDir = Join-Path $Runtime 'logs'
$PidDir = Join-Path $Runtime 'pids'
$Overlay = Join-Path $Root 'game\overlays\tibia-ai'

function Read-DotEnv {
    $path = Join-Path $Root '.env'
    if (-not (Test-Path $path)) { throw ".env not found. Run scripts\setup.ps1 first." }
    $envMap = @{}
    foreach ($line in Get-Content -Encoding UTF8 $path) {
        if ($line -match '^\s*([A-Z0-9_]+)=(.*)$') { $envMap[$Matches[1]] = $Matches[2] }
    }
    return $envMap
}

function Get-TrackedProcess([string]$name) {
    $pidFile = Join-Path $PidDir "$name.pid"
    if (-not (Test-Path $pidFile)) { return $null }
    $procId = [int](Get-Content $pidFile)
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    if (-not $proc) { return $null }
    # Guard against PID reuse: the executable or its command line must point into this project.
    if ($proc.Path -and ($proc.Path -like "$Root*")) { return $proc }
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine
    if ($cmd -and $cmd.Contains($Root)) { return $proc }
    return $null
}

function Get-RootClientConfig {
    # Root credentials go through an option file in runtime\ (git-ignored), never the command line.
    $cfg = Read-DotEnv
    $path = Join-Path $Runtime 'mariadb\root-client.cnf'
    $lines = @('[client]', 'user=root', "password=$($cfg.TIBIAAI_DB_ROOT_PASSWORD)", 'host=127.0.0.1',
        "port=$($cfg.TIBIAAI_DB_PORT)", 'protocol=TCP', 'skip-ssl')
    [System.IO.File]::WriteAllLines($path, $lines)
    return $path
}

function Invoke-MariaDb([string]$sql, [string]$database = '') {
    $client = Join-Path $MariaDbHome 'bin\mariadb.exe'
    $clientArgs = @("--defaults-extra-file=$(Get-RootClientConfig)", '--batch', '--skip-column-names')
    if ($database) { $clientArgs += $database }
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $out = $sql | & $client @clientArgs 2>&1
        if ($LASTEXITCODE -ne 0) { throw "mariadb failed: $out" }
        return ($out | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] })
    } finally { $ErrorActionPreference = $prev }
}

function Start-Detached([string]$exe, [string]$workDir, [string]$outLog, [string]$errLog) {
    # cmd.exe performs the redirection, so the server never inherits the caller's console/pipe
    # handles (Start-Process -RedirectStandardOutput would, which blocks callers that capture output).
    $line = "/c `"`"$exe`" > `"$outLog`" 2> `"$errLog`"`""
    $shell = Start-Process -FilePath 'cmd.exe' -ArgumentList $line -WorkingDirectory $workDir -WindowStyle Hidden -PassThru
    $leaf = Split-Path $exe -Leaf
    for ($i = 0; $i -lt 50; $i++) {
        $child = Get-CimInstance Win32_Process -Filter "ParentProcessId=$($shell.Id)" | Where-Object { $_.Name -eq $leaf }
        if ($child) { return [int]$child.ProcessId }
        Start-Sleep -Milliseconds 100
    }
    throw "$leaf did not start (see $errLog)"
}

function Test-LocalPort([int]$port) {
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
}

function Wait-LocalPort([int]$port, [int]$timeoutSec) {
    $deadline = (Get-Date).AddSeconds($timeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-LocalPort $port) { return $true }
        Start-Sleep -Milliseconds 500
    }
    return $false
}
