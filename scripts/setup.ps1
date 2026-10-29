# First-time setup (idempotent). Run from the project root in Windows PowerShell:
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
# Downloads pinned artifacts (sha256-verified), extracts them into vendor\, creates .env with
# random secrets, initialises a portable MariaDB in runtime\mariadb (no Windows service),
# imports the Canary schema, sets the test account password and assembles runtime\server.
# Never deletes existing data: every step is skipped when its result already exists.
. "$PSScriptRoot\lib.ps1"

function New-Secret([int]$length = 24) {
    $chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'.ToCharArray()
    $bytes = New-Object byte[] $length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    return -join ($bytes | ForEach-Object { $chars[$_ % $chars.Length] })
}

function Get-Artifact($entry) {
    $target = Join-Path $Downloads $entry.file
    New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
    if (-not (Test-Path $target)) {
        Write-Host "Downloading $($entry.url)"
        & curl.exe -sSL -o $target $entry.url
        if ($LASTEXITCODE -ne 0) { throw "download failed: $($entry.url)" }
    }
    $hash = (Get-FileHash -Algorithm SHA256 $target).Hash.ToLower()
    if ($hash -ne $entry.sha256) { throw "sha256 mismatch for $target ($hash)" }
    return $target
}

function Expand-Once([string]$zip, [string]$dest, [string]$marker) {
    if (Test-Path $marker) { return }
    New-Item -ItemType Directory -Force $dest | Out-Null
    Write-Host "Extracting $zip"
    Expand-Archive -Path $zip -DestinationPath $dest -Force
}

# 1. Artifacts
$canaryZip = Get-Artifact $Lock.canary.binary
$canarySrcZip = Get-Artifact $Lock.canary.source
$mariaZip = Get-Artifact $Lock.mariadb
$otcZip = Get-Artifact $Lock.otclient.binary
$otcSrcZip = Get-Artifact $Lock.otclient.source

Expand-Once $canarySrcZip (Join-Path $Vendor 'canary-src') (Join-Path $CanarySrc 'schema.sql')
Expand-Once $canaryZip (Join-Path $Vendor 'canary-bin') $CanaryExe
Expand-Once $mariaZip (Join-Path $Vendor 'mariadb') (Join-Path $MariaDbHome 'bin\mariadbd.exe')
Expand-Once $otcSrcZip (Join-Path $Vendor 'otclient') (Join-Path $OtclientDir 'init.lua')
if (-not (Test-Path (Join-Path $OtclientDir 'otclient.exe'))) {
    $tmp = Join-Path $Vendor 'otclient\_bin'
    Expand-Archive -Path $otcZip -DestinationPath $tmp -Force
    Copy-Item (Join-Path $tmp 'otclient.exe') $OtclientDir
}

# Login-server built from the pinned commit with a portable Go (caches stay under vendor\).
if (-not (Test-Path $LoginServerExe)) {
    $goZip = Get-Artifact $Lock.go
    $lsZip = Get-Artifact $Lock.loginServer.source
    $goRoot = Join-Path $Vendor 'go-toolchain\go'
    Expand-Once $goZip (Join-Path $Vendor 'go-toolchain') (Join-Path $goRoot 'bin\go.exe')
    $lsSrc = Join-Path $Vendor ("login-server-src\login-server-" + $Lock.loginServer.commit)
    Expand-Once $lsZip (Join-Path $Vendor 'login-server-src') (Join-Path $lsSrc 'go.mod')
    $env:GOROOT = $goRoot; $env:GOPATH = Join-Path $Vendor 'go-path'; $env:GOMODCACHE = Join-Path $Vendor 'go-path\pkg\mod'
    $env:GOCACHE = Join-Path $Vendor 'go-cache'; $env:GOTOOLCHAIN = 'local'; $env:GOFLAGS = '-mod=readonly'; $env:GOTELEMETRY = 'off'
    Push-Location $lsSrc
    try { & (Join-Path $goRoot 'bin\go.exe') build -trimpath -o $LoginServerExe ./src } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "login-server build failed" }
}

# 2. .env with generated secrets (kept if it exists)
$envPath = Join-Path $Root '.env'
if (-not (Test-Path $envPath)) {
    $lines = @(
        "TIBIAAI_DB_PORT=$($Lock.ports.db)",
        'TIBIAAI_DB_NAME=tibiaai_canary',
        'TIBIAAI_DB_USER=canary',
        "TIBIAAI_DB_PASSWORD=$(New-Secret)",
        "TIBIAAI_DB_ROOT_PASSWORD=$(New-Secret)",
        'TIBIAAI_TEST_ACCOUNT=tibiaai',
        'TIBIAAI_TEST_EMAIL=tibiaai@localhost',
        "TIBIAAI_TEST_PASSWORD=$(New-Secret 12)",
        'TIBIAAI_BRAIN_PROVIDER=rules'
    )
    [System.IO.File]::WriteAllLines($envPath, $lines)
    Write-Host "Created .env with generated secrets"
}
$cfg = Read-DotEnv

# 3. MariaDB data directory
New-Item -ItemType Directory -Force $DbTmp, $LogDir, $PidDir | Out-Null
if (-not (Test-Path (Join-Path $DbData 'mysql'))) {
    Write-Host "Initialising MariaDB data dir in $DbData"
    $installDb = Join-Path $MariaDbHome 'bin\mariadb-install-db.exe'
    & $installDb "--datadir=$DbData" "--port=$($cfg.TIBIAAI_DB_PORT)" "--password=$($cfg.TIBIAAI_DB_ROOT_PASSWORD)" | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "mariadb-install-db failed" }
}

& "$PSScriptRoot\start.ps1" -DbOnly

# 4. Database, user, schema, test account
$db = $cfg.TIBIAAI_DB_NAME
$user = $cfg.TIBIAAI_DB_USER
$pw = $cfg.TIBIAAI_DB_PASSWORD
Invoke-MariaDb @"
CREATE DATABASE IF NOT EXISTS ``$db`` CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS '$user'@'127.0.0.1' IDENTIFIED BY '$pw';
CREATE USER IF NOT EXISTS '$user'@'localhost' IDENTIFIED BY '$pw';
GRANT ALL PRIVILEGES ON ``$db``.* TO '$user'@'127.0.0.1';
GRANT ALL PRIVILEGES ON ``$db``.* TO '$user'@'localhost';
FLUSH PRIVILEGES;
"@ | Out-Null

$hasSchema = Invoke-MariaDb "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db' AND table_name='server_config';"
if ("$hasSchema".Trim() -eq '0') {
    Write-Host "Importing schema.sql"
    $schema = Get-Content -Raw -Encoding UTF8 (Join-Path $CanarySrc 'schema.sql')
    Invoke-MariaDb $schema $db | Out-Null
    # Upstream schema ships account 1 as god/god; rename it and set a generated password (sha1, passwordType=sha1).
    # The client logs in with the EMAIL: Canary 3.6.1 resolves the game session by email for protocol 15.11.
    $acc = $cfg.TIBIAAI_TEST_ACCOUNT
    $mail = $cfg.TIBIAAI_TEST_EMAIL
    $tpw = $cfg.TIBIAAI_TEST_PASSWORD
    Invoke-MariaDb "UPDATE accounts SET name='$acc', email='$mail', password=SHA1('$tpw') WHERE id=1;" $db | Out-Null
}

# 5. Server directory
& "$PSScriptRoot\sync-server.ps1"
Write-Host "Setup complete. Next: scripts\start.ps1"
