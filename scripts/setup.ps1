#Requires -Version 5.1
<#
  setup.ps1 - first-time setup and verification of the dev environment (iteration I1).
  Safe to run again. Writes a report to setup-report.txt in the project root.
#>
$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$env:TURBO_TELEMETRY_DISABLED = '1'

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$reportPath = Join-Path $root 'setup-report.txt'
$report  = New-Object System.Collections.Generic.List[string]
$results = New-Object System.Collections.Generic.List[object]
$compose = @('compose', '-f', 'infrastructure/docker/compose.yaml', '--env-file', '.env')

function Add-Report([string]$s) { $report.Add($s) | Out-Null }

function Save-Report {
  Add-Report ''
  Add-Report '## Summary'
  foreach ($r in $results) { Add-Report ("{0,-6} {1} ({2} s)" -f $r.Status, $r.Step, $r.Sec) }
  [System.IO.File]::WriteAllLines($reportPath, $report, (New-Object System.Text.UTF8Encoding($false)))
}

function Run-Step([string]$Name, [scriptblock]$Block, [switch]$Critical) {
  Write-Host ''
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $global:LASTEXITCODE = 0
  $lines = @()
  try {
    $lines = & $Block 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
  } catch {
    $lines += "EXCEPTION: $($_.Exception.Message)"
    $code = 1
  }
  $sw.Stop()
  if ($null -eq $code) { $code = 0 }
  foreach ($l in $lines) { Write-Host "  $l" }
  $status = if ($code -eq 0) { 'PASS' } else { 'FAIL' }
  $color  = if ($code -eq 0) { 'Green' } else { 'Red' }
  $sec = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  Write-Host "  [$status] $Name ($sec s)" -ForegroundColor $color
  $results.Add([pscustomobject]@{ Step = $Name; Status = $status; Sec = $sec }) | Out-Null
  Add-Report ''
  Add-Report "### $status - $Name (exit $code, $sec s)"
  $tail = @($lines | Select-Object -Last 80)
  foreach ($l in $tail) { Add-Report "    $l" }
  if ($Critical -and $code -ne 0) {
    Save-Report
    Write-Host ''
    Write-Host "Stopped: critical step failed. Report: $reportPath" -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
  }
}

function Read-DotEnv([string]$path) {
  $map = @{}
  foreach ($line in Get-Content $path) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$') { $map[$Matches[1]] = $Matches[2] }
  }
  return $map
}

Add-Report "# Setup report $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

Run-Step 'Node.js >= 24' -Critical {
  $v = (& node --version)
  $v
  if ($v -notmatch '^v(\d+)' -or [int]$Matches[1] -lt 24) { $global:LASTEXITCODE = 1 }
}
Run-Step 'pnpm available' -Critical { & pnpm --version }
Run-Step 'Docker engine running' -Critical { & docker info --format '{{.ServerVersion}}' }

Run-Step '.env file' -Critical {
  if (Test-Path '.env') { '.env already exists - kept as is' }
  else { Copy-Item '.env.example' '.env'; 'created .env from .env.example' }
}
$envMap = Read-DotEnv (Join-Path $root '.env')

Run-Step 'pnpm install' -Critical { & pnpm install }

Run-Step 'Infrastructure up (postgres, redis, s3, mailpit)' -Critical {
  & docker @compose up -d --quiet-pull --wait --wait-timeout 180
}
Run-Step 'S3 buckets' { & docker @compose --profile init run --rm --quiet-pull s3-init }
Run-Step 'Containers' { & docker @compose ps --format 'table {{.Service}}\t{{.State}}\t{{.Health}}\t{{.Ports}}' }

$pgUser = $envMap['POSTGRES_USER']
Run-Step 'PostgreSQL version and extensions (mp, mp_test)' {
  & docker @compose exec -T postgres psql -U $pgUser -d mp -At -c 'select version()'
  & docker @compose exec -T postgres psql -U $pgUser -d mp -At -c "select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension"
  & docker @compose exec -T postgres psql -U $pgUser -d mp_test -At -c "select string_agg(extname || ' ' || extversion, ', ' order by extname) from pg_extension"
}
Run-Step 'Redis ping' {
  & docker @compose exec -T redis redis-cli -a $envMap['REDIS_PASSWORD'] --no-auth-warning ping
}
Run-Step 'S3 list buckets' {
  & docker @compose --profile init run --rm --entrypoint aws s3-init --endpoint-url http://s3:8333 s3 ls
}
Run-Step 'Mailpit API' {
  $port = $envMap['MAILPIT_UI_PORT']
  $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/v1/info" -TimeoutSec 10 -ErrorAction Stop
  "HTTP $($r.StatusCode)"
  $r.Content
}

Run-Step 'Generate DB migrations from schema (drizzle-kit)' { & pnpm db:generate }
Run-Step 'Format code (prettier --write)' { & pnpm format }
Run-Step 'Lint + typecheck + test + build' { & pnpm check }
Run-Step 'Migrate development database' { & pnpm db:migrate }

$apiPort = if ($envMap['API_PORT']) { $envMap['API_PORT'] } else { '4000' }
Run-Step "API smoke test (GET http://127.0.0.1:$apiPort/health)" {
  $apiDir = Join-Path $root 'apps\api'
  $out = Join-Path $env:TEMP 'mp-api-smoke.out.txt'
  $err = Join-Path $env:TEMP 'mp-api-smoke.err.txt'
  $proc = Start-Process -FilePath 'node' -ArgumentList @('--env-file-if-exists=../../.env', 'dist/main.js') `
    -WorkingDirectory $apiDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $out -RedirectStandardError $err
  $body = $null
  try {
    for ($i = 0; $i -lt 40 -and -not $body; $i++) {
      Start-Sleep -Milliseconds 500
      if ($proc.HasExited) { break }
      try { $body = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$apiPort/health" -TimeoutSec 5 -ErrorAction Stop).Content } catch {}
    }
  } finally {
    if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force }
  }
  if ($body) { $body } else {
    'API did not answer. Server output:'
    if (Test-Path $out) { Get-Content $out -Tail 30 }
    if (Test-Path $err) { Get-Content $err -Tail 30 }
    $global:LASTEXITCODE = 1
  }
}

Save-Report
$failed = @($results | Where-Object { $_.Status -eq 'FAIL' }).Count
Write-Host ''
if ($failed -eq 0) { Write-Host 'ALL CHECKS PASSED' -ForegroundColor Green }
else { Write-Host "$failed check(s) FAILED - see setup-report.txt" -ForegroundColor Red }
Write-Host "Report: $reportPath"
Read-Host 'Press Enter to close'
