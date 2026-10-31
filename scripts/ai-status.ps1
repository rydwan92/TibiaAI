# What the AI is doing now: game Ollama, model, provider, last answers, agents. Read-only: it never
# sends a request to a model.
#   powershell -ExecutionPolicy Bypass -File scripts\ai-status.ps1 [-Json]
param([switch]$Json)
. "$PSScriptRoot\lib.ps1"
$node = (Get-Command node -ErrorAction Stop).Source
$cli = @('--disable-warning=ExperimentalWarning', (Join-Path $Root 'apps\brain\src\cli\ai-status.ts'))
if ($Json) { $cli += '--json' }
& $node @cli
