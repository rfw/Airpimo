import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {customizeNsis,UPSTREAM,TARGET} from '../scripts/prepare-windows-nsis.mjs';
const root = resolve(import.meta.dirname,'..');
const read = f => readFileSync(resolve(root,f),'utf8');
const hooks=read('src-tauri/windows/installer-hooks.nsh');

// The three exact Tauri 2.11.1 transformation points are deliberately tested:
// do not loosen the anchors or replace all other installer behavior.
const sample = `!include "utils.nsh"
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
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}
Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\\\${MAINBINARYNAME}.exe" ""
FunctionEnd
` + 'X'.repeat(25100);

test('same-version reinstall cleans first, and upgrade cleanup precedes legacy uninstaller',()=>{
  const generated=customizeNsis(sample);
  assert.match(generated,/Same version: default clean REINSTALL/);
  assert.match(generated,/StrCpy \$R2 "\$\(uninstallBeforeInstalling\)"/);
  assert.match(generated,/StrCpy \$R3 "\$\(addOrReinstall\)"/);
  assert.match(generated,/\$R0 = 0 ; Same version: first \(default\) = clean reinstall/);
  assert.match(generated,/Goto reinst_uninstall\n    \$\{Else\}\s+; Explicit in-place reinstall\n      Goto reinst_done/);
  const uninstall = generated.split('  reinst_uninstall:')[1].split('    HideWindow')[0];
  assert.match(uninstall,/Banner::show "\$\(airpimoPreparingUninstall\)"/);
  assert.match(uninstall,/!insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES/);
  assert.match(uninstall,/!insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER/);
  assert.ok(uninstall.indexOf('Banner::show') < uninstall.indexOf('AIRPIMO_STOP_INSTALLED_PROCESSES'));
  assert.ok(uninstall.indexOf('AIRPIMO_STOP_INSTALLED_PROCESSES') < uninstall.indexOf('AIRPIMO_DISMISS_PREPARATION_BANNER'));
  assert.equal(generated.split('AIRPIMO_STOP_INSTALLED_PROCESSES').length-1,1);
  assert.match(generated,/A registry-only install cannot run its missing uninstaller/);
  assert.match(generated,/AndIfNot.*FileExists.*\$R8\\uninstall\.exe/);
  assert.match(generated,/previous install record exists, but directory is empty/);
});

test('template preparation fails closed on unexpected Tauri layout',()=>{
  assert.throws(()=>customizeNsis(sample.replace('$(uninstallApp)','$(mutated)')),/template drift: same-version labels/);
  assert.throws(()=>customizeNsis(sample.replace('reinst_uninstall:', 'other_label:')),/template drift: old-uninstaller cleanup/);
  assert.throws(()=>customizeNsis(sample.replace('; Compare this installar version', '; Modified version')),/template drift: stale-registration bypass/);
  assert.ok(UPSTREAM.includes('tauri-v2.11.1'));
  assert.match(TARGET,/airpimo-installer\.nsi$/);
});

test('PowerShell payload matches versioned script and kills only installed path-matched processes',()=>{
  const source=read('src-tauri/windows/process-cleanup.ps1');
  const embedded=hooks.split('\n').filter(line=>line.trim().startsWith('FileWriteUTF16LE $R9 '))
    .map(line=>line.match(/^\s*FileWriteUTF16LE \$R9 "(.*)"$/)?.[1])
    .map(encoded=>encoded.replace(/\$\\r\$\\n$/, '').replace(/\$\\"/g,'"').replace(/\$\$/g,'$'))
    .join('\n')+'\n';
  assert.equal(embedded,source);
  assert.match(hooks,/FileWriteUTF16LE \/BOM/);
  assert.doesNotMatch(hooks, /-EncodedCommand/);
  assert.match(source,/AIRPIMO_INSTALL_DIR/);
  assert.match(source,/\[string\]::Equals\(\$item\.ExecutablePath, \$target, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(source,/Get-WmiObject Win32_Process/);
  assert.match(source,/Get-Process -ErrorAction Stop \| Where-Object/);
  assert.match(source,/\$_.ProcessName -ieq 'Airpimo'/);
  assert.match(source,/if \(\$candidates.Count -eq 0\) \{ return \}/);
  assert.ok(source.indexOf('if ($candidates.Count -eq 0) { return }') < source.indexOf('Get-WmiObject Win32_Process'));
  assert.match(source,/throw \"WMI query failed/);
  assert.match(source,/Timed out waiting for scoped Airpimo/);

  assert.match(source,/sidecar\\uxplay\.exe/);
  assert.doesNotMatch(source,/taskkill|Stop-Process|Win32_Process -Filter "Name='uxplay.exe'"/);
  assert.match(hooks,/!macro NSIS_HOOK_PREINSTALL/);
  assert.match(hooks,/!macro NSIS_HOOK_PREUNINSTALL/);
  assert.match(hooks,/SetEnvironmentVariableW/);
  assert.match(hooks,/No installed executable means a clean or already-removed installation/);
  assert.match(hooks,/\$INSTDIR\\Airpimo\.exe/);
  assert.match(hooks,/\$INSTDIR\\sidecar\\uxplay\.exe/);
  assert.ok(hooks.indexOf('No installed executable') < hooks.indexOf('InitPluginsDir'));
  assert.match(source,/if \(-not \$hasInstalledExecutable\) \{ exit 0 \}/);
  assert.match(source,/Airpimo-installer-cleanup\.log/);
  assert.match(hooks,/Airpimo scoped cleanup failed: exit=\$0/);
  assert.match(hooks,/\$0 != "0"/);
});

test('Windows Job Object is installed immediately after spawning UxPlay and released on stop and exit',()=>{
  const receiver=read('src-tauri/src/receiver.rs');
  const job=read('src-tauri/src/windows_job.rs');
  const lib=read('src-tauri/src/lib.rs');
  assert.match(job,/JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(job,/AssignProcessToJobObject/);
  assert.match(job,/SetInformationJobObject/);
  assert.match(job,/impl Drop for ReceiverJob/);
  assert.match(job,/return Err\(io::Error::last_os_error\(\)\)/);
  assert.ok(receiver.indexOf('ReceiverJob::attach(&child)') > receiver.indexOf('command.spawn()'));
  assert.ok(receiver.indexOf('ReceiverJob::attach(&child)') < receiver.indexOf('i.child=Some(child)'));
  assert.match(receiver,/let _=child.kill\(\); let _=child.wait\(\);\n\s+self.error\(app,epoch,"missing_runtime"/);
  assert.match(receiver,/receiver_job\.take\(\)/);
  assert.match(lib,/mod windows_job;/);
});

test('both Windows build entry points generate a pinned template before packaging',()=>{
  const configs=['src-tauri/tauri.conf.json','src-tauri/tauri.win7.conf.json'].map(read).map(JSON.parse);
  assert.equal(configs[0].bundle.windows.nsis.template,'./windows/airpimo-installer.nsi');
  assert.equal(configs[0].bundle.windows.nsis.installerHooks,'./windows/installer-hooks.nsh');
  assert.equal(configs[1].bundle.windows.nsis.installMode,'perMachine');
  for(const file of ['scripts/build-win7.mjs','scripts/build-win10.mjs']){
    const src=read(file);
    assert.match(src,/await prepareWindowsNsis\(\)/);
    assert.ok(src.indexOf('await prepareWindowsNsis()') < src.indexOf('const build=spawnSync('));
  }
});
