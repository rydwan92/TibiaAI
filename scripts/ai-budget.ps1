# Cloud model spending, and the switch that stops new calls. Reports never send a request to a model.
#   powershell -ExecutionPolicy Bypass -File scripts\ai-budget.ps1 [-Quota]
#   powershell -ExecutionPolicy Bypass -File scripts\ai-budget.ps1 -Stop
#   powershell -ExecutionPolicy Bypass -File scripts\ai-budget.ps1 -Resume
param([switch]$Quota, [switch]$Stop, [switch]$Resume)
. "$PSScriptRoot\lib.ps1"
$stopFile = Join-Path $Runtime 'control\ai-stop'
if ($Stop) {
    New-Item -ItemType Directory -Force (Split-Path $stopFile) | Out-Null
    Set-Content -Path $stopFile -Value (Get-Date -Format o)
    Write-Host 'Cloud AI stopped: no new calls, characters play by rules'
}
if ($Resume) { Remove-Item $stopFile -ErrorAction SilentlyContinue; Write-Host 'Cloud AI resumed' }
Write-Host ("Stan: " + $(if (Test-Path $stopFile) { 'ZATRZYMANE' } else { 'wlaczone' }))
$node = (Get-Command node -ErrorAction Stop).Source
$cli = @('--disable-warning=ExperimentalWarning', (Join-Path $Root 'apps\brain\src\cli\ai-usage.ts'))
if ($Quota) { $cli += '--quota' }
& $node @cli
