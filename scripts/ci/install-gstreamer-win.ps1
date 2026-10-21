#Requires -Version 7
$ErrorActionPreference = 'Stop'
# 1.24.13 MinGW x64 is the already Win7-tested SDK. Do not replace with a
# floating GStreamer/MSYS2 package. Validate each official MSI before use.
$base = 'https://gstreamer.freedesktop.org/pkg/windows/1.24.13/mingw'
$names = @(
  'gstreamer-1.0-mingw-x86_64-1.24.13.msi',
  'gstreamer-1.0-devel-mingw-x86_64-1.24.13.msi'
)
$tempRoot = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$downloads = Join-Path $tempRoot 'uxplay-gst-msi'
$drive = if ($env:SystemDrive) { $env:SystemDrive.TrimEnd('\') } else { 'C:' }
# GStreamer 1.24 MSI uses INSTALLDIR as an installation PREFIX, NOT as
# the final SDK root. The installer creates 1.0\mingw_x86_64 below it.
# 1.26 changed the semantics of INSTALLDIR: do not apply its behavior here.
# A private prefix keeps us away from SDKs preinstalled by runner images.
$installPrefix = "${drive}\uxplay-gstreamer-1.24.13"
if (Test-Path -LiteralPath $installPrefix) {
  throw "Refusing to reuse pre-existing GStreamer installation prefix: $installPrefix"
}
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
Write-Host "[gst] Isolated GStreamer 1.24.13 MSI install prefix: $installPrefix"

function Show-InstallerFailure([string]$name, [string]$log, [int]$code) {
  Write-Host "[gst] Installer failure: $name (exit $code), log: $log"
  if (Test-Path -LiteralPath $log) {
    Get-Content -LiteralPath $log -Tail 120 | ForEach-Object { Write-Host $_ }
  }
  throw "GStreamer MSI installation failed: $name (exit $code; see $log)"
}

foreach ($name in $names) {
  $file = Join-Path $downloads $name
  $sum = "$file.sha256sum"
  $log = Join-Path $downloads "$name.install.log"
  Write-Host "[gst] Downloading $name with published checksum"
  Invoke-WebRequest -Uri "$base/$name.sha256sum" -OutFile $sum
  $line = (Get-Content -LiteralPath $sum -Raw).Trim()
  if ($line -notmatch '(?i)\b([a-f0-9]{64})\b') { throw "Missing upstream SHA-256 for $name" }
  $expected = $Matches[1].ToLowerInvariant()
  Invoke-WebRequest -Uri "$base/$name" -OutFile $file
  $actual = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actual -ne $expected) { throw "SHA-256 mismatch: $name" }
  Write-Host "[gst] Verified $name ($actual); installing all features; log: $log"

  # The 1.24 MSI generation accepts INSTALLDIR. Explicit ADDLOCAL=ALL is
  # necessary for libav/H.264/AAC on unattended builds (default features vary).
  # Use a single well-quoted argument string: msiexec otherwise can return 1639.
  $arguments = '/i "{0}" /qn /norestart ADDLOCAL=ALL INSTALLDIR="{1}" /L*v "{2}"' -f $file, $installPrefix, $log
  $proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -Wait -PassThru -NoNewWindow
  if ($proc.ExitCode -notin @(0, 3010)) { Show-InstallerFailure $name $log $proc.ExitCode }
  Write-Host "[gst] Installer returned $($proc.ExitCode): $name"
}

# Resolve ONLY inside the isolated installation prefix. GStreamer 1.24 MSI
# may create <prefix>\1.0\mingw_x86_64; do not pick preinstalled SDKs from
# C:\gstreamer, Program Files, machine environment variables, or PATH.
# Runtime and Development must have landed in the SAME complete SDK root.
if (!(Test-Path -LiteralPath $installPrefix)) {
  throw "Both MSI installers returned success but did not create $installPrefix"
}
$candidates = @(
  Get-ChildItem -LiteralPath $installPrefix -Filter 'gst-inspect-1.0.exe' -File -Recurse -ErrorAction Stop |
    Where-Object { $_.Directory.Name -eq 'bin' -and $_.Directory.Parent.Name -eq 'mingw_x86_64' } |
    ForEach-Object { Split-Path -Parent $_.Directory.FullName } |
    Select-Object -Unique
)
$validRoots = @($candidates | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_ 'bin\gst-inspect-1.0.exe')) -and
    (Test-Path -LiteralPath (Join-Path $_ 'lib\pkgconfig\gstreamer-1.0.pc')) -and
    (Test-Path -LiteralPath (Join-Path $_ 'include\gstreamer-1.0\gst\gst.h'))
  })
if ($validRoots.Count -ne 1) {
  Write-Host "[gst] Expected one complete SDK beneath $installPrefix; discovered $($validRoots.Count). Candidate roots: $($candidates -join ', ')"
  Get-ChildItem -LiteralPath $downloads -Filter '*.install.log' |
    ForEach-Object { Write-Host "[gst] Installer log: $($_.FullName)" }
  throw 'Both GStreamer MSI installers returned success, but the isolated installation did not yield one complete 1.24.13 MinGW x64 SDK.'
}
$root = $validRoots[0]
Write-Host "[gst] Selected isolated SDK root: $root"
$inspect = Join-Path $root 'bin\gst-inspect-1.0.exe'
$pluginDir = Join-Path $root 'lib\gstreamer-1.0'
if (!(Test-Path -LiteralPath (Join-Path $pluginDir 'libgstlibav.dll'))) {
  throw "GStreamer 1.24.13 libav plugin missing under $root. MSI logs: $downloads"
}

$env:PATH = "$(Join-Path $root 'bin');$env:PATH"
$scanner = Join-Path $root 'libexec\gstreamer-1.0\gst-plugin-scanner.exe'
if (!(Test-Path -LiteralPath $scanner)) {
  throw "GStreamer plugin scanner missing under selected SDK: $scanner"
}
$env:GST_PLUGIN_PATH = $pluginDir
$env:GST_PLUGIN_SYSTEM_PATH = $pluginDir
$env:GST_PLUGIN_PATH_1_0 = $pluginDir
$env:GST_PLUGIN_SYSTEM_PATH_1_0 = $pluginDir
$env:GST_PLUGIN_SCANNER_1_0 = $scanner
$env:GST_REGISTRY_1_0 = Join-Path $tempRoot 'uxplay-gst-ci-registry.bin'
$version = & $inspect --version
if ($LASTEXITCODE -ne 0 -or ($version -join "`n") -notmatch '\b1\.24\.13\b') {
  throw "Unexpected GStreamer runtime version at $root ($($version -join '; '))"
}
foreach ($target in @('avdec_h264', 'avdec_aac')) {
  & $inspect $target | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "GStreamer plugin smoke failed: $target at $root" }
}
if ($env:GITHUB_ENV) {
  "UXPLAY_GST_RUNTIME=$root" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
  "GSTREAMER_1_0_ROOT_MINGW_X86_64=$root" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8
}
if ($env:GITHUB_PATH) {
  (Join-Path $root 'bin') | Out-File -FilePath $env:GITHUB_PATH -Append -Encoding utf8
}
Write-Host "[gst] PASS: complete verified GStreamer 1.24.13 MinGW SDK at $root (H.264/AAC libav present)"
