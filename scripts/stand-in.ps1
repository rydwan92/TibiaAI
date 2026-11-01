# A stand-in for a person: a scripted client on the test character. Agents do not know it from a human.
# It says what tools\scene.py tells it and records what it really heard, so a test reads the other side
# of a conversation instead of the agent's own diary.
#   powershell -ExecutionPolicy Bypass -File scripts\stand-in.ps1 -Start
#   powershell -ExecutionPolicy Bypass -File scripts\stand-in.ps1 -Stop
# It takes the account of the test character: stop it before logging in by hand.
param([switch]$Start, [switch]$Stop, [string]$Character = 'Knight Sample')
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
$dir = Join-Path $Runtime 'players-standin'
$pidFile = Join-Path $PidDir 'agent-standin.pid'

if ($Stop) {
    if (Test-Path $pidFile) {
        $proc = Get-Process -Id ([int](Get-Content $pidFile)) -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'otclient') { Stop-Process -Id $proc.Id -Force }
        Remove-Item $pidFile
    }
    Write-ControlRequest 'dev-kick.request' $Character
    Write-Host 'Stand-in stopped'
}

if ($Start) {
    if (-not (Test-LocalPort $Lock.ports.game)) { throw "Server is not running (scripts\start.ps1)" }
    $modDir = Join-Path $OtclientDir 'mods\tibiaai_agent'
    if (-not (Test-Path $modDir)) { throw "Agent mod is not installed: start scripts\player-agents.ps1 first" }
    Copy-Item (Join-Path $Root 'tools\otclient-agent\*') $modDir -Force
    New-Item -ItemType Directory -Force $dir | Out-Null
    Remove-Item (Join-Path $dir 'orders.json') -ErrorAction SilentlyContinue # orders of the last scene are not for this one
    $defs = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'packages\contracts\players.json') | ConvertFrom-Json
    $config = @{
        host = "http://127.0.0.1:$($Lock.ports.loginHttp)/login"; port = $Lock.ports.loginHttp; version = $Lock.canary.clientVersion
        email = $cfg.TIBIAAI_TEST_EMAIL; password = $cfg.TIBIAAI_TEST_PASSWORD; character = $Character
        reflexes = $defs.reflexes; vocation = 'knight'; friends = @(); controlDir = (Join-Path $Runtime 'control').Replace('\', '/') + '/'
    } | ConvertTo-Json -Depth 4 -Compress
    [System.IO.File]::WriteAllText((Join-Path $dir 'login.json'), $config, (New-Object System.Text.UTF8Encoding $false))
    $arg = "--agent-dir=$($dir.Replace('\', '/'))/"
    $p = Start-Process -FilePath (Join-Path $OtclientDir 'otclient.exe') -ArgumentList $arg -WorkingDirectory $OtclientDir -WindowStyle Minimized -PassThru
    Set-Content -Path $pidFile -Value $p.Id
    Write-Host "$Character started (client pid $($p.Id))"
}
