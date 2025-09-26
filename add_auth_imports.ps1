# add_auth_imports.ps1
param([string]$Root = ".")

$exclude = @("\.venv\", "\venv\", "\.env\", "\.tox\", "\__pycache__\", "\site-packages\")
$files = Get-ChildItem -Path $Root -Recurse -Filter *.py | Where-Object {
  $p = $_.FullName
  -not ($exclude | Where-Object { $p -like "*$_*" })
}

foreach ($f in $files) {
  $path = $f.FullName
  $text = Get-Content -Raw -Path $path

  $needsUser = ($text -match '\bget_current_user\b') -and ($text -notmatch 'from\s+backend\.deps\s+import\s+get_current_user')
  $needsDepends = ($text -match '\bDepends\s*\(') -and ($text -notmatch 'from\s+fastapi\s+import\s+.*\bDepends\b')

  if (-not ($needsUser -or $needsDepends)) { continue }

  $lines = $text -split "`r?`n"
  $insertIdx = 0

  # Keep __future__ at the very top if present
  if ($lines.Length -gt 0 -and $lines[0] -match '^\s*from\s+__future__\s+import\s+') {
    $insertIdx = 1
    # Also skip consecutive __future__ lines just in case
    while ($insertIdx -lt $lines.Length -and $lines[$insertIdx] -match '^\s*from\s+__future__\s+import\s+') {
      $insertIdx++
    }
  }

  $prefix = @()
  if ($needsDepends) { $prefix += 'from fastapi import Depends' }
  if ($needsUser)    { $prefix += 'from backend.deps import get_current_user' }

  if ($prefix.Count -gt 0) {
    $newLines = @()
    if ($insertIdx -gt 0) { $newLines += $lines[0..($insertIdx-1)] }
    $newLines += $prefix
    $newLines += $lines[$insertIdx..($lines.Count-1)]
    Copy-Item -Path $path -Destination ($path + ".bak") -Force
    Set-Content -Path $path -Value ($newLines -join "`r`n")
    Write-Host "Patched: $path"
  }
}
