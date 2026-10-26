import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {auditMacNative,parseLibraries,parseRpaths} from '../scripts/audit-macos-native.mjs';
import {planMacRelocation} from '../scripts/relocate-macos-native.mjs';
async function fixture(fn) {
  const root=mkdtempSync(join(tmpdir(),'uxplay-macho-test-'));
  const paths=['sidecar/Airpimo Player','gstreamer/lib/libgst.dylib','gstreamer/lib/gstreamer-1.0/libgstvideo.so'];
  for(const path of paths){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),Buffer.from('cffaedfe00000000','hex'));}
  const manifest={schema:1,ready:true,os:'darwin',arch:'x64',files:paths.map(path=>({path,sha256:'test'}))};
  try{return await fn({root,manifest,paths});}finally{rmSync(root,{recursive:true,force:true});}
}
function mockOtool(root,{external=false,unresolved=false}={}) {
  return (tool,args)=>{
    if(tool==='lipo')return {status:0,stdout:'x86_64\n'};
    assert.equal(tool,'otool');
    const file=args.at(-1);
    const portableFile=file.replaceAll('\\','/');
    if(args[0]==='-l')return {status:0,stdout:`${file}:\nLoad command 3\n          cmd LC_RPATH\n      cmdsize 48\n         path @loader_path/../gstreamer/lib (offset 12)\n`};
    if(args[0]==='-L') {
      let libs;
      if(portableFile.endsWith('/sidecar/Airpimo Player'))libs=[unresolved?'@rpath/libnothing.dylib':external?'/usr/local/opt/gstreamer/lib/libgst.dylib':'@loader_path/../gstreamer/lib/libgst.dylib','/usr/lib/libSystem.B.dylib'];
      else if(file.endsWith('libgst.dylib'))libs=['@loader_path/libgst.dylib','/usr/lib/libSystem.B.dylib'];
      else libs=['@loader_path/../libgst.dylib','/usr/lib/libSystem.B.dylib'];
      return {status:0,stdout:`${file}:\n${libs.map(v=>`  ${v} (compatibility version 1.0.0, current version 1.0.0)`).join('\n')}\n`};
    }
    throw new Error('Unexpected command '+args.join(' '));
  };
}
test('otool parser reads LC_RPATH and dependency lines',()=>{
  assert.deepEqual(parseLibraries('exe:\n  /usr/lib/libSystem.B.dylib (compatibility version 1.0.0)\n'),['/usr/lib/libSystem.B.dylib']);
  assert.deepEqual(parseRpaths('Load command 3\n cmd LC_RPATH\n cmdsize 48\n path @loader_path/lib (offset 12)\n'),['@loader_path/lib']);
});
test('every staged Mach-O file has self-contained or system deps',()=>fixture(({root,manifest})=>{
  const result=auditMacNative(root,{manifest,run:mockOtool(root)});
  assert.equal(result.ok,true,JSON.stringify(result.problems));assert.equal(result.filesExamined,3);
}));
test('absolute Homebrew link is rejected even when files are copied',()=>fixture(({root,manifest})=>{
  const result=auditMacNative(root,{manifest,run:mockOtool(root,{external:true})});
  assert.equal(result.ok,false);assert.match(result.problems.join('\n'),/absolute dependency/);
}));
test('unresolved @rpath is rejected rather than assumed okay',()=>fixture(({root,manifest})=>{
  const result=auditMacNative(root,{manifest,run:mockOtool(root,{unresolved:true})});
  assert.equal(result.ok,false);assert.match(result.problems.join('\n'),/unresolved/);
}));
test('relocation plan maps Homebrew dylib references to packaged relative loader paths',()=>fixture(({root,manifest})=>{
  const plan=planMacRelocation(root,{manifest,run:mockOtool(root,{external:true})});
  assert.equal(plan.ok,true,JSON.stringify(plan.problems));
  assert.ok(plan.operations.some(op=>op.type==='change'&&op.path==='sidecar/Airpimo Player'&&op.to==='@loader_path/../gstreamer/lib/libgst.dylib'));
}));
test('relocation plan blocks dependencies missing from staging',()=>fixture(({root,manifest})=>{
  const plan=planMacRelocation(root,{manifest,run:mockOtool(root,{unresolved:true})});
  assert.equal(plan.ok,false);assert.match(plan.problems.join('\n'),/missing packaged dependency/);
}));
test('manifest is bundled and build verifies the actual .app copy',async()=>{
  const {readFileSync}=await import('node:fs');
  const {resolve}=await import('node:path');
  const root=resolve(import.meta.dirname,'..');
  const conf=JSON.parse(readFileSync(join(root,'src-tauri/tauri.conf.json')));
  const pkg=JSON.parse(readFileSync(join(root,'package.json')));
  assert.equal(conf.bundle.resources['resources/native-manifest.json'],'native-manifest.json');
  assert.match(pkg.scripts['desktop:build:mac'],/native:verify:app/);
});
test('receiver start locks out duplicate IPC before child handle exists',async()=>{
  const {readFileSync}=await import('node:fs');
  const {resolve}=await import('node:path');
  const rust=readFileSync(resolve(import.meta.dirname,'../src-tauri/src/receiver.rs'),'utf8');
  assert.match(rust,/fn start_already_in_progress\(/);
  assert.match(rust,/if start_already_in_progress\(i.child.is_some\(\), i.stopping, i.stage\)/);
  assert.match(rust,/fn start_guard_blocks_parallel_start_before_child_spawn/);
});

test('staged architecture mismatch fails instead of producing wrong-CPU .app',()=>fixture(({root,manifest})=>{
  const base=mockOtool(root);
  const run=(tool,args,opts)=>tool==='lipo'?{status:0,stdout:'arm64\n'}:base(tool,args,opts);
  const result=auditMacNative(root,{manifest,run});
  assert.equal(result.ok,false);assert.match(result.problems.join('\n'),/architecture/);
}));

test('relocation apply updates manifest hashes only after successful staged audit',async()=>fixture(async ({root,manifest})=>{
  const {readFileSync,writeFileSync}=await import('node:fs');
  const {applyMacRelocation}=await import('../scripts/relocate-macos-native.mjs');
  writeFileSync(join(root,'native-manifest.json'),JSON.stringify(manifest));
  let relocated=false;
  const run=(tool,args,opts)=>{
    if(tool==='install_name_tool') {relocated=true;return {status:0,stdout:''};}
    return mockOtool(root,{external:!relocated})(tool,args,opts);
  };
  const result=applyMacRelocation(root,{run});
  assert.ok(result.operations>0);
  const saved=JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
  assert.equal(saved.ready,true);assert.equal(saved.relocated,true);
  assert.match(saved.files[0].sha256,/^[a-f0-9]{64}$/);
}));

test('relocation failure leaves manifest blocked for release',async()=>fixture(async ({root,manifest})=>{
  const {readFileSync,writeFileSync}=await import('node:fs');
  const {applyMacRelocation}=await import('../scripts/relocate-macos-native.mjs');
  writeFileSync(join(root,'native-manifest.json'),JSON.stringify(manifest));
  const run=(tool,args,opts)=>tool==='install_name_tool'?{status:1,stderr:'fake link failure'}:mockOtool(root,{external:true})(tool,args,opts);
  assert.throws(()=>applyMacRelocation(root,{run}),/Relocation failed/);
  const saved=JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
  assert.equal(saved.ready,false);
}));
