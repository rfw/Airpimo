import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {customizeNsis, SIGNATURE} from '../scripts/prepare-windows-nsis.mjs';

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
Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\\\${MAINBINARYNAME}.exe" ""
FunctionEnd
` + 'X'.repeat(25100);

test('finish-page launch consumes plugin result and reports failures without changing checkbox behavior',()=>{
  const generated = customizeNsis(source);
  const start=generated.indexOf('Function RunMainBinary');
  const finish=generated.indexOf('FunctionEnd',start)+ 'FunctionEnd'.length;
  const fn=generated.slice(start,finish);
  assert.match(fn,/\$\{IfNot\} \$\{FileExists\} "\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"/);
  assert.match(fn,/nsis_tauri_utils::RunAsUser[^\n]*\n  Pop \$R0\n  \$\{If\} \$R0 != 0/);
  assert.match(fn,/MessageBox MB_ICONEXCLAMATION\|MB_OK "\$\(airpimoLaunchFailed\)"/);
  assert.match(fn,/!if "\$\{INSTALLMODE\}" == "currentUser"/);
  assert.match(fn,/System::Call 'shell32::IsUserAnAdmin\(\) i \.r1'/);
  assert.match(fn,/\$\{If\} \$1 == 0[\s\S]*ExecShell "open"/);
  assert.ok(fn.indexOf('ExecShell') > fn.indexOf('!if "${INSTALLMODE}" == "currentUser"'));
  assert.doesNotMatch(fn,/ExecWait|runas\s*"|Start-Process|cmd\.exe/);
  assert.equal((fn.match(/nsis_tauri_utils::RunAsUser/g)||[]).length,1);
});

test('English/Chinese messages are after NSIS language registration and generated template cache invalidates',()=>{
  const generated=customizeNsis(source);
  assert.match(SIGNATURE,/INSTALLER_V5/);
  for(const name of ['LaunchMissing','LaunchFailed']) {
    for(const lang of ['ENGLISH','SIMPCHINESE']) {
      assert.match(generated,new RegExp(`LangString airpimo${name} \\$\\{LANG_${lang}\\}`));
    }
  }
  assert.ok(generated.indexOf('!include "{{this}}"') < generated.indexOf('LangString airpimoLaunchFailed'));
  assert.match(read('scripts/build-win10.mjs'),/await prepareWindowsNsis\(\)/);
  assert.match(read('scripts/build-win7.mjs'),/await prepareWindowsNsis\(\)/);
  assert.throws(()=>customizeNsis(source.replace('nsis_tauri_utils::RunAsUser', 'some_other_launcher::Run')),/template drift: finish-page RunAsUser handling/);
});
