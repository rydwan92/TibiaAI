# Start MariaDB and Canary as hidden background processes bound to 127.0.0.1.
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1          # DB + Canary
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -DbOnly  # DB only
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -NoBrain # world without Brain
#   powershell -ExecutionPolicy Bypass -File scripts\start.ps1 -BrainOnly
param([switch]$DbOnly, [switch]$NoBrain, [switch]$BrainOnly)
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
New-Item -ItemType Directory -Force $LogDir, $PidDir, $DbTmp | Out-Null

function Rotate-Log([string]$name) {
    $path = Join-Path $LogDir $name
    if (Test-Path $path) {
        $stamp = (Get-Item $path).LastWriteTime.ToString('yyyyMMdd-HHmmss')
        Move-Item $path (Join-Path $LogDir ($name -replace '\.log$', ".$stamp.log"))
    }
}

function Start-Brain {
    if (Get-TrackedProcess 'brain') { Write-Host "Brain already running"; return }
    $node = (Get-Command node -ErrorAction Stop).Source
    $ver = (& $node --version).Trim()
    if ($ver -notlike 'v22.*') { throw "Brain needs Node 22 (.nvmrc: 22.18.0); found $ver" }
    Remove-Item (Join-Path $Runtime 'control\brain-stop.request') -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force (Join-Path $Runtime 'control') | Out-Null
    $env:TIBIAAI_BRAIN_PROVIDER = $cfg.TIBIAAI_BRAIN_PROVIDER
    $main = Join-Path $Root 'apps\brain\src\main.ts'
    # Brain writes its own JSONL log (runtime\logs\brain.log); console output goes to brain.console.log.
    $line = "/c `"`"$node`" --disable-warning=ExperimentalWarning `"$main`" > `"$(Join-Path $LogDir 'brain.console.log')`" 2>&1`""
    $shell = Start-Process -FilePath 'cmd.exe' -ArgumentList $line -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    $brainPid = $null
    for ($i = 0; $i -lt 50 -and -not $brainPid; $i++) {
        $brainPid = (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($shell.Id)" | Where-Object { $_.Name -eq 'node.exe' }).ProcessId
        if (-not $brainPid) { Start-Sleep -Milliseconds 100 }
    }
    if (-not $brainPid) { throw "Brain did not start; see runtime\logs\brain.console.log" }
    Set-Content -Path (Join-Path $PidDir 'brain.pid') -Value $brainPid
    Write-Host "Brain started (pid $brainPid, provider $($cfg.TIBIAAI_BRAIN_PROVIDER))"
}

if ($BrainOnly) { Start-Brain; return }

# MariaDB
$dbPort = [int]$cfg.TIBIAAI_DB_PORT
if (Get-TrackedProcess 'mariadb') {
    Write-Host "MariaDB already running"
} else {
    if (Test-LocalPort $dbPort) { throw "Port $dbPort is used by another process" }
    $mariadbd = Join-Path $MariaDbHome 'bin\mariadbd.exe'
    $dbArgs = @(
        "--no-defaults",
        "--datadir=`"$DbData`"",
        "--tmpdir=`"$DbTmp`"",
        "--port=$dbPort",
        "--bind-address=127.0.0.1",
        "--skip-name-resolve",
        "--log-error=`"$(Join-Path $LogDir 'mariadb.err.log')`"",
        "--innodb-buffer-pool-size=256M",
        "--character-set-server=utf8mb4"
    )
    $p = Start-Process -FilePath $mariadbd -ArgumentList $dbArgs -WindowStyle Hidden -PassThru
    Set-Content -Path (Join-Path $PidDir 'mariadb.pid') -Value $p.Id
    if (-not (Wait-LocalPort $dbPort 30)) { throw "MariaDB did not open port $dbPort; see runtime\logs\mariadb.err.log" }
    Write-Host "MariaDB started (pid $($p.Id), 127.0.0.1:$dbPort)"
}
if ($DbOnly) { return }

