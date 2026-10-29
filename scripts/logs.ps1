# Tail logs:  scripts\logs.ps1 [-Name canary|mariadb|brain] [-Lines 60] [-Follow]
param([ValidateSet('canary', 'mariadb', 'login', 'brain', 'journal')][string]$Name = 'canary', [int]$Lines = 60, [switch]$Follow)
. "$PSScriptRoot\lib.ps1"
$file = switch ($Name) {
    'canary' { Join-Path $LogDir 'canary.out.log' }
    'login' { Join-Path $LogDir 'login.out.log' }
    'journal' { Join-Path $LogDir 'world-journal.jsonl' }
    'mariadb' { Join-Path $LogDir 'mariadb.err.log' }
    'brain' { Join-Path $LogDir 'brain.log' }
}
if (-not (Test-Path $file)) { Write-Host "No log yet: $file"; return }
if ($Follow) { Get-Content $file -Tail $Lines -Wait } else { Get-Content $file -Tail $Lines }
