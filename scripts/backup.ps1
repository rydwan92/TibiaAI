# Backup of the world database and Brain memory into runtime\backups\<timestamp>\ (nothing is deleted).
#   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1
# - world.sql    : mariadb-dump --single-transaction (consistent while Canary runs)
# - brain.sqlite : SQLite VACUUM INTO (consistent while Brain runs)
# - manifest.json: versions, sha256, row counts per table (used by scripts\restore-test.ps1)
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
if (-not (Get-TrackedProcess 'mariadb')) { throw "MariaDB is not running (scripts\start.ps1 -DbOnly)" }

$stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
$dest = Join-Path $Runtime "backups\$stamp"
New-Item -ItemType Directory -Force $dest | Out-Null
$db = $cfg.TIBIAAI_DB_NAME

# World database
$dump = Join-Path $MariaDbHome 'bin\mariadb-dump.exe'
$worldSql = Join-Path $dest 'world.sql'
& $dump "--defaults-extra-file=$(Get-RootClientConfig)" --single-transaction --routines --triggers --hex-blob "--result-file=$worldSql" $db
if ($LASTEXITCODE -ne 0) { throw "mariadb-dump failed" }
$worldCounts = Get-TableRowCounts $db

# Brain memory
$brainDb = Join-Path $Runtime 'brain\brain.sqlite'
$brainInfo = $null
if (Test-Path $brainDb) {
    $node = (Get-Command node -ErrorAction Stop).Source
    $tool = Join-Path $Root 'apps\brain\src\cli\sqlite-tool.ts'
    $out = & $node --disable-warning=ExperimentalWarning $tool backup $brainDb (Join-Path $dest 'brain.sqlite')
    if ($LASTEXITCODE -ne 0) { throw "SQLite backup failed" }
    $brainInfo = $out | ConvertFrom-Json
}

$files = Get-ChildItem $dest -File | ForEach-Object {
    [ordered]@{ name = $_.Name; bytes = $_.Length; sha256 = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower() }
}
$manifest = [ordered]@{
    createdAt = (Get-Date).ToUniversalTime().ToString('o')
    database = $db
    canaryCommit = $Lock.canary.commit
    mariadb = $Lock.mariadb.version
    worldTables = $worldCounts
    brainTables = if ($brainInfo) { $brainInfo.tables } else { $null }
    files = @($files)
}
[System.IO.File]::WriteAllText((Join-Path $dest 'manifest.json'), ($manifest | ConvertTo-Json -Depth 5), (New-Object System.Text.UTF8Encoding $false))
Write-Host "Backup written to $dest"
$files | ForEach-Object { Write-Host ("  {0,-14} {1,10} bytes" -f $_.name, $_.bytes) }
