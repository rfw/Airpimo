#!/usr/bin/env node
// A tightly pinned customization of Tauri 2.11.1's official NSIS template.
// The template is cached after the first Windows build. Use the offline source
// override for air-gapped CI; fail if upstream layout changes unexpectedly.
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import https from 'node:https';
import {pathToFileURL} from 'node:url';

export const UPSTREAM = 'https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.11.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi';
export const TARGET = resolve(import.meta.dirname, '../src-tauri/windows/airpimo-installer.nsi');
export const SIGNATURE = '; AIRPIMO_CUSTOM_TAURI_2_11_1_INSTALLER_V6';
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if(count !== 1) throw Error(`Pinned Tauri NSIS template drift: ${label} (${count} matches)`);
  return source.replace(before, after);
}
export function customizeNsis(upstream) {
  if(upstream.length < 25000 || !upstream.includes('!include "utils.nsh"') ||
    !upstream.includes('!insertmacro CheckIfAppIsRunning')) throw Error('Not the expected Tauri 2.11.1 NSIS source');
  let s = upstream;
  // Tauri's maintenance page is registry-driven, even after manual removal.
  // When only its stale registration remains (no files at the recorded path),
  // skip the maintenance page and perform a normal installation. Never delete
  // registration data blindly or bypass a still-existing uninstaller.
  s = replaceOnce(s,
`  ; Compare this installar version with the existing installation`,
`  ; A registry-only install cannot run its missing uninstaller.
  \${If} $WixMode <> 1
    ReadRegStr $R8 SHCTX "\${MANUPRODUCTKEY}" ""
    \${If} $R8 != ""
    \${AndIfNot} \${FileExists} "$R8\\uninstall.exe"
    \${AndIfNot} \${FileExists} "$R8\\\${MAINBINARYNAME}.exe"
    \${AndIfNot} \${FileExists} "$R8\\*.*"
      DetailPrint "Airpimo: previous install record exists, but directory is empty; continuing with a fresh install."
      Abort
    \${EndIf}
  \${EndIf}
  ; Compare this installar version with the existing installation`, 'stale-registration bypass');
  s = replaceOnce(s,
`  ; Reinstalling the same version
  \${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"`,
`  ; Same version: default clean REINSTALL, not uninstall-only.
  \${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 "$(addOrReinstall)"`, 'same-version labels');
  s = replaceOnce(s,
`  \${If} $R0 = 0 ; Same version, proceed
    \${If} $R1 = 1              ; User chose to add/reinstall
      Goto reinst_done
    \${Else}                    ; User chose to uninstall
      Goto reinst_uninstall
    \${EndIf}`, 
`  \${If} $R0 = 0 ; Same version: first (default) = clean reinstall
    \${If} $R1 = 1
      Goto reinst_uninstall
    \${Else}                    ; Explicit in-place reinstall
      Goto reinst_done
    \${EndIf}`, 'same-version action');
  // Tauri emits MUI_LANGUAGE and its own language files here. Declare our
  // hook messages AFTER MUI_LANGUAGE, not in the early-included hooks file.
  // The locked template must contain the precise anchor or packaging fails.
  s = replaceOnce(s,
`{{#each language_files}}
  !include "{{this}}"
{{/each}}`,
`{{#each language_files}}
  !include "{{this}}"
{{/each}}
; Airpimo custom installer/uninstaller messages (both architectures).
LangString airpimoCleanupCreateError \${LANG_ENGLISH} "Airpimo cannot create the installer cleanup helper."
LangString airpimoCleanupCreateError \${LANG_SIMPCHINESE} "无法创建 Airpimo 安装程序的清理辅助脚本。"
LangString airpimoCleanupWriteError \${LANG_ENGLISH} "Airpimo cannot write the installer cleanup helper."
LangString airpimoCleanupWriteError \${LANG_SIMPCHINESE} "无法写入 Airpimo 安装程序的清理辅助脚本。"
LangString airpimoCleanupLocationError \${LANG_ENGLISH} "Airpimo could not verify the install location. Close the installer."
LangString airpimoCleanupLocationError \${LANG_SIMPCHINESE} "无法验证 Airpimo 的安装位置，请关闭安装程序。"
LangString airpimoCleanupProcessError \${LANG_ENGLISH} "Unable to stop Airpimo processes in $INSTDIR. Close Airpimo and Airpimo Player and retry."
LangString airpimoCleanupProcessError \${LANG_SIMPCHINESE} "无法停止 $INSTDIR 中的 Airpimo 进程。请关闭 Airpimo 和 Airpimo Player 后重试。"
LangString airpimoPreparingUninstall \${LANG_ENGLISH} "Stopping Airpimo and preparing the previous version for removal..."
LangString airpimoPreparingUninstall \${LANG_SIMPCHINESE} "正在关闭 Airpimo 并准备卸载旧版本，请稍候…"
`,
    'localized cleanup messages');
  // Tauri's first radio is checked by default; on upgrade it already means
  // uninstall-before-install. The above aligns same-version repairs with it.
  s = replaceOnce(s,
`  reinst_uninstall:
    HideWindow`,
`  reinst_uninstall:
    ; A synchronous PowerShell/WMI check is slow on Win7 and formerly froze
    ; the maintenance page after Next was clicked. Show NSIS' built-in banner
    ; BEFORE the check, then remove it before the old uninstaller opens.
    \${If} $PassiveMode != 1
      Banner::show "$(airpimoPreparingUninstall)"
      StrCpy $AirpimoPreparationBanner 1
    \${EndIf}
    ; This is BEFORE running an older uninstaller without our safety hooks.
    !insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES
    \${If} $PassiveMode != 1
      !insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER
    \${EndIf}
    HideWindow`, 'old-uninstaller cleanup');
  // Airpimo is started manually. Remove the run checkbox and callback,
  // but leave the normal finish page, desktop-shortcut option and install
  // lifecycle unchanged. Pin this to the upstream Tauri 2.11.1 template.
  s = replaceOnce(s,
`; Show run app after installation.
!define MUI_FINISHPAGE_RUN
!define MUI_FINISHPAGE_RUN_FUNCTION RunMainBinary
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH
Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\\\${MAINBINARYNAME}.exe" ""
FunctionEnd`,
`; Airpimo: start from the Start menu or desktop shortcut after installing.
!define MUI_PAGE_CUSTOMFUNCTION_PRE SkipIfPassive
!insertmacro MUI_PAGE_FINISH`, 'finish-page auto-launch removal');
  return SIGNATURE + '\n; Derived from tauri-v2.11.1, preserving original handlebars placeholders.\n' + s;
}
function download(url, redirect = 0) {
  if (redirect > 2) return Promise.reject(Error('Too many NSIS template redirects'));
  return new Promise((res,rej) => {
    const request=https.get(url,{timeout:25000,headers:{'User-Agent':'Airpimo-nsis-source/1'}},r=>{
      if(r.statusCode===301||r.statusCode===302){const next=new URL(r.headers.location,url);r.resume();return next.protocol==='https:'?res(download(next.href,redirect+1)):rej(Error('Insecure NSIS template redirect'));}
      if(r.statusCode!==200){r.resume();return rej(Error(`Pinned NSIS source HTTP ${r.statusCode}`));}
      const chunks=[];let length=0;r.on('data',b=>{length+=b.length;if(length>300000){r.destroy(Error('NSIS template too large'));return;}chunks.push(b)});
      r.on('end',()=>res(Buffer.concat(chunks).toString('utf8')));r.on('error',rej);
    }); request.on('timeout',()=>request.destroy(Error('NSIS template request timed out')));request.on('error',rej);
  });
}
export async function prepareWindowsNsis({platform=process.platform,target=TARGET,sourcePath=process.env.AIRPIMO_TAURI_NSIS_TEMPLATE_SOURCE}={}) {
  if(platform!=='win32') return false;
  if(existsSync(target) && readFileSync(target,'utf8').startsWith(SIGNATURE)) {
    if (!readFileSync(target,'utf8').includes('AIRPIMO_STOP_INSTALLED_PROCESSES') || !readFileSync(target,'utf8').includes('!insertmacro MUI_PAGE_FINISH') || readFileSync(target,'utf8').includes('MUI_FINISHPAGE_RUN')) throw Error('Generated NSIS template is incomplete');
    return false;
  }
  const source=sourcePath?readFileSync(sourcePath,'utf8'):await download(UPSTREAM);
  const generated=customizeNsis(source);
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,generated);
  console.log(`[nsis] Tauri 2.11.1 template prepared: ${target}`);
  return true;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href) {
  prepareWindowsNsis().catch(e=>{console.error(`[nsis] BLOCKED: ${e.message}`);process.exitCode=2;});
}
