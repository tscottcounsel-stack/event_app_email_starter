Param(
  [ValidateSet("dev","prod")] [string]$Mode = "dev",
  [string]$Token = "devtoken123",
  [switch]$Migrate,
  [switch]$Smoke,
  [int]$EventId = 5
)

$ErrorActionPreference = "Stop"

function Start-ApiDev {
  Enable-DevAuth -Token $Token
  uvicorn main:app --reload
}

function Start-ApiProd {
  Disable-DevAuth
  $env:REQUIRE_AUTH = "1"
  uvicorn main:app --reload
}

function Migrate-Up { alembic upgrade head }

function Smoke-Slots {
  $base = "http://127.0.0.1:8000"

  Write-Host "Health:";  Invoke-RestMethod "$base/health"  | Out-String | Write-Host
  Write-Host "Version:"; Invoke-RestMethod "$base/version" | Out-String | Write-Host

  $auth = $null
  if ($env:DEV_AUTH -eq "1" -and $env:DEV_TOKEN) {
    $auth = @{ Authorization = "Bearer $($env:DEV_TOKEN)" }
  }

  $payload = @{ label="Booth QA"; price_cents=12000 } | ConvertTo-Json
  Invoke-RestMethod "$base/events/$EventId/slots" -Headers $auth -Method POST -ContentType "application/json" -Body $payload | Out-Null

  $slots = Invoke-RestMethod "$base/events/$EventId/slots" -Headers $auth
  if (-not $slots) { throw "No slots returned after create." }

  $slotId = $slots[0].id
  Write-Host "Created slot id:" $slotId

  $patch = @{ label="Booth QA (Corner)"; price_cents=15000 } | ConvertTo-Json
  Invoke-RestMethod "$base/events/$EventId/slots/$slotId" -Headers $auth -Method PATCH -ContentType "application/json" -Body $patch | Out-Null

  Invoke-RestMethod "$base/events/$EventId/slots/$slotId" -Headers $auth -Method DELETE | Out-Null
  Write-Host "Smoke OK âœ…"
}

if ($Migrate) { Migrate-Up }

switch ($Mode) {
  "dev"  { if ($Smoke) { Smoke-Slots } else { Start-ApiDev } }
  "prod" { if ($Smoke) { Smoke-Slots } else { Start-ApiProd } }
}
