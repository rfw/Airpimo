#!/usr/bin/env node
/**
 * Airpimo v24: keep v19/v21 regression guards compatible with the v23
 * native diagnostic export while still verifying the complete IPC/Rust path.
 * Edits only two narrow sources + .gitignore, with backups and idempotency.
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const rootDefault = fileURLToPath(new URL('../..',import.meta.url));

const oldUI = String.raw`      if (!/<AirpimoHome(?:\s|\/>)/.test(original) || !original.includes("airpimo-diagnostics-")) throw new Error('App.tsx: UI 处于不完整状态');`;
const newUI = String.raw`      const homePresent = /<AirpimoHome(?:\s|\/>)/.test(original);
      // v19/v21 generated a Blob filename in React. v23 moves the filename and
      // actual file write into Rust, leaving a native export call in React.
      const legacyExport = original.includes('airpimo-diagnostics-');
      const nativeExport = /await desktop\.exportDiagnostics\(\)/.test(original) &&
        /setDiagnosticsExportStatus\(/.test(original) &&
        original.includes('diagnosticsExporting');
      if (!homePresent || !(legacyExport || nativeExport)) throw new Error('App.tsx: UI 处于不完整状态');`;

const oldBrand = "  assert.match(read('src/App.tsx'),/airpimo-diagnostics-/);";
const newBrand = String.raw`  const app = read('src/App.tsx');
  if (/await desktop\.exportDiagnostics\(\)/.test(app)) {
    // Native export is a cross-layer contract: verify frontend + IPC + Rust,
    // not only the old download filename location.
    assert.match(app,/setDiagnosticsExportStatus\(/);
    assert.doesNotMatch(app,/URL\.createObjectURL/);
    assert.match(read('src/lib/desktop.ts'),/invoke\('export_diagnostics'\)/);
    const rust = read('src-tauri/src/lib.rs');
    assert.match(rust,/fn export_diagnostics\(app:AppHandle\)/);
    assert.match(rust,/let filename=format!\("airpimo-diagnostics-/);
    assert.match(rust,/std::fs::write\(&destination,controller\(&app\)\.diagnostics\(\)\)/);
    assert.match(rust,/save_settings,get_diagnostics,export_diagnostics\]/);
  } else {
    // Keep older v19/v21 snapshot tests useful for pre-v23 source trees.
    assert.match(app,/airpimo-diagnostics-/);
  }`;

function one(before, from, to, name) {
  if (before.includes(to)) return before;
  const idx=before.indexOf(from);
  if(idx<0 || before.indexOf(from,idx+from.length)>=0) throw Error(`${name}: source marker missing or duplicated; no changes applied`);
  return before.slice(0,idx)+to+before.slice(idx+from.length);
}
export function plan(root=rootDefault) {
  const changes=new Map();
  function edit(relative,fn) {
    const absolute=join(root,relative);
    if(!existsSync(absolute))throw Error(`Missing ${relative}`);
    const before=readFileSync(absolute,'utf8');
    const after=fn(before);
    if(before!==after)changes.set(relative,{before,after,absolute});
  }
  // v23 accidentally generated an unclosed JSX expression in the log export status.
  const beforeJsx = '{diagnosticsExportStatus}</p>';
  const afterJsx = '{diagnosticsExportStatus}</p>}';
  edit('src/App.tsx', s => {
    if (!s.includes('await desktop.exportDiagnostics()')) return s; // pre-v23
    return one(s,beforeJsx,afterJsx,'v23 diagnostic status JSX');
  });
  edit('scripts/ci/apply-airpimo-v23.mjs', s => one(s,beforeJsx,afterJsx,'v23 installer JSX template'));
  edit('scripts/ci/apply-airpimo-ui-v21.mjs', s => s.includes('const legacyExport = /link\\.download') ? s : one(s,oldUI,newUI,'v21 home UI validator'));
  edit('tests/airpimo-brand.test.mjs', s => s.includes('(?:,open_release_page)?') ? s : one(s,oldBrand,newBrand,'v19 brand diagnostics assertion'));
  edit('.gitignore', s => s.includes('.airpimo-v24-backup/') ? s : `${s.replace(/\s*$/,'')}\n.airpimo-v24-backup/\n`);
  return changes;
}
export function apply(root=rootDefault,write=false) {
  const changes=plan(root);
  if(write){
    for(const [name,entry] of changes){
      const backup=join(root,'.airpimo-v24-backup',name);
      mkdirSync(dirname(backup),{recursive:true});
      if(!existsSync(backup))writeFileSync(backup,entry.before,'utf8');
    }
    for(const entry of changes.values())writeFileSync(entry.absolute,entry.after,'utf8');
  }
  return [...changes.keys()];
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const mode=process.argv[2]??'--check';
    if(!['--apply','--check'].includes(mode))throw Error('Usage: --apply|--check');
    const changed=apply(rootDefault,mode==='--apply');
    for(const file of changed)console.log(`[airpimo-v24] ${mode==='--apply'?'UPDATED':'PENDING'} ${file}`);
    if(mode==='--check' && changed.length)throw Error('v24 has not been applied');
    console.log(`[airpimo-v24] PASS (${changed.length} changed)`);
  }catch(e){console.error(`[airpimo-v24] BLOCKED: ${e.message}`);process.exitCode=2;}
}
