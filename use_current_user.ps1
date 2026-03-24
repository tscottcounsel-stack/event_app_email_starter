# use_current_user.ps1
param([string]$Root=".")

$exclude = @("\.venv\", "\venv\", "\.env\", "\.tox\", "\__pycache__\", "\site-packages\")
$files = Get-ChildItem -Path $Root -Recurse -Filter *.py | Where-Object {
  $p = $_.FullName
  -not ($exclude | Where-Object { $p -like "*$_*" })
}

foreach ($f in $files) {
  $path = $f.FullName
  $text = Get-Content -Raw -Encoding UTF8 -Path $path

  if ($text -notmatch '\bDepends\s*\(\s*get_current_user\b') { continue }

  # Replace the dependency call
  $new = $text -replace '\bDepends\s*\(\s*get_current_user\s*\)', 'Depends(current_user)'

  # Ensure imports (after any from __future__ imports)
  if ($new -notmatch 'from\s+backend\.deps\s+import\s+current_user') {
    $lines = $new -split "`r?`n"
    $insertPos = 0
    while ($insertPos -lt $lines.Count -and $lines[$insertPos] -match '^\s*from\s+__future__\s+import\s+') { $insertPos++ }
    $before = $lines[0..($insertPos-1)]
    $after  = $lines[$insertPos..($lines.Count-1)]
    $before += 'from backend.deps import current_user'
    if ($new -match '\bDepends\s*\(' -and $new -notmatch 'from\s+fastapi\s+import\s+.*\bDepends\b') {
      $before += 'from fastapi import Depends'
    }
    $new = ($before + $after) -join "`r`n"
  }

  if ($new -ne $text) {
    Copy-Item -Path $path -Destination ($path + ".bak") -Force
    Set-Content -Encoding UTF8 -Path $path -Value $new
    Write-Host "Patched: $path"
  }
}