# Login-server (HTTP login for client 15.11; Canary 3.6.1 rejects 15.11 on legacy TCP login).
# Configuration passes through inherited environment variables; nothing is written to disk.
if (Get-TrackedProcess 'login') {
    Write-Host "Login-server already running"
} else {
    foreach ($port in $Lock.ports.loginHttp, $Lock.ports.loginGrpc) {
        if (Test-LocalPort $port) { throw "Port $port is used by another process" }
    }
    $loginEnv = @{
        SERVER_PATH = $ServerDir; SERVER_IP = '127.0.0.1'; SERVER_NAME = 'TibiaAI'; SERVER_PORT = "$($Lock.ports.game)"
        SERVER_LOCATION = 'POL'; LOGIN_IP = '127.0.0.1'; LOGIN_HTTP_PORT = "$($Lock.ports.loginHttp)"
        LOGIN_GRPC_PORT = "$($Lock.ports.loginGrpc)"; MYSQL_HOST = '127.0.0.1'; MYSQL_PORT = $cfg.TIBIAAI_DB_PORT
        MYSQL_DBNAME = $cfg.TIBIAAI_DB_NAME; MYSQL_USER = $cfg.TIBIAAI_DB_USER; MYSQL_PASS = $cfg.TIBIAAI_DB_PASSWORD
        ENV_LOG_LEVEL = 'info'
    }
    foreach ($k in $loginEnv.Keys) { Set-Item "Env:\$k" $loginEnv[$k] }
    Rotate-Log 'login.out.log'
    Rotate-Log 'login.err.log'
    $loginDir = Join-Path $Runtime 'login-server'
    New-Item -ItemType Directory -Force $loginDir | Out-Null
    $loginPid = Start-Detached $LoginServerExe $loginDir (Join-Path $LogDir 'login.out.log') (Join-Path $LogDir 'login.err.log')
    foreach ($k in $loginEnv.Keys) { Remove-Item "Env:\$k" -ErrorAction SilentlyContinue }
    Set-Content -Path (Join-Path $PidDir 'login.pid') -Value $loginPid
    if (-not (Wait-LocalPort $Lock.ports.loginHttp 20)) { throw "Login-server did not open port $($Lock.ports.loginHttp); see runtime\logs\login.*.log" }
    Write-Host "Login-server started (pid $loginPid, http://127.0.0.1:$($Lock.ports.loginHttp)/login)"
}

# Canary
if (Get-TrackedProcess 'canary') {
    Write-Host "Canary already running"
    if (-not $NoBrain) { Start-Brain }
    return
}
foreach ($port in $Lock.ports.login, $Lock.ports.game) {
    if (Test-LocalPort $port) { throw "Port $port is used by another process" }
}
Remove-Item (Join-Path $Runtime 'control\shutdown.request') -ErrorAction SilentlyContinue
# Mailbox and control directories (Lua cannot create directories without a shell).
foreach ($sub in 'events', 'commands', 'results', 'processed', 'quarantine', 'brain-processed') {
    New-Item -ItemType Directory -Force (Join-Path $Runtime "mailbox\$sub") | Out-Null
}
New-Item -ItemType Directory -Force (Join-Path $Runtime 'control') | Out-Null
Rotate-Log 'canary.out.log'
Rotate-Log 'canary.err.log'
$canaryPid = Start-Detached (Join-Path $ServerDir 'canary.exe') $ServerDir (Join-Path $LogDir 'canary.out.log') (Join-Path $LogDir 'canary.err.log')
Set-Content -Path (Join-Path $PidDir 'canary.pid') -Value $canaryPid
Write-Host "Canary starting (pid $canaryPid); waiting for game port $($Lock.ports.game)..."
if (Wait-LocalPort $Lock.ports.game 180) {
    Write-Host "Canary is listening. Logs: runtime\logs\canary.out.log"
} else {
    Write-Warning "Game port not open after 180 s. Check: scripts\logs.ps1"
}
if (-not $NoBrain) { Start-Brain }
