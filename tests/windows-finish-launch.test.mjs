import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {customizeNsis, prepareWindowsNsis, SIGNATURE} from '../scripts/prepare-windows-nsis.mjs';

const root = resolve(import.meta.dirname, '..');
const read = f => readFileSync(resolve(root, f), 'utf8');
const source = `!include "utils.nsh"
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
{{#each language_files}}
  !include "{{this}}"
{{/each}}
; Use show readme button in the finish page as a button create a desktop shortcut
!define MUI_FINISHPAGE_SHOWREADME
!define MUI_FINISHPAGE_SHOWREADME_TEXT "$(createDesktop)"
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

test('installer finish page restores upstream run checkbox and callback while retaining shortcuts',()=>{
  const generated = customizeNsis(source);
  assert.match(SIGNATURE,/INSTALLER_V10/);
  assert.match(generated,/!insertmacro MUI_PAGE_FINISH/);
  assert.match(generated,/!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut/);
  assert.match(generated,/!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive\n!insertmacro MUI_PAGE_FINISH/);
  assert.match(generated, /!define MUI_FINISHPAGE_RUN\n/);
  assert.match(generated, /!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary/);
  assert.match(generated, /Function RunMainBinary\n\s+nsis_tauri_utils::RunAsUser/);
  assert.match(generated, /Function \.onInstSuccess/);
  assert.doesNotMatch(generated, /airpimoLaunchMissing|airpimoLaunchFailed|ExecShell "open"/);
  assert.match(read('scripts/build-win10.mjs'),/await prepareWindowsNsis\(\)/);
  assert.match(read('scripts/build-win7.mjs'),/await prepareWindowsNsis\(\)/);
});

test('NSIS template drift fails closed if upstream run controls change',()=>{
  assert.throws(()=>customizeNsis(source.replace('!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary','!define MUI_FINISHPAGE_RUN_FUNCTION DifferentAction')),/template drift: finish-page auto-launch removal/);
  assert.throws(()=>customizeNsis(source.replace('nsis_tauri_utils::RunAsUser','other::RunAsUser')),/template drift: finish-page auto-launch removal/);
});

test('pinned Tauri finish-page block tolerates CRLF and indentation without relaxing drift guard',()=>{
  const crlfSource=source.replace(/\n/g,'\r\n');
  const generated=customizeNsis(crlfSource);
  assert.match(generated,/MUI_FINISHPAGE_RUN|Function RunMainBinary/);
  const indented=source.replace('  nsis_tauri_utils::RunAsUser', '\t  nsis_tauri_utils::RunAsUser');
  assert.match(customizeNsis(indented),/MUI_FINISHPAGE_RUN|Function RunMainBinary/);
});

test('finish-page directives may be separated by comments without false template drift',()=>{
  const split = source
    .replace('!define MUI_FINISHPAGE_RUN\n!define MUI_FINISHPAGE_RUN_FUNCTION',
      '!define MUI_FINISHPAGE_RUN\n; NSIS may place a comment between directives.\n\n!define MUI_FINISHPAGE_RUN_FUNCTION')
    .replace('!insertmacro MUI_PAGE_FINISH\nFunction RunMainBinary',
      '!insertmacro MUI_PAGE_FINISH\n; Finished the page definitions.\n\nFunction RunMainBinary');
  const out=customizeNsis(split);
  assert.match(out,/MUI_FINISHPAGE_RUN|RunMainBinary|RunAsUser/);
  assert.match(out,/MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut/);
  assert.match(out,/!insertmacro MUI_PAGE_FINISH/);
});

test('do not remove unknown finish-page handlers or duplicate launch definitions',()=>{
  assert.throws(()=>customizeNsis(source.replace('RunAsUser "$INSTDIR', 'RunAsAdmin "$INSTDIR')),
    /finish-page auto-launch removal/);
  const duplicate=source.replace('!define MUI_FINISHPAGE_RUN\n','!define MUI_FINISHPAGE_RUN\n!define MUI_FINISHPAGE_RUN\n');
  assert.throws(()=>customizeNsis(duplicate),/run option=2/);
});


test('Tauri 2.11.1 silent/passive /R auto-launch is restored',()=>{
  const generated = customizeNsis(source);
  assert.match(generated, /Function \.onInstSuccess/);
  assert.match(generated, /nsis_tauri_utils::RunAsUser/);
  assert.match(generated, /\$CMDLINE "\/R"/);
  assert.match(generated,/!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateOrUpdateDesktopShortcut/);
});

test('NSIS silent callback drift and unknown extra instructions fail closed',()=>{
  const extra=source.replace('      nsis_tauri_utils::RunAsUser', '      DetailPrint "unexpected"\n      nsis_tauri_utils::RunAsUser');
  assert.throws(()=>customizeNsis(extra),/unexpected \.onInstSuccess body/);
  assert.throws(()=>customizeNsis(source.replace('\"\/ARGS\"', '"/OTHER"')),/unexpected \.onInstSuccess body/);
  const duplicated=source.replace('Function .onInstSuccess\n','Function .onInstSuccess\nFunctionEnd\nFunction .onInstSuccess\n');
  assert.throws(()=>customizeNsis(duplicated),/silent\/passive run handler=2/);
  assert.throws(()=>customizeNsis(source.replace('Function .onInstSuccess', 'Function .onInstSuccessV2')),/silent\/passive run handler=0/);
});
test('installer generator replaces stale V9 cache and reuses verified V10 cache offline',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'airpimo-nsis-v10-'));
  const target=join(dir,'airpimo-installer.nsi');
  const sourcePath=join(dir,'pinned.nsi');
  try {
    writeFileSync(target,'; AIRPIMO_CUSTOM_TAURI_2_11_1_INSTALLER_V9\nold');
    writeFileSync(sourcePath,source.replace(/\n/g,'\r\n'));
    assert.equal(await prepareWindowsNsis({platform:'win32',target,sourcePath}),true);
    const generated=readFileSync(target,'utf8');
    assert.ok(generated.startsWith(SIGNATURE));
    assert.match(generated,/MUI_FINISHPAGE_RUN|Function RunMainBinary/);
    assert.equal(await prepareWindowsNsis({platform:'win32',target,sourcePath}),false);
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});
