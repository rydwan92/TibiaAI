# Two real clients at once: Knight Sample walks with the guide while Kael tries to take the guide
# over and to stop the walk. The verdict comes from the engine journal, not from client logs, which
# both clients share. Needs a running stack and the Kael account (scripts\lab-fixture.ps1 -Combatant).
#   powershell -ExecutionPolicy Bypass -File scripts\npc-two-players.ps1
. "$PSScriptRoot\lib.ps1"
$since = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$script = Join-Path $PSScriptRoot 'client-autotest.ps1'

$flag = Join-Path $Runtime 'two-players.go'
Remove-Item $flag -ErrorAction SilentlyContinue
$run = { param($path, $options) & $path @options *>&1 | Out-String }

# Kael stands by the guide first: logging in takes longer than a whole walk.
$kael = Start-Job -ScriptBlock $run -ArgumentList $script, @{
    Scenario = 'conversation'; Character = 'Kael'; Npc = 'Tolek'; Lines = 'Tolku, czesc|Tolku, pokaz mi swiatynie|stop'; WaitFile = $flag; TimeoutSec = 110
}
if (-not (Wait-JournalEntry 'npc_said' $since 60)) { Stop-Job $kael; throw 'Kael did not reach the guide' }
$knightSince = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$knight = Start-Job -ScriptBlock $run -ArgumentList $script, @{
    Second = $true; Scenario = 'conversation'; Character = 'Knight Sample'; Npc = 'Tolek'; Lines = 'Tolku, czesc|Tolku, pokaz mi swiatynie'
    Walk = 'follow'; WalkEnd = 'jestesmy,to tutaj'; TimeoutSec = 110
}
if (-not (Wait-JournalEntry 'guide_started' $knightSince 70)) { Stop-Job $kael, $knight; throw 'Knight Sample did not start a walk' }
[System.IO.File]::WriteAllText($flag, 'go')
Wait-Job $kael, $knight -Timeout 130 | Out-Null
Stop-Job $kael, $knight -ErrorAction SilentlyContinue
Remove-Job $kael, $knight -Force -ErrorAction SilentlyContinue
Remove-Item $flag -ErrorAction SilentlyContinue

$journal = Get-Content -Tail 800 -Encoding UTF8 (Join-Path $LogDir 'world-journal.jsonl') |
    ForEach-Object { try { $_ | ConvertFrom-Json } catch { } } | Where-Object { "$($_.ts)" -ge $since -and $_.agentKey -eq 'tolek' }
$starts = @($journal | Where-Object { $_.kind -eq 'guide_started' })
$busy = @($journal | Where-Object { $_.kind -eq 'command_result' -and $_.reasonCode -eq 'guide_busy' })
$ended = @($journal | Where-Object { $_.kind -eq 'guide_ended' })
$kaelStop = @($journal | Where-Object { $_.kind -eq 'event' -and $_.payload.text -eq 'stop' -and $_.payload.playerName -eq 'Kael' })
$results = @(
    @{ Name = 'one walk only'; Ok = $starts.Count -eq 1; Detail = "started: $($starts.Count), guid $($starts[0].playerGuid)" }
    @{ Name = 'second player refused'; Ok = $busy.Count -ge 1; Detail = "guide_busy: $($busy.Count)" }
    @{ Name = "the other player's stop reached the guide"; Ok = $kaelStop.Count -ge 1; Detail = "heard: $($kaelStop.Count), addressed: $($kaelStop[0].payload.addressed)" }
    @{ Name = 'first player reached the place'; Ok = $ended.Count -eq 1 -and $ended[0].outcome -eq 'arrived' -and $ended[0].playerGuid -eq $starts[0].playerGuid; Detail = "outcome: $($ended[0].outcome), guid $($ended[0].playerGuid), not cancelled by the other player's stop" }
)
foreach ($r in $results) { Write-Host ("{0} {1}: {2}" -f $(if ($r.Ok) { 'PASS' } else { 'FAIL' }), $r.Name, $r.Detail) }
if (@($results | Where-Object { -not $_.Ok }).Count -gt 0) { exit 1 }
exit 0
