import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,copyFileSync,renameSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {RENDERER_PATCH_SHA256} from '../scripts/native-engine-core.mjs';
import {parsePE,auditWin7Runtime} from '../scripts/win7-pe-audit.mjs';
import {alignWin7Runtime,smokeWin7Plugins} from '../scripts/win7-runtime-align.mjs';
import {promoteNativeCandidate} from '../scripts/native-release-prepare.mjs';
import {verifyFixedWebview2} from '../scripts/win7-release-core.mjs';

// Deterministic synthetic x64 PE with import descriptor, export directory, and .rdata section.
// The test does not rely on any Windows SDK/toolchain or staged native binaries.
function pe({dll=null, imported='WaitOnAddress', exported=null}={}) {
  const b=Buffer.alloc(4096);
  b.write('MZ',0);b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80);
  const co=0x84,opt=co+20;
  b.writeUInt16LE(0x8664,co);b.writeUInt16LE(1,co+2);b.writeUInt16LE(0xF0,co+16);
  b.writeUInt16LE(0x20b,opt);b.writeUInt32LE(0x200,opt+60);
  const sh=opt+0xf0;
  b.write('.rdata',sh);b.writeUInt32LE(0x1000,sh+8);b.writeUInt32LE(0x1000,sh+12);
  b.writeUInt32LE(0xe00,sh+16);b.writeUInt32LE(0x200,sh+20);
  const at=r=>r-0x1000+0x200;
  if(dll) {
    b.writeUInt32LE(0x1180,opt+112+8);b.writeUInt32LE(40,opt+112+12);
    b.writeUInt32LE(0x11c0,at(0x1180));b.writeUInt32LE(0x1240,at(0x1180)+12);
    b.writeUInt32LE(0x11c0,at(0x1180)+16);
    b.write(dll+'\0',at(0x1240));b.writeBigUInt64LE(0x1200n,at(0x11c0));
    b.write(imported+'\0',at(0x1202));
  }
  if(exported) {
    b.writeUInt32LE(0x1300,opt+112);b.writeUInt32LE(128,opt+116);
    b.writeUInt32LE(1,at(0x1300)+20);b.writeUInt32LE(1,at(0x1300)+24);
    b.writeUInt32LE(0x1450,at(0x1300)+32);b.writeUInt32LE(0x1400,at(0x1450));
    b.write(exported+'\0',at(0x1400));
  }
  return b;
}
function sandbox(fn) {const d=mkdtempSync(join(tmpdir(),'ux-win7-pe-'));try{return fn(d)}finally{rmSync(d,{recursive:true,force:true})}}
function fixture(root, entries) {
  for(const [p,data] of Object.entries(entries)){
    const dest=join(root,p);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,data);
  }
  return {files:Object.keys(entries).map(path=>({path}))};
}
const roots=Object.fromEntries([
  'sidecar/uxplay.exe',
  'gstreamer/bin/gst-inspect-1.0.exe',
  'gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner.exe',
  'gstreamer/lib/gstreamer-1.0/libgstlibav.dll',
  'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dll',
  'gstreamer/lib/gstreamer-1.0/libgstaudioconvert.dll',
  'gstreamer/lib/gstreamer-1.0/libgstaudioresample.dll',
].map(s=>[s,pe()]));
test('PE reader identifies ordinary import, known Windows API and exports',()=>{
  const parsed=parsePE(pe({dll:'KERNEL32.dll', imported:'CreateFile2', exported:'gst_plugin_libav_get_desc'}));
  assert.deepEqual([...parsed.imports.get('kernel32.dll')],['CreateFile2']);
  assert.ok(parsed.exports.has('gst_plugin_libav_get_desc'));
  assert.equal(parsed.pe64,true);
});
test('PE reader rejects corrupt header and truncated file',()=>{
  assert.throws(()=>parsePE(Buffer.from('not PE')),/invalid PE/);
  const broken=pe({dll:'KERNEL32.dll'});broken.writeUInt32LE(0xfffffff0,0x84+20+112+8);
  assert.throws(()=>parsePE(broken),/invalid PE/);
});
test('Win7 gate rejects transitive dependency importing WaitOnAddress',()=>sandbox(root=>{
  const manifest=fixture(root,{...roots,
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll':pe({dll:'avcodec-63.dll',imported:'my_codec_api'}),
    'gstreamer/bin/avcodec-63.dll':pe({dll:'librav1e.dll',imported:'my_rav_api', exported:'my_codec_api'}),
    'gstreamer/bin/librav1e.dll':pe({dll:'api-ms-win-core-synch-l1-2-0.dll',imported:'WaitOnAddress',exported:'my_rav_api'}),
  });
  const result=auditWin7Runtime(root,manifest);
  assert.equal(result.ok,false);
  assert.match(result.problems.join('\n'),/WaitOnAddress.*Windows 8/);
  assert.ok(result.inspected>=9);
}));
test('Win7 gate rejects incompatible local export instead of ignoring ABI mismatch',()=>sandbox(root=>{
  const manifest=fixture(root,{...roots,
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll':pe({dll:'avcodec-63.dll',imported:'expected_export'}),
    'gstreamer/bin/avcodec-63.dll':pe({exported:'different_export'}),
  });
  const result=auditWin7Runtime(root,manifest);
  assert.match(result.problems.join('\n'),/bundled import\/export mismatch/);
}));
test('compatible synthetic closure passes known Win7 import gate',()=>sandbox(root=>{
  const manifest=fixture(root,{...roots,
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll':pe({dll:'avcodec-63.dll',imported:'av_api'}),
    'gstreamer/bin/avcodec-63.dll':pe({exported:'av_api'}),
  });
  const result=auditWin7Runtime(root,manifest);
  assert.deepEqual(result.problems,[]);
  assert.equal(result.ok,true);
}));
test('WebView2 gate catches nested folder and wrong version',()=>sandbox(dir=>{
  const conf={bundle:{windows:{webviewInstallMode:{type:'fixedRuntime',path:'./webview2-109'}}}};
  writeFileSync(join(dir,'tauri.conf.json'),JSON.stringify(conf));
  writeFileSync(join(dir,'tauri.win7.conf.json'),JSON.stringify(conf));
  mkdirSync(join(dir,'webview2-109','Microsoft.WebView2.FixedVersionRuntime.109'),{recursive:true});
  const exe=join(dir,'webview2-109','Microsoft.WebView2.FixedVersionRuntime.109','msedgewebview2.exe');writeFileSync(exe,'MZ');
  assert.throws(()=>verifyFixedWebview2({dir,host:'win32'}),/must directly contain/);
  writeFileSync(join(dir,'webview2-109','msedgewebview2.exe'),'MZ');
  const good=verifyFixedWebview2({dir,host:'win32',run:()=>({status:0,stdout:'109.0.1518.78\n'})});
  assert.equal(good.version,'109.0.1518.78');
  assert.throws(()=>verifyFixedWebview2({dir,host:'win32',run:()=>({status:0,stdout:'145.0.0.1'})}),/expected WebView2 109/);
}));


