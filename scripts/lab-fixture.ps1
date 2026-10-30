# Lab fixture: places test characters in Montag, next to the agents. The Canary schema starts the
# sample characters in town 8 (Strongarm), thousands of tiles from the agents. Run while they are offline.
#   powershell -ExecutionPolicy Bypass -File scripts\lab-fixture.ps1 [-Characters "Knight Sample","GOD"] [-X 5008] [-Y 5006]
# Reverse: UPDATE players SET town_id=8, posx=0, posy=0, posz=0 WHERE name='<name>'; (spawns at the town temple).
#   powershell -ExecutionPolicy Bypass -File scripts\lab-fixture.ps1 -Combatant
#     creates the separate account and character Kael for combat experiments (deaths never touch
#     your characters) and stores its generated password in .env.
#   -KnownOffline: the caller checked with the world; players_online refreshes only every 10 minutes.
param([string[]]$Characters = @('Knight Sample', 'GOD'), [int]$X = 5008, [int]$Y = 5006, [int]$Z = 7, [int]$TownId = 1, [switch]$Combatant, [switch]$KnownOffline)
. "$PSScriptRoot\lib.ps1"
$cfg = Read-DotEnv
$db = $cfg.TIBIAAI_DB_NAME

if ($Combatant) {
    if (-not $cfg.TIBIAAI_AGENT_PASSWORD) {
        $bytes = New-Object byte[] 12
        [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
        $secret = -join ($bytes | ForEach-Object { 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'[$_ % 56] })
        Add-Content -Path (Join-Path $Root '.env') -Value @('TIBIAAI_AGENT_EMAIL=kael@localhost', "TIBIAAI_AGENT_PASSWORD=$secret")
        $cfg = Read-DotEnv
    }
    $exists = Invoke-MariaDb "SELECT COUNT(*) FROM accounts WHERE email='$($cfg.TIBIAAI_AGENT_EMAIL)';" $db
    if ("$exists".Trim() -eq '0') {
        Invoke-MariaDb "INSERT INTO accounts (name, email, password, type) VALUES ('kael', '$($cfg.TIBIAAI_AGENT_EMAIL)', SHA1('$($cfg.TIBIAAI_AGENT_PASSWORD)'), 1);" $db | Out-Null
        $columns = 'name, group_id, account_id, level, vocation, health, healthmax, experience, lookbody, lookfeet, lookhead, looklegs, looktype, maglevel, mana, manamax, manaspent, town_id, posx, posy, posz, conditions, cap, sex, skill_club, skill_club_tries, skill_sword, skill_sword_tries, skill_axe, skill_axe_tries, skill_dist, skill_dist_tries'
        $values = "'Kael', 1, a.id, 8, 4, 185, 185, 4200, 113, 115, 95, 39, 129, 0, 90, 90, 0, 1, 5010, 5007, 7, '', 470, 1, 10, 0, 10, 0, 10, 0, 10, 0"
        Invoke-MariaDb "INSERT INTO players ($columns) SELECT $values FROM accounts a WHERE a.name = 'kael';" $db | Out-Null
        Write-Host "Created account kael and character Kael (Knight, level 8) at 5010,5007,7"
    } else {
        Write-Host "Kael already exists"
    }
    return
}
foreach ($name in $Characters) {
    if ($name -notmatch "^[A-Za-z ']+$") { throw "Invalid character name: $name" }
    $sqlName = $name.Replace("'", "''")
    $online = Invoke-MariaDb "SELECT COUNT(*) FROM players_online po JOIN players p ON p.id = po.player_id WHERE p.name = '$sqlName';" $db
    if (-not $KnownOffline -and "$online".Trim() -ne '0') { throw "$name is online; log out first (the server would overwrite the change on logout)" }
    Invoke-MariaDb "UPDATE players SET town_id=$TownId, posx=$X, posy=$Y, posz=$Z WHERE name = '$sqlName';" $db | Out-Null
    Write-Host "$name -> town $TownId, position $X,$Y,$Z"
}
