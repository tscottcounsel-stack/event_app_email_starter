param(
  [string]$BaseUrl = "http://127.0.0.1:8000"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Results CSV (picked up by run_all_tests.ps1)
$Stamp  = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmss")
$CsvLog = "flow_results_{0}.csv" -f $Stamp

function Write-Result {
  param([string]$Test,[string]$Status,[string]$Details="")
  $row = [pscustomobject]@{
    timestamp = (Get-Date).ToUniversalTime().ToString("s") + "Z"
    test      = $Test
    status    = $Status
    details   = $Details
  }
  if (!(Test-Path $CsvLog)) { $row | Export-Csv -Path $CsvLog -NoTypeInformation }
  else { $row | Export-Csv -Path $CsvLog -NoTypeInformation -Append }
}

Write-Host "Starting secure API flow test..."

# 1) Register or fallback to existing user
$userEmail = "flowuser@example.com"
$userPass  = "strongpass"
$userId    = $null

try {
  $newUser = Invoke-RestMethod -Method POST -Uri "$BaseUrl/auth/register" `
    -ContentType "application/json" `
    -Body (@{ email=$userEmail; password=$userPass; role="vendor" } | ConvertTo-Json)
  $userId = $newUser.id
  Write-Result "Register" "PASS" "userId=$userId"
} catch {
  # If already exists, find it
  try {
    $users = Invoke-RestMethod -Method GET -Uri "$BaseUrl/users/"
    $userId = ($users | Where-Object { $_.email -eq $userEmail }).id
    if ($null -ne $userId) {
      Write-Result "Register" "PASS" "existing userId=$userId"
    } else {
      Write-Result "Register" "FAIL" "user lookup failed"
      throw
    }
  } catch {
    Write-Result "Register" "FAIL" $_.Exception.Message
    throw
  }
}

# 2) Login
try {
  $login = Invoke-RestMethod -Method POST -Uri "$BaseUrl/auth/login" `
    -ContentType "application/json" `
    -Body (@{ email=$userEmail; password=$userPass } | ConvertTo-Json)
  $token = $login.access_token
  $authHeader = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
  Write-Result "Login" "PASS" "token acquired"
} catch {
  Write-Result "Login" "FAIL" $_.Exception.Message
  throw
}

# 3) Create Vendor
$vendor = $null
try {
  $vendor = Invoke-RestMethod -Method POST -Uri "$BaseUrl/vendors/" -Headers $authHeader `
    -Body (@{
      display_name="DJ Troy";
      company_name="Taz Events";
      phone="555-1234";
      location="Atlanta";
      services="Music, Hosting";
      categories="DJ, MC";
      rate_min=500;
      rate_max=1000;
      bio="Professional DJ";
      availability_notes="Available weekends"
    } | ConvertTo-Json)
  Write-Result "CreateVendor" "PASS" ("vendorId={0}" -f $vendor.id)
} catch {
  Write-Result "CreateVendor" "FAIL" $_.Exception.Message
  throw
}

# 4) Create Event
$event = $null
try {
  $event = Invoke-RestMethod -Method POST -Uri "$BaseUrl/events/" -Headers $authHeader `
    -Body (@{
      title="Launch Party";
      description="Event with live music";
      date=(Get-Date).AddDays(7).ToUniversalTime().ToString("o");
      location="Atlanta Club"
    } | ConvertTo-Json)
  Write-Result "CreateEvent" "PASS" ("eventId={0}" -f $event.id)
} catch {
  Write-Result "CreateEvent" "FAIL" $_.Exception.Message
  throw
}

# 5) Apply Vendor to Event
$app = $null
try {
  $app = Invoke-RestMethod -Method POST -Uri "$BaseUrl/applications/" -Headers $authHeader `
    -Body (@{ event_id=$event.id; vendor_id=$vendor.id; message="Book me!" } | ConvertTo-Json)
  Write-Result "CreateApplication" "PASS" ("applicationId={0}" -f $app.id)
} catch {
  Write-Result "CreateApplication" "FAIL" $_.Exception.Message
}

# 6) Cleanup (best-effort)
Write-Host "Starting cleanup..."
try {
  if ($app -and $app.id) {
    Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/applications/$($app.id)" -Headers $authHeader | Out-Null
    Write-Result "DeleteApplication" "PASS" ("applicationId={0}" -f $app.id)
  }
} catch { Write-Result "DeleteApplication" "FAIL" $_.Exception.Message }

try {
  if ($event -and $event.id) {
    Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/events/$($event.id)" -Headers $authHeader | Out-Null
    Write-Result "DeleteEvent" "PASS" ("eventId={0}" -f $event.id)
  }
} catch { Write-Result "DeleteEvent" "FAIL" $_.Exception.Message }

try {
  if ($vendor -and $vendor.id) {
    Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/vendors/$($vendor.id)" -Headers $authHeader | Out-Null
    Write-Result "DeleteVendor" "PASS" ("vendorId={0}" -f $vendor.id)
  }
} catch { Write-Result "DeleteVendor" "FAIL" $_.Exception.Message }

try {
  if ($userId) {
    Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/users/$($userId)" -Headers $authHeader | Out-Null
    Write-Result "DeleteUser" "PASS" ("userId={0}" -f $userId)
  }
} catch { Write-Result "DeleteUser" "FAIL" $_.Exception.Message }

Write-Host "Secure test flow complete."
Write-Host "Results saved to $CsvLog"
