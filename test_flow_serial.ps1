param(
    [string]$BaseUrl = "http://127.0.0.1:8000"
)

Write-Host "Ã°Å¸Å¡â‚¬ Starting serial API test against $BaseUrl..."

function Safe-Request {
    param(
        [string]$Url,
        [string]$Method = "GET",
        [object]$Body = $null
    )
    try {
        if ($Body) {
            $resp = Invoke-WebRequest -Uri $Url -Method $Method `
                -Headers @{ "Content-Type" = "application/json" } `
                -Body ($Body | ConvertTo-Json -Depth 10 -Compress)
        } else {
            $resp = Invoke-WebRequest -Uri $Url -Method $Method `
                -Headers @{ "Content-Type" = "application/json" }
        }
        return $resp
    } catch {
        Write-Host "Ã¢ÂÅ’ [$Method $Url] $($_.Exception.Message)" -ForegroundColor Red
        if ($_.Exception.Response -and $_.Exception.Response.Content) {
            Write-Host "Ã¢Å¡Â  Raw Response: $($_.Exception.Response.Content)" -ForegroundColor DarkGray
        }
        return $null
    }
}

# Track created entities
$user = $null; $organizer = $null; $vendor = $null; $event = $null; $application = $null

# 1. User
$userEmail = "serial_user_$((Get-Date).ToFileTime())@example.com"
$userResp = Safe-Request "$BaseUrl/users/" -Method POST -Body @{ email=$userEmail; password="secret"; role="vendor" }
if ($userResp) {
    $user = $userResp.Content | ConvertFrom-Json
    Write-Host "Ã¢Å“â€¦ User created with ID: $($user.id) ($($user.email))" -ForegroundColor Green
}

# 2. Organizer
$orgResp = Safe-Request "$BaseUrl/organizers/" -Method POST -Body @{ display_name="OrgSerial"; organization_name="OrgCoSerial" }
if ($orgResp) {
    $organizer = $orgResp.Content | ConvertFrom-Json
    Write-Host "Ã¢Å“â€¦ Organizer created with ID: $($organizer.id)" -ForegroundColor Green
}

# 3. Vendor
$vendorResp = Safe-Request "$BaseUrl/vendors/" -Method POST -Body @{ display_name="VendorSerial"; company_name="VendorCoSerial" }
if ($vendorResp) {
    $vendor = $vendorResp.Content | ConvertFrom-Json
    Write-Host "Ã¢Å“â€¦ Vendor created with ID: $($vendor.id)" -ForegroundColor Green
}

# 4. Event
$eventResp = Safe-Request "$BaseUrl/events/" -Method POST -Body @{ title="Serial Event"; description="Debugging"; date=(Get-Date).AddDays(7).ToString("s"); location="Atlanta" }
if ($eventResp) {
    $event = $eventResp.Content | ConvertFrom-Json
    Write-Host "Ã¢Å“â€¦ Event created with ID: $($event.id)" -ForegroundColor Green
}

# 5. Application
if ($event -and $vendor) {
    $appResp = Safe-Request "$BaseUrl/applications/" -Method POST -Body @{ event_id=$event.id; message="Interested in Serial Event" }
    if ($appResp) {
        $application = $appResp.Content | ConvertFrom-Json
        Write-Host "Ã¢Å“â€¦ Application created with ID: $($application.id) (status: $($application.status))" -ForegroundColor Green
    }
}

# === CLEANUP ===
Write-Host "`nÃ°Å¸â€”â€˜ Starting cleanup..."

if ($application) {
    Safe-Request "$BaseUrl/applications/$($application.id)" -Method DELETE | Out-Null
    Write-Host "Ã°Å¸â€”â€˜ Application $($application.id) deleted" -ForegroundColor Yellow
}
if ($event) {
    Safe-Request "$BaseUrl/events/$($event.id)" -Method DELETE | Out-Null
    Write-Host "Ã°Å¸â€”â€˜ Event $($event.id) deleted" -ForegroundColor Yellow
}
if ($vendor) {
    Safe-Request "$BaseUrl/vendors/$($vendor.id)" -Method DELETE | Out-Null
    Write-Host "Ã°Å¸â€”â€˜ Vendor $($vendor.id) deleted" -ForegroundColor Yellow
}
if ($organizer) {
    Safe-Request "$BaseUrl/organizers/$($organizer.id)" -Method DELETE | Out-Null
    Write-Host "Ã°Å¸â€”â€˜ Organizer $($organizer.id) deleted" -ForegroundColor Yellow
}
if ($user) {
    Safe-Request "$BaseUrl/users/$($user.id)" -Method DELETE | Out-Null
    Write-Host "Ã°Å¸â€”â€˜ User $($user.id) deleted" -ForegroundColor Yellow
}

Write-Host "`nÃ°Å¸Å½â€° Serial test complete!" -ForegroundColor Green
