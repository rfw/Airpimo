; NSIS hooks shared by Windows 7 and Windows 10/11.
; Source of embedded UTF-16LE script: process-cleanup.ps1 (checked by tests).
!macro AIRPIMO_STOP_INSTALLED_PROCESSES
  ; Scoped to $INSTDIR; no global taskkill /IM uxplay.exe.
  InitPluginsDir
  ClearErrors
  FileOpen $R9 "$PLUGINSDIR\airpimo-cleanup.ps1" w
  ${If} ${Errors}
    MessageBox MB_ICONSTOP|MB_OK "Airpimo cannot create the installer cleanup helper."
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
  FileWriteUTF16LE $R9 "function Get-ScopedProcesses {$\r$\n"
  FileWriteUTF16LE $R9 "  $$items = @(Get-WmiObject Win32_Process -Filter $\"Name='Airpimo.exe' OR Name='uxplay.exe'$\" -ErrorAction Stop)$\r$\n"
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
  FileWriteUTF16LE $R9 "  foreach ($$item in $$running) {$\r$\n"
  FileWriteUTF16LE $R9 "    if ($$item.Name -ieq 'Airpimo.exe') {$\r$\n"
  FileWriteUTF16LE $R9 "      $$appProcess = Get-Process -Id ([int]$$item.ProcessId) -ErrorAction SilentlyContinue$\r$\n"
  FileWriteUTF16LE $R9 "      if ($$null -ne $$appProcess) { $$null = $$appProcess.CloseMainWindow() }$\r$\n"
  FileWriteUTF16LE $R9 "    }$\r$\n"
  FileWriteUTF16LE $R9 "  }$\r$\n"
  FileWriteUTF16LE $R9 "  if ($$running.Count -gt 0) { Start-Sleep -Milliseconds 500 }$\r$\n"
  FileWriteUTF16LE $R9 "  foreach ($$item in @(Get-ScopedProcesses)) {$\r$\n"
  FileWriteUTF16LE $R9 "    # Scoped to installation root; exit if access is denied instead of ignoring locks.$\r$\n"
  FileWriteUTF16LE $R9 "    $$result = $$item.Terminate()$\r$\n"
  FileWriteUTF16LE $R9 "    if ($$null -ne $$result -and $$result.ReturnValue -ne 0 -and $$result.ReturnValue -ne 9) { exit 5 }$\r$\n"
  FileWriteUTF16LE $R9 "  }$\r$\n"
  FileWriteUTF16LE $R9 "  for ($$attempt = 0; $$attempt -lt 20; $$attempt++) {$\r$\n"
  FileWriteUTF16LE $R9 "    if (@(Get-ScopedProcesses).Count -eq 0) { exit 0 }$\r$\n"
  FileWriteUTF16LE $R9 "    Start-Sleep -Milliseconds 250$\r$\n"
  FileWriteUTF16LE $R9 "  }$\r$\n"
  FileWriteUTF16LE $R9 "} catch { exit 5 }$\r$\n"
  FileWriteUTF16LE $R9 "exit 5$\r$\n"
  ${If} ${Errors}
    FileClose $R9
    MessageBox MB_ICONSTOP|MB_OK "Airpimo cannot write the installer cleanup helper."
    Abort
  ${EndIf}
  FileClose $R9
  System::Call 'kernel32::SetEnvironmentVariableW(w "AIRPIMO_INSTALL_DIR", w "$INSTDIR") i .r0'
  ${If} $0 = 0
    MessageBox MB_ICONSTOP|MB_OK "Airpimo could not verify the install location. Close the installer."
    Abort
  ${EndIf}
  nsExec::ExecToStack '"$WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\airpimo-cleanup.ps1"'
  Pop $0
  Pop $1
  Delete "$PLUGINSDIR\airpimo-cleanup.ps1"
  ${If} $0 != "0"
    MessageBox MB_ICONSTOP|MB_OK "Unable to stop Airpimo processes in $INSTDIR. Close Airpimo and Airpimo Player and retry."
    Abort
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES
!macroend
