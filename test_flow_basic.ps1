# test_flow_basic.ps1
# Clean start before running tests
Write-Host "Ã°Å¸Â§Â¹ Cleaning environment before Basic Flow tests..."
python db_check.py --cleanup

Write-Host "Ã°Å¸Å¡â‚¬ Running Basic Flow Tests..."

# Example test calls (replace with your actual basics)
Write-Host "Ã¢Å¾Â¡Ã¯Â¸Â Health root GET"
python -m pytest tests/test_health.py::test_root --maxfail=1 --disable-warnings -q

Write-Host "Ã¢Å¾Â¡Ã¯Â¸Â Health ping"
python -m pytest tests/test_health.py::test_ping --maxfail=1 --disable-warnings -q

# ... add other basic flow tests ...

Write-Host "Ã¢Å“â€¦ Basic flow tests complete."

# Clean up after running tests
Write-Host "Ã°Å¸Â§Â¹ Cleaning environment after Basic Flow tests..."
python db_check.py --cleanup
