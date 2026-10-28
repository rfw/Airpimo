import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {customizeNsis, SIGNATURE} from '../scripts/prepare-windows-nsis.mjs';
const root=resolve(import.meta.dirname,'..');
const read=p=>readFileSync(resolve(root,p),'utf8');
const base=JSON.parse(read('src-tauri/tauri.conf.json'));
const win7=JSON.parse(read('src-tauri/tauri.win7.conf.json'));

// Both packaging entry points inherit shared languages from tauri.conf.json.
// The Win7 override must not repeat these fields or change platform runtimes.
test('Win7 inherits shared five-language NSIS settings while preserving separate runtimes',()=>{
  assert.deepEqual(base.bundle.windows.nsis.languages,[
    'English','SimpChinese','TradChinese','Japanese','Korean',
  ]);
  assert.equal(base.bundle.windows.nsis.displayLanguageSelector,false);
  assert.equal(Object.hasOwn(win7.bundle.windows.nsis,'languages'),false);
  assert.equal(Object.hasOwn(win7.bundle.windows.nsis,'displayLanguageSelector'),false);
  assert.equal(base.bundle.windows.nsis.template,'./windows/airpimo-installer.nsi');
  assert.equal(base.bundle.windows.nsis.installerHooks,'./windows/installer-hooks.nsh');
  assert.equal(base.bundle.windows.webviewInstallMode.type,'downloadBootstrapper');
  assert.equal(win7.bundle.windows.webviewInstallMode.type,'fixedRuntime');
  assert.equal(win7.bundle.windows.webviewInstallMode.path,'./webview2-109');
  assert.equal(win7.bundle.windows.nsis.installMode,'perMachine');
  assert.match(read('scripts/build-win7.mjs'),/--config src-tauri\/tauri\.win7\.conf\.json/);
  assert.match(read('scripts/build-win10.mjs'),/--config src-tauri\/tauri\.conf\.json/);
});

test('localized warnings in both installer hooks, without altering the process-kill safety gates',()=>{
  const hooks=read('src-tauri/windows/installer-hooks.nsh');
  for(const key of ['CreateError','WriteError','LocationError','ProcessError']){
    assert.match(hooks,new RegExp('MessageBox MB_ICONSTOP\\|MB_OK "\\$\\(airpimoCleanup'+key+'\\)"'));
  }
  assert.match(hooks,/\$INSTDIR\\Airpimo\.exe/);
  assert.match(hooks,/Get-WmiObject/); // WMI remains in injected PowerShell script
  assert.match(hooks,/!macro NSIS_HOOK_PREUNINSTALL/);
});

test('pinned NSIS template emits five-language messages after languages, and old cache is invalidated',()=>{
  const sample=`!include "utils.nsh"
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
`+'X'.repeat(25100);
  const generated=customizeNsis(sample);
  assert.match(SIGNATURE,/INSTALLER_V10/);
  assert.ok(generated.indexOf('!insertmacro MUI_LANGUAGE') < generated.indexOf('LangString airpimoCleanupCreateError'));
  for(const name of ['CreateError','WriteError','LocationError','ProcessError']){
    for(const lang of ['ENGLISH','SIMPCHINESE','TRADCHINESE','JAPANESE','KOREAN']){
      assert.match(generated,new RegExp('LangString airpimoCleanup'+name+' \\${LANG_'+lang+'}'));
    }
  }
  assert.match(generated,/无法停止/);
  assert.match(generated,/LangString airpimoPreparingUninstall \$\{LANG_ENGLISH\}/);
  assert.match(generated,/LangString airpimoPreparingUninstall \$\{LANG_SIMPCHINESE\}/);
  for (const lang of ['TRADCHINESE', 'JAPANESE', 'KOREAN']) assert.match(generated, new RegExp('LangString airpimoPreparingUninstall \\$\\{LANG_' + lang + '\\}'));
  assert.throws(()=>customizeNsis(sample.replace('{{#each language_files}}','{{#each broken_language_files}}')),/template drift: localized cleanup messages/);
});