test('Win7 reconciliation pairs the engine CRT and adds its entire missing DLL dependency chain',()=>sandbox(dir=>{
  const root=join(dir,'candidate'), source=join(dir,'msys64','mingw64','bin');
  mkdirSync(root,{recursive:true});mkdirSync(source,{recursive:true});
  const manifest=fixture(root,{...roots,
    'sidecar/uxplay.exe':pe({dll:'libstdc++-6.dll',imported:'__engine_std_symbol'}),
    'gstreamer/bin/libstdc++-6.dll':pe({exported:'__old_symbol'}),
    'gstreamer/bin/libwinpthread-1.dll':pe({exported:'__old_pthread_symbol'}),
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll':pe({dll:'libcrypto-3-x64.dll',imported:'crypto_func'}),
  });
  writeFileSync(join(root,'native-manifest.json'),JSON.stringify({schema:1,ready:true,os:'win32',arch:'x64',files:manifest.files.map(f=>({path:f.path,sha256:'x'}))}));
  writeFileSync(join(source,'libstdc++-6.dll'),pe({exported:'__engine_std_symbol'}));
  writeFileSync(join(source,'libwinpthread-1.dll'),pe({exported:'__new_pthread_symbol'}));
  writeFileSync(join(source,'libcrypto-3-x64.dll'),pe({dll:'libplist-2.0.dll',imported:'plist_func',exported:'crypto_func'}));
  writeFileSync(join(source,'libplist-2.0.dll'),pe({exported:'plist_func'}));
  const result=alignWin7Runtime(root,source);
  assert.equal(result.changed.length,4);
  assert.equal(auditWin7Runtime(root,result.manifest).ok,true);
  for(const name of ['libstdc++-6.dll','libwinpthread-1.dll','libcrypto-3-x64.dll','libplist-2.0.dll']) {
    const file=`gstreamer/bin/${name}`;
    assert.ok(result.manifest.files.some(f=>f.path===file && /^[a-f0-9]{64}$/.test(f.sha256)));
  }
}));

