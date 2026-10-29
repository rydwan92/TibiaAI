# Controlled training alarm for Ardan (administrator test event, not monster detection).
#   powershell -ExecutionPolicy Bypass -File scripts\alarm.ps1 start
#   powershell -ExecutionPolicy Bypass -File scripts\alarm.ps1 clear
# In game the GOD character can use /alarm start | /alarm clear instead.
param([Parameter(Mandatory = $true)][ValidateSet('start', 'clear')][string]$Action)
. "$PSScriptRoot\lib.ps1"
$control = Join-Path $Runtime 'control'
New-Item -ItemType Directory -Force $control | Out-Null
Set-Content -Path (Join-Path $control "alarm-$Action.request") -Value (Get-Date -Format o)
Write-Host "Alarm $Action requested; result appears in runtime\logs\world-journal.jsonl (admin_alarm_request)."
