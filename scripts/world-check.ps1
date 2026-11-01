# One pass through the world's basic promises in real clients, with results from the game itself:
# entry and a guide, then agents at the shop and depot, a refused passage, a Brain restart under a
# running game and a death with relog. Writes runtime\evidence\world-check-<time>.json.
#   powershell -ExecutionPolicy Bypass -File scripts\world-check.ps1
. "$PSScriptRoot\lib.ps1"
$results = [ordered]@{ startedAt = (Get-Date).ToString('s'); map = $Lock.world.mapSha256 }

function Get-Diary([string]$key, [int]$tail = 300) { Get-Content (Join-Path $Runtime "players\$key\diary.log") -Tail $tail -Encoding UTF8 }
function Get-State([string]$key) { Get-Content -Raw -Encoding UTF8 (Join-Path $Runtime "players\$key\state.json") | ConvertFrom-Json }
function Force([string]$key, [string]$json) { [System.IO.File]::WriteAllText((Join-Path $Runtime "players\$key\force.json"), $json) }
function Wait-Diary([string]$key, [string]$pattern, [int]$seconds, [int]$from) {
    $end = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $end) {
        $all = @(Get-Content (Join-Path $Runtime "players\$key\diary.log") -Encoding UTF8)
        $hit = @($all | Select-Object -Skip $from | Where-Object { $_ -match $pattern })
        if ($hit.Count -gt 0) { return $hit[-1] }
        Start-Sleep -Seconds 3
    }
    return $null
}
function Get-DiaryLines([string]$key) { @(Get-Content (Join-Path $Runtime "players\$key\diary.log") -Encoding UTF8).Count }

& "$PSScriptRoot\player-agents.ps1" -Stop | Out-Null
Start-Sleep -Seconds 5 # the clients need a moment to go
$results.clientEntry = (& "$PSScriptRoot\client-autotest.ps1" *>&1 | Select-Object -Last 3 | ForEach-Object { "$_" }) -join ' | '
$results.guide = (& "$PSScriptRoot\npc-scenario.ps1" -Only guide_arrives, guide_no_path *>&1 | Select-Object -Last 4 | ForEach-Object { "$_" }) -join ' | '
& "$PSScriptRoot\player-agents.ps1" -Start | Out-Null
Start-Sleep -Seconds 35

$kael = Get-State 'kael'
$results.agentsStart = [ordered]@{ kael = "$($kael.level) $($kael.x),$($kael.y),$($kael.z) gold $($kael.gold)" }
$mark = Get-DiaryLines 'kael'
Force 'kael' '{"option":"supply"}'
$results.shop = Wait-Diary 'kael' 'handel skonczony|nie udalo' 150 $mark
Write-ControlRequest 'dev-give-item.request' 'Kael,3031,150'
Start-Sleep -Seconds 4
$mark = Get-DiaryLines 'kael'
Force 'kael' '{"option":"depot"}'
$results.depot = Wait-Diary 'kael' 'depo: schowalem|nie udalo' 150 $mark

# Yalahar's captain demands a quest, so a paying character is refused on the pier.
Write-ControlRequest 'dev-give-item.request' 'Ravn,3031,100'
Start-Sleep -Seconds 4
$mark = Get-DiaryLines 'ravn'
Force 'ravn' '{"route":{"x":32816,"y":31272,"z":6}}'
$results.refusal = Wait-Diary 'ravn' 'kapitan nie zabral|przeszedlem: boat|nie znam drogi' 240 $mark

# Brain goes down under a running game; a kill written meanwhile must count once after it returns.
$before = Get-Content -Raw -Encoding UTF8 (Join-Path $Runtime 'players\sira\metrics.json') | ConvertFrom-Json
& "$PSScriptRoot\stop.ps1" -BrainOnly | Out-Null
Start-Sleep -Seconds 20
& "$PSScriptRoot\start.ps1" -BrainOnly | Out-Null
Start-Sleep -Seconds 45
$after = Get-Content -Raw -Encoding UTF8 (Join-Path $Runtime 'players\sira\metrics.json') | ConvertFrom-Json
$results.brainRestart = [ordered]@{ killsBefore = $before.kills; killsAfter = $after.kills; expBefore = $before.experience; expAfter = $after.experience }

$mark = Get-DiaryLines 'sira'
Write-ControlRequest 'dev-kill.request' 'Sira'
$results.death = Wait-Diary 'sira' 'ZGINALEM' 60 $mark
$results.lesson = Wait-Diary 'sira' 'lekcja' 90 $mark
Start-Sleep -Seconds 15
$sira = Get-State 'sira'
$results.afterDeath = "online age $([int](((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalSeconds - $sira.atMs / 1000)) s at $($sira.x),$($sira.y),$($sira.z) hp $($sira.hp)/$($sira.hpMax)"
$bad = @{}
foreach ($key in 'kael', 'sira', 'ravn') { $bad[$key] = @(Select-String -Path (Join-Path $Runtime "players\$key\events.jsonl") -Pattern 'adapter_error' -ErrorAction SilentlyContinue).Count }
$results.adapterErrors = $bad
$path = Join-Path $Runtime ("evidence\world-check-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
[System.IO.File]::WriteAllText($path, ($results | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Report: $path"
