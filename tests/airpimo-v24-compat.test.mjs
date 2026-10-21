import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {plan} from '../scripts/ci/apply-airpimo-v24.mjs';
import {planAirpimoUI} from '../scripts/ci/apply-airpimo-ui-v21.mjs';
const root = resolve(import.meta.dirname,'..');

test('v24 patch is fully applied and safe to repeat',()=>{
  assert.equal(plan(root).size,0);
  const app=readFileSync(join(root,'src/App.tsx'),'utf8');
  assert.match(app,/await desktop\.exportDiagnostics\(\)/);
  assert.match(readFileSync(join(root,'src-tauri/src/lib.rs'),'utf8'),/airpimo-diagnostics-/);
  assert.match(app,/title=\{diagnosticsExportStatus\}>\{diagnosticsExportStatus\}<\/p>\}/);
  assert.match(readFileSync(join(root,'scripts/ci/apply-airpimo-v23.mjs'),'utf8'),/\{diagnosticsExportStatus\}<\/p>\}/);
});

test('v21 guard rejects an incomplete v23 export instead of ignoring missing functionality',()=>{
  const temp=mkdtempSync(join(tmpdir(),'airpimo-v24-negative-'));
  try {
    const paths=['src/App.tsx','src/main.tsx','src-tauri/tauri.conf.json','src-tauri/capabilities/default.json','.gitignore','src/components/AirpimoHome.tsx','src/domain/home-status.ts','src/styles/airpimo-home.css'];
    for(const path of paths){const to=join(temp,path);mkdirSync(dirname(to),{recursive:true});cpSync(join(root,path),to);}
    const path=join(temp,'src/App.tsx');
    const source=readFileSync(path,'utf8');
    assert.ok(source.includes('await desktop.exportDiagnostics()'));
    writeFileSync(path,source.replace('await desktop.exportDiagnostics()',"await desktop.diagnostics()"));
    assert.throws(()=>planAirpimoUI(temp),/不完整/);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
