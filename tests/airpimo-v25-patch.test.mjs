import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {dirname, resolve, join} from 'node:path';
import {plan,apply} from '../scripts/ci/apply-airpimo-v25.mjs';
const root=resolve(import.meta.dirname,'..');

test('v25 source patch is idempotent after installation',()=>{
  const installed = readFileSync(join(root,'src/App.tsx'),'utf8');
  assert.match(installed,/airpimo-panel-updates/);
  assert.match(installed,/id="uxplayArgs"/);
  const done=spawnSync(process.execPath,['scripts/ci/apply-airpimo-uxplay-args.mjs','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(done.status,0,done.stderr);
});

test('an unknown App.tsx refuses changes without mutating unrelated sources',()=>{
  const tmp=mkdtempSync(join(tmpdir(),'airpimo-v25-reject-'));
  try{
    const manifest=JSON.parse(readFileSync(join(root,'scripts/ci/airpimo-v25-edits.json'),'utf8'));
    for(const path of [...manifest.assets.map(a=>a.path),...manifest.edits.map(e=>e.path),'scripts/ci/airpimo-v25-edits.json']){
      const dest=join(tmp,path);mkdirSync(dirname(dest),{recursive:true});cpSync(join(root,path),dest);
    }
    const app=join(tmp,'src/App.tsx');
    const css=join(tmp,'src/styles/airpimo-settings-tabs.css');
    const text=readFileSync(css,'utf8');
    const expert=text.indexOf('\n/* Expert receiver parameters:');
    if(expert>=0)writeFileSync(css,text.slice(0,expert));
    writeFileSync(app,'export default function App() { return null; }');
    const oldRust=readFileSync(join(tmp,'src-tauri/src/lib.rs'),'utf8');
    assert.throws(()=>apply(tmp,true),/不匹配|锚点/);
    assert.equal(readFileSync(join(tmp,'src-tauri/src/lib.rs'),'utf8'),oldRust);
    assert.equal(readFileSync(app,'utf8'),'export default function App() { return null; }');
  }finally{rmSync(tmp,{recursive:true,force:true});}
});
