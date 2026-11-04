# Environment check for music-platform development.
# Writes report to env-report.txt in the project root.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
$out  = Join-Path $root 'env-report.txt'
$lines = New-Object System.Collections.Generic.List[string]
function Add([string]$s) { $lines.Add($s) | Out-Null }

Add "=== ENV REPORT $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ==="
Add ""

$checks = @(
  @('node',           'node',    @('--version')),
  @('npm',            'npm',     @('--version')),
  @('pnpm',           'pnpm',    @('--version')),
  @('corepack',       'corepack',@('--version')),
  @('git',            'git',     @('--version')),
  @('docker',         'docker',  @('--version')),
  @('docker compose', 'docker',  @('compose','version')),
  @('docker engine',  'docker',  @('info','--format','{{.ServerVersion}}')),
  @('rustc',          'rustc',   @('--version')),
  @('cargo',          'cargo',   @('--version')),
  @('rustup',         'rustup',  @('--version')),
  @('python',         'python',  @('--version')),
  @('py launcher',    'py',      @('--list')),
  @('uv',             'uv',      @('--version')),
  @('ffmpeg',         'ffmpeg',  @('-hide_banner','-version')),
  @('java',           'java',    @('-version')),
  @('adb',            'adb',     @('--version')),
  @('eas-cli',        'eas',     @('--version')),
  @('winget',         'winget',  @('--version')),
  @('choco',          'choco',   @('--version')),
  @('just',           'just',    @('--version'))
)

foreach ($c in $checks) {
  $name = $c[0]; $exe = $c[1]; $cargs = $c[2]
  Add "--- $name ---"
  $cmd = Get-Command $exe -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $cmd) { if ($exe -eq 'corepack') { Add "NOT INSTALLED (expected: removed from Node.js 25+)" } else { Add "NOT INSTALLED" }; Add ""; continue }
  Add "path: $($cmd.Source)"
  try {
    $res = & $exe @cargs 2>&1 | Select-Object -First 3 | ForEach-Object { "$_" }
    foreach ($r in $res) { Add $r }
  } catch { Add "ERROR: $($_.Exception.Message)" }
  Add ""
}

Add "--- wsl ---"
# wsl.exe prints UTF-16LE; switch console decoding temporarily
$prevEnc = [Console]::OutputEncoding
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::Unicode
  $w = & wsl.exe --status 2>&1 | ForEach-Object { "$_" } | Where-Object { $_.Trim() } | Select-Object -First 4
  if ($LASTEXITCODE -ne 0) { Add "NOT INSTALLED (exit $LASTEXITCODE)" }
  foreach ($l in $w) { Add $l }
} catch { Add "NOT INSTALLED" } finally { [Console]::OutputEncoding = $prevEnc }
Add ""

Add "--- MSVC Build Tools (Rust/Tauri) ---"
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path $vswhere) {
  $vs = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property displayName
  if ($vs) { $vs | ForEach-Object { Add $_ } } else { Add "Visual Studio found, but C++ build tools component NOT installed" }
} else { Add "NOT INSTALLED" }
Add ""

Add "--- WebView2 Runtime (Tauri) ---"
$wv = $null
foreach ($k in @('HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
                 'HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')) {
  try { $wv = (Get-ItemProperty $k -ErrorAction Stop).pv; break } catch {}
}
if ($wv) { Add "version: $wv" } else { Add "NOT FOUND" }
Add ""

Add "--- Android SDK ---"
Add "ANDROID_HOME=$env:ANDROID_HOME"
$sdk = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (Test-Path $sdk) { Add "Found: $sdk" } else { Add "Not found: $sdk" }
Add ""

Add "--- System ---"
try {
  $os  = Get-CimInstance Win32_OperatingSystem
  $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
  Add "OS: $($os.Caption) $($os.Version)"
  Add "CPU: $($cpu.Name) ($($cpu.NumberOfLogicalProcessors) threads)"
  Add ("RAM GB: {0} (free {1})" -f [math]::Round($os.TotalVisibleMemorySize/1MB,1), [math]::Round($os.FreePhysicalMemory/1MB,1))
  Add "Virtualization in firmware: $($cpu.VirtualizationFirmwareEnabled)"
  Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -ne $null } | ForEach-Object {
    Add ("Disk {0}: free GB {1}" -f $_.Name, [math]::Round($_.Free/1GB,1))
  }
} catch { Add "ERROR: $($_.Exception.Message)" }

[System.IO.File]::WriteAllLines($out, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Report saved to: $out"