test('Win7 reconciliation rejects a wrong C++ CRT rather than changing unrelated media DLLs',()=>sandbox(dir=>{
  const root=join(dir,'candidate'), source=join(dir,'toolchain');
  mkdirSync(source,{recursive:true});
  const manifest=fixture(root,{...roots,
    'sidecar/uxplay.exe':pe({dll:'libstdc++-6.dll',imported:'__required_symbol'}),
    'gstreamer/bin/libstdc++-6.dll':pe({exported:'__old'}),
  });
  writeFileSync(join(root,'native-manifest.json'),JSON.stringify({schema:1,files:manifest.files.map(f=>({path:f.path,sha256:'x'}))}));
  writeFileSync(join(source,'libstdc++-6.dll'),pe({exported:'__still_wrong'}));
  writeFileSync(join(source,'libwinpthread-1.dll'),pe());
  assert.throws(()=>alignWin7Runtime(root,source),/import\/export mismatch/);
}));

test('candidate promotion updates three artifacts together and preserves unrelated resource files',()=>sandbox(dir=>{
  const candidate=join(dir,'candidate'),destination=join(dir,'resources');
  for(const name of ['sidecar','gstreamer']) {
    mkdirSync(join(candidate,name),{recursive:true});mkdirSync(join(destination,name),{recursive:true});
    writeFileSync(join(candidate,name,'tag'),'new');writeFileSync(join(destination,name,'tag'),'old');
  }
  writeFileSync(join(candidate,'native-manifest.json'),'new manifest');
  writeFileSync(join(destination,'native-manifest.json'),'old manifest');
  writeFileSync(join(destination,'unrelated.txt'),'retain');
  promoteNativeCandidate(candidate,destination);
  for(const name of ['sidecar','gstreamer']) assert.equal(readFileSync(join(destination,name,'tag'),'utf8'),'new');
  assert.equal(readFileSync(join(destination,'native-manifest.json'),'utf8'),'new manifest');
  assert.equal(readFileSync(join(destination,'unrelated.txt'),'utf8'),'retain');
}));

test('plugin smoke probes all three decoder entries with packaged paths',()=>sandbox(dir=>{
  const bin=join(dir,'gstreamer','bin'),scan=join(dir,'gstreamer','libexec','gstreamer-1.0');
  mkdirSync(bin,{recursive:true});mkdirSync(scan,{recursive:true});
  writeFileSync(join(bin,'gst-inspect-1.0.exe'),'fake');writeFileSync(join(scan,'gst-plugin-scanner.exe'),'fake');
  const visited=[];
  assert.equal(smokeWin7Plugins(dir,{host:'win32',env:{PATH:'C:\\Windows'},run:(exe,args,opts)=>{
    visited.push(args[0]);assert.ok(opts.env.PATH.startsWith(bin+';'));
    assert.equal(opts.env.GST_PLUGIN_PATH_1_0,join(dir,'gstreamer','lib','gstreamer-1.0'));
    return {status:0,stdout:'pass'};
  }}),true);
  assert.deepEqual(visited,['libav','avdec_h264','avdec_aac']);
}));


test('failed promotion restores old native resource tree and does not remove unrelated files',()=>sandbox(dir=>{
  const candidate=join(dir,'candidate'), destination=join(dir,'resources');
  for(const folder of ['sidecar','gstreamer']) {
    mkdirSync(join(candidate,folder),{recursive:true});mkdirSync(join(destination,folder),{recursive:true});
    writeFileSync(join(candidate,folder,'tag'),'new');writeFileSync(join(destination,folder,'tag'),'old');
  }
  // Intentionally omit candidate/native-manifest.json to force rollback.
  writeFileSync(join(destination,'native-manifest.json'),'old manifest');
  writeFileSync(join(destination,'user-settings.txt'),'keep');
  assert.throws(()=>promoteNativeCandidate(candidate,destination));
  for(const folder of ['sidecar','gstreamer']) assert.equal(readFileSync(join(destination,folder,'tag'),'utf8'),'old');
  assert.equal(readFileSync(join(destination,'native-manifest.json'),'utf8'),'old manifest');
  assert.equal(readFileSync(join(destination,'user-settings.txt'),'utf8'),'keep');
}));

