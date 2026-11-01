# Stop Canary and MariaDB without deleting any data.
# Canary: graceful shutdown request via runtime\control\shutdown.request (handled by our Lua
# globalevent, which saves the world), forced stop only after the timeout.
# MariaDB: clean shutdown through mariadb-admin.
#   scripts\stop.ps1             # everything
#   scripts\stop.ps1 -KeepDb     # keep MariaDB running
#   scripts\stop.ps1 -BrainOnly  # only Brain (the world keeps running on its local controller)
param([switch]$KeepDb, [switch]$BrainOnly, [int]$TimeoutSec = 60)
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
if (-not $BrainOnly) { Stop-Keeper }

$brain = Get-TrackedProcess 'brain'
if ($brain) {
    $control = Join-Path $Runtime 'control'
    New-Item -ItemType Directory -Force $control | Out-Null
    Set-Content -Path (Join-Path $control 'brain-stop.request') -Value (Get-Date -Format o)
    if (-not $brain.WaitForExit(10000)) { Stop-Process -Id $brain.Id -Force }
    Remove-Item (Join-Path $PidDir 'brain.pid') -ErrorAction SilentlyContinue
    Write-Host "Brain stopped"
}
if ($BrainOnly) { return }
& "$PSScriptRoot\ollama.ps1" -Stop

$canary = Get-TrackedProcess 'canary'
if ($canary) {
    $control = Join-Path $Runtime 'control'
    New-Item -ItemType Directory -Force $control | Out-Null
    Set-Content -Path (Join-Path $control 'shutdown.request') -Value (Get-Date -Format o)
    Write-Host "Requested graceful Canary shutdown (pid $($canary.Id))..."
    if (-not $canary.WaitForExit($TimeoutSec * 1000)) {
        Write-Warning "Canary did not exit in $TimeoutSec s; stopping process (unsaved state since last save may be lost)."
        Stop-Process -Id $canary.Id -Force
    }
    Remove-Item (Join-Path $PidDir 'canary.pid') -ErrorAction SilentlyContinue
    Write-Host "Canary stopped"
} else {
    Write-Host "Canary not running"
}

$login = Get-TrackedProcess 'login'
if ($login) {
    # Stateless HTTP/gRPC service: a plain process stop loses nothing.
    Stop-Process -Id $login.Id -Force
    Remove-Item (Join-Path $PidDir 'login.pid') -ErrorAction SilentlyContinue
    Write-Host "Login-server stopped"
}

if ($KeepDb) { return }
$db = Get-TrackedProcess 'mariadb'
if ($db) {
    $admin = Join-Path $MariaDbHome 'bin\mariadb-admin.exe'
    & $admin "--defaults-extra-file=$(Get-RootClientConfig)" shutdown
    if (-not $db.WaitForExit(30000)) { throw "MariaDB did not stop; check runtime\logs\mariadb.err.log" }
    Remove-Item (Join-Path $PidDir 'mariadb.pid') -ErrorAction SilentlyContinue
    Write-Host "MariaDB stopped"
} else {
    Write-Host "MariaDB not running"
}
