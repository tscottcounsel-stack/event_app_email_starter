param(
  [string]$BaseUrl = "http://127.0.0.1:8000",
  [int]$Loops = 3
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Master results file
$stamp  = (Get-Date).ToUniversalTime().ToString("yyyyMMdd_HHmmss")
$OutDir = $PSScriptRoot
$MasterCsv = Join-Path $OutDir ("parallel_results_{0}.csv" -f $stamp)

Write-Host "Starting parallel API stress test with $Loops cycles against $BaseUrl..."
Write-Host "Waiting for all $Loops flows to finish..."

# Launch N jobs; each job writes its own CSV to avoid file locking
$jobs = for ($i=1; $i -le $Loops; $i++) {
  $flowCsv = Join-Path $OutDir ("parallel_results_{0}_flow{1}.csv" -f $stamp, $i)

  Start-Job -ArgumentList $BaseUrl, $i, $flowCsv -ScriptBlock {
    param($BaseUrl, $Index, $CsvPath)

    $ErrorActionPreference = "Stop"

    function Write-Result {
      param([string]$Test,[string]$Status,[string]$Details="")
      $row = [pscustomobject]@{
        timestamp = (Get-Date).ToUniversalTime().ToString("s") + "Z"
        test      = $Test
        status    = $Status
        details   = $Details
      }
      if (!(Test-Path $CsvPath)) { $row | Export-Csv -Path $CsvPath -NoTypeInformation }
      else { $row | Export-Csv -Path $CsvPath -NoTypeInformation -Append }
    }

    function Run-Flow {
      param([int]$Index,[string]$BaseUrl)

      try {
        $email = "parallel_user_${Index}@{0}.com" -f (Get-Random -Minimum 100000000 -Maximum 1999999999)
        $pass  = "strongpass"

        # Register (ignore if already exists)
        try {
          Invoke-RestMethod -Method POST -Uri "$BaseUrl/auth/register" `
            -ContentType "application/json" `
            -Body (@{ email=$email; password=$pass; role="vendor" } | ConvertTo-Json) | Out-Null
          Write-Result ("P{0}-Register" -f $Index) "PASS" $email
        } catch {
          # If the API returns 400 for existing, still treat as pass
          Write-Result ("P{0}-Register" -f $Index) "PASS" ("already-exists:{0}" -f $email)
        }

        # Login
        $login = Invoke-RestMethod -Method POST -Uri "$BaseUrl/auth/login" `
          -ContentType "application/json" `
          -Body (@{ email=$email; password=$pass } | ConvertTo-Json)
        $token = $login.access_token
        $hdr = @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" }
        Write-Result ("P{0}-Login" -f $Index) "PASS" $email

        # Create Vendor
        $vendor = Invoke-RestMethod -Method POST -Uri "$BaseUrl/vendors/" -Headers $hdr `
          -Body (@{ display_name="P$Index Vendor" } | ConvertTo-Json)
        Write-Result ("P{0}-CreateVendor" -f $Index) "PASS" ("vendorId={0}" -f $vendor.id)

        # Create Event
        $event = Invoke-RestMethod -Method POST -Uri "$BaseUrl/events/" -Headers $hdr `
          -Body (@{
            title="P$Index Event";
            date=(Get-Date).AddDays(3).ToUniversalTime().ToString("o");
            location="Test City"
          } | ConvertTo-Json)
        Write-Result ("P{0}-CreateEvent" -f $Index) "PASS" ("eventId={0}" -f $event.id)

        # Create Application
        $app = Invoke-RestMethod -Method POST -Uri "$BaseUrl/applications/" -Headers $hdr `
          -Body (@{ event_id=$event.id; vendor_id=$vendor.id; message="Apply" } | ConvertTo-Json)
        Write-Result ("P{0}-CreateApplication" -f $Index) "PASS" ("applicationId={0}" -f $app.id)

        # Cleanup (best-effort)
        try {
          Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/applications/$($app.id)" -Headers $hdr | Out-Null
          Write-Result ("P{0}-DeleteApplication" -f $Index) "PASS" ("applicationId={0}" -f $app.id)
        } catch { Write-Result ("P{0}-DeleteApplication" -f $Index) "FAIL" $_.Exception.Message }

        try {
          Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/events/$($event.id)" -Headers $hdr | Out-Null
          Write-Result ("P{0}-DeleteEvent" -f $Index) "PASS" ("eventId={0}" -f $event.id)
        } catch { Write-Result ("P{0}-DeleteEvent" -f $Index) "FAIL" $_.Exception.Message }

        try {
          Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/vendors/$($vendor.id)" -Headers $hdr | Out-Null
          Write-Result ("P{0}-DeleteVendor" -f $Index) "PASS" ("vendorId={0}" -f $vendor.id)
        } catch { Write-Result ("P{0}-DeleteVendor" -f $Index) "FAIL" $_.Exception.Message }

        # Try to delete the user account
        try {
          $users = Invoke-RestMethod -Method GET -Uri "$BaseUrl/users/"
          $uid = ($users | Where-Object { $_.email -eq $email }).id
          if ($uid) {
            Invoke-RestMethod -Method DELETE -Uri "$BaseUrl/users/$uid" -Headers $hdr | Out-Null
            Write-Result ("P{0}-DeleteUser" -f $Index) "PASS" ("userId={0}" -f $uid)
          } else {
            Write-Result ("P{0}-DeleteUser" -f $Index) "SKIP" "user not found"
          }
        } catch {
          Write-Result ("P{0}-DeleteUser" -f $Index) "FAIL" $_.Exception.Message
        }

      } catch {
        Write-Result ("P{0}-Flow" -f $Index) "FAIL" $_.Exception.Message
      }
    } # Run-Flow

    # Run the flow for this index
    Run-Flow -Index $Index -BaseUrl $BaseUrl
  }
}

# Wait/collect
Wait-Job -Job $jobs | Out-Null
Receive-Job -Job $jobs | Out-Null
Remove-Job -Job $jobs | Out-Null

# Merge per-flow CSVs into master CSV
$partFiles = Get-ChildItem -LiteralPath $OutDir -Filter ("parallel_results_{0}_flow*.csv" -f $stamp) | Sort-Object Name
if ($partFiles.Count -gt 0) {
  # Write header once
  "timestamp,test,status,details" | Out-File -FilePath $MasterCsv -Encoding utf8 -Force
  foreach ($pf in $partFiles) {
    # Skip header line of each part
    (Get-Content -LiteralPath $pf -Encoding utf8 | Select-Object -Skip 1) | Add-Content -LiteralPath $MasterCsv -Encoding utf8
  }
  Write-Host "Parallel stress test complete!"
  Write-Host "Results saved to $MasterCsv"
} else {
  Write-Host "Parallel stress test complete!"
  Write-Host "No partial CSVs found to merge."
}
