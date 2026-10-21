import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {macAppCandidates,selectMacApp} from '../scripts/verify-app-bundle.mjs';

function fixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),'uxplay-app-discovery-'));
  try{return fn(dir);}finally{rmSync(dir,{force:true,recursive:true});}
}
function appAt(dir) {
  const app=join(dir,'UxPlay Desktop.app');
  mkdirSync(join(app,'Contents','Resources'),{recursive:true});
  mkdirSync(join(app,'Contents','MacOS'),{recursive:true});
  writeFileSync(join(app,'Contents','Info.plist'),'fixture');
  return app;
}

test('a DMG-only output is not accepted as a verified .app',()=>fixture(root=>{
  const d=join(root,'src-tauri','target','x86_64-apple-darwin','release','bundle','dmg');
  mkdirSync(d,{recursive:true});writeFileSync(join(d,'UxPlay.dmg'),'dmg only');
  const found=macAppCandidates(root,'x86_64-apple-darwin');
  assert.deepEqual(found.apps,[]);
  assert.throws(()=>selectMacApp({projectRoot:root,target:'x86_64-apple-darwin'}),/--bundles app,dmg/);
}));

test('finds app in target-qualified Intel Tauri directory',()=>fixture(root=>{
  const app=appAt(join(root,'src-tauri','target','x86_64-apple-darwin','release','bundle','macos'));
  assert.equal(selectMacApp({projectRoot:root,target:'x86_64-apple-darwin'}),app);
}));

test('finds app in host-native ARM64 and root-level target directories',()=>fixture(root=>{
  const app=appAt(join(root,'target','release','bundle','macos'));
  assert.equal(selectMacApp({projectRoot:root,target:'aarch64-apple-darwin'}),app);
}));

test('supports explicit CARGO_TARGET_DIR without scanning unrelated paths',()=>fixture(root=>{
  const cargoDir=join(root,'custom-output');
  const app=appAt(join(cargoDir,'aarch64-apple-darwin','release','bundle','macos'));
  assert.equal(selectMacApp({projectRoot:root,target:'aarch64-apple-darwin',cargoTargetDir:cargoDir}),app);
}));

test('multiple .app candidates block instead of silently verifying the wrong app',()=>fixture(root=>{
  appAt(join(root,'target','release','bundle','macos'));
  const specific=appAt(join(root,'src-tauri','target','aarch64-apple-darwin','release','bundle','macos'));
  assert.throws(()=>selectMacApp({projectRoot:root,target:'aarch64-apple-darwin'}),/found 2/);
  assert.equal(selectMacApp({projectRoot:root,target:'aarch64-apple-darwin',explicitApp:specific}),specific);
}));

test('invalid targets and nonexistent explicit paths fail closed',()=>fixture(root=>{
  assert.throws(()=>macAppCandidates(root,'aarch64-pc-windows-msvc'),/Unknown macOS/);
  assert.throws(()=>selectMacApp({projectRoot:root,target:'x86_64-apple-darwin',explicitApp:join(root,'missing.app')}),/Not a .app directory/);
}));

test('both hosted Mac jobs explicitly emit app,dmg before verifying actual bundle',()=>{
  const workflow=readFileSync(resolve(import.meta.dirname,'../.github/workflows/release-gate.yml'),'utf8');
  for(const triple of ['x86_64-apple-darwin','aarch64-apple-darwin']) {
    assert.match(workflow,new RegExp(`npx tauri build --target ${triple} --bundles app,dmg`));
    assert.match(workflow,new RegExp(`npm run native:verify:app -- --target ${triple}`));
  }
  assert.equal((workflow.match(/--bundles app,dmg/g)??[]).length,2);
  assert.match(workflow,/if-no-files-found: error/);
});
