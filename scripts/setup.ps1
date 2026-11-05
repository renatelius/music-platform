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

# -Live prints output while the step runs (long steps); otherwise it is printed at the end.
function Run-Step([string]$Name, [scriptblock]$Block, [switch]$Critical, [switch]$Live) {
  Write-Host ''
  Write-Host "=== $Name ===" -ForegroundColor Cyan
  $sw = [System.Diagnostics.Stopwatch]::StartNew()
  $global:LASTEXITCODE = 0
  $lines = @()
  try {
    if ($Live) {
      $lines = & $Block 2>&1 | ForEach-Object { $l = "$_"; Write-Host "  $l"; $l }
    } else {
      $lines = & $Block 2>&1 | ForEach-Object { "$_" }
    }
    $code = $LASTEXITCODE
  } catch {
    $lines += "EXCEPTION: $($_.Exception.Message)"
    $code = 1
  }
  $sw.Stop()
  if ($null -eq $code) { $code = 0 }
  if (-not $Live) { foreach ($l in $lines) { Write-Host "  $l" } }
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

Run-Step 'Node.js >= 24.7 (built-in Argon2)' -Critical {
  $v = (& node --version)
  $v
  if ($v -notmatch '^v(\d+)\.(\d+)' -or [int]$Matches[1] -lt 24 -or ([int]$Matches[1] -eq 24 -and [int]$Matches[2] -lt 7)) { $global:LASTEXITCODE = 1 }
}
Run-Step 'pnpm available' -Critical { & pnpm --version }
Run-Step 'Docker engine running' -Critical { & docker info --format '{{.ServerVersion}}' }

Run-Step '.env file' -Critical {
  if (-not (Test-Path '.env')) { Copy-Item '.env.example' '.env'; 'created .env from .env.example' }
  # Add settings that appeared in .env.example after .env was created; existing values are kept.
  $current = Read-DotEnv (Join-Path $root '.env')
  $raw = [System.IO.File]::ReadAllText((Join-Path $root '.env'))
  $added = @()
  foreach ($line in Get-Content '.env.example') {
    if ($line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') { continue }
    $key = $Matches[1]
    if ($current.ContainsKey($key)) { continue }
    if ($key -eq 'AUTH_JWT_SECRET') {
      $bytes = New-Object byte[] 48
      [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $line = 'AUTH_JWT_SECRET=' + [Convert]::ToBase64String($bytes)
    }
    if ($raw.Length -gt 0 -and -not $raw.EndsWith("`n")) { $line = "`r`n" + $line; $raw = "x`n" }
    Add-Content -Path '.env' -Value $line -Encoding ASCII
    $added += $key
  }
  if ($added.Count -gt 0) { "added to .env: $($added -join ', ')" } else { '.env is up to date' }
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

Run-Step 'FFmpeg with required encoders (aac, libopus, flac, libmp3lame)' {
  $ff = if ($envMap['FFMPEG_PATH']) { $envMap['FFMPEG_PATH'] } else { 'ffmpeg' }
  $fp = if ($envMap['FFPROBE_PATH']) { $envMap['FFPROBE_PATH'] } else { 'ffprobe' }
  (& $ff -hide_banner -version | Select-Object -First 1)
  (& $fp -hide_banner -version | Select-Object -First 1)
  $encoders = (& $ff -hide_banner -encoders) -join "`n"
  $missing = @('aac', 'libopus', 'flac', 'libmp3lame') | Where-Object { $encoders -notmatch "(?m)^\s*A\S*\s+$_\s" }
  if ($missing.Count -gt 0) { "missing encoders: $($missing -join ', ')"; $global:LASTEXITCODE = 1 } else { 'all required encoders present' }
}

Run-Step 'Generate DB migrations from schema (drizzle-kit)' { & pnpm db:generate }
Run-Step 'Format code (prettier --write)' { & pnpm format }
Run-Step 'Lint + typecheck + test + build' { & pnpm check }
Run-Step 'Migrate development database' { & pnpm db:migrate }
Run-Step 'Audio pipeline smoke test (synthetic file -> renditions in S3)' { & pnpm --filter @mp/api worker:smoke }
# First run downloads several GB from Hugging Face (audio is read per row group, ~0.3-0.5 GB each)
# and takes a while; once the catalog has 300 ready tracks it only verifies them (seconds).
Run-Step 'Test catalog: FMA import, 300 tracks under open licenses (check only when complete)' -Live { & pnpm catalog:import }

# Smoke tests start their own servers. If dev.bat is running, the ports are taken and the
# requests would reach the dev servers instead, so a passing result would prove nothing.
function Test-PortBusy([string]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', [int]$Port)
    return ($task.Wait(300) -and $client.Connected)
  } catch { return $false } finally { $client.Dispose() }
}

$portBusyHint = 'already in use - is dev.bat running? Stop it (Ctrl+C) and run setup.bat again.'

$apiPort = if ($envMap['API_PORT']) { $envMap['API_PORT'] } else { '4000' }
Run-Step "API smoke test (GET http://127.0.0.1:$apiPort/health)" {
  $busy = @(@($apiPort) | Where-Object { Test-PortBusy $_ })
  if ($busy.Count -gt 0) { "Port $($busy -join ', ') $portBusyHint"; $global:LASTEXITCODE = 1; return }
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

$webPort = '3000'
Run-Step "Web smoke test (http://127.0.0.1:$webPort/login and /api/health through the proxy)" {
  $busy = @(@($apiPort, $webPort) | Where-Object { Test-PortBusy $_ })
  if ($busy.Count -gt 0) { "Port $($busy -join ', ') $portBusyHint"; $global:LASTEXITCODE = 1; return }
  $apiDir = Join-Path $root 'apps\api'
  $webDir = Join-Path $root 'apps\web'
  $nextBin = Join-Path $webDir 'node_modules\next\dist\bin\next'
  $logs = @{}
  foreach ($n in 'api-out', 'api-err', 'web-out', 'web-err') { $logs[$n] = Join-Path $env:TEMP "mp-smoke-$n.txt" }
  $api = Start-Process -FilePath 'node' -ArgumentList @('--env-file-if-exists=../../.env', 'dist/main.js') `
    -WorkingDirectory $apiDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $logs['api-out'] -RedirectStandardError $logs['api-err']
  $web = Start-Process -FilePath 'node' -ArgumentList @("`"$nextBin`"", 'start', '--port', $webPort, '--hostname', '127.0.0.1') `
    -WorkingDirectory $webDir -PassThru -WindowStyle Hidden -RedirectStandardOutput $logs['web-out'] -RedirectStandardError $logs['web-err']
  $login = $null; $health = $null
  try {
    for ($i = 0; $i -lt 60 -and -not ($login -and $health); $i++) {
      Start-Sleep -Milliseconds 500
      if ($web.HasExited -or $api.HasExited) { break }
      if (-not $login) {
        try {
          $r = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webPort/login" -TimeoutSec 5 -ErrorAction Stop
          if ($r.Content -match 'ReMusic') { $login = "GET /login -> HTTP $($r.StatusCode), $($r.Content.Length) bytes, contains 'ReMusic'" }
        } catch {}
      }
      if (-not $health) {
        try { $health = (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$webPort/api/health" -TimeoutSec 5 -ErrorAction Stop).Content } catch {}
      }
    }
  } finally {
    foreach ($proc in @($web, $api)) {
      if (-not $proc.HasExited) { & taskkill /PID $proc.Id /T /F 2>&1 | Out-Null }
    }
    # taskkill returns 128 when the process exited on its own a moment earlier; that is not a test failure.
    $global:LASTEXITCODE = 0
  }
  if ($login) { $login } else { 'Web app did not serve /login' }
  if ($health) { "GET /api/health (proxied) -> $health" } else { 'Proxy /api/health did not answer' }
  if (-not ($login -and $health)) {
    foreach ($n in 'web-out', 'web-err', 'api-err') {
      if (Test-Path $logs[$n]) { "--- $n"; Get-Content $logs[$n] -Tail 25 }
    }
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
