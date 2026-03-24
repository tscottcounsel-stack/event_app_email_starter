# run_all_tests.ps1
# Master test runner

Write-Host "Ã°Å¸Â§Â¹ Global cleanup before all tests..."
python db_check.py --cleanup

Write-Host "Ã°Å¸Å¡â‚¬ Running ALL test flows..."

# === Run each test flow ===
Write-Host "`nÃ¢Å¾Â¡Ã¯Â¸Â Running Basic Flow..."
.\test_flow_basic.ps1

Write-Host "`nÃ¢Å¾Â¡Ã¯Â¸Â Running Extended Flow..."
.\test_flow_extended.ps1

Write-Host "`nÃ¢Å¾Â¡Ã¯Â¸Â Running Auth Flow..."
.\test_flow_auth.ps1

# Add more flows here as needed
# .\test_flow_other.ps1

Write-Host "Ã¢Å“â€¦ All test flows completed."

Write-Host "Ã°Å¸Â§Â¹ Global cleanup after all tests..."
python db_check.py --cleanup
