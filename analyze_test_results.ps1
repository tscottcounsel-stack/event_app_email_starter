param(
    [string]$CsvPath = "C:\Users\troys\Downloads\event_app_email_starter\test_results_master.csv",
    [string]$SummaryExport = "C:\Users\troys\Downloads\event_app_email_starter\summary_results.csv",
    [string]$Mode = "",     # Optional filter: "Loop" or "Parallel"
    [int]$LastN = 20        # Number of recent runs for ASCII timeline
)

if (-not (Test-Path $CsvPath)) {
    Write-Host "❌ CSV file not found at $CsvPath" -ForegroundColor Red
    exit
}

# Import results
$results = Import-Csv -Path $CsvPath
if (-not $results) {
    Write-Host "⚠ No data found in CSV." -ForegroundColor Yellow
    exit
}

# Optional filter
if ($Mode -ne "") {
    $results = $results | Where-Object { $_.Mode -eq $Mode }
    Write-Host "📌 Filtering results for Mode: $Mode" -ForegroundColor Cyan
}

Write-Host "📊 Analyzing test results from $CsvPath`n" -ForegroundColor Cyan

# --- Stats
$total    = $results.Count
$success  = ($results | Where-Object { $_.Status -eq "Success" }).Count
$failed   = ($results | Where-Object { $_.Status -eq "Failed" }).Count
$avgTime  = [math]::Round(($results | Measure-Object -Property Duration -Average).Average,2)
$avgErrs  = [math]::Round(($results | Measure-Object -Property Errors -Average).Average,2)

# --- Overall
Write-Host "==================== Overall ====================" -ForegroundColor Yellow
Write-Host (" Success:".PadRight(15) + "$success " + ("█" * ($success * 50 / $total)))
Write-Host (" Failed:".PadRight(15) + "$failed " + ("█" * ($failed * 50 / $total))) -ForegroundColor Red
Write-Host " Average time (s):  $avgTime"
Write-Host " Average errors:    $avgErrs"
Write-Host "=================================================`n"

# --- ASCII timeline
Write-Host "📌 Recent results timeline (last $LastN):" -ForegroundColor Cyan
$timeline = ($results | Select-Object -Last $LastN | ForEach-Object {
    if ($_.Status -eq "Success") { "✔" } else { "✘" }
}) -join ""
Write-Host $timeline
Write-Host "`n"

# --- Export summary CSV
$summary = [PSCustomObject]@{
    Timestamp     = (Get-Date)
    TotalRuns     = $total
    Success       = $success
    Failed        = $failed
    AvgTime       = $avgTime
    AvgErrors     = $avgErrs
}
if (Test-Path $SummaryExport) {
    $summary | Export-Csv -Path $SummaryExport -Append -NoTypeInformation
} else {
    $summary | Export-Csv -Path $SummaryExport -NoTypeInformation
}
Write-Host "✅ Summary saved to $SummaryExport" -ForegroundColor Green

# --- Optional Excel export with charts
try {
    $excelPath = [System.IO.Path]::ChangeExtension($SummaryExport,".xlsx")
    $excel = New-Object -ComObject Excel.Application
    $excel.Visible = $false
    $wb = $excel.Workbooks.Add()
    $ws = $wb.Sheets.Item(1)
    $results | Export-Csv "$env:TEMP\temp_results.csv" -NoTypeInformation
    $data = Import-Csv "$env:TEMP\temp_results.csv"
    $row = 2
    foreach ($r in $data) {
        $ws.Cells.Item($row,1).Value2 = $r.Mode
        $ws.Cells.Item($row,2).Value2 = $r.Status
        $ws.Cells.Item($row,3).Value2 = $r.Duration
        $ws.Cells.Item($row,4).Value2 = $r.Errors
        $row++
    }
    $wb.SaveAs($excelPath)
    $excel.Quit()
    Write-Host "📊 Excel summary saved to $excelPath" -ForegroundColor Green
}
catch {
    Write-Host "⚠ Excel export failed (likely Excel not installed)." -ForegroundColor Yellow
}
