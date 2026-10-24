; NSIS hooks shared by Windows 7 and Windows 10/11.
; Source of embedded UTF-16LE script: process-cleanup.ps1 (checked by tests).
; Banner is shown only for interactive maintenance-page cleanup, not on a
; normal install/uninstall hook. Avoid calling its plugin when none is open.
Var AirpimoPreparationBanner
!macro AIRPIMO_DISMISS_PREPARATION_BANNER
  ${If} $AirpimoPreparationBanner == "1"
    Banner::destroy
    StrCpy $AirpimoPreparationBanner 0
  ${EndIf}
!macroend
!macro AIRPIMO_STOP_INSTALLED_PROCESSES
  ; Scoped to $INSTDIR; no global taskkill /IM uxplay.exe.
  ; No installed executable means a clean or already-removed installation.
  ; Do not launch PowerShell/WMI on the first installation.
  ${If} ${FileExists} "$INSTDIR\Airpimo.exe"
  ${OrIf} ${FileExists} "$INSTDIR\sidecar\uxplay.exe"
  ${OrIf} ${FileExists} "$INSTDIR\resources\sidecar\uxplay.exe"
    InitPluginsDir
    ; PowerShell v2 can fail in nsExec when STDIN is redirected. The NSIS
    ; documentation also warns against launching a .ps1 directly from the
    ; PLUGINSDIR root. Use a child directory plus -InputFormat None.
    CreateDirectory "$PLUGINSDIR\AirpimoCleanup"
    ClearErrors
    FileOpen $R9 "$PLUGINSDIR\AirpimoCleanup\airpimo-cleanup.ps1" w
    ${If} ${Errors}
      !insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER
      MessageBox MB_ICONSTOP|MB_OK "$(airpimoCleanupCreateError)"
      Abort
    ${EndIf}
    FileWriteUTF16LE /BOM $R9 ""
    FileWriteUTF16LE $R9 "# Windows PowerShell 2-5 compatible; invoked by NSIS with scoped install root.$\r$\n"
    FileWriteUTF16LE $R9 "# Never terminate an arbitrary process solely because it is named uxplay.exe.$\r$\n"
    FileWriteUTF16LE $R9 "$$root = $$env:AIRPIMO_INSTALL_DIR$\r$\n"
    FileWriteUTF16LE $R9 "if ([string]::IsNullOrEmpty($$root)) { exit 3 }$\r$\n"
    FileWriteUTF16LE $R9 "try { $$root = [IO.Path]::GetFullPath($$root).TrimEnd('\') } catch { exit 3 }$\r$\n"
    FileWriteUTF16LE $R9 "if ($$root.Length -lt 4) { exit 3 }$\r$\n"
    FileWriteUTF16LE $R9 "$$targets = @($\r$\n"
    FileWriteUTF16LE $R9 "  [IO.Path]::Combine($$root, 'Airpimo.exe'),$\r$\n"
    FileWriteUTF16LE $R9 "  [IO.Path]::Combine($$root, 'sidecar\uxplay.exe'),$\r$\n"
    FileWriteUTF16LE $R9 "  [IO.Path]::Combine($$root, 'resources\sidecar\uxplay.exe')$\r$\n"
    FileWriteUTF16LE $R9 ")$\r$\n"
    FileWriteUTF16LE $R9 "# A clean install or a previously deleted installation has nothing to stop.$\r$\n"
    FileWriteUTF16LE $R9 "# Do not require working WMI just to create a new installation directory.$\r$\n"
    FileWriteUTF16LE $R9 "$$hasInstalledExecutable = $$false$\r$\n"
    FileWriteUTF16LE $R9 "foreach ($$target in $$targets) {$\r$\n"
    FileWriteUTF16LE $R9 "  if ([IO.File]::Exists($$target)) { $$hasInstalledExecutable = $$true; break }$\r$\n"
    FileWriteUTF16LE $R9 "}$\r$\n"
    FileWriteUTF16LE $R9 "if (-not $$hasInstalledExecutable) { exit 0 }$\r$\n"
    FileWriteUTF16LE $R9 "function Get-ScopedProcesses {$\r$\n"
    FileWriteUTF16LE $R9 "  # Win7 WMI can fail even after every Airpimo process has exited. Use the$\r$\n"
    FileWriteUTF16LE $R9 "  # native process snapshot first and only invoke WMI when a candidate exists.$\r$\n"
    FileWriteUTF16LE $R9 "  # We still require an exact executable-path match before terminating anything.$\r$\n"
    FileWriteUTF16LE $R9 "  $$candidates = @(Get-Process -ErrorAction Stop | Where-Object {$\r$\n"
    FileWriteUTF16LE $R9 "    $$_.ProcessName -ieq 'Airpimo' -or $$_.ProcessName -ieq 'uxplay'$\r$\n"
    FileWriteUTF16LE $R9 "  })$\r$\n"
    FileWriteUTF16LE $R9 "  if ($$candidates.Count -eq 0) { return }$\r$\n"
    FileWriteUTF16LE $R9 "  try {$\r$\n"
    FileWriteUTF16LE $R9 "    $$items = @(Get-WmiObject Win32_Process -Filter $\"Name='Airpimo.exe' OR Name='uxplay.exe'$\" -ErrorAction Stop)$\r$\n"
    FileWriteUTF16LE $R9 "  } catch {$\r$\n"
    FileWriteUTF16LE $R9 "    throw $\"WMI query failed while candidate process names exist: $$($$_.Exception.Message)$\"$\r$\n"
    FileWriteUTF16LE $R9 "  }$\r$\n"
    FileWriteUTF16LE $R9 "  foreach ($$item in $$items) {$\r$\n"
    FileWriteUTF16LE $R9 "    if ($$null -eq $$item.ExecutablePath) { continue }$\r$\n"
    FileWriteUTF16LE $R9 "    foreach ($$target in $$targets) {$\r$\n"
    FileWriteUTF16LE $R9 "      if ([string]::Equals($$item.ExecutablePath, $$target, [StringComparison]::OrdinalIgnoreCase)) {$\r$\n"
    FileWriteUTF16LE $R9 "        Write-Output $$item$\r$\n"
    FileWriteUTF16LE $R9 "        break$\r$\n"
    FileWriteUTF16LE $R9 "      }$\r$\n"
    FileWriteUTF16LE $R9 "    }$\r$\n"
    FileWriteUTF16LE $R9 "  }$\r$\n"
    FileWriteUTF16LE $R9 "}$\r$\n"
    FileWriteUTF16LE $R9 "try {$\r$\n"
    FileWriteUTF16LE $R9 "  $$running = @(Get-ScopedProcesses)$\r$\n"
    FileWriteUTF16LE $R9 "  # Do not call CloseMainWindow here: with $\"stay in tray$\" enabled it only$\r$\n"
    FileWriteUTF16LE $R9 "  # hides Airpimo, wasting time before termination. WMI objects below were$\r$\n"
    FileWriteUTF16LE $R9 "  # already verified against this exact installation path.$\r$\n"
    FileWriteUTF16LE $R9 "  foreach ($$item in $$running) {$\r$\n"
    FileWriteUTF16LE $R9 "    $$result = $$item.Terminate()$\r$\n"
    FileWriteUTF16LE $R9 "    if ($$null -ne $$result -and $$result.ReturnValue -ne 0 -and $$result.ReturnValue -ne 9) {$\r$\n"
    FileWriteUTF16LE $R9 "      throw $\"Terminate failed for PID $$($$item.ProcessId), WMI return code $$($$result.ReturnValue)$\"$\r$\n"
    FileWriteUTF16LE $R9 "    }$\r$\n"
    FileWriteUTF16LE $R9 "  }$\r$\n"
    FileWriteUTF16LE $R9 "  # Wait on the already identified PIDs using native process handles instead$\r$\n"
    FileWriteUTF16LE $R9 "  # of repeating a costly Win7 WMI query twenty times. Recheck exact paths once$\r$\n"
    FileWriteUTF16LE $R9 "  # before allowing the old installer's files to be removed.$\r$\n"
    FileWriteUTF16LE $R9 "  foreach ($$item in $$running) {$\r$\n"
    FileWriteUTF16LE $R9 "    $$process = Get-Process -Id ([int]$$item.ProcessId) -ErrorAction SilentlyContinue$\r$\n"
    FileWriteUTF16LE $R9 "    if ($$null -ne $$process) {$\r$\n"
    FileWriteUTF16LE $R9 "      try { $$null = $$process.WaitForExit(2000) } catch { }$\r$\n"
    FileWriteUTF16LE $R9 "    }$\r$\n"
    FileWriteUTF16LE $R9 "  }$\r$\n"
    FileWriteUTF16LE $R9 "  if (@(Get-ScopedProcesses).Count -eq 0) { exit 0 }$\r$\n"
    FileWriteUTF16LE $R9 "  throw $\"Timed out waiting for scoped Airpimo/UxPlay processes to exit$\"$\r$\n"
    FileWriteUTF16LE $R9 "} catch {$\r$\n"
    FileWriteUTF16LE $R9 "  # Distinguish a WMI/script failure from an actual process still running.$\r$\n"
    FileWriteUTF16LE $R9 "  try {$\r$\n"
    FileWriteUTF16LE $R9 "    $$log = [IO.Path]::Combine([IO.Path]::GetTempPath(), 'Airpimo-installer-cleanup.log')$\r$\n"
    FileWriteUTF16LE $R9 "    [IO.File]::AppendAllText($$log, $\"$$(Get-Date -Format s) root=$$root error=$$($$_.Exception.Message)`r`n$\")$\r$\n"
    FileWriteUTF16LE $R9 "  } catch { }$\r$\n"
    FileWriteUTF16LE $R9 "  exit 5$\r$\n"
    FileWriteUTF16LE $R9 "}$\r$\n"
    FileWriteUTF16LE $R9 "exit 5$\r$\n"
    ${If} ${Errors}
      FileClose $R9
      !insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER
      MessageBox MB_ICONSTOP|MB_OK "$(airpimoCleanupWriteError)"
      Abort
    ${EndIf}
    FileClose $R9
    System::Call 'kernel32::SetEnvironmentVariableW(w "AIRPIMO_INSTALL_DIR", w "$INSTDIR") i .r0'
    ${If} $0 = 0
      !insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER
      MessageBox MB_ICONSTOP|MB_OK "$(airpimoCleanupLocationError)"
      Abort
    ${EndIf}
    ; The two trailing spaces follow the documented NSIS/PowerShell v2
    ; stdin-redirection compatibility workaround, including on Windows 7.
    nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -InputFormat None -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\AirpimoCleanup\airpimo-cleanup.ps1"  '
    Pop $0
    Pop $1
    Delete "$PLUGINSDIR\AirpimoCleanup\airpimo-cleanup.ps1"
    RMDir "$PLUGINSDIR\AirpimoCleanup"
    ${If} $0 != "0"
      DetailPrint "Airpimo scoped cleanup failed: exit=$0; output=$1"
      !insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER
      MessageBox MB_ICONSTOP|MB_OK "$(airpimoCleanupProcessError)"
      Abort
    ${EndIf}
  ${Else}
    DetailPrint "Airpimo: no installed executable in $INSTDIR; skipping process cleanup."
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES
!macroend
