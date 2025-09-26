# test_flow_basic.ps1
# Clean start before running tests
Write-Host "🧹 Cleaning environment before Basic Flow tests..."
python db_check.py --cleanup

Write-Host "🚀 Running Basic Flow Tests..."

# Example test calls (replace with your actual basics)
Write-Host "➡️ Health root GET"
python -m pytest tests/test_health.py::test_root --maxfail=1 --disable-warnings -q

Write-Host "➡️ Health ping"
python -m pytest tests/test_health.py::test_ping --maxfail=1 --disable-warnings -q

# ... add other basic flow tests ...

Write-Host "✅ Basic flow tests complete."

# Clean up after running tests
Write-Host "🧹 Cleaning environment after Basic Flow tests..."
python db_check.py --cleanup
