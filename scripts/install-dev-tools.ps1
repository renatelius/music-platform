#Requires -Version 5.1
<#
  install-dev-tools.ps1
  Installs the developer toolchain for music-platform on Windows.
  Idempotent: already installed tools are skipped, safe to run again.

  Installs into B:\develop where the installer allows it.
  Installs / configures:
    1. Windows long paths + git core.longpaths
    2. WSL 2 (no distro)            -> required by Docker Desktop (reboot needed)
    3. Visual Studio Build Tools (C++ workload) -> required by Rust / Tauri
    4. Node.js LTS (into B:\nodejs) + pnpm via corepack
    5. Rust (rustup, stable toolchain)
    6. FFmpeg
    7. Docker Desktop (WSL 2 backend, data on drive B:)
  Not installed yet (needed from Phase 3): Android Studio / SDK, JDK 17.

  Log: install-log.txt in project root.
#>

$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'

# ---------------- self-elevate ----------------
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Write-Host "Requesting administrator rights. A new window will open..." -ForegroundColor Yellow
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
  } catch {
    Write-Host "Elevation was cancelled. Nothing was installed." -ForegroundColor Red
    Start-Sleep -Seconds 4
  }
  exit
}

# ---------------- settings ----------------
# All tools live in B:\develop (see B:\develop\README.txt)
$DevRoot       = 'B:\develop'
$NodeDir       = "$DevRoot\nodejs"
$NpmGlobalDir  = "$DevRoot\npm-global"
$PnpmStoreDir  = "$DevRoot\pnpm-store"
$CargoHome     = "$DevRoot\rust\cargo"
$RustupHome    = "$DevRoot\rust\rustup"
$FfmpegDir     = "$DevRoot\ffmpeg"
$DockerDataDir = "$DevRoot\docker-data"
New-Item -ItemType Directory -Force -Path $DevRoot | Out-Null
$MinNodeMajor  = 22

$root = Split-Path -Parent $PSScriptRoot
$log  = Join-Path $root 'install-log.txt'
try { Start-Transcript -Path $log -Force | Out-Null } catch {}

$summary      = [ordered]@{}
$rebootNeeded = $false

function Step([string]$t) { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }
function Ok([string]$m)   { Write-Host "  [OK] $m" -ForegroundColor Green }
function Warn([string]$m) { Write-Host "  [!]  $m" -ForegroundColor Yellow }
function Fail([string]$m) { Write-Host "  [X]  $m" -ForegroundColor Red }

function Refresh-Path {
  $m = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $u = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$m;$u"
  $ch = [Environment]::GetEnvironmentVariable('CARGO_HOME', 'User')
  if (-not $ch) { $ch = Join-Path $env:USERPROFILE '.cargo' }
  $cargo = Join-Path $ch 'bin'
  if ((Test-Path $cargo) -and ($env:Path -notlike "*$cargo*")) { $env:Path = "$env:Path;$cargo" }
}

function Has([string]$exe) { [bool](Get-Command $exe -ErrorAction SilentlyContinue) }

function First-Line([string]$exe, [string[]]$cargs) {
  try { return ((& $exe @cargs 2>&1) | Select-Object -First 1 | ForEach-Object { "$_" }) } catch { return '' }
}

function Winget-Install([string]$id, [string[]]$extra = @()) {
  $a = @('install', '--id', $id, '-e', '--source', 'winget',
         '--accept-package-agreements', '--accept-source-agreements',
         '--disable-interactivity', '--silent') + $extra
  Write-Host "  > winget $($a -join ' ')" -ForegroundColor DarkGray
  & winget @a
  $code = $LASTEXITCODE
  Refresh-Path
  return $code
}

# ---------------- 0. winget ----------------
Step "0. Checking winget"
if (-not (Has 'winget')) {
  Fail "winget not found. Install 'App Installer' from Microsoft Store and run again."
  Read-Host "Press Enter to close"
  exit 1
}
Ok (First-Line 'winget' @('--version'))
& winget source update --disable-interactivity | Out-Null

