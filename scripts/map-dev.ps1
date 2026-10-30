# Developer copy of the map for editing in Canary Map Editor (DOCS/TOOLING.md). The pinned original
# in vendor\ is never touched; scripts\sync-server.ps1 uses the copy when it exists.
#   powershell -ExecutionPolicy Bypass -File scripts\map-dev.ps1 -Init     create runtime\maps\canary.otbm
#   powershell -ExecutionPolicy Bypass -File scripts\map-dev.ps1 -Status   show which map the server uses
#   powershell -ExecutionPolicy Bypass -File scripts\map-dev.ps1 -Reset    keep the copy as canary.<date>.otbm, use the original again
param([switch]$Init, [switch]$Status, [switch]$Reset)
. "$PSScriptRoot\lib.ps1"
$maps = Join-Path $Runtime 'maps'
$dev = Join-Path $maps 'canary.otbm'
$original = Join-Path $CanarySrc 'data-canary\world\canary.otbm'
$live = Join-Path $ServerDir 'data-canary\world\canary.otbm'

function Hash([string]$path) { if (Test-Path $path) { (Get-FileHash -Algorithm SHA256 $path).Hash.ToLower().Substring(0, 16) } else { 'missing' } }

if ($Init) {
    New-Item -ItemType Directory -Force $maps | Out-Null
    if (Test-Path $dev) { Write-Host "Developer map already exists: $dev" } else { Copy-Item $original $dev; Write-Host "Created $dev" }
}
if ($Reset) {
    if (Test-Path $dev) {
        $kept = Join-Path $maps ("canary.{0}.otbm" -f (Get-Date).ToString('yyyyMMdd-HHmmss'))
        Move-Item $dev $kept
        Write-Host "Developer map kept as $kept. Run stop.ps1 -KeepDb, sync-server.ps1, start.ps1 to return to the original."
    }
}
Write-Host ("original  {0}  {1}" -f (Hash $original), $original)
Write-Host ("developer {0}  {1}" -f (Hash $dev), $dev)
Write-Host ("server    {0}  {1}" -f (Hash $live), $live)
