# Assemble runtime\server from pinned upstream + our overlay, and generate config.lua.
# Upstream files under vendor\ stay untouched. Re-run after editing game\overlays\tibia-ai.
# Does not touch the database or runtime data other than the server directory's copied code.
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv

# A running canary.exe cannot be overwritten; fail with a clear message instead of a copy error.
if (Get-TrackedProcess 'canary') {
    if (Test-Path (Join-Path $ServerDir 'canary.exe')) {
        Write-Host "Canary is running; runtime\server left unchanged. To deploy changes: scripts\stop.ps1 -KeepDb, then run this again."
        return
    }
}

New-Item -ItemType Directory -Force $ServerDir | Out-Null
Copy-Item $CanaryExe $ServerDir -Force
Copy-Item (Join-Path $CanarySrc 'key.pem') $ServerDir -Force
foreach ($dir in 'data', $DataPack) {
    # robocopy /MIR keeps the copy identical to the pinned source (only inside runtime\server).
    # The map is copied separately below and must survive /MIR.
    & robocopy.exe (Join-Path $CanarySrc $dir) (Join-Path $ServerDir $dir) /MIR /XF "$MapName.otbm" /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy failed for $dir ($LASTEXITCODE)" }
}

# Overlay: our scripts and NPC declarations, copied over the datapack copy.
if (Test-Path $Overlay) {
    & robocopy.exe $Overlay (Join-Path $ServerDir $DataPack) /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy overlay failed ($LASTEXITCODE)" }
}
# Developer map: runtime\maps\<map>.otbm (scripts\map-dev.ps1) replaces the pinned map in the server
# copy only. Removing that file and syncing returns to the pinned one.
$devMap = Join-Path $Runtime "maps\$MapName.otbm"
$liveMap = Join-Path $ServerDir "$DataPack\world\$MapName.otbm"
$sourceMap = if (Test-Path $devMap) { Write-Host "Using developer map $devMap"; $devMap } else { $MapFile }
if (-not (Test-Path $sourceMap)) { throw "Map $sourceMap is missing; see DOCS/RUNBOOK.md" }
if (-not (Test-Path $liveMap) -or (Get-Item $liveMap).Length -ne (Get-Item $sourceMap).Length) { Copy-Item $sourceMap $liveMap -Force }

# Our own places: small map files beside the pinned map, which stays untouched (tools\map_place.py).
$custom = Join-Path $ServerDir "$DataPack\world\custom"
& python -I (Join-Path $Root 'tools\map_place.py') build (Join-Path $Root 'game\world\places') $custom (Join-Path $CanarySrc 'data\items\items.xml')
if ($LASTEXITCODE -ne 0) { throw 'A place in game\world\places is invalid' }
New-Item -ItemType Directory -Force (Join-Path $Runtime 'atlas') | Out-Null
Move-Item -Force (Join-Path $custom 'stevium-blocked.json') (Join-Path $Runtime 'atlas\places-blocked.json')

# Agent definitions: single source in packages\contracts (ADR 0004), read by Lua at script load.
$agentsJson = Join-Path $Root 'packages\contracts\agents.json'
$null = Get-Content -Raw -Encoding UTF8 $agentsJson | ConvertFrom-Json  # fail early on invalid JSON
$ourData = Join-Path $ServerDir "$DataPack\tibia-ai"
New-Item -ItemType Directory -Force $ourData | Out-Null
Copy-Item $agentsJson (Join-Path $ourData 'agents.json') -Force
# The engine reads incident descriptions from the shared world rules.
Copy-Item (Join-Path $Root 'packages\contracts\npc\world.json') (Join-Path $ourData 'world.json') -Force
Copy-Item (Join-Path $Root 'packages\contracts\tasks.json') (Join-Path $ourData 'tasks.json') -Force
Copy-Item (Join-Path $Root 'packages\contracts\shop.json') (Join-Path $ourData 'shop.json') -Force
Copy-Item (Join-Path $Root 'packages\contracts\observation.json') (Join-Path $ourData 'observation.json') -Force

# config.lua from config.lua.dist with explicit overrides; fail if a key is missing upstream.
$overrides = [ordered]@{
    'dataPackDirectory'       = "`"$DataPack`""
    'ip'                      = "`"$(Get-WorldHost $cfg)`""
    'bindOnlyGlobalAddress'   = 'true'
    'serverName'              = '"TibiaAI"'
    'serverMotd'              = '"TibiaAI local lab"'
    'toggleDownloadMap'       = 'false'
    'mapName'                 = "`"$MapName`""
    'mysqlHost'               = '"127.0.0.1"'
    'mysqlUser'               = "`"$($cfg.TIBIAAI_DB_USER)`""
    'mysqlPass'               = "`"$($cfg.TIBIAAI_DB_PASSWORD)`""
    'mysqlDatabase'           = "`"$($cfg.TIBIAAI_DB_NAME)`""
    'mysqlPort'               = $cfg.TIBIAAI_DB_PORT
    'metricsPrometheusAddress' = '"127.0.0.1:9464"'
    'worldType'               = '"pvp"'
    # Upstream stops the whole server at the daily save (06:00). Here the world and its agents live on.
    'globalServerSaveShutdown' = 'false'
    # Forge would turn arena monsters into Fiendish ones (health x3.6, stronger hits) every 10 s,
    # which breaks predictable training and floods the log on a map without monsters.
    'forgeInfluencedLimit'    = '0'
    'forgeFiendishLimit'      = '0'
}
$config = Get-Content -Raw -Encoding UTF8 (Join-Path $CanarySrc 'config.lua.dist')
foreach ($key in $overrides.Keys) {
    $pattern = "(?m)^$key\s*=.*$"
    if ($config -notmatch $pattern) { throw "config.lua.dist has no key '$key'" }
    $config = [regex]::Replace($config, $pattern, "$key = $($overrides[$key])")
}
[System.IO.File]::WriteAllText((Join-Path $ServerDir 'config.lua'), $config, (New-Object System.Text.UTF8Encoding $false))
Write-Host "Server assembled in $ServerDir"