// Windows can refuse renaming the entire GStreamer directory (EPERM) even
// when individual files remain writable. Exercise the safe fallback with a
// complete, hash-verifiable native manifest on a non-Windows test host.
function writePromotableRuntime(root, tag) {
  const files={
    [`sidecar/${process.platform==='win32'?'uxplay.exe':'uxplay'}`]:`engine-${tag}`,
    'gstreamer/bin/example.dll':`dll-${tag}`,
    [`gstreamer/lib/libgstreamer-1.0.${process.platform==='darwin'?'dylib':'so'}`]:`core-${tag}`,
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll':`plugin-${tag}`,
  };
  fixture(root,files);
  const manifest={
    schema:1,ready:true,os:process.platform,arch:process.arch,
    upstream:{commit:'df67c212a433cf6dda3676dd40c097900d24e645',rendererPatchSha256:RENDERER_PATCH_SHA256},
    gstreamerVersion:'1.24.13',
    files:Object.entries(files).map(([path,contents])=>({
      path,sha256:createHash('sha256').update(contents).digest('hex'),
    })),
  };
  writeFileSync(join(root,'native-manifest.json'),JSON.stringify(manifest));
}
function simulateDirectoryLock(destination) {
  let once=true;
  return (from,to)=>{
    if(once && from===join(destination,'gstreamer')) {
      once=false;
      const e=new Error('simulated Windows directory handle lock');e.code='EPERM';throw e;
    }
    renameSync(from,to);
  };
}

test('Win7 EPERM directory rename falls back to backed-up file promotion and removes stale DLLs',()=>sandbox(dir=>{
  const candidate=join(dir,'candidate'),destination=join(dir,'resources');
  writePromotableRuntime(candidate,'new');
  writePromotableRuntime(destination,'old');
  writeFileSync(join(destination,'gstreamer','bin','stale.dll'),'stale');
  writeFileSync(join(destination,'unrelated.txt'),'keep');
  promoteNativeCandidate(candidate,destination,{
    rename:simulateDirectoryLock(destination),allowInPlaceFallback:true,
  });
  assert.equal(readFileSync(join(destination,'sidecar',process.platform==='win32'?'uxplay.exe':'uxplay'),'utf8'),'engine-new');
  assert.equal(readFileSync(join(destination,'gstreamer','bin','example.dll'),'utf8'),'dll-new');
  assert.equal(existsSync(join(destination,'gstreamer','bin','stale.dll')),false);
  assert.equal(readFileSync(join(destination,'unrelated.txt'),'utf8'),'keep');
}));

test('Win7 EPERM fallback restores existing native assets if a file update fails',()=>sandbox(dir=>{
  const candidate=join(dir,'candidate'),destination=join(dir,'resources');
  writePromotableRuntime(candidate,'new');
  writePromotableRuntime(destination,'old');
  writeFileSync(join(destination,'gstreamer','bin','legacy.dll'),'old-only');
  const originalManifest=readFileSync(join(destination,'native-manifest.json'));
  let failed=false;
  assert.throws(()=>promoteNativeCandidate(candidate,destination,{
    rename:simulateDirectoryLock(destination),allowInPlaceFallback:true,
    copyFile:(from,to)=>{
      copyFileSync(from,to);
      if(!failed && from===join(candidate,'gstreamer','bin','example.dll')) {
        failed=true;throw Error('simulated failure midway through file promotion');
      }
    },
  }),/old native resources restored/);
  assert.equal(failed,true);
  assert.equal(readFileSync(join(destination,'sidecar',process.platform==='win32'?'uxplay.exe':'uxplay'),'utf8'),'engine-old');
  assert.equal(readFileSync(join(destination,'gstreamer','bin','example.dll'),'utf8'),'dll-old');
  assert.equal(readFileSync(join(destination,'gstreamer','bin','legacy.dll'),'utf8'),'old-only');
  assert.deepEqual(readFileSync(join(destination,'native-manifest.json')),originalManifest);
}));
