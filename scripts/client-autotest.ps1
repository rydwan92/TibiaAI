# Real-client smoke test: installs tools\otclient-autotest as an OTClient mod for one run, drives
# login -> character list -> enter world -> walk -> greet NPC -> logout -> relogin, prints PASS/FAIL
# and removes the mod. Opens a client window for up to -TimeoutSec seconds.
#   powershell -ExecutionPolicy Bypass -File scripts\client-autotest.ps1 [-Character "Knight Sample"] [-Npc Ardan]
#   powershell -ExecutionPolicy Bypass -File scripts\client-autotest.ps1 -Scenario combat   (Kael, see scripts\lab-fixture.ps1 -Combatant)
param([string]$Character = '', [string]$Npc = 'Ardan', [string]$Greeting = 'hi', [int]$GreetRange = 3, [int]$ObserveMs = 6000, [int]$TimeoutSec = 180,
      [string]$Route = '', [ValidateSet('smoke', 'combat')][string]$Scenario = 'smoke')
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
if (-not ((Test-LocalPort $Lock.ports.loginHttp) -and (Test-LocalPort $Lock.ports.game))) { throw "Server is not running (scripts\start.ps1)" }
if (Get-Process otclient -ErrorAction SilentlyContinue) { throw "Close the running OTClient first (one test account, one session)" }

$email, $password = $cfg.TIBIAAI_TEST_EMAIL, $cfg.TIBIAAI_TEST_PASSWORD
if ($Scenario -eq 'combat') {
    if (-not $cfg.TIBIAAI_AGENT_PASSWORD) { throw "No combat account: run scripts\lab-fixture.ps1 -Combatant" }
    $email, $password = $cfg.TIBIAAI_AGENT_EMAIL, $cfg.TIBIAAI_AGENT_PASSWORD
    if (-not $Character) { $Character = 'Kael' }
    # A character stays in the world after its client disconnects, so log it out first. The
    # players_online table refreshes once a minute; wait for it because the fixture checks it.
    Write-ControlRequest 'dev-kick.request' $Character
    Start-Sleep 2
    $safeName = $Character.Replace("'", "''")
    for ($i = 0; $i -lt 40; $i++) {
        $online = Invoke-MariaDb "SELECT COUNT(*) FROM players_online po JOIN players p ON p.id = po.player_id WHERE p.name = '$safeName';" $cfg.TIBIAAI_DB_NAME
        if ("$online".Trim() -eq '0') { break }
        Start-Sleep 2
    }
    # Death sends the character to the temple; every run starts at the same spot next to a wall.
    & "$PSScriptRoot\lab-fixture.ps1" -Characters $Character -X 5010 -Y 5007 | Out-Null
}
if (-not $Character) { $Character = 'Knight Sample' }

$exe = Join-Path $OtclientDir 'otclient.exe'
$modDir = Join-Path $OtclientDir 'mods\tibiaai_autotest'
$logFile = Join-Path $OtclientDir 'otclient.log'
New-Item -ItemType Directory -Force $modDir | Out-Null
Copy-Item (Join-Path $Root 'tools\otclient-autotest\*') $modDir -Force

function LuaStr([string]$s) { '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }
$legs = (@($Route -split ';' | Where-Object { $_ }) | ForEach-Object { $x, $y = $_ -split ','; "{ x = $x, y = $y, z = 7 }" }) -join ', '
$config = @"
return {
  host = $(LuaStr "http://127.0.0.1:$($Lock.ports.loginHttp)/login"), port = $($Lock.ports.loginHttp), version = $($Lock.canary.clientVersion),
  email = $(LuaStr $email), password = $(LuaStr $password), scenario = $(LuaStr $Scenario),
  controlDir = $(LuaStr ((Join-Path $Runtime 'control').Replace('\', '/') + '/')),
  wallDirection = East, openDirection = West,
  character = $(LuaStr $Character), npc = $(LuaStr $Npc), greeting = $(LuaStr $Greeting), greetRange = $GreetRange,
  observeMs = $ObserveMs, timeoutSec = $TimeoutSec,
  route = { $legs },
}
"@
[System.IO.File]::WriteAllText((Join-Path $modDir 'config.lua'), $config, (New-Object System.Text.UTF8Encoding $false))

try {
    $p = Start-Process -FilePath $exe -WorkingDirectory $OtclientDir -WindowStyle Minimized -PassThru  # minimized: no stray clicks during the test
    $peakMb = 0
    $deadline = (Get-Date).AddSeconds($TimeoutSec + 20)
    while (-not $p.HasExited -and (Get-Date) -lt $deadline) {
        $p.Refresh()
        if (-not $p.HasExited) { $peakMb = [math]::Max($peakMb, [math]::Round($p.WorkingSet64 / 1MB)) }
        Start-Sleep -Milliseconds 500
    }
    if (-not $p.HasExited) {
        Write-Warning "Client did not exit in time; stopping it."
        Stop-Process -Id $p.Id -Force
    }
    Write-Host "client process peak working set: $peakMb MB"
} finally {
    Remove-Item $modDir -Recurse -Force -ErrorAction SilentlyContinue  # also removes the config with the test password
}

$lines = Get-Content $logFile -Encoding UTF8 | Where-Object { $_ -match '\[AUTOTEST\]|\[error\]' } | ForEach-Object { $_ -replace '^\[[^\]]*\] \[\w+\] ', '' }
$lines | ForEach-Object { Write-Host $_ }
$failed = @($lines | Where-Object { $_ -match '\[AUTOTEST\] FAIL' }).Count
$passed = @($lines | Where-Object { $_ -match '\[AUTOTEST\] PASS' }).Count
Write-Host "client autotest: $passed passed, $failed failed"
$evidence = Join-Path $LogDir ("client-autotest-{0}.log" -f (Get-Date).ToString('yyyyMMdd-HHmmss'))
Copy-Item $logFile $evidence
Write-Host "Log: $evidence"
if ($failed -gt 0 -or $passed -eq 0) { exit 1 }
