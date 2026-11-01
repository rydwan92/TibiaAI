# What was recorded about people who agreed to it (packages\contracts\observation.json).
#   powershell -ExecutionPolicy Bypass -File scripts\observe.ps1                     # who, how much
#   powershell -ExecutionPolicy Bypass -File scripts\observe.ps1 -Delete "Name"      # removes that person's record
param([string]$Delete = '')
. "$PSScriptRoot\lib.ps1"
$logs = Join-Path $Runtime 'logs'
if ($Delete) {
    $file = Join-Path $logs ("observe-" + ($Delete -replace '\W', '_') + '.jsonl')
    if (Test-Path $file) { Remove-Item $file; Write-Host "Deleted the record of $Delete" } else { Write-Host "No record of $Delete" }
    return
}
$consent = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'packages\contracts\observation.json') | ConvertFrom-Json
Write-Host "Zgoda: $(@($consent.consented) -join ', ')"
Get-ChildItem $logs -Filter 'observe-*.jsonl' -ErrorAction SilentlyContinue | ForEach-Object { Write-Host ("{0}: {1} KB, ostatni zapis {2}" -f $_.Name, [math]::Round($_.Length / 1KB), $_.LastWriteTime) }
