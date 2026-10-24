#!/usr/bin/env node
/** Windows 10/11 NSIS: use Evergreen WebView2 and never bundle fixed WebView2 109. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {preserveNsisInstaller} from './windows-build-artifacts.mjs';
import {prepareWindowsNsis} from './prepare-windows-nsis.mjs';
const root=resolve(import.meta.dirname,'..');
function block(reason) {console.error(`[win10+] BLOCKED: ${reason}`);process.exit(2)}
if(process.platform!=='win32'||process.arch!=='x64') block('Run on a Windows x64 build host.');
const base=JSON.parse(readFileSync(resolve(root,'src-tauri/tauri.conf.json'),'utf8'));
const legacy=JSON.parse(readFileSync(resolve(root,'src-tauri/tauri.win7.conf.json'),'utf8'));
if(base.bundle?.windows?.webviewInstallMode?.type!=='downloadBootstrapper')
  block('tauri.conf.json must use downloadBootstrapper (no bundled WebView2)');
if(legacy.bundle?.windows?.webviewInstallMode?.type!=='fixedRuntime')
  block('Win7 configuration must retain fixedRuntime');
if(JSON.stringify(base.bundle?.resources??{}).includes('webview2-109'))
  block('Fixed WebView2 folder is unexpectedly included in shared bundle resources');
for(const args of [['scripts/check-native.mjs'],['scripts/check-tauri-lock.mjs']]) {
  const run=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(run.error||run.status!==0) block(`${args.join(' ')} failed; no installer generated`);
}
// Explicitly select the modern Windows config; the Win7 override must never be used.
try { await prepareWindowsNsis(); } catch(error) { block(`Installer template preparation failed: ${error.message}`); }
const started=Date.now();
const build=spawnSync('cmd.exe',['/d','/s','/c','npx tauri build --config src-tauri/tauri.conf.json --bundles nsis'],
  {cwd:root,stdio:'inherit',windowsHide:true});
if(build.error||build.status!==0) block('Tauri NSIS build failed');
try { console.log(`[win10+] Installer: ${preserveNsisInstaller(root,'win10plus',started)}`); }
catch(error) {block(error.message)}
console.log('[win10+] Evergreen WebView2: not bundled; installer downloads bootstrapper if WebView2 is missing. Internet is required for that fallback.');
