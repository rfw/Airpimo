# Windows PowerShell 2-5 compatible; invoked by NSIS with scoped install root.
# Never terminate an arbitrary process solely because it is named uxplay.exe.
$root = $env:AIRPIMO_INSTALL_DIR
if ([string]::IsNullOrEmpty($root)) { exit 3 }
try { $root = [IO.Path]::GetFullPath($root).TrimEnd('\') } catch { exit 3 }
if ($root.Length -lt 4) { exit 3 }
$targets = @(
  [IO.Path]::Combine($root, 'Airpimo.exe'),
  [IO.Path]::Combine($root, 'sidecar\uxplay.exe'),
  [IO.Path]::Combine($root, 'resources\sidecar\uxplay.exe')
)
# A clean install or a previously deleted installation has nothing to stop.
# Do not require working WMI just to create a new installation directory.
$hasInstalledExecutable = $false
foreach ($target in $targets) {
  if ([IO.File]::Exists($target)) { $hasInstalledExecutable = $true; break }
}
if (-not $hasInstalledExecutable) { exit 0 }
function Get-ScopedProcesses {
  # Win7 WMI can fail even after every Airpimo process has exited. Use the
  # native process snapshot first and only invoke WMI when a candidate exists.
  # We still require an exact executable-path match before terminating anything.
  $candidates = @(Get-Process -ErrorAction Stop | Where-Object {
    $_.ProcessName -ieq 'Airpimo' -or $_.ProcessName -ieq 'uxplay'
  })
  if ($candidates.Count -eq 0) { return }
  try {
    $items = @(Get-WmiObject Win32_Process -Filter "Name='Airpimo.exe' OR Name='uxplay.exe'" -ErrorAction Stop)
  } catch {
    throw "WMI query failed while candidate process names exist: $($_.Exception.Message)"
  }
  foreach ($item in $items) {
    if ($null -eq $item.ExecutablePath) { continue }
    foreach ($target in $targets) {
      if ([string]::Equals($item.ExecutablePath, $target, [StringComparison]::OrdinalIgnoreCase)) {
        Write-Output $item
        break
      }
    }
  }
}
try {
  $running = @(Get-ScopedProcesses)
  # Do not call CloseMainWindow here: with "stay in tray" enabled it only
  # hides Airpimo, wasting time before termination. WMI objects below were
  # already verified against this exact installation path.
  foreach ($item in $running) {
    $result = $item.Terminate()
    if ($null -ne $result -and $result.ReturnValue -ne 0 -and $result.ReturnValue -ne 9) {
      throw "Terminate failed for PID $($item.ProcessId), WMI return code $($result.ReturnValue)"
    }
  }
  # Wait on the already identified PIDs using native process handles instead
  # of repeating a costly Win7 WMI query twenty times. Recheck exact paths once
  # before allowing the old installer's files to be removed.
  foreach ($item in $running) {
    $process = Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue
    if ($null -ne $process) {
      try { $null = $process.WaitForExit(2000) } catch { }
    }
  }
  if (@(Get-ScopedProcesses).Count -eq 0) { exit 0 }
  throw "Timed out waiting for scoped Airpimo/UxPlay processes to exit"
} catch {
  # Distinguish a WMI/script failure from an actual process still running.
  try {
    $log = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'Airpimo-installer-cleanup.log')
    [IO.File]::AppendAllText($log, "$(Get-Date -Format s) root=$root error=$($_.Exception.Message)`r`n")
  } catch { }
  exit 5
}
exit 5
