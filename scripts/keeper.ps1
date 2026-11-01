# Keeps the world up without anyone watching: every minute it brings back what fell over and writes down
# what it did. Stopping the world by hand (stop.ps1, player-agents.ps1 -Stop) stops the keeper first.
#   powershell -ExecutionPolicy Bypass -File scripts\keeper.ps1 -Start      # in the background
#   powershell -ExecutionPolicy Bypass -File scripts\keeper.ps1 -Stop
#   powershell -ExecutionPolicy Bypass -File scripts\keeper.ps1 -Status
param([switch]$Start, [switch]$Stop, [switch]$Status, [switch]$Run)
. "$PSScriptRoot\lib.ps1"
$log = Join-Path $Runtime 'logs\keeper.log'
$CHECK_SECONDS = 60
$TRIES_PER_HOUR = 6 # something that keeps failing needs a person, not a loop

function Note([string]$text) { Add-Content -Path $log -Value "$((Get-Date).ToString('s')) $text" -Encoding UTF8 }

if ($Stop) { Stop-Keeper; Write-Host 'Keeper stopped' }
if ($Status) {
    $running = Get-KeeperProcess
    Write-Host "Keeper: $(if ($running) { "pid $($running.Id)" } else { 'off' })"
    if (Test-Path $log) { Get-Content $log -Tail 8 -Encoding UTF8 }
}
if ($Start) {
    if (Get-KeeperProcess) { Write-Host 'Keeper already runs'; return }
    $p = Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $PSScriptRoot 'keeper.ps1'), '-Run' -WindowStyle Hidden -PassThru
    Set-Content -Path (Join-Path $PidDir 'keeper.pid') -Value $p.Id
    Write-Host "Keeper started (pid $($p.Id))"
}
if ($Run) {
    Note 'keeper on'
    $tries = New-Object System.Collections.ArrayList
    while ($true) {
        Start-Sleep -Seconds $CHECK_SECONDS
        $cutoff = (Get-Date).AddHours(-1)
        while ($tries.Count -gt 0 -and $tries[0] -lt $cutoff) { $tries.RemoveAt(0) }
        if ($tries.Count -ge $TRIES_PER_HOUR) { continue }
        $world = (Test-LocalPort $Lock.ports.loginHttp) -and (Test-LocalPort $Lock.ports.game)
        if (-not $world) {
            Note 'world down, starting'
            [void]$tries.Add((Get-Date))
            & "$PSScriptRoot\start.ps1" -NoModel *>> $log
            continue
        }
        $brain = Join-Path $PidDir 'brain.pid'
        if (-not (Test-Path $brain) -or -not (Get-Process -Id ([int](Get-Content $brain)) -ErrorAction SilentlyContinue)) {
            Note 'brain down, starting'
            [void]$tries.Add((Get-Date))
            & "$PSScriptRoot\start.ps1" -BrainOnly -NoModel *>> $log
        }
        $defs = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'packages\contracts\players.json') | ConvertFrom-Json
        foreach ($key in $defs.agents.PSObject.Properties.Name) {
            $file = Join-Path $PidDir "agent-$key.pid"
            if ((Test-Path $file) -and (Get-Process -Id ([int](Get-Content $file)) -ErrorAction SilentlyContinue)) { continue }
            Note "$key has no body, starting"
            [void]$tries.Add((Get-Date))
            & "$PSScriptRoot\player-agents.ps1" -Start -Only $key *>> $log
        }
    }
}
