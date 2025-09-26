# run_all_tests.ps1
# Master test runner

Write-Host "🧹 Global cleanup before all tests..."
python db_check.py --cleanup

Write-Host "🚀 Running ALL test flows..."

# === Run each test flow ===
Write-Host "`n➡️ Running Basic Flow..."
.\test_flow_basic.ps1

Write-Host "`n➡️ Running Extended Flow..."
.\test_flow_extended.ps1

Write-Host "`n➡️ Running Auth Flow..."
.\test_flow_auth.ps1

# Add more flows here as needed
# .\test_flow_other.ps1

Write-Host "✅ All test flows completed."

Write-Host "🧹 Global cleanup after all tests..."
python db_check.py --cleanup
