# Real-client smoke test: installs tools\otclient-autotest as an OTClient mod for one run, drives
# login -> character list -> enter world -> walk -> greet NPC -> logout -> relogin, prints PASS/FAIL
# and removes the mod. Opens a client window for up to -TimeoutSec seconds.
#   powershell -ExecutionPolicy Bypass -File scripts\client-autotest.ps1 [-Character "Knight Sample"] [-Npc Ardan]
#   powershell -ExecutionPolicy Bypass -File scripts\client-autotest.ps1 -Scenario combat   (Kael, see scripts\lab-fixture.ps1 -Combatant)
#   powershell -ExecutionPolicy Bypass -File scripts\client-autotest.ps1 -Scenario conversation -Npc Ardan -Lines "hi|Jak mam na imie?" -Expect "mar" -Forbid "kael"
#     -Lines are said one by one; -Expect and -Forbid (comma-separated, lower case) check the last reply; -Incident fires one next to the NPC first.
#     -Walk follow|stay|cancel|alarm|logout acts out a walk with a guide after the last line, until a -WalkEnd word is heard;
#     -ExpectOutcome then checks what the engine really reported (guide_ended in the journal), not what the NPC said.
param([string]$Character = '', [string]$Npc = 'Ardan', [string]$Greeting = 'hi', [int]$GreetRange = 3, [int]$ObserveMs = 6000, [int]$TimeoutSec = 180,
      [string]$Route = '', [ValidateSet('smoke', 'combat', 'conversation')][string]$Scenario = 'smoke',
      [string]$Lines = 'hi', [string]$Expect = '', [string]$Forbid = '', [string]$Incident = '',
      [ValidateSet('', 'follow', 'stay', 'cancel', 'alarm', 'logout')][string]$Walk = '', [string]$WalkEnd = '', [int]$WalkSeconds = 80,
      [string]$CancelLine = 'stop', [string]$ExpectOutcome = '', [switch]$Second, [string]$WaitFile = '', [string]$ExpectStep = '', [string]$ResetTask = '')
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
if (-not ((Test-LocalPort $Lock.ports.loginHttp) -and (Test-LocalPort $Lock.ports.game))) { throw "Server is not running (scripts\start.ps1)" }
# -Second: a deliberate second client (scripts\npc-two-players.ps1), on another account.
if (-not $Second -and (Get-Process otclient -ErrorAction SilentlyContinue)) { throw "Close the running OTClient first (one test account, one session)" }

$email, $password = $cfg.TIBIAAI_TEST_EMAIL, $cfg.TIBIAAI_TEST_PASSWORD
if (-not $Character) { $Character = if ($Scenario -eq 'combat') { 'Kael' } else { 'Knight Sample' } }
if ($Character -eq 'Kael') {
    if (-not $cfg.TIBIAAI_AGENT_PASSWORD) { throw "No combat account: run scripts\lab-fixture.ps1 -Combatant" }
    $email, $password = $cfg.TIBIAAI_AGENT_EMAIL, $cfg.TIBIAAI_AGENT_PASSWORD
}
# A character stays in the world after its client disconnects, so log it out first. The engine
# answers in the journal; players_online would lag by up to 10 minutes.
$since = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
Write-ControlRequest 'dev-kick.request' $Character
if (-not (Wait-JournalEntry 'dev_exception_used' $since 10)) { throw "The world did not answer the logout request" }
Start-Sleep 2
# Death or an earlier test can leave it anywhere; every run starts at the same spot next to a wall.
& "$PSScriptRoot\lab-fixture.ps1" -Characters $Character -X 32369 -Y 32252 -KnownOffline | Out-Null

$exe = Join-Path $OtclientDir 'otclient.exe'
$modDir = Join-Path $OtclientDir 'mods\tibiaai_autotest'
$logFile = Join-Path $OtclientDir 'otclient.log'
New-Item -ItemType Directory -Force $modDir | Out-Null
Copy-Item (Join-Path $Root 'tools\otclient-autotest\*') $modDir -Force
Install-ClientFrameCap

