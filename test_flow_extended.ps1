# test_flow_extended.ps1
# Clean start before running tests
Write-Host "🧹 Cleaning environment before tests..."
python db_check.py --cleanup

Write-Host "🚀 Running Extended Flow Tests..."

# Example test calls (replace with your actual flows)
Write-Host "➡️ Health root GET"
python -m pytest tests/test_health.py::test_root --maxfail=1 --disable-warnings -q

Write-Host "➡️ Auth register vendor"
python -m pytest tests/test_auth.py::test_register_vendor --maxfail=1 --disable-warnings -q

Write-Host "➡️ Auth login vendor"
python -m pytest tests/test_auth.py::test_login_vendor --maxfail=1 --disable-warnings -q

Write-Host "➡️ Vendor CRUD tests"
python -m pytest tests/test_vendor.py --maxfail=1 --disable-warnings -q

# ... add any other extended flow test calls here ...

Write-Host "✅ Extended flow tests complete."

# Clean up after running tests
Write-Host "🧹 Cleaning environment after tests..."
python db_check.py --cleanup
