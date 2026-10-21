#Requires -Version 7
[CmdletBinding()]
param(
  # Cloud-only one-time provenance audit. Never stages a Tauri runtime and never
  # counts as approval of a new hash.
  [switch]$AuditOnly
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Windows 7 validated WebView2 Fixed Runtime. This is a historical FIXED CAB,
# not the Evergreen installer. Do not silently use the newest runtime.
# Its original Microsoft CDN link now returns HTTP 404. The locked URL points
# to a version-specific third-party archive: the audit MUST validate the full
# CAB, the embedded Microsoft's digital signature, product version, and files.
# A release MUST additionally match the maintainer-approved pinned SHA-256.
$version = '109.0.1518.78'
$lockPath = Join-Path (Join-Path $PSScriptRoot '..\..') 'native\webview2-109-lock.json'
$lock = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json
if ($lock.version -ne $version -or $lock.arch -ne 'x64' -or $lock.format -ne 'cab') {
  throw 'Invalid native/webview2-109-lock.json. Expected WebView2 109.0.1518.78 x64 CAB.'
}
$source = [string]$lock.url
# A one-time per-repository override is allowed only if still checksum-pinned.
$override = $env:UXPLAY_WEBVIEW109_URL
if (![string]::IsNullOrWhiteSpace($override)) { $source = $override }
$uri = [uri]$source
if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Fragment -or $uri.AbsolutePath -notmatch '\.(cab|zip)$') {
  throw 'WebView2 archive URL must be a credential-free HTTPS .cab or .zip without a fragment.'
}
$format = [System.IO.Path]::GetExtension($uri.AbsolutePath).TrimStart('.').ToLowerInvariant()
# The hash must come from independent review and be pinned in source control
# (or supplied by a previously configured repository variable).
$expected = if (![string]::IsNullOrWhiteSpace($env:UXPLAY_WEBVIEW109_SHA256)) {
  $env:UXPLAY_WEBVIEW109_SHA256.Trim().ToLowerInvariant()
} else { [string]$lock.sha256 }
if (!$AuditOnly -and $expected -notmatch '^[0-9a-f]{64}$') {
  throw 'BLOCKED: WebView2 109 archive SHA-256 has not been approved. Run Actions > Audit WebView2 109 CAB hash (one-time), review the Microsoft Authenticode/version report, then set native/webview2-109-lock.json sha256 to the reported 64-hex value. Do not disable this gate.'
}
if ($expected -and $expected -notmatch '^[a-fA-F0-9]{64}$') {
  throw 'WebView2 109 SHA-256, if provided, must have exactly 64 hexadecimal characters.'
}

$temp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [System.IO.Path]::GetTempPath() }
$work = Join-Path $temp 'uxplay-webview109'
$archive = Join-Path $work "webview109.$format"
$unpacked = Join-Path $work 'extracted'
$dest = Join-Path (Join-Path $PSScriptRoot '..\..') 'src-tauri\webview2-109'
if (Test-Path -LiteralPath $dest) {
  throw "Refusing to overwrite an existing WebView2 runtime: $dest"
}
if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
New-Item -ItemType Directory -Path $unpacked -Force | Out-Null
Write-Host "[webview109] Downloading historical Fixed Runtime ($version x64, $format) from $($uri.Host)"
if ($uri.Host -eq 'github.com') {
  Write-Host '[webview109] WARNING: third-party historical archive; validate Microsoft signature/version and pin the full CAB SHA-256 before release.'
}
try {
  Invoke-WebRequest -Uri $uri.AbsoluteUri -OutFile $archive -MaximumRedirection 5
} catch {
  $status = if ($_.Exception.Response) { [string][int]$_.Exception.Response.StatusCode } else { 'unknown' }
  throw "BLOCKED: Could not retrieve WebView2 $version Fixed Runtime CAB (HTTP $status) from $($uri.Host). Check the locked URL and asset availability. Do not replace with Evergreen or disable SHA-256/signature checks. Details: $($_.Exception.Message)"
}
if ((Get-Item -LiteralPath $archive).Length -lt 50MB) {
  throw 'BLOCKED: WebView2 109 CAB unexpectedly small. Refusing a truncated/archive-placeholder response.'
}
$actual = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
if (!$AuditOnly -and $actual -ne $expected.ToLowerInvariant()) {
  throw "WebView2 109 SHA-256 mismatch. Expected $expected, actual $actual. No installer will be produced."
}
if ($expected -and $actual -ne $expected.ToLowerInvariant()) {
  throw "WebView2 109 SHA-256 mismatch. Expected $expected, actual $actual"
}
if ($format -eq 'cab') {
  # Use Windows expand.exe, NOT Expand-Archive (which only accepts ZIP).
  & "$env:SystemRoot\System32\expand.exe" '-F:*' $archive $unpacked | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "WebView2 CAB extraction failed (expand exit $LASTEXITCODE)" }
} else {
  Expand-Archive -LiteralPath $archive -DestinationPath $unpacked -Force
}
$executables = @(Get-ChildItem -LiteralPath $unpacked -Filter 'msedgewebview2.exe' -File -Recurse)
if ($executables.Count -ne 1) {
  throw "Expected exactly one msedgewebview2.exe, found $($executables.Count)"
}
$exe = $executables[0]
$ver = [string]$exe.VersionInfo.ProductVersion
if ($ver -notmatch '^109\.0\.1518\.78(?:$|\s)') {
  throw "Expected WebView2 $version, found $ver"
}
# This audit helps detect unofficial repackaged binaries, but does NOT replace
# the pinned archive SHA-256 requirement during packaging.
$signature = Get-AuthenticodeSignature -LiteralPath $exe.FullName
$signer = [string]$signature.SignerCertificate.Subject
if ($signature.Status -ne 'Valid' -or $signer -notmatch 'O=Microsoft Corporation') {
  throw "WebView2 main executable lacks a valid Microsoft Authenticode signature: status=$($signature.Status), signer=$signer"
}
$runtime = $exe.DirectoryName
foreach ($required in @('msedgewebview2.exe', 'msedge.dll', 'icudtl.dat')) {
  if (!(Test-Path -LiteralPath (Join-Path $runtime $required) -PathType Leaf)) {
    throw "Incomplete WebView2 Fixed Runtime: missing $required"
  }
}
if (!(Test-Path -LiteralPath (Join-Path $runtime 'locales') -PathType Container)) {
  throw 'Incomplete WebView2 Fixed Runtime: missing locales directory'
}
Write-Host "[webview109] Verified version=$ver; Microsoft signature=$($signature.Status); signer=$signer"
Write-Host "[webview109] Archive SHA-256=$actual"
if ($AuditOnly) {
  Write-Host '[webview109] AUDIT ONLY. No runtime was staged; no release was built.'
  Write-Host "[webview109] After reviewing the official Microsoft source, pin this in native/webview2-109-lock.json: `"sha256`": `"$actual`""
  return
}
New-Item -ItemType Directory -Path $dest -Force | Out-Null
try {
  Get-ChildItem -LiteralPath $runtime -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
  }
  foreach ($required in @('msedgewebview2.exe', 'msedge.dll', 'icudtl.dat')) {
    if (!(Test-Path -LiteralPath (Join-Path $dest $required) -PathType Leaf)) {
      throw "Staging failed: $required is not at the Tauri fixedRuntime root"
    }
  }
} catch {
  Remove-Item -LiteralPath $dest -Recurse -Force -ErrorAction SilentlyContinue
  throw
}
Write-Host "[webview109] PASS: pinned $version x64 Fixed Runtime staged at $dest (SHA-256 $actual)"
