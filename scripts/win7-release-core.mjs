/** Verify the effective Tauri Windows 7 WebView2 directory and 109.x build. */
import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {spawnSync} from 'node:child_process';
const DIR=resolve(import.meta.dirname,'..','src-tauri');
export function verifyFixedWebview2({dir=DIR, run=spawnSync, host=process.platform}={}) {
  const primary=JSON.parse(readFileSync(join(dir,'tauri.conf.json'),'utf8'));
  const legacy=JSON.parse(readFileSync(join(dir,'tauri.win7.conf.json'),'utf8'));
  const primaryMode=primary.bundle?.windows?.webviewInstallMode;
  const win7Mode=legacy.bundle?.windows?.webviewInstallMode;
  if(win7Mode?.type!=='fixedRuntime') throw Error('Win7 Tauri override must use fixedRuntime');
  if(primaryMode?.type==='fixedRuntime' && primaryMode.path !== win7Mode.path)
    throw Error(`Tauri fixedRuntime paths conflict: main=${primaryMode.path}, Win7=${win7Mode.path}`);
  const raw=win7Mode.path;
  if(typeof raw!=='string'|| !/^\.\/webview2-109$/.test(raw)) throw Error(`expected ./webview2-109; got ${raw}`);
  const path=resolve(dir,raw),exe=join(path,'msedgewebview2.exe');
  if(!existsSync(exe)||!statSync(exe).isFile())
    throw Error(`fixedRuntime root must directly contain msedgewebview2.exe, not a version-number subfolder: ${path}`);
  if(host!=='win32') throw Error('WebView2 file-version check requires a Windows build host');
  const command=`(Get-Item -LiteralPath '${exe.replaceAll("'","''")}').VersionInfo.ProductVersion`;
  const encoded=Buffer.from(command,'utf16le').toString('base64');
  const result=run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{encoding:'utf8',timeout:15000,windowsHide:true});
  if(result.error||result.status!==0) throw Error(`cannot verify WebView2 PE version: ${result.error?.message||result.stderr||'unknown'}`);
  const version=result.stdout.trim();
  if(!/^109\.\d+\.\d+\.\d+$/.test(version)) throw Error(`expected WebView2 109.x, found '${version}'`);
  return {path,version};
}
