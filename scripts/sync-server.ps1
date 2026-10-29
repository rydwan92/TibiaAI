# Assemble runtime\server from pinned upstream + our overlay, and generate config.lua.
# Upstream files under vendor\ stay untouched. Re-run after editing game\overlays\tibia-ai.
# Does not touch the database or runtime data other than the server directory's copied code.
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv

New-Item -ItemType Directory -Force $ServerDir | Out-Null
Copy-Item $CanaryExe $ServerDir -Force
Copy-Item (Join-Path $CanarySrc 'key.pem') $ServerDir -Force
foreach ($dir in 'data', 'data-canary') {
    # robocopy /MIR keeps the copy identical to the pinned source (only inside runtime\server).
    & robocopy.exe (Join-Path $CanarySrc $dir) (Join-Path $ServerDir $dir) /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $dir ($LASTEXITCODE)" }
}

# Overlay: our scripts and NPC declarations, copied over the datapack copy.
if (Test-Path $Overlay) {
    & robocopy.exe $Overlay (Join-Path $ServerDir 'data-canary') /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy overlay failed ($LASTEXITCODE)" }
}

# config.lua from config.lua.dist with explicit overrides; fail if a key is missing upstream.
$overrides = [ordered]@{
    'dataPackDirectory'       = '"data-canary"'
    'ip'                      = '"127.0.0.1"'
    'bindOnlyGlobalAddress'   = 'true'
    'serverName'              = '"TibiaAI"'
    'serverMotd'              = '"TibiaAI local lab"'
    'toggleDownloadMap'       = 'false'
    'mapName'                 = '"canary"'
    'mysqlHost'               = '"127.0.0.1"'
    'mysqlUser'               = "`"$($cfg.TIBIAAI_DB_USER)`""
    'mysqlPass'               = "`"$($cfg.TIBIAAI_DB_PASSWORD)`""
    'mysqlDatabase'           = "`"$($cfg.TIBIAAI_DB_NAME)`""
    'mysqlPort'               = $cfg.TIBIAAI_DB_PORT
    'metricsPrometheusAddress' = '"127.0.0.1:9464"'
    'worldType'               = '"no-pvp"'
}
$config = Get-Content -Raw -Encoding UTF8 (Join-Path $CanarySrc 'config.lua.dist')
foreach ($key in $overrides.Keys) {
    $pattern = "(?m)^$key\s*=.*$"
    if ($config -notmatch $pattern) { throw "config.lua.dist has no key '$key'" }
    $config = [regex]::Replace($config, $pattern, "$key = $($overrides[$key])")
}
[System.IO.File]::WriteAllText((Join-Path $ServerDir 'config.lua'), $config, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Server assembled in $ServerDir"
