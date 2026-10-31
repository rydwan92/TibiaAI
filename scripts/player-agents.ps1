# Player agents: real clients playing ordinary characters (DOCS/PLAYER_AGENTS.md).
#   powershell -ExecutionPolicy Bypass -File scripts\player-agents.ps1 -Create           # accounts and characters, once
#   powershell -ExecutionPolicy Bypass -File scripts\player-agents.ps1 -Start [-Only kael,sira]
#   powershell -ExecutionPolicy Bypass -File scripts\player-agents.ps1 -Stop
#   powershell -ExecutionPolicy Bypass -File scripts\player-agents.ps1 -Status
param([switch]$Create, [switch]$Start, [switch]$Stop, [switch]$Status, [string[]]$Only = @())
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
$db = $cfg.TIBIAAI_DB_NAME
$defs = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'packages\contracts\players.json') | ConvertFrom-Json
$keys = @($defs.agents.PSObject.Properties.Name | Where-Object { $Only.Count -eq 0 -or $Only -contains $_ })
$vocationId = @{ sorcerer = 1; druid = 2; paladin = 3; knight = 4 }
$startAt = @{ x = 5008; y = 5006; z = 7 }

function Get-AgentLogin([string]$key) {
    if ($key -eq 'kael') { return @{ Email = $cfg.TIBIAAI_AGENT_EMAIL; Password = $cfg.TIBIAAI_AGENT_PASSWORD } }
    $upper = $key.ToUpper()
    return @{ Email = $cfg["TIBIAAI_PLAYER_${upper}_EMAIL"]; Password = $cfg["TIBIAAI_PLAYER_${upper}_PASSWORD"] }
}

