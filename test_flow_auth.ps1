# test_flow_auth.ps1
# Clean start before running tests
Write-Host "🧹 Cleaning environment before Auth Flow tests..."
python db_check.py --cleanup

Write-Host "🚀 Running Auth Flow Tests..."

Write-Host "➡️ Register Vendor"
python -m pytest tests/test_auth.py::test_register_vendor --maxfail=1 --disable-warnings -q

Write-Host "➡️ Login Vendor"
python -m pytest tests/test_auth.py::test_login_vendor --maxfail=1 --disable-warnings -q

Write-Host "➡️ Refresh Token"
python -m pytest tests/test_auth.py::test_refresh_token --maxfail=1 --disable-warnings -q

# ... add other auth-related tests ...

Write-Host "✅ Auth flow tests complete."

# Clean up after running tests
Write-Host "🧹 Cleaning environment after Auth Flow tests..."
python db_check.py --cleanup
