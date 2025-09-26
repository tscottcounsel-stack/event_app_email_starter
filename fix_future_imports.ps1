param([string]$Root = ".")

$exclude = @("\.venv\", "\venv\", "\.env\", "\.tox\", "\__pycache__\", "\site-packages\")
$files = Get-ChildItem -Path $Root -Recurse -Filter *.py | Where-Object {
  $p = $_.FullName
  -not ($exclude | Where-Object { $p -like "*$_*" })
}

foreach ($f in $files) {
  $path = $f.FullName
  $lines = (Get-Content -Raw -Encoding UTF8 -Path $path) -split "`r?`n"

  # Collect all from __future__ import lines
  $futureIdxs = @()
  $futureLines = @()
  for ($i = 0; $i -lt $lines.Count; $i++) {
    $t = $lines[$i].Trim()
    if ($t.StartsWith("from __future__ import")) {
      $futureIdxs += $i
      $futureLines += $lines[$i]
    }
  }

  if ($futureLines.Count -eq 0) { continue }

  # Remove them (from bottom to top so indices don't shift)
  foreach ($idx in ($futureIdxs | Sort-Object -Descending)) {
    $lines = $lines[0..($idx-1)] + $lines[($idx+1)..($lines.Count-1)]
  }

  # Determine insertion point:
  $insertPos = 0

  # Skip shebang (#!...) if present
  if ($lines.Count -gt 0 -and $lines[0].StartsWith("#!")) { $insertPos++ }

  # Skip encoding line like "# -*- coding: utf-8 -*-" or "# coding: utf-8"
  if ($insertPos -lt $lines.Count) {
    $enc = $lines[$insertPos].ToLower()
    if ($enc.Contains("coding:") -or $enc.Contains("coding=")) { $insertPos++ }
  }

  # Skip leading blank lines and comments
  while ($insertPos -lt $lines.Count) {
    $trim = $lines[$insertPos].Trim()
    if ($trim -eq "" -or $trim.StartsWith("#")) { $insertPos++ } else { break }
  }

  # Skip a top-level module docstring if present
  if ($insertPos -lt $lines.Count) {
    $trim = $lines[$insertPos].Trim()
    $docStart = $null
    $quote = $null
    if ($trim.StartsWith('"""')) { $docStart = $insertPos; $quote = '"""' }
    elseif ($trim.StartsWith("'''")) { $docStart = $insertPos; $quote = "'''" }

    if ($docStart -ne $null) {
      # If it ends on the same line
      if ($trim.Contains($quote) -and ($trim.Split($quote).Count -ge 3)) {
        $insertPos = $docStart + 1
      } else {
        $j = $docStart + 1
        while ($j -lt $lines.Count -and -not $lines[$j].Contains($quote)) { $j++ }
        if ($j -lt $lines.Count) { $insertPos = $j + 1 } else { $insertPos = $lines.Count }
      }
    }
  }

  # Build new content with future imports inserted
  $newLines = @()
  if ($insertPos -gt 0) { $newLines += $lines[0..($insertPos-1)] }
  $newLines += $futureLines
  if ($insertPos -lt $lines.Count) { $newLines += $lines[$insertPos..($lines.Count-1)] }

  # Write with backup
  Copy-Item -Path $path -Destination ($path + ".bak") -Force
  Set-Content -Encoding utf8 -Path $path -Value ($newLines -join "`r`n")
  Write-Host "Fixed __future__ position in: $path"
}
