# Verify a backup by restoring it into a separate scratch database and comparing row counts with
# the manifest. The live database is never touched; only the scratch database named below is
# created and (unless -Keep) dropped again.
#   powershell -ExecutionPolicy Bypass -File scripts\restore-test.ps1 [-Path runtime\backups\<stamp>] [-Keep]
param([string]$Path = '', [switch]$Keep)
. "$PSScriptRoot\lib.ps1"
$ScratchDb = 'tibiaai_restore_test'
if (-not (Get-TrackedProcess 'mariadb')) { throw "MariaDB is not running (scripts\start.ps1 -DbOnly)" }

if (-not $Path) {
    $latest = Get-ChildItem (Join-Path $Runtime 'backups') -Directory -ErrorAction SilentlyContinue | Sort-Object Name | Select-Object -Last 1
    if (-not $latest) { throw "No backups in runtime\backups (run scripts\backup.ps1)" }
    $Path = $latest.FullName
}
$manifest = Get-Content -Raw -Encoding UTF8 (Join-Path $Path 'manifest.json') | ConvertFrom-Json
$cfg = Read-DotEnv
if ($ScratchDb -eq $cfg.TIBIAAI_DB_NAME) { throw "Scratch database name collides with the live database" }
Write-Host "Backup: $Path ($($manifest.createdAt))"

# 1. Checksums
$fail = 0
foreach ($f in $manifest.files) {
    $hash = (Get-FileHash -Algorithm SHA256 (Join-Path $Path $f.name)).Hash.ToLower()
    $ok = $hash -eq $f.sha256
    if (-not $ok) { $fail++ }
    Write-Host ("  sha256 {0,-14} {1}" -f $f.name, $(if ($ok) { 'PASS' } else { 'FAIL' }))
}

# 2. World database into the scratch database
Invoke-MariaDb "DROP DATABASE IF EXISTS ``$ScratchDb``; CREATE DATABASE ``$ScratchDb`` CHARACTER SET utf8mb4;" | Out-Null
$sqlPath = (Join-Path $Path 'world.sql').Replace('\', '/')
Invoke-MariaDb "source $sqlPath" $ScratchDb | Out-Null
$restored = Get-TableRowCounts $ScratchDb
foreach ($p in $manifest.worldTables.PSObject.Properties) {
    $got = $restored[$p.Name]
    $ok = ($got -eq [long]$p.Value)
    if (-not $ok) { $fail++; Write-Host ("  world  {0,-28} expected {1} got {2} FAIL" -f $p.Name, $p.Value, $got) }
}
Write-Host ("  world  {0} tables compared" -f @($manifest.worldTables.PSObject.Properties).Count)
if (-not $Keep) { Invoke-MariaDb "DROP DATABASE ``$ScratchDb``;" | Out-Null }

# 3. Brain memory copy
$brainCopy = Join-Path $Path 'brain.sqlite'
if ($manifest.brainTables -and (Test-Path $brainCopy)) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $info = & $node --disable-warning=ExperimentalWarning (Join-Path $Root 'apps\brain\src\cli\sqlite-tool.ts') check $brainCopy | ConvertFrom-Json
    if (-not $info.ok) { $fail++ }
    foreach ($p in $manifest.brainTables.PSObject.Properties) {
        if ($info.tables.($p.Name) -ne $p.Value) { $fail++; Write-Host ("  brain  {0} expected {1} got {2} FAIL" -f $p.Name, $p.Value, $info.tables.($p.Name)) }
    }
    Write-Host ("  brain  integrity={0}, {1} tables compared" -f $info.integrity, @($manifest.brainTables.PSObject.Properties).Count)
}

if ($fail -gt 0) { Write-Host "RESTORE TEST FAILED ($fail problem(s))"; exit 1 }
Write-Host "RESTORE TEST PASSED"
