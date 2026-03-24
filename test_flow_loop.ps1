param(
    [int]$Loops = 1,                              # Default = 1 loop
    [string]$BaseUrl = "http://127.0.0.1:8000",   # API Base URL
    [switch]$VerboseLog                           # Optional detailed logging
)

$Mode = "Loop"
$results = @()

function Safe-Request {
    param($Name, $Method, $Url, $Body)

    try {
        if ($Body) {
            return Invoke-RestMethod -Uri $Url -Method $Method -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 10)
        } else {
            return Invoke-RestMethod -Uri $Url -Method $Method
        }
    } catch {
        Write-Host "Ã¢Å¡Â  $Name failed -> $($_.Exception.Message)" -ForegroundColor Red
        return $null
    }
}

for ($i = 1; $i -le $Loops; $i++) {
    Write-Host "===================" -ForegroundColor Cyan
    Write-Host "Ã¢â€“Â¶ Starting loop $i..." -ForegroundColor Cyan
    Write-Host "===================" -ForegroundColor Cyan

    $startTime = Get-Date
    $errors = 0

    # --- User ---
    $userBody = @{
        email    = "loop_user_$((Get-Random)-band 100000)@example.com"
        password = "secret"
        role     = "organizer"
    }
    $user = Safe-Request "User" POST "$BaseUrl/users/" $userBody
    if (-not $user) { $errors++; continue }
    Write-Host "[Loop $i] Ã¢Å“â€¦ User created (ID: $($user.id))"

    # --- Organizer ---
    $orgBody = @{ display_name = "Organizer $i" }
    $organizer = Safe-Request "Organizer" POST "$BaseUrl/organizers/" $orgBody
    if (-not $organizer) { $errors++; continue }
    Write-Host "[Loop $i] Ã¢Å“â€¦ Organizer created (ID: $($organizer.id))"

    # --- Vendor ---
    $vendorBody = @{ display_name = "Vendor $i" }
    $vendor = Safe-Request "Vendor" POST "$BaseUrl/vendors/" $vendorBody
    if (-not $vendor) { $errors++; continue }
    Write-Host "[Loop $i] Ã¢Å“â€¦ Vendor created (ID: $($vendor.id))"

    # --- Event ---
    $eventBody = @{
        title       = "Event $i"
        description = "Test Event $i"
        date        = (Get-Date).AddDays(10).ToString("o")
        location    = "Atlanta"
    }
    $event = Safe-Request "Event" POST "$BaseUrl/events/" $eventBody
    if (-not $event) { $errors++; continue }
    Write-Host "[Loop $i] Ã¢Å“â€¦ Event created (ID: $($event.id))"

    # --- Application ---
    $appBody = @{ event_id = $event.id; message = "Vendor applying" }
    $application = Safe-Request "Application" POST "$BaseUrl/applications/" $appBody
    if ($application) {
        Write-Host "[Loop $i] Ã¢Å“â€¦ Application created (ID: $($application.id), status: $($application.status))"
    } else {
        $errors++
    }

    # --- Cleanup ---
    Write-Host "[Loop $i] Ã°Å¸â€”â€˜ Starting cleanup..."
    foreach ($del in @(
        @{Name="Application"; Url="$BaseUrl/applications/$($application.id)"},
        @{Name="Event"; Url="$BaseUrl/events/$($event.id)"},
        @{Name="Vendor"; Url="$BaseUrl/vendors/$($vendor.id)"},
        @{Name="Organizer"; Url="$BaseUrl/organizers/$($organizer.id)"},
        @{Name="User"; Url="$BaseUrl/users/$($user.id)"}
    )) {
        if ($del.Url -and $del.Url -notmatch "null") {
            try {
                Invoke-RestMethod -Uri $del.Url -Method DELETE | Out-Null
                Write-Host "[Loop $i] Ã°Å¸â€”â€˜ $($del.Name) deleted"
            } catch {
                Write-Host "[Loop $i] Ã¢Å¡Â  Failed to delete $($del.Name): $($_.Exception.Message)"
            }
        }
    }

    $duration = ((Get-Date) - $startTime).TotalSeconds
    $results += [pscustomobject]@{
        FlowId           = $i
        UserId           = $user.id
        OrganizerId      = $organizer.id
        VendorId         = $vendor.id
        EventId          = $event.id
        ApplicationId    = $application.id
        Errors           = $errors
        DurationSeconds  = [math]::Round($duration, 2)
    }

    Write-Host "[Loop $i] Ã°Å¸Å½â€° Cycle complete!"
}

# === Shared Logging ===
$CsvLog = "stress_results.csv"
if ($results.Count -gt 0) {
    $results | ForEach-Object {
        $_ | Add-Member -NotePropertyName Mode -NotePropertyValue $Mode -Force
        $_ | Add-Member -NotePropertyName Timestamp -NotePropertyValue (Get-Date) -Force
        $_ | Add-Member -NotePropertyName BaseUrl -NotePropertyValue $BaseUrl -Force
        $_
    } | Export-Csv -Path $CsvLog -NoTypeInformation -Append

    Write-Host "Ã¢Å“â€¦ Results appended to $CsvLog (Mode=$Mode)"
}
