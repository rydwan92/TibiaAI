# Engine view of map walkability around a position, for choosing agent waypoints without GUI.
#   powershell -ExecutionPolicy Bypass -File scripts\scan.ps1 -X 32369 -Y 32251 [-Z 7] [-Radius 12]
# Legend: '.' walkable, '#' solid, '^' floor change (stairs/holes), ' ' no tile, '@' centre.
param([Parameter(Mandatory = $true)][int]$X, [Parameter(Mandatory = $true)][int]$Y, [int]$Z = 7, [ValidateRange(1, 20)][int]$Radius = 12)
. "$PSScriptRoot\lib.ps1"
if (-not (Get-TrackedProcess 'canary')) { throw "Canary is not running" }
$since = (Get-Date).ToUniversalTime().AddSeconds(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
Write-ControlRequest 'scan.request' "$X,$Y,$Z,$Radius"
$entry = Wait-JournalEntry 'area_scan' $since 10
if (-not $entry) { throw "No area_scan within 10 s" }
if ($entry.error) { throw $entry.error }
$header = ' ' * 6 + (-join (($X - $Radius)..($X + $Radius) | ForEach-Object { [string]($_ % 10) }))
Write-Host "x from $($X - $Radius) to $($X + $Radius) (last digit shown)"
Write-Host $header
$entry.rows | ForEach-Object { Write-Host $_ }
