#!/usr/bin/env node
/** Win7 x64 candidate build: refuses known incompatible PE DLLs before invoking expensive NSIS. */
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {preserveNsisInstaller} from './windows-build-artifacts.mjs';
import {prepareWindowsNsis} from './prepare-windows-nsis.mjs';
const root=resolve(import.meta.dirname,'..');
const mdnsRequired=process.argv.includes('--require-mdns');
function block(s){console.error(`[win7] BLOCKED: ${s}`);process.exit(2);}
if(process.platform!=='win32'||process.arch!=='x64')block('Run on a Windows x64 build host.');
const lock=readFileSync(resolve(root,'src-tauri/Cargo.lock'),'utf8');
if(!/^version\s*=\s*3\s*$/m.test(lock))block('Rust 1.77.2 requires Cargo.lock v3');
const version=spawnSync('rustc.exe',['--version'],{encoding:'utf8',windowsHide:true});
if(version.error||version.status!==0||!/^rustc 1\.77\.2\s/.test(version.stdout))
  block(`Use Rust 1.77.2 MSVC in this terminal (RUSTUP_TOOLCHAIN=1.77.2-x86_64-pc-windows-msvc). Current: ${version.stdout??version.error?.message}`);
for(const [program,args] of [
  [process.execPath,['scripts/check-native.mjs','--win7',...(mdnsRequired?['--require-mdns']:[])]],
  [process.execPath,['scripts/check-tauri-lock.mjs']],
  [process.execPath,['--experimental-strip-types','--test','tests/packaging.test.mjs','tests/win7-pe-audit.test.mjs','tests/win7-mdns-provenance.test.mjs']],
]) {
  const r=spawnSync(program,args,{cwd:root,stdio:'inherit',windowsHide:true});
  if(r.error||r.status!==0)block(`${args.join(' ')} failed; no installer generated`);
}
try { await prepareWindowsNsis(); } catch(error) { block(`Installer template preparation failed: ${error.message}`); }
const started=Date.now();
const build=spawnSync('cmd.exe',['/d','/s','/c','npx tauri build --config src-tauri/tauri.win7.conf.json --bundles nsis'],{cwd:root,stdio:'inherit',windowsHide:true});
if(build.error||build.status!==0)block('Tauri NSIS build failed');
try{console.log(`[win7] Installer: ${preserveNsisInstaller(root,'win7',started)}`)}catch(error){block(error.message)}
console.log(`[win7] ${mdnsRequired?'Internal-mDNS experimental':'Legacy Bonjour'} candidate NSIS built; real Win7 + AirPlay validation REQUIRED.`);
