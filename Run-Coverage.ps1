Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Optional: make sure PYTHONPATH includes project root
if (-not $env:PYTHONPATH) { $env:PYTHONPATH = "." }

Write-Host "==> Starting Uvicorn…" -ForegroundColor Cyan
$uvicornArgs = @(
    "-m","uvicorn",
    "app.main:app",
    "--host","127.0.0.1",
    "--port","8000"
)

# Start Uvicorn in background and capture logs
$uvProc = Start-Process -FilePath "python" -ArgumentList $uvicornArgs `
    -RedirectStandardOutput "uvicorn.out" `
    -RedirectStandardError  "uvicorn.err" `
    -PassThru -WindowStyle Hidden

Write-Host "Uvicorn PID: $($uvProc.Id)"

# Wait for /health
$healthy = $false
for ($i=1; $i -le 30; $i++) {
    try {
        $resp = Invoke-WebRequest "http://127.0.0.1:8000/health" -UseBasicParsing -TimeoutSec 2
        if ($resp.StatusCode -eq 200) { $healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
}
if (-not $healthy) {
    Write-Host "❌ Uvicorn never became healthy. Showing uvicorn.err:" -ForegroundColor Red
    if (Test-Path uvicorn.err) { Get-Content uvicorn.err | Select-Object -Last 50 }
    throw "App failed to become healthy on :8000"
}

Write-Host "==> App healthy; running tests + coverage…" -ForegroundColor Cyan

# Run pytest with coverage (writes coverage.xml)
$pytestArgs = @(
    "-q",
    "--maxfail=1",
    "--disable-warnings",
    "--cov=.",
    "--cov-report=term",
    "--cov-report=xml:coverage.xml"
)
$pytest = Start-Process -FilePath "pytest" -ArgumentList $pytestArgs -NoNewWindow -PassThru -Wait
$exitCode = $pytest.ExitCode

Write-Host "==> pytest exit code: $exitCode"

# Always try to stop the server
Write-Host "==> Stopping Uvicorn…" -ForegroundColor Cyan
try { Stop-Process -Id $uvProc.Id -Force -ErrorAction SilentlyContinue } catch { }

# Bubble up pytest result
exit $exitCode
