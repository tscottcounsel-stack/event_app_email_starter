# fix_get_current_user_imports.ps1
param(
  [string]$ProjectRoot = "."
)

function Ensure-CoreDeps {
  $coreDir = Join-Path $ProjectRoot "core"
  if (-not (Test-Path $coreDir)) { New-Item -ItemType Directory -Path $coreDir | Out-Null }
  $initPy = Join-Path $coreDir "__init__.py"
  if (-not (Test-Path $initPy)) { New-Item -ItemType File -Path $initPy | Out-Null }

  $depsPy = Join-Path $coreDir "deps.py"
  $content = @'
from __future__ import annotations

import os
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")

def get_current_user(token: str = Depends(oauth2_scheme)):
    if os.getenv("DISABLE_AUTH") == "1":
        return {"id": 1, "email": "dev@example.com", "is_active": True}
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
        headers={"WWW-Authenticate": "Bearer"},
    )
'@
  if (-not (Test-Path $depsPy)) {
    Set-Content -Path $depsPy -Value $content -NoNewline
    Write-Host "Created core/deps.py"
  }
}

function Insert-ImportBlock {
  param(
    [string]$FilePath,
    [string]$ImportLine
  )
  $text = Get-Content -Raw -Path $FilePath

  # If already present, no-op
  if ($text -match [regex]::Escape($ImportLine)) { return $false }

  # DonÃ¢â‚¬â„¢t add to our own deps module
  if ($FilePath -like "*core\deps.py") { return $false }

  # Only touch files that actually reference get_current_user
  if ($text -notmatch "\bget_current_user\b") { return $false }

  $lines = $text -split "`r?`n"
  $i = 0

  # Skip shebang/encoding
  if ($lines[$i] -match "^\s*#\!") { $i++ }
  if ($lines[$i] -match "coding[:=]") { $i++ }

  # Skip module docstring
  if ($lines[$i] -match '^\s*("""|''')') {
    $quote = $matches[1]
    $i++
    while ($i -lt $lines.Count -and $lines[$i] -notmatch $quote) { $i++ }
    if ($i -lt $lines.Count) { $i++ }
  }

  # Skip __future__ imports
  while ($i -lt $lines.Count -and $lines[$i] -match '^\s*from\s+__future__\s+import\s+') { $i++ }

  # Find end of import block
  $j = $i
  while ($j -lt $lines.Count -and $lines[$j] -match '^\s*(from\s+\S+\s+import\s+|import\s+)') { $j++ }

  # Insert our import after existing imports
  $before = $lines[0..($j-1)]
  $after  = $lines[$j..($lines.Count-1)]
  $new    = @()
  $new += $before
  $new += $ImportLine
  $new += $after

  # Ensure fastapi Depends import if file uses Depends(
  $needsDepends = $text -match '\bDepends\s*\(' -and ($text -notmatch 'from\s+fastapi\s+import\s+.*\bDepends\b')
  if ($needsDepends) {
    # Try to amend an existing "from fastapi import ..." line; otherwise insert a new one.
    $idx = ($new | Select-String -SimpleMatch "from fastapi import ").LineNumber
    if ($idx) {
      $lineIndex = $idx[0]-1
      if ($new[$lineIndex] -notmatch '\bDepends\b') {
        $new[$lineIndex] = $new[$lineIndex].TrimEnd() -replace '\s*$', ', Depends'
      }
    } else {
      # Insert just before our core.deps import to keep related imports close
      $insertAt = [Array]::IndexOf($new, $ImportLine)
      $new = $new[0..($insertAt-1)] + @("from fastapi import Depends") + $new[$insertAt..($new.Count-1)]
    }
  }

  # Backup and write
  Copy-Item -Path $FilePath -Destination ($FilePath + ".bak") -Force
  Set-Content -Path $FilePath -Value ($new -join "`r`n")
  return $true
}

# --------- Main ----------
Write-Host "== Ensuring core/deps.py =="
Ensure-CoreDeps

$exclude = @("\.venv\", "\venv\", "\.env\", "\.tox\", "\__pycache__\", "\site-packages\")
$pythonFiles = Get-ChildItem -Path $ProjectRoot -Recurse -Filter *.py | Where-Object {
  $p = $_.FullName
  -not ($exclude | ForEach-Object { $p -like "*$_*" } | Where-Object { $_ })
}

$changed = 0
foreach ($file in $pythonFiles) {
  $did = Insert-ImportBlock -FilePath $file.FullName -ImportLine "from core.deps import get_current_user"
  if ($did) {
    Write-Host "Patched: $($file.FullName)"
    $changed++
  }
}

Write-Host "== Done. Files patched: $changed =="
Write-Host "Tip: make sure your tests override core.deps.get_current_user"
