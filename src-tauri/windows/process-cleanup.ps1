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
function Get-ScopedProcesses {
  $items = @(Get-WmiObject Win32_Process -Filter "Name='Airpimo.exe' OR Name='uxplay.exe'" -ErrorAction Stop)
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
  foreach ($item in $running) {
    if ($item.Name -ieq 'Airpimo.exe') {
      $appProcess = Get-Process -Id ([int]$item.ProcessId) -ErrorAction SilentlyContinue
      if ($null -ne $appProcess) { $null = $appProcess.CloseMainWindow() }
    }
  }
  if ($running.Count -gt 0) { Start-Sleep -Milliseconds 500 }
  foreach ($item in @(Get-ScopedProcesses)) {
    # Scoped to installation root; exit if access is denied instead of ignoring locks.
    $result = $item.Terminate()
    if ($null -ne $result -and $result.ReturnValue -ne 0 -and $result.ReturnValue -ne 9) { exit 5 }
  }
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    if (@(Get-ScopedProcesses).Count -eq 0) { exit 0 }
    Start-Sleep -Milliseconds 250
  }
} catch { exit 5 }
exit 5
