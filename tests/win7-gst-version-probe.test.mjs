import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readWin7GstSdkVersion} from '../scripts/ci/gst-sdk-version.mjs';

function sandbox(fn) {
 const root=mkdtempSync(join(tmpdir(),'uxplay-gst-sdk-version-'));
 try{return fn(root);}finally{rmSync(root,{recursive:true,force:true});}
}
function sdk(root,{pc='1.24.13',major=1,minor=24,micro=13}={}) {
  const p=join(root,'lib','pkgconfig','gstreamer-1.0.pc');
  const h=join(root,'include','gstreamer-1.0','gst','gstversion.h');
  mkdirSync(join(root,'lib','pkgconfig'),{recursive:true});
  mkdirSync(join(root,'include','gstreamer-1.0','gst'),{recursive:true});
  writeFileSync(p,`Name: GStreamer\nVersion: ${pc}\nLibs: -lgstreamer-1.0\n`);
  writeFileSync(h,`#define GST_VERSION_MAJOR (${major})\n#define GST_VERSION_MINOR (${minor})\n#define GST_VERSION_MICRO (${micro})\n#define GST_VERSION_NANO (0)\n`);
}
test('GStreamer SDK version checks pkg-config AND C header before staging',()=>sandbox(root=>{
 sdk(root);assert.equal(readWin7GstSdkVersion(root),'1.24.13');
}));
test('GStreamer SDK version mismatch blocks staging',()=>sandbox(root=>{
 sdk(root,{pc:'1.24.13',micro:12});assert.throws(()=>readWin7GstSdkVersion(root),/version mismatch/);
}));
test('Win7 requires audited 1.24 SDK and rejects newer or older headers',()=>sandbox(root=>{
 sdk(root,{pc:'1.28.8',minor:28,micro:8});assert.throws(()=>readWin7GstSdkVersion(root),/1.24.x/);
}));
test('Win7 refuses a partial runtime without matching devel metadata',()=>sandbox(root=>{
 assert.throws(()=>readWin7GstSdkVersion(root),/matching 1.24 runtime \+ devel MSI/);
}));
test('Win7 pre-staging version does not execute an unaligned gst-inspect process',()=>{
 const text=readFileSync(new URL('../scripts/native-release-prepare.mjs',import.meta.url),'utf8');
 assert.match(text,/if\(win7\)\s*\{\s*gstVersion=readWin7GstSdkVersion\(gst\)/);
 assert.match(text,/'--gst-version',gstVersion/);
 assert.match(text,/alignWin7Runtime\(candidate,resolve\(dllSource\)\)/);
 assert.match(text,/smokeWin7Plugins\(candidate\)/);
 assert.match(text,/promoteNativeCandidate\(candidate/);
});
