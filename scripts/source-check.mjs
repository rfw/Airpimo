#!/usr/bin/env node
// Dependency-light local source verification; not a substitute for cargo check / tsc.
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const dir=resolve(import.meta.dirname,'..');
let ts;
try {ts=require('typescript')} catch {
  const globalRoot=spawnSync('npm',['root','-g'],{encoding:'utf8'}).stdout?.trim();
  if(globalRoot) { try {ts=require(join(globalRoot,'typescript'))} catch {} }
}
if(!ts) { console.error('BLOCKED: TypeScript parser 未安装'); process.exit(2); }
const sourceFiles=[];
function walk(folder) {for(const part of readdirSync(folder,{withFileTypes:true})) {const p=join(folder,part.name);if(part.isDirectory()) walk(p);else if(/\.tsx?$/.test(p))sourceFiles.push(p)}}
walk(join(dir,'src'));sourceFiles.push(join(dir,'vite.config.ts'));
for(const file of sourceFiles){const code=readFileSync(file,'utf8');const tree=ts.createSourceFile(file,code,ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(tree.parseDiagnostics.length,0,`TypeScript syntax: ${file}: ${tree.parseDiagnostics.map(e=>e.messageText).join(',')}`);
}
const rust=readFileSync(join(dir,'src-tauri/src/receiver.rs'),'utf8');
const ui=readFileSync(join(dir,'src/App.tsx'),'utf8');
const conf=JSON.parse(readFileSync(join(dir,'src-tauri/tauri.conf.json')));
const win7=JSON.parse(readFileSync(join(dir,'src-tauri/tauri.win7.conf.json')));
assert.match(rust,/fn sidecar_path\(/);
assert.match(rust,/fn setup_gstreamer\(/);
assert.match(rust,/command\.args\(\["-n", &name, "-d", "1"\]\)/);
assert.match(rust,/discovery_verified: false/);
assert.match(rust,/audio_verified: false/);
assert.match(rust,/Observation::MirrorStarted/);
assert.match(rust,/i\.epoch!=epoch/);
assert.doesNotMatch(ui,/AirPlay 已开启/);
assert.equal(conf.app.windows[0].width,480);
assert.equal(conf.app.windows[0].height,420);
assert.equal(conf.bundle.windows.webviewInstallMode.type,'downloadBootstrapper');
assert.equal(win7.bundle.windows.webviewInstallMode.type,'fixedRuntime');
assert.equal(win7.bundle.windows.webviewInstallMode.path,'./webview2-109');
assert.deepEqual(conf.bundle.targets,['nsis']);
assert.equal(JSON.parse(readFileSync(join(dir,'src-tauri/capabilities/default.json'))).permissions.includes('shell:allow-execute'),false);
assert.equal(existsSync(join(dir,'AGENTS.md')),true);
console.log(`PASS: ${sourceFiles.length} TypeScript/TSX source files syntactically parsed; Rust boundary & package configs statically validated.`);