function LuaStr([string]$s) { '"' + $s.Replace('\', '\\').Replace('"', '\"') + '"' }
$legs = (@($Route -split ';' | Where-Object { $_ }) | ForEach-Object { $x, $y = $_ -split ','; "{ x = $x, y = $y, z = 7 }" }) -join ', '
function LuaList([string]$s, [string]$sep) { (@($s -split $sep | Where-Object { $_ }) | ForEach-Object { LuaStr $_.Trim() }) -join ', ' }
$config = @"
return {
  host = $(LuaStr "http://127.0.0.1:$($Lock.ports.loginHttp)/login"), port = $($Lock.ports.loginHttp), version = $($Lock.canary.clientVersion),
  email = $(LuaStr $email), password = $(LuaStr $password), scenario = $(LuaStr $Scenario),
  controlDir = $(LuaStr ((Join-Path $Runtime 'control').Replace('\', '/') + '/')),
  wallDirection = East, openDirection = West,
  character = $(LuaStr $Character), npc = $(LuaStr $Npc), greeting = $(LuaStr $Greeting), greetRange = $GreetRange,
  observeMs = $ObserveMs, timeoutSec = $TimeoutSec,
  route = { $legs }, lines = { $(LuaList $Lines '\|') }, expect = { $(LuaList $Expect ',') }, forbid = { $(LuaList $Forbid ',') },
  incident = $(LuaStr $Incident), walk = $(LuaStr $Walk), walkEnd = { $(LuaList $WalkEnd ',') }, walkSeconds = $WalkSeconds,
  cancelLine = $(LuaStr $CancelLine), resetTask = $(LuaStr $ResetTask), waitFile = $(LuaStr $WaitFile.Replace('\', '/')),
}
"@
[System.IO.File]::WriteAllText((Join-Path $modDir 'config.lua'), $config, (New-Object System.Text.UTF8Encoding $false))

$runStartedAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
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
$outcomeFailed = 0
if ($ExpectStep) {
    # Engine truth again: the errand moved only if the journal says so.
    $done = Wait-JournalEntry 'task_step_done' $runStartedAt 10
    if ($ExpectStep -eq 'none') {
        if ($done) { $outcomeFailed = 1 }
        Write-Host "[AUTOTEST] $(if ($done) { 'FAIL' } else { 'PASS' }) engine_step no step expected, got $(if ($done) { $done.stepId } else { 'none' })"
    } elseif ($done -and $done.stepId -eq $ExpectStep) {
        Write-Host "[AUTOTEST] PASS engine_step $($done.taskId) $($done.stepId) state $($done.from) -> $($done.to), gold $($done.money)"
    } else {
        $outcomeFailed = 1
        Write-Host "[AUTOTEST] FAIL engine_step expected $ExpectStep, got $(if ($done) { $done.stepId } else { 'no task_step_done' })"
    }
}
if ($ExpectOutcome) {
    # Engine truth: what the NPC said proves nothing, the journal entry does.
    $ended = Wait-JournalEntry 'guide_ended' $runStartedAt 45
    if ($ended -and $ended.outcome -eq $ExpectOutcome) {
        Write-Host "[AUTOTEST] PASS engine_outcome guide_ended $($ended.outcome) at $($ended.position.x),$($ended.position.y),$($ended.position.z) after $($ended.ticks) ticks"
    } else {
        $outcomeFailed = 1
        Write-Host "[AUTOTEST] FAIL engine_outcome expected $ExpectOutcome, got $(if ($ended) { $ended.outcome } else { 'no guide_ended' })"
    }
}
$failed = $outcomeFailed + @($lines | Where-Object { $_ -match '\[AUTOTEST\] FAIL' }).Count
$passed = @($lines | Where-Object { $_ -match '\[AUTOTEST\] PASS' }).Count
Write-Host "client autotest: $passed passed, $failed failed"
$evidence = Join-Path $LogDir ("client-autotest-{0}.log" -f (Get-Date).ToString('yyyyMMdd-HHmmss'))
Copy-Item $logFile $evidence
Write-Host "Log: $evidence"
if ($failed -gt 0 -or $passed -eq 0) { exit 1 }