if ($Create) {
    foreach ($key in $keys) {
        $def = $defs.agents.$key
        if ($key -eq 'kael') { continue } # made by lab-fixture.ps1 -Combatant
        $upper = $key.ToUpper()
        if (-not $cfg["TIBIAAI_PLAYER_${upper}_PASSWORD"]) {
            $bytes = New-Object byte[] 12
            [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
            $secret = -join ($bytes | ForEach-Object { 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[$_ % 56] })
            Add-Content -Path (Join-Path $Root '.env') -Value @("TIBIAAI_PLAYER_${upper}_EMAIL=$key@localhost", "TIBIAAI_PLAYER_${upper}_PASSWORD=$secret")
            $cfg = Read-DotEnv
        }
        $email, $secret = $cfg["TIBIAAI_PLAYER_${upper}_EMAIL"], $cfg["TIBIAAI_PLAYER_${upper}_PASSWORD"]
        $exists = Invoke-MariaDb "SELECT COUNT(*) FROM accounts WHERE email='$email';" $db
        if ("$exists".Trim() -eq '0') {
            Invoke-MariaDb "INSERT INTO accounts (name, email, password, type) VALUES ('$key', '$email', SHA1('$secret'), 1);" $db | Out-Null
            $columns = 'name, group_id, account_id, level, vocation, health, healthmax, experience, lookbody, lookfeet, lookhead, looklegs, looktype, maglevel, mana, manamax, manaspent, town_id, posx, posy, posz, conditions, cap, sex, skill_club, skill_club_tries, skill_sword, skill_sword_tries, skill_axe, skill_axe_tries, skill_dist, skill_dist_tries'
            $values = "'$($def.character)', 1, a.id, 8, $($vocationId[$def.vocation]), 185, 185, 4200, 113, 115, 95, 39, 129, 0, 90, 90, 0, 1, $($startAt.x), $($startAt.y), 7, '', 470, 1, 10, 0, 10, 0, 10, 0, 10, 0"
            Invoke-MariaDb "INSERT INTO players ($columns) SELECT $values FROM accounts a WHERE a.email = '$email';" $db | Out-Null
            Write-Host "Created $($def.character) ($($def.vocation)) on account $key"
        } else { Write-Host "$($def.character) already exists" }
    }
}

function Stop-Agents {
    foreach ($file in $keys | ForEach-Object { Get-Item (Join-Path $PidDir "agent-$_.pid") -ErrorAction SilentlyContinue }) {
        $proc = Get-Process -Id ([int](Get-Content $file.FullName)) -ErrorAction SilentlyContinue
        if ($proc -and $proc.ProcessName -eq 'otclient') { Stop-Process -Id $proc.Id -Force }
        Remove-Item $file.FullName -ErrorAction SilentlyContinue
    }
    # A character stays in the world after its client disconnects.
    foreach ($key in $keys) { Write-ControlRequest 'dev-kick.request' $defs.agents.$key.character; Start-Sleep -Milliseconds 1300 }
    if ($Only.Count -eq 0) { Remove-Item (Join-Path $OtclientDir 'mods\tibiaai_agent') -Recurse -Force -ErrorAction SilentlyContinue }
}

if ($Stop) { Stop-Agents; Write-Host 'Player agents stopped' }

if ($Start) {
    if (-not ((Test-LocalPort $Lock.ports.loginHttp) -and (Test-LocalPort $Lock.ports.game))) { throw "Server is not running (scripts\start.ps1)" }
    Install-ClientFrameCap
    $atlas = Join-Path $Runtime 'atlas\canary-atlas.json'
    if (-not (Test-Path $atlas)) {
        New-Item -ItemType Directory -Force (Split-Path $atlas) | Out-Null
        & python -I (Join-Path $Root 'tools\world_atlas.py') (Join-Path $Runtime 'maps\canary.otbm') (Join-Path $CanarySrc 'data\items\items.xml') $atlas | Out-Null
    }
    $modDir = Join-Path $OtclientDir 'mods\tibiaai_agent'
    New-Item -ItemType Directory -Force $modDir | Out-Null
    Copy-Item (Join-Path $Root 'tools\otclient-agent\*') $modDir -Force
    foreach ($key in $keys) {
        $def = $defs.agents.$key
        $login = Get-AgentLogin $key
        if (-not $login.Password) { throw "No account for $key`: run -Create" }
        $dir = Join-Path $Runtime "players\$key"
        New-Item -ItemType Directory -Force $dir | Out-Null
        $config = @{
            host = "http://127.0.0.1:$($Lock.ports.loginHttp)/login"; port = $Lock.ports.loginHttp; version = $Lock.canary.clientVersion
            email = $login.Email; password = $login.Password; character = $def.character; healSpell = $def.healSpell; attackSpell = $def.attackSpell
            reflexes = $defs.reflexes; kit = $def.kit; vocation = $def.vocation
            friends = @($defs.agents.PSObject.Properties | Where-Object { $_.Name -ne $key } | ForEach-Object { $_.Value.character }); controlDir = (Join-Path $Runtime 'control').Replace('\', '/') + '/'
        } | ConvertTo-Json -Depth 4 -Compress
        [System.IO.File]::WriteAllText((Join-Path $dir 'login.json'), $config, (New-Object System.Text.UTF8Encoding $false))
        $arg = "--agent-dir=$($dir.Replace('\', '/'))/"
        $p = Start-Process -FilePath (Join-Path $OtclientDir 'otclient.exe') -ArgumentList $arg -WorkingDirectory $OtclientDir -WindowStyle Minimized -PassThru
        Set-Content -Path (Join-Path $PidDir "agent-$key.pid") -Value $p.Id
        Write-Host "$($def.character) started (client pid $($p.Id))"
        Start-Sleep -Seconds 6 # clients share the settings file while starting
    }
}

if ($Status) {
    foreach ($key in $defs.agents.PSObject.Properties.Name) {
        $path = Join-Path $Runtime "players\$key\state.json"
        if (Test-Path $path) {
            $s = Get-Content -Raw -Encoding UTF8 $path | ConvertFrom-Json
            Write-Host ("{0,-6} lvl {1} hp {2}/{3} {4},{5},{6} exp {7} target [{8}]" -f $s.name, $s.level, $s.hp, $s.hpMax, $s.x, $s.y, $s.z, $s.experience, $s.target)
            $metricsPath = Join-Path $Runtime "players\$key\metrics.json"
            if (Test-Path $metricsPath) {
                $m = Get-Content -Raw -Encoding UTF8 $metricsPath | ConvertFrom-Json
                Write-Host ("       zabite {0}, smierci {1}, zloto {2}, miejsca {3}, pietra [{4}], rady dane/uslyszane {5}/{6}, pomoc {7}, wyprawy {8}, wybory model/temperament {9}/{10}" -f $m.kills, $m.deaths, $m.gold, $m.places, ($m.floors -join ','), $m.tipsGiven, $m.tipsHeard, $m.helped, $m.trips, $m.modelChoices, $m.ruleChoices)
                Write-Host ("       handel {0}, depo {1}, walki z graczami {2}, drogi: {3}, urazy: {4}" -f $m.trades, $m.stored, $m.pvpFights, (($m.ways | ConvertTo-Json -Compress)), (($m.grudges | ConvertTo-Json -Compress)))
                foreach ($lesson in @($m.lessons | Select-Object -Last 2)) { if ($lesson) { Write-Host "       lekcja: $lesson" } }
                if ($m.plan) { Write-Host "       plan: $($m.plan)" }
            }
            $diary = Join-Path $Runtime "players\$key\diary.log"
            if (Test-Path $diary) { Get-Content -Tail 3 -Encoding UTF8 $diary | ForEach-Object { Write-Host "       $_" } }
        } else { Write-Host "$key : no state" }
    }
}
