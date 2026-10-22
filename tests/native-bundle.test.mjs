import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,copyFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {gunzipSync,gzipSync} from 'node:zlib';
import {LOCK,RENDERER_PATCH_SHA256} from '../scripts/native-engine-core.mjs';
import {sha256,buildBundle,unpackBundle,verifyNativeTree,importBundleBytes,verifiedBundleDir,encodeTar,decodeTar,reviewedBundleForTarget} from '../scripts/native-bundle-core.mjs';
function withSandbox(fn) {const tmp=mkdtempSync(join(tmpdir(),'uxplay-runtime-v8-'));try{return fn(tmp)}finally{rmSync(tmp,{recursive:true,force:true})}}
function createFixture(dir) {
  const files={
    'sidecar/uxplay.exe':Buffer.from('4d5a900001020304','hex'),
    'gstreamer/bin/libgstreamer-1.0-0.dll':Buffer.from('4d5a90001020','hex'),
    'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dll':Buffer.from('4d5a90004321','hex'),
    'gstreamer/bin/gst-inspect-1.0.exe':Buffer.from('4d5a90008899','hex'),
  };
  const manifest={schema:1,ready:true,os:'win32',arch:'x64',upstream:{commit:LOCK.commit,rendererPatchSha256:RENDERER_PATCH_SHA256},gstreamerVersion:'1.24.12',files:[]};
  for(const [rel,bytes] of Object.entries(files)) {
    const dest=join(dir,...rel.split('/')); mkdirSync(join(dest,'..'),{recursive:true});writeFileSync(dest,bytes);
    manifest.files.push({path:rel,sha256:sha256(bytes)});
  }
  writeFileSync(join(dir,'native-manifest.json'),JSON.stringify(manifest));
  return manifest;
}
const options=(home)=>({platform:'win32',arch:'x64',env:{},home});
test('complete Windows bundle round-trip verifies all files, not just uxplay.exe',()=>withSandbox(tmp=>{
  const root=join(tmp,'from');mkdirSync(root); const manifest=createFixture(root);
  const data=buildBundle(root,options(tmp)); const extracted=join(tmp,'to');
  unpackBundle(data,extracted,options(tmp));
  assert.deepEqual(verifyNativeTree(extracted,options(tmp)),manifest);
  assert.deepEqual(readFileSync(join(root,'sidecar','uxplay.exe')),readFileSync(join(extracted,'sidecar','uxplay.exe')));
}));
test('cached full native runtime is usable without any MSYS2 build tools',()=>withSandbox(tmp=>{
  const root=join(tmp,'original');mkdirSync(root);createFixture(root);
  const opts=options(join(tmp,'home'));
  const cached=importBundleBytes(buildBundle(root,opts),opts);
  assert.equal(verifiedBundleDir(opts),cached);
  assert.equal(existsSync(join(cached,'gstreamer','lib','gstreamer-1.0','libgstcoreelements.dll')),true);
  assert.equal(verifiedBundleDir(opts),cached);
}));
test('corrupt cached DLL invalidates the entire native bundle',()=>withSandbox(tmp=>{
  const root=join(tmp,'original');mkdirSync(root);createFixture(root);const opts=options(join(tmp,'home'));
  const cached=importBundleBytes(buildBundle(root,opts),opts);
  writeFileSync(join(cached,'gstreamer','bin','libgstreamer-1.0-0.dll'),'tamper');
  assert.equal(verifiedBundleDir(opts),null);
}));
test('foreign-platform cache cannot be selected',()=>withSandbox(tmp=>{
  const root=join(tmp,'original');mkdirSync(root);createFixture(root);
  assert.throws(()=>buildBundle(root,{platform:'darwin',arch:'x64'}),/not darwin/);
}));
test('archive refuses extra unlisted binaries and missing GStreamer plugins',()=>withSandbox(tmp=>{
  const root=join(tmp,'original');mkdirSync(root);createFixture(root);const opts=options(tmp);
  const archive=buildBundle(root,opts);
  const members=decodeTar(gunzipSync(archive)); members.set('gstreamer/bin/evil.dll',Buffer.from('MZ!!'));
  assert.throws(()=>unpackBundle(gzipSync(encodeTar(members)),join(tmp,'bad'),opts),/Unlisted files/);
  const manifest=JSON.parse(members.get('native-manifest.json'));
  manifest.files=manifest.files.filter(f=>!f.path.includes('libgstcoreelements'));
  assert.throws(()=>unpackBundle(gzipSync(encodeTar(new Map([['native-manifest.json',Buffer.from(JSON.stringify(manifest))],...members.entries()].filter((e,i)=>i===0||e[0]!=='native-manifest.json')))),join(tmp,'bad2'),opts),/lacks UxPlay/);
}));
test('unsafe tar paths, symlink types and repeated names are rejected',()=>withSandbox(tmp=>{
  assert.throws(()=>encodeTar(new Map([['../outside',Buffer.from('bad')]])),/Unsafe archive/);
  const root=join(tmp,'fixture');mkdirSync(root);createFixture(root);const opts=options(tmp);
  const data=buildBundle(root,opts),raw=gunzipSync(data);
  const broken=Buffer.from(raw);broken[156]='2'.charCodeAt(0);
  assert.throws(()=>decodeTar(broken),/Only regular ustar/);
  const bad=Buffer.from(raw);bad[0]=46;
  assert.throws(()=>decodeTar(bad),/Unsafe archive/);
}));
test('bundles.json requires pinned HTTPS and audited SHA-256',()=>{
 const id='win32-x64'; const good={url:'https://download.example.com/runtime.tar.gz',sha256:'a'.repeat(64),commit:LOCK.commit,rendererPatchSha256:RENDERER_PATCH_SHA256};
 assert.deepEqual(reviewedBundleForTarget(id,{targets:{[id]:good}}),good);
 assert.equal(reviewedBundleForTarget(id,{targets:{}}),null);
 assert.throws(()=>reviewedBundleForTarget(id,{targets:{[id]:{...good,url:'http://download.example.com/unsigned'}}}),/HTTPS/);
 assert.throws(()=>reviewedBundleForTarget(id,{targets:{[id]:{...good,commit:'x'}}}),/SHA256/);
});
test('debug runtime scope is only applied to the spawned UxPlay process',()=>{
 const rust=readFileSync(new URL('../src-tauri/src/receiver.rs',import.meta.url),'utf8');
 assert.match(rust, /if let Some\(root\) = std::env::var_os\("UXPLAY_DEV_GST_ROOT"\)/);
 assert.match(rust, /command\.env\("GST_PLUGIN_PATH_1_0", &plugins\)/);
 assert.match(rust, /#\[cfg\(debug_assertions\)\][\s\S]*?if development/);
});

test('Windows native staging excludes SDK .a and unrelated executables',()=>withSandbox(tmp=>{
  const project=join(tmp,'temp-project');const scripts=join(project,'scripts');mkdirSync(scripts,{recursive:true});
  copyFileSync(new URL('../scripts/stage-native.mjs',import.meta.url),join(scripts,'stage-native.mjs'));
  const bin=join(tmp,'uxplay.exe'),gst=join(tmp,'gst');writeFileSync(bin,Buffer.from('MZfake'));
  const files={
    'bin/libgstreamer-1.0-0.dll':'MZdll',
    'bin/gst-inspect-1.0.exe':'MZtool',
    'bin/gcc.exe':'MZnotneeded',
    'lib/gstreamer-1.0/libgstcoreelements.dll':'MZplugin',
    'lib/libunused.a':'gcc-development-artifact',
    'lib/pkgconfig/gstreamer.pc':'development-pkgconfig',
  };
  for(const [file,data] of Object.entries(files)){
    const path=join(gst,...file.split('/'));mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,data);
  }
  const result=spawnSync(process.execPath,[join(scripts,'stage-native.mjs'),'--uxplay',bin,'--gst',gst,'--os','win32','--arch','x64','--upstream-commit',LOCK.commit,'--gst-version','1.24.12','--renderer-patch-sha256',RENDERER_PATCH_SHA256],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const resources=join(project,'src-tauri','resources');
  assert.equal(existsSync(join(resources,'gstreamer','lib','libunused.a')),false);
  assert.equal(existsSync(join(resources,'gstreamer','bin','gcc.exe')),false);
  assert.equal(existsSync(join(resources,'gstreamer','bin','libgstreamer-1.0-0.dll')),true);
  assert.equal(verifyNativeTree(resources,options(tmp)).ready,true);
  // Win7 candidate staging MUST NOT overwrite current resources before ABI/smoke PASS.
  const candidate=join(tmp,'win7-candidate');
  const result2=spawnSync(process.execPath,[join(scripts,'stage-native.mjs'),'--uxplay',bin,'--gst',gst,'--os','win32','--arch','x64','--upstream-commit',LOCK.commit,'--gst-version','1.24.13','--renderer-patch-sha256',RENDERER_PATCH_SHA256,'--destination',candidate],{encoding:'utf8'});
  assert.equal(result2.status,0,result2.stderr);
  assert.equal(verifyNativeTree(candidate,options(tmp)).gstreamerVersion,'1.24.13');
  assert.equal(verifyNativeTree(resources,options(tmp)).gstreamerVersion,'1.24.12');
}));
