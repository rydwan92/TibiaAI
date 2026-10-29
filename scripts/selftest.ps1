# Run the in-engine Lua self test (JSON codec, templates, definitions, command validation)
# inside the running Canary and print the result. Exit code 0 = all passed.
#   powershell -ExecutionPolicy Bypass -File scripts\selftest.ps1
. "$PSScriptRoot\lib.ps1"
if (-not (Get-TrackedProcess 'canary')) { throw "Canary is not running" }
$since = (Get-Date).ToUniversalTime().AddSeconds(-1).ToString('yyyy-MM-ddTHH:mm:ssZ')
Write-ControlRequest 'selftest.request' ''
$entry = Wait-JournalEntry 'selftest_result' $since 15
if (-not $entry) { throw "No selftest_result within 15 s (see runtime\logs\canary.out.log)" }
Write-Host ("passed={0} failed={1}" -f $entry.passed, $entry.failed)
if ($entry.failed -ne 0) {
    # An empty Lua table is encoded as {}, so only list failures when there are some.
    foreach ($f in @($entry.failures)) { Write-Host "  FAIL $f" }
    exit 1
}