# ---------------- 1. long paths ----------------
Step "1. Long paths (node_modules in a monorepo)"
try {
  Set-ItemProperty -Path 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name 'LongPathsEnabled' -Value 1 -Type DWord
  Ok "Windows LongPathsEnabled = 1"
} catch { Warn "Could not set LongPathsEnabled: $($_.Exception.Message)" }
if (Has 'git') { & git config --global core.longpaths true; Ok "git core.longpaths = true" }
$summary['Long paths'] = 'enabled'

# ---------------- 2. WSL ----------------
Step "2. WSL 2 (required by Docker Desktop)"
cmd /c "wsl.exe --status >nul 2>&1"
if ($LASTEXITCODE -eq 0) {
  Ok "WSL already installed"
  cmd /c "wsl.exe --update >nul 2>&1"
  $summary['WSL'] = 'installed'
} else {
  & wsl.exe --install --no-distribution
  if ($LASTEXITCODE -eq 0) {
    $rebootNeeded = $true
    Ok "WSL installed - REBOOT REQUIRED"
    $summary['WSL'] = 'installed now (reboot required)'
  } else {
    Fail "WSL install failed (exit $LASTEXITCODE). Check that virtualization is enabled in BIOS."
    $summary['WSL'] = 'FAILED'
  }
}

# ---------------- 3. VS Build Tools ----------------
Step "3. Visual Studio Build Tools, C++ workload (required by Rust/Tauri)"
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
function Has-ModernVC {
  if (-not (Test-Path $vswhere)) { return $false }
  $r = & $vswhere -products * -version 17.0 -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
  return [bool]$r
}
if (Has-ModernVC) {
  Ok "Build Tools 2022+ with C++ already installed"
  $summary['VS Build Tools'] = 'installed'
} else {
  Write-Host "  Installing (~6-8 GB on C:, may take 10-20 min)..."
  $code = Winget-Install 'Microsoft.VisualStudio.2022.BuildTools' @(
    '--override', '--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended')
  if ($code -eq 3010) { $rebootNeeded = $true }
  if (Has-ModernVC) { Ok "Build Tools installed"; $summary['VS Build Tools'] = 'installed now' }
  else { Fail "Build Tools not detected after install (exit $code)"; $summary['VS Build Tools'] = 'FAILED' }
}

# ---------------- 4. Node.js + pnpm ----------------
Step "4. Node.js LTS + pnpm"
function Node-Major {
  if (-not (Has 'node')) { return 0 }
  $v = First-Line 'node' @('--version')
  if ($v -match '^v(\d+)') { return [int]$Matches[1] } else { return 0 }
}
$nm = Node-Major
if ($nm -ge $MinNodeMajor) {
  Ok "Node.js $(First-Line 'node' @('--version')) is new enough"
} else {
  Write-Host "  Current Node.js major: $nm, need >= $MinNodeMajor. Installing LTS into $NodeDir ..."
  $code = Winget-Install 'OpenJS.NodeJS.LTS' @('--location', $NodeDir)
  $nm = Node-Major
  if ($nm -ge $MinNodeMajor) { Ok "Node.js $(First-Line 'node' @('--version'))" }
  else {
    Fail "Node.js is still v$nm after install (exit $code)."
    Write-Host "  node.exe found at:"
    Get-Command node -All -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $($_.Source)" }
    Write-Host "  Fix: download LTS installer from https://nodejs.org and install into $NodeDir"
  }
}
$summary['Node.js'] = (First-Line 'node' @('--version'))

$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = '0'
if (-not (Has 'pnpm')) {
  if (Has 'corepack') {
    & corepack enable pnpm
    Refresh-Path
  }
  if (-not (Has 'pnpm') -and (Has 'npm')) {
    Warn "corepack did not provide pnpm, installing via npm into $NpmGlobalDir"
    New-Item -ItemType Directory -Force -Path $NpmGlobalDir | Out-Null
    & npm config set prefix $NpmGlobalDir --location=user
    $up = [Environment]::GetEnvironmentVariable('Path', 'User')
    if ($up -notlike "*$NpmGlobalDir*") { [Environment]::SetEnvironmentVariable('Path', "$up;$NpmGlobalDir", 'User') }
    Refresh-Path
    & npm install -g pnpm@latest --allow-scripts=pnpm
    Refresh-Path
  }
}
if (Has 'pnpm') { & pnpm config set store-dir $PnpmStoreDir --global; $pv = First-Line 'pnpm' @('--version'); Ok "pnpm $pv"; $summary['pnpm'] = $pv }
else { Fail "pnpm not available"; $summary['pnpm'] = 'FAILED' }

