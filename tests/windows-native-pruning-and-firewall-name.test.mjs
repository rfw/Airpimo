import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {planWindowsPrune,applyWindowsPrune,REQUIRED} from '../scripts/prune-windows-native.mjs';

function fixture(fn){
 const root=mkdtempSync(join(tmpdir(),'airpimo-prune-test-'));
 const items=[
  'sidecar/uxplay.exe','gstreamer/bin/gst-inspect-1.0.exe','gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner.exe',
  'gstreamer/bin/libgstreamer-1.0-0.dll','gstreamer/bin/libunrelated.dll',
  'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dll','gstreamer/lib/gstreamer-1.0/libgstpango.dll',
  'gstreamer/lib/gstreamer-1.0/libgstlibav.dll','gstreamer/lib/gstreamer-1.0/libgstunrelated.dll',
 ];
 try{
  const files=items.map(path=>{
   const dest=join(root,...path.split('/'));mkdirSync(resolve(dest,'..'),{recursive:true});
   const bytes=Buffer.from(`fake-${path}`);writeFileSync(dest,bytes);
   return {path,sha256:createHash('sha256').update(bytes).digest('hex')};
  });
  const manifest={schema:1,ready:true,os:'win32',arch:'x64',files};
  writeFileSync(join(root,'native-manifest.json'),JSON.stringify(manifest));
  const mapping=Object.fromEntries(REQUIRED.map(el=>[el,el==='textoverlay'?'libgstpango.dll':el.startsWith('avdec_')?'libgstlibav.dll':'libgstcoreelements.dll']));
  const inspect=el=>mapping[el]?`Filename  C:\\staged\\${mapping[el]}\n`:null;
  const parse=bytes=>{
   const name=bytes.toString().slice(5);
   const imports=new Map();
   if(name==='sidecar/uxplay.exe'||name.includes('libgstcoreelements.dll')||name.includes('libgstpango.dll')||name.includes('libgstlibav.dll'))imports.set('libgstreamer-1.0-0.dll',new Set(['g_object_ref']));
   return {pe64:true,imports};
  };
  fn({root,files,manifest,inspect,parse});
 }finally{rmSync(root,{recursive:true,force:true});}
}
test('Windows pruning keeps UxPlay + codec/textoverlay + complete local import closure; removes unused native files',()=>fixture(f=>{
 const plan=planWindowsPrune(f.root,f);
 assert.equal(plan.ok,true,plan.problems.join('\n'));
 assert.ok(plan.removed.includes('gstreamer/bin/libunrelated.dll'));
 assert.ok(plan.removed.includes('gstreamer/lib/gstreamer-1.0/libgstunrelated.dll'));
 assert.ok(plan.kept.includes('gstreamer/bin/libgstreamer-1.0-0.dll'));
 assert.ok(plan.kept.includes('gstreamer/lib/gstreamer-1.0/libgstpango.dll'));
 assert.ok(plan.kept.includes('gstreamer/lib/gstreamer-1.0/libgstlibav.dll'));
 const pruned=applyWindowsPrune(f.root,{inspect:f.inspect,parse:f.parse});
 assert.equal(pruned.ok,true);
 assert.equal(existsSync(join(f.root,'gstreamer/bin/libunrelated.dll')),false);
 const after=JSON.parse(readFileSync(join(f.root,'native-manifest.json'),'utf8'));
 assert.equal(after.ready,true);
 assert.equal(after.windowsRuntimeSelection.strategy,'gst-element-pe-import-closure');
 for(const item of after.files){const buf=readFileSync(join(f.root,item.path));assert.equal(createHash('sha256').update(buf).digest('hex'),item.sha256);}
}));
test('Windows pruning rejects a missing required decoder without deleting anything',()=>fixture(f=>{
 const inspect=el=>el==='avdec_aac'?null:f.inspect(el);
 const plan=planWindowsPrune(f.root,{...f,inspect});
 assert.equal(plan.ok,false);
 assert.match(plan.problems.join('\n'),/avdec_aac/);
 assert.throws(()=>applyWindowsPrune(f.root,{inspect,parse:f.parse}),/blocked/);
 assert.equal(existsSync(join(f.root,'gstreamer/bin/libunrelated.dll')),true);
 assert.equal(JSON.parse(readFileSync(join(f.root,'native-manifest.json'),'utf8')).ready,true);
}));
test('Windows pruning blocks unbundled non-system DLLs and fails closed',()=>fixture(f=>{
 const parse=buffer=>{
  const original=f.parse(buffer);
  if(buffer.toString().includes('libgstpango.dll'))original.imports.set('missing-custom.dll',new Set(['symbol']));
  return original;
 };
 const plan=planWindowsPrune(f.root,{...f,parse});
 assert.equal(plan.ok,false);
 assert.match(plan.problems.join('\n'),/missing-custom.dll/);
}));
test('macOS packaged receiver is named Airpimo, source cached engine and Win7 remain uxplay',()=>{
 const root=resolve(import.meta.dirname,'..');
 const read=path=>readFileSync(join(root,path),'utf8');
 assert.match(read('scripts/stage-native.mjs'),/stagedBinName=os==='darwin'\?'Airpimo':binName/);
 assert.match(read('src-tauri/src/receiver.rs'),/\#\[cfg\(target_os = "macos"\)\] let filename = "Airpimo"/);
 assert.match(read('src-tauri/src/receiver.rs'),/\#\[cfg\(windows\)\] let filename = "uxplay\.exe"/);
 assert.match(read('scripts/native-engine-core.mjs'),/platform==='win32'\?'uxplay\.exe':'uxplay'/);
 assert.match(read('scripts/prune-macos-native.mjs'),/sidecar\/Airpimo/);
});
test('Windows native pruning is called after ABI alignment, before smoke and candidate promotion',()=>{
 const src=readFileSync(resolve(import.meta.dirname,'../scripts/native-release-prepare.mjs'),'utf8');
 const align=src.indexOf('alignWin7Runtime(candidate'),prune=src.indexOf('applyWindowsPrune(candidate'),smoke=src.indexOf('smokeWin7Plugins(candidate'),promote=src.lastIndexOf('promoteNativeCandidate(candidate');
 assert.ok(align>0&&align<prune&&prune<smoke&&smoke<promote);
});
