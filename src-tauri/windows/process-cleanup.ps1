# Windows PowerShell 2-5 compatible; invoked by NSIS with scoped install root.
# Never terminate an arbitrary process solely because it is named uxplay.exe.
$root = $env:AIRPIMO_INSTALL_DIR
if ([string]::IsNullOrEmpty($root)) { exit 3 }
try { $root = [IO.Path]::GetFullPath($root).TrimEnd('\') } catch { exit 3 }
if ($root.Length -lt 4) { exit 3 }
$targets = @(
  [IO.Path]::Combine($root, 'Airpimo.exe'),
  [IO.Path]::Combine($root, 'sidecar\uxplay.exe'),
  [IO.Path]::Combine($root, 'sidecar\AirpimoPlayer.exe'),
  [IO.Path]::Combine($root, 'resources\sidecar\uxplay.exe'),
  [IO.Path]::Combine($root, 'resources\sidecar\AirpimoPlayer.exe')
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
    $_.ProcessName -ieq 'Airpimo' -or $_.ProcessName -ieq 'uxplay' -or $_.ProcessName -ieq 'AirpimoPlayer'
  })
  if ($candidates.Count -eq 0) { return }
  try {
    $items = @(Get-WmiObject Win32_Process -Filter "Name='Airpimo.exe' OR Name='uxplay.exe' OR Name='AirpimoPlayer.exe'" -ErrorAction Stop)
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
  $terminationFailures = @()
  foreach ($item in $running) {
    try {
      $result = $item.Terminate()
      if ($null -ne $result -and $result.ReturnValue -ne 0 -and $result.ReturnValue -ne 9) {
        $terminationFailures += "PID $($item.ProcessId) WMI=$($result.ReturnValue)"
      }
    } catch {
      $terminationFailures += "PID $($item.ProcessId) exception=$($_.Exception.Message)"
    }
  }
  # A termination result can race with an independently exiting process.
  # Never fail just on a stale result; fail if and only if verification still
  # finds a process under this exact installation path after bounded waiting.
  # Terminate() can return before Win7 has completed all process shutdown.
  # The earlier single 2-second wait occasionally rejected an already-exiting
  # process, forcing the user to click Next a second time. Confirm termination
  # within a bounded window instead of treating one early snapshot as final.
  $deadline = [DateTime]::UtcNow.AddSeconds(12)
  while ($true) {
    $remaining = @(Get-ScopedProcesses)
    if ($remaining.Count -eq 0) { exit 0 }
    if ([DateTime]::UtcNow -ge $deadline) { break }
    # Wait on the verified PIDs only. We do not terminate by process name.
    # A process that disappears between WMI and Get-Process is not a failure.
    foreach ($item in $remaining) {
      $milliseconds = [int][Math]::Min(1000, [Math]::Max(1, ($deadline - [DateTime]::UtcNow).TotalMilliseconds))
      if ($milliseconds -le 0) { break }
      $process = Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue
      if ($null -ne $process) {
        try { $null = $process.WaitForExit($milliseconds) } catch { } finally { $process.Close() }
      }
    }
    if ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
  }
  # Final path-scoped verification is mandatory: never uninstall while a
  # process belonging to this exact installation is still running.
  $remaining = @(Get-ScopedProcesses)
  if ($remaining.Count -eq 0) { exit 0 }
  $details = (@($remaining | ForEach-Object { "$($_.Name) pid=$($_.ProcessId)" }) -join ', ')
  $failures = ($terminationFailures -join '; ')
  throw "Timed out waiting for scoped Airpimo/UxPlay processes to exit: $details; terminate=$failures"
} catch {
  # Distinguish a WMI/script failure from an actual process still running.
  try {
    $log = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'Airpimo-installer-cleanup.log')
    [IO.File]::AppendAllText($log, "$(Get-Date -Format s) root=$root error=$($_.Exception.Message)`r`n")
  } catch { }
  Write-Output "AIRPIMO_CLEANUP_ERROR: $($_.Exception.Message)"
  exit 5
}
exit 5
