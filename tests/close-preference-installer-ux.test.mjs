import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { customizeNsis, SIGNATURE } from '../scripts/prepare-windows-nsis.mjs';

const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(resolve(root, path), 'utf8');

const sourceSample = `!include "utils.nsh"
!insertmacro CheckIfAppIsRunning
  ; Compare this installar version with the existing installation
  ; Reinstalling the same version
  \${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"
    \${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
    Pop $R3
    ; Disable this radio button if downgrading and downgrades are disabled
    !if "\${ALLOWDOWNGRADES}" == "false"
      \${IfThen} $R0 = -1 \${|} EnableWindow $R3 0 \${|}
    !endif
    \${NSD_OnClick} $R3 PageReinstallUpdateSelection
    \${If} $ReinstallPageCheck <> 2
      SendMessage $R2 \${BM_SETCHECK} \${BST_CHECKED} 0
    \${Else}
      SendMessage $R3 \${BM_SETCHECK} \${BST_CHECKED} 0
    \${EndIf}
  \${If} $R0 = 0 ; Same version, proceed
    \${If} $R1 = 1              ; User chose to add/reinstall
      Goto reinst_done
    \${Else}                    ; User chose to uninstall
      Goto reinst_uninstall
    \${EndIf}
  reinst_uninstall:
    HideWindow
;Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}
; Use show readme button as desktop shortcut
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut
; Show run app after installation.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH
Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\\\${MAINBINARYNAME}.exe" ""
FunctionEnd
; Uninstaller Pages
Function .onInstSuccess
  ; Check for /R flag only in silent and passive installers because
  ; GUI installer has a toggle for the user to (re)start the app
  \${If} $PassiveMode = 1
  \${OrIf} \${Silent}
    \${GetOptions} $CMDLINE "/R" $R0
    \${IfNot} \${Errors}
      \${GetOptions} $CMDLINE "/ARGS" $R0
      nsis_tauri_utils::RunAsUser "$INSTDIR\\\${MAINBINARYNAME}.exe" "$R0"
    \${EndIf}
  \${EndIf}
FunctionEnd
` + 'X'.repeat(25100);

test('tray feedback remains in a fixed-height accessible row and success stays readable', () => {
  const app = read('src/App.tsx');
  const dialog = read('src/components/AirpimoSettingsDialog.tsx');
  const translations = read('src/lib/i18n.ts');
  assert.match(app, /const \[trayPersisted, setTrayPersisted\] = useState\(false\)/);
  assert.match(app, /setTrayPersisted\(true\)/);
  assert.match(dialog, /role=\{trayError \? "alert" : "status"\}/);
  assert.match(dialog, /aria-atomic="true"/);
  assert.match(dialog, /min-h-\[15px\]/);
  assert.match(dialog, /trayPersisted[\s\S]*?t\("设置已保存，无需点击保存设置。"\)/);
  assert.doesNotMatch(dialog, /\{traySaving && <p role="status"/);
  assert.match(translations, /'设置已保存，无需点击保存设置。': 'Saved\./);
});

test('macOS and Windows exit paths enqueue a native app-level exit after close dispatch', () => {
  const lib = read('src-tauri/src/lib.rs');
  assert.match(lib, /if window\.label\(\) != "main" \{ return; \}/);
  assert.match(lib, /api\.prevent_close\(\)/);
  assert.match(lib, /MainWindowCloseAction::HideToTray => \{ let _=window\.hide\(\); \}/);
  assert.match(lib, /MainWindowCloseAction::Exit => request_main_window_exit\(app\.clone\(\)\)/);
  assert.match(lib, /fn request_main_window_exit\(app: AppHandle\) \{\s*std::thread::spawn\(move \|\| app\.exit\(0\)\);/);
  assert.match(lib, /RunEvent::Exit=event \{ controller\(app\)\.stop\(app\); \}/);
});

test('Win7 maintenance action shows preparation banner before synchronous cleanup and dismisses it on success/error', () => {
  const generated = customizeNsis(sourceSample);
  const hooks = read('src-tauri/windows/installer-hooks.nsh');
  const phase = generated.split('  reinst_uninstall:')[1].split('    HideWindow')[0];
  assert.match(SIGNATURE, /INSTALLER_V10/);
  assert.ok(phase.indexOf('Banner::show') < phase.indexOf('!insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES'));
  assert.ok(phase.indexOf('!insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES') < phase.indexOf('!insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER'));
  assert.match(generated, /LangString airpimoPreparingUninstall \$\{LANG_SIMPCHINESE\}/);
  assert.match(hooks, /Var AirpimoPreparationBanner/);
  assert.match(hooks, /!macro AIRPIMO_DISMISS_PREPARATION_BANNER[\s\S]*?\$AirpimoPreparationBanner == "1"/);
  for (const reason of ['CreateError','WriteError','LocationError','ProcessError']) {
    assert.match(hooks, new RegExp('!insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER\\n\\s+MessageBox MB_ICONSTOP\\|MB_OK "\\$\\(airpimoCleanup' + reason + '\\)"'));
  }
});

test('Win7 path-matched cleanup avoids tray-only CloseMainWindow and repeating WMI polling', () => {
  const script = read('src-tauri/windows/process-cleanup.ps1');
  assert.match(script, /\[string\]::Equals\(\$item\.ExecutablePath, \$target, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(script, /\$result = \$item\.Terminate\(\)/);
  assert.match(script, /\$process\.WaitForExit\(\$milliseconds\)/);
  assert.match(script, /\$remaining = @\(Get-ScopedProcesses\)/);
  assert.match(script, /if \(\$remaining\.Count -eq 0\) \{ exit 0 \}/);
  assert.doesNotMatch(script, /\$appProcess\.CloseMainWindow\(\)/);
  assert.doesNotMatch(script, /for \(\$attempt = 0; \$attempt -lt 20/);
  assert.doesNotMatch(script, /taskkill|Stop-Process -Force/);
});
