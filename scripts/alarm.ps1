# Controlled training alarm for all agents reacting to the zone (administrator test event,
# not monster detection). Zones: packages\contracts\agents.json -> alarmZones (default: first).
#   powershell -ExecutionPolicy Bypass -File scripts\alarm.ps1 start [-Zone thais_gate]
#   powershell -ExecutionPolicy Bypass -File scripts\alarm.ps1 clear [-Zone thais_gate]
# In game the GOD character can use /alarm start|clear [zone] instead.
param([Parameter(Mandatory = $true)][ValidateSet('start', 'clear')][string]$Action, [ValidatePattern('^[A-Za-z0-9_]*$')][string]$Zone = '')
. "$PSScriptRoot\lib.ps1"
Write-ControlRequest "alarm-$Action.request" $Zone
Write-Host "Alarm $Action requested; result appears in runtime\logs\world-journal.jsonl (admin_alarm_request)."
