import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {ensureMacTitleHelper,needsMacTitleBuild,prepareDevResourceDirectories,macTarget} from '../scripts/dev-macos-title.mjs';
import {verifiedCachedEngine,storeEngine,LOCK} from '../scripts/native-engine-core.mjs';
const root = resolve(import.meta.dirname,'..');
const read = name => readFileSync(join(root,name),'utf8');
function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'airpimo-v32-'));try{return fn(dir)}finally{rmSync(dir,{recursive:true,force:true})}}

test('desktop:dev prioritizes user override then pinned SHA-verified local cache without Windows bundle instructions',()=>{
 const src=read('scripts/desktop-dev.mjs');
 assert.match(src,/if \(requested\) \{[\s\S]*?source = 'explicit'/);
 assert.match(src,/verifiedCachedEngine\(\)/);
 assert.ok(src.indexOf('verifiedCachedEngine()') < src.indexOf('stagedNativePaths(root)'));
 assert.match(src,/if \(process\.platform === 'win32'\)/);
 assert.doesNotMatch(src,/native-bundle\.mjs','prepare'/);
 assert.match(src,/npm run native:prepare/);
 assert.match(src,/prepareDevResourceDirectories\(root\)/);
});

test('native:prepare cache is reused only when pinned target and SHA-256 receipt are valid', {skip:process.platform==='win32'?'Windows file mode cannot simulate macOS executable permissions':false}, ()=>fixture(dir=>{
 const env={UXPLAY_NATIVE_CACHE:join(dir,'cache')};
 const input=join(dir,'mock-macos');
 writeFileSync(input,Buffer.from('cffaedfe0102030405060708','hex'));
 const saved=storeEngine(input,{platform:'darwin',arch:'x64',env});
 assert.equal(verifiedCachedEngine({platform:'darwin',arch:'x64',env}),saved.binary);
 writeFileSync(saved.binary,Buffer.from('cffaedfe9999999999','hex'));
 assert.equal(verifiedCachedEngine({platform:'darwin',arch:'x64',env}),null);
}));

test('Mac helper builds only on Mac, if missing or older than Objective-C source',()=>fixture(dir=>{
 const source=join(dir,'native/fullscreen/uxplay-fullscreen-macos.m');
 mkdirSync(resolve(source,'..'),{recursive:true});writeFileSync(source,'source');
 assert.equal(macTarget('x64'),'x86_64-apple-darwin');
 assert.equal(macTarget('arm64'),'aarch64-apple-darwin');
 assert.equal(needsMacTitleBuild(dir),true);
 let called=0;
 const run=(cmd,args,opts)=>{
   called++;
   assert.equal(cmd,'bash');assert.deepEqual(args,['scripts/ci/build-macos-fullscreen.sh','x86_64-apple-darwin']);
   assert.equal(opts.cwd,dir);
   return {status:0};
 };
 assert.equal(ensureMacTitleHelper(dir,{platform:'darwin',arch:'x64',run}),true);
 assert.equal(called,1);
 const output=join(dir,'src-tauri/resources/fullscreen/uxplay-fullscreen-macos.dylib');
 writeFileSync(output,'helper');
 assert.equal(needsMacTitleBuild(dir),false);
 assert.equal(ensureMacTitleHelper(dir,{platform:'darwin',arch:'x64',run}),false);
 assert.equal(called,1);
 assert.equal(ensureMacTitleHelper(dir,{platform:'win32',arch:'x64',run}),false);
}));

test('fresh checkout can start debug Tauri without claiming a distributable runtime',()=>fixture(dir=>{
 prepareDevResourceDirectories(dir);
 for(const sub of ['sidecar','gstreamer']) assert.equal(statSync(join(dir,'src-tauri/resources',sub)).isDirectory(),true);
 const setup=read('scripts/dev-macos-title.mjs');
 assert.doesNotMatch(setup,/native-manifest\.json/);
}));

test('macOS child helper prevents destructive close and requests controlled receiver stop without touching system fullscreen',()=>{
 const helper=read('native/fullscreen/uxplay-fullscreen-macos.m');
 assert.match(helper,/AIRPIMO_PLAYER_TITLE_CHILD/);
 assert.match(helper,/window\.title = @"Airpimo Player"/);
 assert.match(helper,/OpenGL renderer/);
 assert.match(helper,/method_exchangeImplementations/);
 assert.match(helper,/\[self orderOut:nil\]/);
 assert.match(helper,/AIRPIMO_PLAYER_WINDOW_HIDDEN/);
 assert.doesNotMatch(helper,/toggleFullScreen|NSEventMaskLeftMouseDown|addSubview:button|exit\(0\)/);
 const receiver=read('src-tauri/src/receiver.rs');
 assert.match(receiver,/line\.trim\(\) == "AIRPIMO_PLAYER_WINDOW_HIDDEN"/);
 assert.match(receiver,/if allowed \{ self\.stop\(app\); \}/);
 assert.match(receiver,/fn observe\(self: &Arc<Self>/);
 assert.match(read('scripts/desktop-dev.mjs'),/ensureMacTitleHelper\(root\)/);
});

test('Win7 NSIS installs machine-wide with start menu and uninstall registration, modern Windows retains user install',()=>{
 const normal=JSON.parse(read('src-tauri/tauri.conf.json'));
 const win7=JSON.parse(read('src-tauri/tauri.win7.conf.json'));
 assert.equal(normal.bundle.windows.nsis.startMenuFolder,'Airpimo');
 assert.equal(win7.bundle.windows.nsis.installMode,'perMachine');
 assert.equal(win7.bundle.windows.nsis.startMenuFolder,'Airpimo');
 assert.equal(normal.bundle.windows.nsis.installMode,undefined);
 assert.equal(win7.bundle.windows.webviewInstallMode.type,'fixedRuntime');
});

test('home retains advertised AirPlay name and clipboard behavior',()=>{
 const home=read('src/components/AirpimoHome.tsx');
 assert.match(home,/applied_device_name/);
 assert.match(home,/replace\(\/@Airpimo\$\//);
 assert.match(home,/onCopy\(name\)/);
});
