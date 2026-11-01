# Starts a raid from the datapack now. Everyone online sees the announcement, agents talk about it.
#   powershell -ExecutionPolicy Bypass -File scripts\event.ps1 -Raid thais.rats
param([Parameter(Mandatory = $true)][string]$Raid)
. "$PSScriptRoot\lib.ps1"
Write-ControlRequest 'raid.request' $Raid
Write-Host "Requested raid $Raid; result in runtime\logs\world-journal.jsonl (world_event)"
