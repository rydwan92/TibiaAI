# Long run of the player agents with evidence: samples what each character reached and what the
# machine paid for it, then writes a summary to runtime\evidence\player-run-<time>.json.
#   powershell -ExecutionPolicy Bypass -File scripts\player-run.ps1 -Minutes 20
param([int]$Minutes = 20, [int]$SampleSeconds = 60)
. "$PSScriptRoot\lib.ps1"
$defs = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'packages\contracts\players.json') | ConvertFrom-Json
$keys = @($defs.agents.PSObject.Properties.Name)

function Read-Json([string]$path) {
    if (-not (Test-Path $path)) { return $null }
    try { return Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json } catch { return $null }
}

function Get-Sample {
    $agents = @{}
    foreach ($key in $keys) {
        $dir = Join-Path $Runtime "players\$key"
        $state = Read-Json (Join-Path $dir 'state.json')
        $metrics = Read-Json (Join-Path $dir 'metrics.json')
        $agents[$key] = [ordered]@{ level = $state.level; experience = $state.experience; hp = $state.hp; z = $state.z; x = $state.x; y = $state.y; kills = $metrics.kills; deaths = $metrics.deaths; gold = $metrics.gold; places = $metrics.places; trips = $metrics.trips; helped = $metrics.helped; tipsGiven = $metrics.tipsGiven; tipsHeard = $metrics.tipsHeard; trades = $metrics.trades; stored = $metrics.stored; pvpFights = $metrics.pvpFights; ways = $metrics.ways; lessons = @($metrics.lessons).Count }
    }
    $ram = 0
    foreach ($p in @(Get-Process otclient, canary, llama-server, node, mariadbd -ErrorAction SilentlyContinue)) { $ram += $p.WorkingSet64 }
    $free = [math]::Round((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory / 1MB, 1)
    return [ordered]@{ at = (Get-Date).ToString('s'); agents = $agents; stackMb = [math]::Round($ram / 1MB); freeRamGb = $free }
}

$first = Get-Sample
$samples = New-Object System.Collections.ArrayList
[void]$samples.Add($first)
$end = (Get-Date).AddMinutes($Minutes)
while ((Get-Date) -lt $end) {
    Start-Sleep -Seconds $SampleSeconds
    [void]$samples.Add((Get-Sample))
}
$last = $samples[$samples.Count - 1]
$errors = @{}
foreach ($key in $keys) {
    $events = Join-Path $Runtime "players\$key\events.jsonl"
    $errors[$key] = @(Select-String -Path $events -Pattern 'adapter_error' -ErrorAction SilentlyContinue).Count
}
$report = [ordered]@{ minutes = $Minutes; started = $first.at; ended = $last.at; first = $first.agents; last = $last.agents; adapterErrors = $errors; minFreeRamGb = ($samples | ForEach-Object { $_.freeRamGb } | Measure-Object -Minimum).Minimum; maxStackMb = ($samples | ForEach-Object { $_.stackMb } | Measure-Object -Maximum).Maximum; samples = $samples }
$path = Join-Path $Runtime ("evidence\player-run-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
[System.IO.File]::WriteAllText($path, ($report | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Report: $path"
