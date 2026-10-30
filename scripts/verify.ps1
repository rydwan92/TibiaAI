# Runs every headless verification in one go and prints a PASS/FAIL table.
#   powershell -ExecutionPolicy Bypass -File scripts\verify.ps1 [-SkipLive] [-Client] [-Model]
# -Client also runs the real-client smoke and combat tests (opens a minimized client window).
# -Model also runs the scenario on real inference (scripts\ollama.ps1 -Start first, about a minute).
# Unit tests + typecheck always; with a running world (default) also the in-engine Lua selftest,
# the live bridge test (Brain is stopped for it and started again) and a backup + restore test.
# Nothing is deleted except the scratch database used by restore-test.ps1.
param([switch]$SkipLive, [switch]$Client, [switch]$Model)
. "$PSScriptRoot\lib.ps1"
$ErrorActionPreference = 'Continue'
$results = New-Object System.Collections.Generic.List[object]
$node = (Get-Command node -ErrorAction Stop).Source
$brainDir = Join-Path $Root 'apps\brain'

function Step([string]$name, [scriptblock]$body) {
    $t0 = Get-Date
    $output = & $body 2>&1 | Out-String
    $ok = $LASTEXITCODE -eq 0
    $results.Add([pscustomobject]@{ Step = $name; Result = $(if ($ok) { 'PASS' } else { 'FAIL' }); Seconds = [math]::Round(((Get-Date) - $t0).TotalSeconds, 1) })
    if (-not $ok) { Write-Host "---- $name output ----"; Write-Host $output }
}

Push-Location $brainDir
try {
    Step 'unit tests (Brain)' { & $node --disable-warning=ExperimentalWarning --test (Get-ChildItem test\*.test.ts | ForEach-Object FullName) }
    Step 'typecheck (Brain)' { & (Join-Path $brainDir 'node_modules\.bin\tsc.cmd') --noEmit }
} finally { Pop-Location }

if (-not $SkipLive) {
    if (-not (Get-TrackedProcess 'canary')) {
        $results.Add([pscustomobject]@{ Step = 'live checks'; Result = 'NOT RUN (Canary stopped)'; Seconds = 0 })
    } else {
        Step 'selftest (Lua in Canary)' { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'selftest.ps1') }
        $brainWasRunning = [bool](Get-TrackedProcess 'brain')
        if ($brainWasRunning) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'stop.ps1') -BrainOnly | Out-Null }
        Step 'bridge test (live world)' { & $node --disable-warning=ExperimentalWarning (Join-Path $brainDir 'test-integration\bridge.itest.ts') }
        if ($brainWasRunning) { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'start.ps1') -BrainOnly | Out-Null }
        Step 'backup' { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'backup.ps1') }
        Step 'restore test' { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'restore-test.ps1') }
        if ($Client) {
            Step 'client smoke' { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'client-autotest.ps1') }
            Step 'client combat' { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'client-autotest.ps1') -Scenario combat -TimeoutSec 260 }
        }
    }
}

if ($Model) {
    Step 'real model scenario' { & $node --disable-warning=ExperimentalWarning (Join-Path $brainDir 'test-integration\ollama.itest.ts') }
}

$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
$report = Join-Path $LogDir ("verify-{0}.json" -f (Get-Date).ToString('yyyyMMdd-HHmmss'))
[System.IO.File]::WriteAllText($report, ($results | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Report: $report"
if ($failed -gt 0) { exit 1 }
