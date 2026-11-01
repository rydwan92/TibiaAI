# Triggers a world incident from packages\contracts\npc\world.json. Only agents that can see the
# position perceive it (ADR 0008).
#   powershell -ExecutionPolicy Bypass -File scripts\incident.ps1 -Id cart_crash -X 32367 -Y 32252 [-Z 7]
param([Parameter(Mandatory = $true)][ValidatePattern('^[a-z_]+$')][string]$Id, [Parameter(Mandatory = $true)][int]$X, [Parameter(Mandatory = $true)][int]$Y, [int]$Z = 7)
. "$PSScriptRoot\lib.ps1"
Write-ControlRequest 'incident.request' "$Id,$X,$Y,$Z"
Write-Host "Incident $Id at $X,$Y,$Z requested; see: python -I tools\journal.py --kinds incident"
