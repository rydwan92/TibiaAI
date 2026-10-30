# Show process state and every listening socket owned by our processes (verifies loopback-only binding).
. "$PSScriptRoot\lib.ps1"
$ErrorActionPreference = 'Continue'
foreach ($name in 'mariadb', 'login', 'canary', 'ollama', 'brain') {
    $p = Get-TrackedProcess $name
    if ($p) {
        $mb = [math]::Round($p.WorkingSet64 / 1MB)
        Write-Host ("{0,-8} RUNNING pid={1} mem={2}MB" -f $name, $p.Id, $mb)
        $socks = Get-NetTCPConnection -State Listen -OwningProcess $p.Id -ErrorAction SilentlyContinue
        foreach ($s in $socks) {
            $flag = if ($s.LocalAddress -in '127.0.0.1', '::1') { 'loopback' } else { 'NOT LOOPBACK!' }
            Write-Host ("         listen {0}:{1} {2}" -f $s.LocalAddress, $s.LocalPort, $flag)
        }
    } else {
        Write-Host ("{0,-8} stopped" -f $name)
    }
}