# ---------------- 5. Rust ----------------
Step "5. Rust (rustup + stable toolchain)"
if (-not (Has 'rustup')) {
  [Environment]::SetEnvironmentVariable('CARGO_HOME', $CargoHome, 'User')
  [Environment]::SetEnvironmentVariable('RUSTUP_HOME', $RustupHome, 'User')
  $env:CARGO_HOME = $CargoHome; $env:RUSTUP_HOME = $RustupHome
  $code = Winget-Install 'Rustlang.Rustup'
  Refresh-Path
}
if (Has 'rustup') {
  & rustup default stable
  cmd /c "rustup update stable --no-self-update >nul 2>&1"
  Refresh-Path
}
if (Has 'rustc') { $rv = First-Line 'rustc' @('--version'); Ok $rv; $summary['Rust'] = $rv }
else { Fail "rustc not available"; $summary['Rust'] = 'FAILED' }

# ---------------- 6. FFmpeg ----------------
Step "6. FFmpeg"
if (-not (Has 'ffmpeg')) { $code = Winget-Install 'Gyan.FFmpeg' @('--location', $FfmpegDir) }
if (Has 'ffmpeg') { $fv = First-Line 'ffmpeg' @('-hide_banner', '-version'); Ok $fv; $summary['FFmpeg'] = $fv }
else { Warn "ffmpeg not on PATH yet - open a new terminal and check 'ffmpeg -version'"; $summary['FFmpeg'] = 'installed? (new terminal needed)' }

# ---------------- 7. Docker Desktop ----------------
Step "7. Docker Desktop (WSL 2 backend, data on B:)"
$dockerExe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
if ((Test-Path $dockerExe) -or (Has 'docker')) {
  Ok "Docker Desktop already installed"
  $summary['Docker Desktop'] = 'installed'
} else {
  New-Item -ItemType Directory -Path $DockerDataDir -Force | Out-Null
  $code = Winget-Install 'Docker.DockerDesktop' @(
    '--override', "install --quiet --accept-license --backend=wsl-2 --wsl-default-data-root=$DockerDataDir")
  if (Test-Path $dockerExe) {
    Ok "Docker Desktop installed (data: $DockerDataDir)"
    $summary['Docker Desktop'] = 'installed now'
    $rebootNeeded = $true
  } else {
    Fail "Docker Desktop not detected after install (exit $code)"
    $summary['Docker Desktop'] = 'FAILED'
  }
}
cmd /c "net localgroup docker-users `"$env:USERNAME`" /add >nul 2>&1"

# ---------------- summary ----------------
Step "SUMMARY"
foreach ($k in $summary.Keys) { Write-Host ("  {0,-16} {1}" -f $k, $summary[$k]) }
Write-Host ""
Write-Host "  Not installed yet (needed from Phase 3, Android): Android Studio + SDK, JDK 17." -ForegroundColor DarkGray
Write-Host "  Log: $log" -ForegroundColor DarkGray
Write-Host ""
if ($rebootNeeded) {
  Write-Host "  REBOOT REQUIRED. After reboot:" -ForegroundColor Yellow
  Write-Host "    1) start Docker Desktop once and accept the terms" -ForegroundColor Yellow
  Write-Host "    2) run check-env.bat again" -ForegroundColor Yellow
} else {
  Write-Host "  Done. Open a NEW terminal and run check-env.bat." -ForegroundColor Green
}
try { Stop-Transcript | Out-Null } catch {}
Read-Host "Press Enter to close"
