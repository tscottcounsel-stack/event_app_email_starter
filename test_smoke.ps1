# test_smoke.ps1  Ã¢â‚¬â€ run from repo root
$ErrorActionPreference = "Stop"
$Base = "http://127.0.0.1:8000"
$failed = 0

function Write-Section($msg) { Write-Host "`n=== $msg ===" -ForegroundColor Cyan }
function Pass($msg) { Write-Host "[PASS] $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "[FAIL] $msg" -ForegroundColor Red; $script:failed++ }

function Get-Json($url) {
  try { return Invoke-RestMethod -Method GET -Uri $url }
  catch { Fail "GET $url -> $($_.Exception.Message)"; return $null }
}

function Post-Json($url, $obj, $headers=$null) {
  try {
    $json = $obj | ConvertTo-Json -Depth 10
    return Invoke-RestMethod -Method POST -Uri $url -ContentType "application/json" -Body $json -Headers $headers
  } catch { Fail "POST $url -> $($_.Exception.Message)"; return $null }
}

Write-Section "Health checks"
$health = Get-Json "$Base/health"
if ($health -and $health.status -eq "ok") { Pass "/health ok" } else { Fail "/health not ok" }

$ping = Get-Json "$Base/ping"
if ($ping -and ($ping.pong -eq $true -or $ping.pong -eq "True")) { Pass "/ping true" } else { Fail "/ping not true" }

Write-Section "Auth: register + login"
# Unique email each run to avoid conflicts
$rand = [guid]::NewGuid().ToString("N").Substring(0,8)
$email = "vendor_$rand@example.com"

$reg = Post-Json "$Base/auth/register" @{ email=$email; password="secret123"; role="vendor" }
if ($reg) { Pass "Registered $email" } else { Fail "Register failed for $email" }

$login = Post-Json "$Base/auth/login" @{ email=$email; password="secret123" }
if ($login -and $login.access_token) { Pass "Login issued access token" } else { Fail "Login failed / no token"; }

$hdrs = @{ Authorization = "Bearer $($login.access_token)" }

Write-Section "Vendors: create + fetch"
$vendor = Post-Json "$Base/vendors" @{ display_name="DJ Spark"; company_name="Spark Events" } $hdrs
if ($vendor -and $vendor.id) { Pass "Created vendor id=$($vendor.id)" } else { Fail "Create vendor failed" }

if ($vendor -and $vendor.id) {
  $got = Get-Json ("$Base/vendors/{0}" -f $vendor.id)
  if ($got -and $got.id -eq $vendor.id) { Pass "Fetched vendor id=$($got.id)" } else { Fail "Fetch vendor failed" }
}

Write-Section "Check OpenAPI for /events"
$spec = Get-Json "$Base/openapi.json"
$hasEvents = $false
if ($spec -and $spec.paths) {
  $paths = $spec.paths.PSObject.Properties.Name
  if ($paths -contains "/events" -and $paths -contains "/events/{event_id}") { $hasEvents = $true }
}

if ($hasEvents) {
  Pass "Events routes detected"
  Write-Section "Events: create + fetch"
  $ev = Post-Json "$Base/events" @{
    title="Spring Gala"
    date="2026-06-01T19:00:00Z"
    location="NYC"
    description="Black tie"
  } $hdrs
  if ($ev -and $ev.id) { Pass "Created event id=$($ev.id)" } else { Fail "Create event failed" }
  if ($ev -and $ev.id) {
    $evGet = Get-Json ("$Base/events/{0}" -f $ev.id)
    if ($evGet -and $evGet.id -eq $ev.id) { Pass "Fetched event id=$($evGet.id)" } else { Fail "Fetch event failed" }
  }
} else {
  Write-Host "(/events not mounted Ã¢â‚¬â€ skipping events tests.)"
}

Write-Section "Summary"
if ($failed -gt 0) {
  Write-Host "Smoke tests FAILED ($failed check(s))." -ForegroundColor Red
  exit 1
} else {
  Write-Host "All smoke tests PASSED." -ForegroundColor Green
  exit 0
}
