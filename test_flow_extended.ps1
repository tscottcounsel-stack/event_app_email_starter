# test_flow_extended.ps1
# Clean start before running tests
Write-Host "Ã°Å¸Â§Â¹ Cleaning environment before tests..."
python db_check.py --cleanup

Write-Host "Ã°Å¸Å¡â‚¬ Running Extended Flow Tests..."

# Example test calls (replace with your actual flows)
Write-Host "Ã¢Å¾Â¡Ã¯Â¸Â Health root GET"
python -m pytest tests/test_health.py::test_root --maxfail=1 --disable-warnings -q

Write-Host "Ã¢Å¾Â¡Ã¯Â¸Â Auth register vendor"
python -m pytest tests/test_auth.py::test_register_vendor --maxfail=1 --disable-warnings -q

Write-Host "Ã¢Å¾Â¡Ã¯Â¸Â Auth login vendor"
python -m pytest tests/test_auth.py::test_login_vendor --maxfail=1 --disable-warnings -q

Write-Host "Ã¢Å¾Â¡Ã¯Â¸Â Vendor CRUD tests"
python -m pytest tests/test_vendor.py --maxfail=1 --disable-warnings -q

# ... add any other extended flow test calls here ...

Write-Host "Ã¢Å“â€¦ Extended flow tests complete."

# Clean up after running tests
Write-Host "Ã°Å¸Â§Â¹ Cleaning environment after tests..."
python db_check.py --cleanup
