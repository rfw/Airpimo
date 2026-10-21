import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {targetId,LOCK,engineDir,verifiedCachedEngine,storeEngine,prebuiltForTarget,downloadVerified,validateSourceLock,buildEngine} from '../scripts/native-engine-core.mjs';

async function sandbox(callback) {
 const dir=mkdtempSync(join(tmpdir(),'uxplay-native-int-'));
 try{return await callback(dir);}finally{rmSync(dir,{recursive:true,force:true});}
}
const MACH=Buffer.from('cffaedfe01020304','hex');
const PE=Buffer.from([0x4d,0x5a,0,0,1,2,3]);
const hash=(b)=>createHash('sha256').update(b).digest('hex');

test('supported target families are explicit and Win7 is Windows x64 only',()=>{
 assert.equal(targetId('win32','x64'),'win32-x64');
 assert.equal(targetId('darwin','arm64'),'darwin-arm64');
 assert.throws(()=>targetId('win32','arm64'),/Unsupported/);
 assert.throws(()=>targetId('linux','x64'),/Unsupported/);
});
test('source commit, official Git origin, portability flags are immutable',()=>{
 assert.equal(LOCK.commit,'df67c212a433cf6dda3676dd40c097900d24e645');
 assert.equal(validateSourceLock(),true);
 assert.throws(()=>validateSourceLock({...LOCK,upstream:'https://evil.invalid/repo'}),/Invalid/);
 assert.throws(()=>validateSourceLock({...LOCK,buildFlags:[]}),/Invalid/);
});
test('storing a macOS executable records SHA and reuses it across launches', {skip: process.platform==='win32' ? 'Windows cannot emulate POSIX executable permissions' : false}, ()=>sandbox(dir=>{
 const path=join(dir,'source-uxplay');writeFileSync(path,MACH);
 const opts={platform:'darwin',arch:'x64',home:dir,env:{}};
 const result=storeEngine(path,opts);
 assert.equal(result.sha256,hash(MACH));
 assert.equal(verifiedCachedEngine(opts),result.binary);
 const receipt=JSON.parse(readFileSync(join(engineDir(opts),'receipt.json'),'utf8'));
 assert.equal(receipt.commit,LOCK.commit);
 assert.equal(receipt.target,'darwin-x64');
}));
test('corrupt binary and false cached receipt fail closed',()=>sandbox(dir=>{
 const path=join(dir,'source.exe');writeFileSync(path,PE);
 const opts={platform:'win32',arch:'x64',home:dir,env:{}};
 const {binary}=storeEngine(path,opts);
 assert.equal(verifiedCachedEngine(opts),binary);
 writeFileSync(binary,Buffer.concat([PE,Buffer.from('tampered')]));
 assert.equal(verifiedCachedEngine(opts),null);
}));
test('foreign executable rejected even with expected name',()=>sandbox(dir=>{
 const file=join(dir,'uxplay.exe');writeFileSync(file,MACH);
 assert.throws(()=>storeEngine(file,{platform:'win32',arch:'x64',home:dir,env:{}}),/not a recognized/);
}));
test('prebuilt requires HTTPS, exact SHA256 and matching upstream commit',()=>{
 const id='darwin-x64';const entry={url:'https://build.example.org/uxplay',sha256:hash(MACH),commit:LOCK.commit};
 assert.deepEqual(prebuiltForTarget(id,{targets:{[id]:entry}}),entry);
 assert.equal(prebuiltForTarget(id,{targets:{}}),null);
 assert.throws(()=>prebuiltForTarget(id,{targets:{[id]:{...entry,commit:'fake'}}}),/Invalid/);
 assert.throws(()=>prebuiltForTarget(id,{targets:{[id]:{...entry,url:'http://build.example.org/uxplay'}}}),/HTTPS/);
});
test('mock HTTPS download: exactly matching binary SHA accepted, mismatch rejected',()=>sandbox(async dir=>{
 const url='https://approved.example.org/uxplay';
 const mock=async()=>({ok:true,headers:{get:()=>String(MACH.length)},arrayBuffer:async()=>MACH});
 await downloadVerified(url,hash(MACH),join(dir,'ok'),{fetchImpl:mock});
 assert.deepEqual(readFileSync(join(dir,'ok')),MACH);
 await assert.rejects(downloadVerified(url,'0'.repeat(64),join(dir,'bad'),{fetchImpl:mock}),/SHA-256 mismatch/);
 await assert.rejects(downloadVerified('http://insecure.example.com/uxplay',hash(MACH),join(dir,'bad2'),{fetchImpl:mock}),/Unsafe/);
}));
test('missing MSYS2 toolchain is explained before first Windows build',()=>sandbox(dir=>{
 assert.throws(()=>buildEngine({platform:'win32',arch:'x64',env:{MSYS2_ROOT:join(dir,'missing')},home:dir}),/MSYS2 MINGW64 dependencies missing/);
}));
test('macOS app keeps verified software decoder and release ignores debug override',()=>{
 const fs=readFileSync(new URL('../src-tauri/src/receiver.rs',import.meta.url),'utf8');
 assert.match(fs,/#\[cfg\(target_os = "macos"\)\]\s*command\.args\(\["-avdec", "-vsync", "no"\]\)/);
 assert.match(fs,/#\[cfg\(debug_assertions\)\]\s*if let Some\(override_path\)/);
 assert.match(fs,/GST_PLUGIN_SYSTEM_PATH_1_0/);
});

test('FPS and 50% initial volume flow into UxPlay; Windows has software decoder with default timestamp sync',()=>{
 const fs=readFileSync(new URL('../src-tauri/src/receiver.rs',import.meta.url),'utf8');
 assert.match(fs,/command\.args\(\["-fps", fps_arg\.as_str\(\), "-vol", "0\.5"\]\)/);
 assert.match(fs,/#\[cfg\(windows\)\]\s*command\.arg\("-avdec"\)/);
 assert.doesNotMatch(fs,/#\[cfg\(windows\)\]\s*command\.args\(\["-vsync", "no"\]\)/);
 assert.match(fs,/applied_fps: self\.applied_fps/);
});


test('brightness is backed by real UxPlay -vc videobalance and retains Windows A/V sync',()=>{
  const receiver=readFileSync(new URL('../src-tauri/src/receiver.rs', import.meta.url),'utf8');
  const settings=readFileSync(new URL('../src-tauri/src/settings.rs', import.meta.url),'utf8');
  const app=readFileSync(new URL('../src/App.tsx', import.meta.url),'utf8');
  assert.match(receiver,/if brightness < 100/);
  assert.match(receiver,/let converter = format!\("videoconvert ! videobalance brightness=\{balance\}"\)/);
  assert.match(receiver,/command\.args\(\["-vc", converter\.as_str\(\)\]\)/);
  assert.match(receiver,/applied_brightness: self\.applied_brightness/);
  assert.match(receiver,/#\[cfg\(windows\)\]\s*command\.arg\("-avdec"\)/);
  assert.match(settings,/serde\(default = "default_brightness"\)/);
  assert.match(settings,/pub const fn default_brightness\(\) -> u8 \{ 80 \}/);
  assert.match(app,/aria-label="画面亮度" type="range"/);
  assert.doesNotMatch(receiver,/"-vsync", "no"\]\);\s*\/\/.*windows/);
});
