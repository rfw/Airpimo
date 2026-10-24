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
export const SIGNATURE = '; AIRPIMO_CUSTOM_TAURI_2_11_1_INSTALLER_V2';
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
  // Tauri's first radio is checked by default; on upgrade it already means
  // uninstall-before-install. The above aligns same-version repairs with it.
  s = replaceOnce(s,
`  reinst_uninstall:
    HideWindow`,
`  reinst_uninstall:
    ; This is BEFORE running an older uninstaller without our safety hooks.
    !insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES
    HideWindow`, 'old-uninstaller cleanup');
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
    if (!readFileSync(target,'utf8').includes('AIRPIMO_STOP_INSTALLED_PROCESSES')) throw Error('Generated NSIS template is incomplete');
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
