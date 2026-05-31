<#
.SYNOPSIS
  pentesterflow online installer (Windows).

.DESCRIPTION
  Downloads the standalone Windows binary from the latest GitHub release,
  verifies its SHA-256, installs it under %LOCALAPPDATA%\Programs\pentesterflow,
  and adds that directory to your user PATH.

  Run:
    irm https://raw.githubusercontent.com/pentesterflow/agent/main/install.ps1 | iex

.NOTES
  Environment overrides:
    $env:PENTESTERFLOW_VERSION     = 'v0.1.0'   # pin a release (default: latest)
    $env:PENTESTERFLOW_INSTALL_DIR = 'C:\path'  # install location
#>

#Requires -Version 5
$ErrorActionPreference = 'Stop'

$Repo = 'pentesterflow/agent'
$Bin  = 'pentesterflow'

# --- detect arch (only windows-x64 is published) -------------------------
if (-not [Environment]::Is64BitOperatingSystem) {
  throw 'unsupported architecture: only 64-bit Windows (x64) is published.'
}
$asset = "$Bin-windows-x64.exe"

$ver = if ($env:PENTESTERFLOW_VERSION) { $env:PENTESTERFLOW_VERSION } else { 'latest' }
$base = if ($ver -eq 'latest') {
  "https://github.com/$Repo/releases/latest/download"
} else {
  "https://github.com/$Repo/releases/download/$ver"
}

$dir = if ($env:PENTESTERFLOW_INSTALL_DIR) {
  $env:PENTESTERFLOW_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA 'Programs\pentesterflow'
}
New-Item -ItemType Directory -Force -Path $dir | Out-Null

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $download = Join-Path $tmp $asset

  Write-Host "downloading $asset ($ver)..."
  Invoke-WebRequest -Uri "$base/$asset" -OutFile $download -UseBasicParsing

  # --- verify checksum (best-effort) -------------------------------------
  try {
    $sums = (Invoke-WebRequest -Uri "$base/SHA256SUMS" -UseBasicParsing).Content
    $line = $sums -split "`n" |
      Where-Object { $_ -match "\s$([regex]::Escape($asset))\s*$" } |
      Select-Object -First 1
    if ($line) {
      $want = ($line -replace '\s.*$', '').Trim().ToLower()
      $got  = (Get-FileHash -Algorithm SHA256 -Path $download).Hash.ToLower()
      if ($got -ne $want) { throw "checksum mismatch for $asset (expected $want, got $got)" }
      Write-Host 'checksum ok'
    }
  } catch {
    Write-Warning "checksum verification skipped: $($_.Exception.Message)"
  }

  $dest = Join-Path $dir "$Bin.exe"
  Copy-Item -Force -Path $download -Destination $dest
  Write-Host "installed $Bin -> $dest"

  # --- add to user PATH --------------------------------------------------
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not ($userPath -split ';' | Where-Object { $_ -eq $dir })) {
    $newPath = if ([string]::IsNullOrEmpty($userPath)) { $dir } else { "$userPath;$dir" }
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
    $env:Path = "$env:Path;$dir"
    Write-Host "added $dir to your user PATH (open a new terminal for it to take effect)"
  }

  & $dest --version
} finally {
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
}
