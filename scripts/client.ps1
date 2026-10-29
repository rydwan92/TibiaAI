# Launch OTClient 4.1 (opentibiabr/otclient @ dd56414) and show the login values for this lab.
#   powershell -ExecutionPolicy Bypass -File scripts\client.ps1 [-CopyPassword]
# -CopyPassword puts the test account password on the clipboard instead of printing it.
param([switch]$CopyPassword)
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
$exe = Join-Path $OtclientDir 'otclient.exe'
if (-not (Test-Path $exe)) { throw "OTClient not found: run scripts\setup.ps1" }

$things = Join-Path $OtclientDir "data\things\$($Lock.canary.clientVersion)"
$hasAssets = (Test-Path $things) -and (Get-ChildItem $things -Filter 'catalog-content.json' -ErrorAction SilentlyContinue)
if (-not $hasAssets) {
    Write-Warning "No client assets in $things. OTClient offers its own downloader (client_assets module), or copy the 'assets' of a Tibia 15.11 client there. See DOCS\RUNBOOK.md, section Klient."
}

Write-Host ""
Write-Host "Login screen values:"
Write-Host "  Server / IP     : http://127.0.0.1:$($Lock.ports.loginHttp)/login"
Write-Host "  Port            : $($Lock.ports.loginHttp)"
Write-Host "  Client version  : $($Lock.canary.clientVersion)"
Write-Host "  HTTP login      : checked"
Write-Host "  Email           : $($cfg.TIBIAAI_TEST_EMAIL)   (email, not the account name)"
if ($CopyPassword) {
    Set-Clipboard -Value $cfg.TIBIAAI_TEST_PASSWORD
    Write-Host "  Password        : copied to clipboard"
} else {
    Write-Host "  Password        : .env -> TIBIAAI_TEST_PASSWORD (or run with -CopyPassword)"
}
Write-Host "  Characters      : 'GOD' (admin: /alarm, /ardan) or 'Knight Sample' (normal player)"
Write-Host ""
Start-Process -FilePath $exe -WorkingDirectory $OtclientDir
