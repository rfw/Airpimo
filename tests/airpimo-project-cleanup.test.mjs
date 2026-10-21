import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,readdirSync,rmSync } from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {plan,clean} from '../scripts/ci/clean-airpimo-project.mjs';
function fixture(run){
 const root=mkdtempSync(join(tmpdir(),'airpimo-clean-v27-'));
 function put(p,v='old'){mkdirSync(join(root,p,'..'),{recursive:true});writeFileSync(join(root,p),v);}
 put('package.json',JSON.stringify({name:'airpimo',version:'0.1.8'}));
 put('src/App.tsx','keep app');put('src-tauri/tauri.conf.json','{}');
 put('LICENSE','GPLv3');put('THIRD_PARTY_NOTICES.txt','UxPlay GPLv3');
 put('README.md','# Airpimo\n## V21 修复记录\n');put('AGENTS.md','legacy');put('.gitignore','dist/\n');
 put('.airpimo-v21-backup/src/App.tsx','legacy backup');
 put('.airpimo-ui-v21-backup/README.md','legacy');
 put('.airpimo-brand-backup/README.md','legacy');
 put('.win-cxx-abi-backup/libstdc++-6.dll','legacy');
 put('AIRPIMO-DESKTOP-UI-REDESIGN-v21.md','legacy');
 put('BRIGHTNESS80-PATCH-README.md','legacy');
 put('docs/TEST_REPORT.md','legacy');put('docs/WINDOWS-BUILD-TARGETS.md','legacy');
 put('docs/KEEP-CUSTOM.md','custom');
 put('native/README.md','# native V8');
 put('src-tauri/Cargo.lock','critical');put('src-tauri/Cargo.lock.bak','old');
 put('src-tauri/resources/gstreamer/bin/libstdc++-6.dll','critical binary');
 put('third_party/UPSTREAM.md','UxPlay original license');
 try{return run(root);}finally{rmSync(root,{recursive:true,force:true});}
}
test('dry run never touches any source, original documents or native binaries',()=>fixture(root=>{
 const result=clean(root,false);
 assert.ok(result.removals.some(x=>x.path==='.win-cxx-abi-backup'));
 assert.equal(readFileSync(join(root,'README.md'),'utf8'),'# Airpimo\n## V21 修复记录\n');
 assert.equal(existsSync(join(root,'.airpimo-v21-backup')),true);
 assert.equal(existsSync(join(root,'docs/TEST_REPORT.md')),true);
}));
test('apply deletes only known backups and old docs; keeps git, license, binaries, custom notes',()=>fixture(root=>{
 const r=clean(root,true);
 assert.ok(r.removals.length>4);
 for(const p of ['.airpimo-v21-backup','.airpimo-brand-backup','.airpimo-ui-v21-backup','.win-cxx-abi-backup','AIRPIMO-DESKTOP-UI-REDESIGN-v21.md','BRIGHTNESS80-PATCH-README.md','docs/TEST_REPORT.md','docs/WINDOWS-BUILD-TARGETS.md','src-tauri/Cargo.lock.bak'])assert.equal(existsSync(join(root,p)),false,p);
 for(const p of ['LICENSE','THIRD_PARTY_NOTICES.txt','src-tauri/Cargo.lock','third_party/UPSTREAM.md','src-tauri/resources/gstreamer/bin/libstdc++-6.dll','docs/KEEP-CUSTOM.md'])assert.equal(existsSync(join(root,p)),true,p);
 const readme=readFileSync(join(root,'README.md'),'utf8');
 assert.match(readme,/Airpimo/);assert.match(readme,/github.com\/rfw\/Airpimo/);
 assert.doesNotMatch(readme,/## V\d+|修复记录|升级日志/);
 assert.match(readFileSync(join(root,'.gitignore'),'utf8'),/\.win-cxx-abi-backup/);
 assert.equal(plan(root).removals.length,0);
 assert.equal(plan(root).writes.length,0);
}));
test('unknown docs are preserved and reported for manual review',()=>fixture(root=>{
 const result=clean(root,true);
 assert.ok(result.unknownDocs.includes('docs/KEEP-CUSTOM.md'));
 assert.equal(existsSync(join(root,'docs/KEEP-CUSTOM.md')),true);
}));
test('cleanup rejects directory without Airpimo layout',()=>fixture(root=>{
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'another-app'}));
 assert.throws(()=>clean(root,true),/不是预期的 Airpimo/);
 assert.equal(existsSync(join(root,'.airpimo-v21-backup')),true);
}));
