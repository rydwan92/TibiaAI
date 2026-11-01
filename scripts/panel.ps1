# Opens the toolbox page Brain keeps up to date: characters, what they remember, what they cost.
#   powershell -ExecutionPolicy Bypass -File scripts\panel.ps1
. "$PSScriptRoot\lib.ps1"
$page = Join-Path $Runtime 'panel\index.html'
if (-not (Test-Path $page)) { throw "No page yet: Brain writes it every 30 s (scripts\start.ps1)" }
Start-Process $page
