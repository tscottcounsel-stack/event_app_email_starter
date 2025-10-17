<#  scripts\Fix-LineEndings.ps1
    Normalize text files:
      - UTF-8 without BOM
      - LF line endings (default)
      - CRLF for Windows script types: .ps1 .bat .cmd
      - Ensure final newline
      - For YAML: remove control chars, replace tabs with 2 spaces
    Usage examples:
      pwsh -File scripts/Fix-LineEndings.ps1
      pwsh -File scripts/Fix-LineEndings.ps1 -Stage
      pwsh -File scripts/Fix-LineEndings.ps1 -IncludeExt .py,.md,.yml
      pwsh -File scripts/Fix-LineEndings.ps1 -DryRun
#>

[CmdletBinding()]
param(
  [string]$Root = ".",
  [string[]]$IncludeExt = @(
    ".py",".yml",".yaml",".toml",".json",".md",".txt",".ini",".cfg",
    ".editorconfig",".gitattributes",".gitignore",".ps1",".psm1",".psd1",
    ".psd",".css",".html",".ts",".tsx",".js",".jsx",".sh",".sql",".xml"
  ),
  [string[]]$ExcludeExt = @(".png",".jpg",".jpeg",".gif",".pdf",".ico",".zip",".7z",".rar",".exe",".dll",".so",".dylib",".mp3",".mp4",".mov",".webp",".woff",".woff2"),
  [switch]$DryRun,
  [switch]$Stage
)

function Test-IsBinaryLike([byte[]]$bytes) {
  # quick heuristic: if it contains nulls, likely binary
  return ($bytes -contains 0x00)
}

function Normalize-File([string]$Path) {
  $ext = [IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($ExcludeExt -contains $ext) { return $false }

  $bytes = [IO.File]::ReadAllBytes($Path)
  if (Test-IsBinaryLike $bytes) { return $false }

  # Strip UTF-8 BOM if present
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
  }

  $text = [Text.Encoding]::UTF8.GetString($bytes)

  $original = $text

  # YAML hygiene: no control chars (except tab/LF/CR), no tabs for indent
  if ($ext -in @(".yml",".yaml")) {
    $text = [regex]::Replace($text, "[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "")
    $text = $text -replace "`t","  "
  }

  # Normalize newlines
  $text = $text -replace "`r?`n","`n"   # LF for now

  # Ensure final newline
  if (-not $text.EndsWith("`n")) { $text += "`n" }

  # For Windows script files, switch to CRLF in working tree
  if ($ext -in @(".ps1",".psm1",".psd1",".bat",".cmd")) {
    $text = $text -replace "`n","`r`n"
  }

  $changed = ($text -ne $original)

  if ($changed -and -not $DryRun) {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [IO.File]::WriteAllText($Path, $text, $utf8NoBom)
  }

  return $changed
}

# Gather candidate files
$files = Get-ChildItem -Path $Root -Recurse -File |
  Where-Object {
    $IncludeExt.Count -eq 0 -or ($IncludeExt -contains ([IO.Path]::GetExtension($_.FullName).ToLowerInvariant()))
  }

$changedPaths = @()
foreach ($f in $files) {
  try {
    if (Normalize-File -Path $f.FullName) {
      $changedPaths += $f.FullName
      Write-Host "[fixed] $($f.FullName)"
    }
  } catch {
    Write-Warning "Skipped (error): $($f.FullName) -> $($_.Exception.Message)"
  }
}

if ($changedPaths.Count -eq 0) {
  Write-Host "No changes needed. ✅"
} else {
  Write-Host "`nChanged $($changedPaths.Count) file(s)."
  if ($Stage -and -not $DryRun) {
    # Stage the changed files
    & git add -- $changedPaths 2>$null | Out-Null
    Write-Host "Staged changed files."
  }
  if ($DryRun) {
    Write-Host "(Dry run) No files were written."
  }
}
