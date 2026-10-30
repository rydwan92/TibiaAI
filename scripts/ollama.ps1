# Dedicated Ollama instance for the game (ADR 0007): its own process on 127.0.0.1:11435 with cloud
# features disabled, one loaded model and one request at a time. Model weights are shared with the
# user's normal Ollama installation, whose settings and cloud models stay untouched.
#   powershell -ExecutionPolicy Bypass -File scripts\ollama.ps1 -Start | -Stop | -Status
param([switch]$Start, [switch]$Stop, [switch]$Status)
. "$PSScriptRoot\lib.ps1"
$policy = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'packages\contracts\local-ai.json') | ConvertFrom-Json
$port = ([uri]$policy.endpoint).Port
New-Item -ItemType Directory -Force $PidDir, $LogDir | Out-Null

function Test-CloudBlocked {
    # Proof on the running process: a request for a cloud model must fail with "cloud is disabled".
    try {
        $body = '{"model":"glm-5.2:cloud","stream":false,"messages":[{"role":"user","content":"ok"}]}'
        Invoke-RestMethod -Uri "$($policy.endpoint)/api/chat" -Method Post -Body $body -ContentType 'application/json' -TimeoutSec 15 | Out-Null
        return $false
    } catch {
        return ("$($_.ErrorDetails.Message) $($_.Exception.Message)" -match 'cloud is disabled|disabled|not found|403')
    }
}

if ($Start) {
    if (Get-TrackedProcess 'ollama') {
        Write-Host "Game Ollama already running on $($policy.endpoint)"
    } else {
        if (Test-LocalPort $port) { throw "Port $port is used by another process" }
        $exe = (Get-Command ollama -ErrorAction Stop).Source
        $vars = @{
            OLLAMA_HOST = "127.0.0.1:$port"; OLLAMA_NO_CLOUD = '1'; OLLAMA_NUM_PARALLEL = '1'; OLLAMA_MAX_LOADED_MODELS = '1'
            OLLAMA_MAX_QUEUE = '8'; OLLAMA_CONTEXT_LENGTH = "$($policy.contextTokens)"; OLLAMA_KEEP_ALIVE = $policy.keepAlive
        }
        foreach ($k in $vars.Keys) { Set-Item "Env:\$k" $vars[$k] }
        $log = Join-Path $LogDir 'ollama-game.log'
        $line = "/c `"`"$exe`" serve > `"$log`" 2>&1`""
        $shell = Start-Process -FilePath 'cmd.exe' -ArgumentList $line -WorkingDirectory $Runtime -WindowStyle Hidden -PassThru
        foreach ($k in $vars.Keys) { Remove-Item "Env:\$k" -ErrorAction SilentlyContinue }
        $child = $null
        for ($i = 0; $i -lt 50 -and -not $child; $i++) {
            $child = (Get-CimInstance Win32_Process -Filter "ParentProcessId=$($shell.Id)" | Where-Object { $_.Name -eq 'ollama.exe' }).ProcessId
            if (-not $child) { Start-Sleep -Milliseconds 100 }
        }
        if (-not $child) { throw "Ollama did not start; see $log" }
        Set-Content -Path (Join-Path $PidDir 'ollama.pid') -Value $child
        if (-not (Wait-LocalPort $port 15)) { throw "Ollama did not open port $port; see $log" }
        Write-Host "Game Ollama started (pid $child, $($policy.endpoint), cloud disabled by environment)"
    }
}

if ($Stop) {
    $p = Get-TrackedProcess 'ollama'
    if ($p) {
        # The model runs in a child llama-server; stopping only the parent leaves it holding the VRAM.
        $runners = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($p.Id)" | Where-Object { $_.Name -eq 'llama-server.exe' })
        Stop-Process -Id $p.Id -Force
        foreach ($r in $runners) { Stop-Process -Id $r.ProcessId -Force -ErrorAction SilentlyContinue }
        Remove-Item (Join-Path $PidDir 'ollama.pid') -ErrorAction SilentlyContinue
        Write-Host "Game Ollama stopped"
    }
    else { Write-Host "Game Ollama not running" }
}

if ($Status -or $Start) {
    if (Test-LocalPort $port) {
        Write-Host ("cloud blocked on {0}: {1}" -f $policy.endpoint, (Test-CloudBlocked))
        $models = (Invoke-RestMethod "$($policy.endpoint)/api/tags").models
        $wanted = $models | Where-Object { $_.name -eq $policy.model }
        Write-Host ("model {0}: {1}" -f $policy.model, $(if ($wanted -and -not $wanted.remote_host) { 'installed, local' } else { 'MISSING: ollama pull ' + $policy.model }))
    } else { Write-Host "Game Ollama not running" }
}
