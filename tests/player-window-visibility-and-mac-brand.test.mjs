import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LOCK, RENDERER_PATCH_SHA256} from '../scripts/native-engine-core.mjs';
import {safeRelative, sha256, buildBundle, unpackBundle, verifyNativeTree} from '../scripts/native-bundle-core.mjs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('visible Windows player keeps normal taskbar button, maximize and close detection', () => {
  const src = read('src-tauri/src/windows_player.rs');
  assert.match(src, /set_title_and_maximize_button\(hwnd\)/);
  assert.match(src, /let mut window_missing_since: Option<Instant>/);
  assert.match(src, /if on_closed\(\) \{ break; \}/);
  assert.doesNotMatch(src, /ITaskbarList|suppress_child_taskbar_button|delete_tab|WS_EX_TOOLWINDOW/);
});

test('macOS player is a regular Dock app, with safe close and native fullscreen intact', () => {
  const src = read('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(src, /NSApplicationActivationPolicyRegular/);
  assert.match(src, /setProcessName:@"Airpimo Player"/);
  assert.match(src, /airpimoInstallSafeClose\(\)/);
  assert.match(src, /AIRPIMO_PLAYER_WINDOW_HIDDEN/);
  assert.match(src, /NSWindowCollectionBehaviorFullScreenPrimary/);
  assert.doesNotMatch(src, /NSApplicationActivationPolicyAccessory|kProcessTransformToUIElementApplication/);
});

test('macOS packaged child name agrees across native staging, launch and Mach-O gates', () => {
  assert.match(read('scripts/stage-native.mjs'), /stagedBinName=os==='darwin'\?'Airpimo Player':binName/);
  assert.match(read('src-tauri/src/receiver.rs'), /\#\[cfg\(target_os = "macos"\)\] let filename = "Airpimo Player"/);
  for (const p of ['scripts/prune-macos-native.mjs','scripts/relocate-macos-native.mjs',
    'scripts/audit-macos-native.mjs','scripts/native-bundle-core.mjs','scripts/check-native.mjs']) {
    assert.ok(read(p).includes('sidecar/Airpimo Player'), `${p} must allow packaged Mac child`);
  }
  assert.match(read('scripts/stage-native.mjs'), /const binName=os==='win32'\?'uxplay\.exe':'uxplay'/);
});

test('macOS branded binary is allowed in verified archive, arbitrary whitespace paths are blocked', () => {
  assert.equal(safeRelative('sidecar/Airpimo Player'), true);
  for (const bad of ['sidecar/Not Airpimo', 'sidecar/Airpimo Player/extra', 'gstreamer/lib/unsafe file.dylib',
    'sidecar/../Airpimo Player','sidecar/Airpimo Player.exe','sidecar/../../tmp']) {
    assert.equal(safeRelative(bad), false, bad);
  }
  const tmp=mkdtempSync(join(tmpdir(),'airpimo-mac-branded-'));
  try {
    const root=join(tmp,'staged'); mkdirSync(root);
    const files={
      'sidecar/Airpimo Player':Buffer.from('cffaedfe00112233','hex'),
      'gstreamer/lib/libgstreamer-1.0.0.dylib':Buffer.from('cffaedfe99887766','hex'),
      'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dylib':Buffer.from('cffaedfe12345678','hex'),
    };
    const manifest={schema:1,ready:true,os:'darwin',arch:'arm64',
      upstream:{commit:LOCK.commit,rendererPatchSha256:RENDERER_PATCH_SHA256},
      gstreamerVersion:'1.24.12',files:[]};
    for(const [name,bytes] of Object.entries(files)){
      const full=join(root,name);mkdirSync(join(full,'..'),{recursive:true});writeFileSync(full,bytes);
      manifest.files.push({path:name,sha256:sha256(bytes)});
    }
    writeFileSync(join(root,'native-manifest.json'),JSON.stringify(manifest));
    const opts={platform:'darwin',arch:'arm64'};
    const archive=buildBundle(root,opts);
    const extracted=join(tmp,'extracted');
    unpackBundle(archive,extracted,opts);
    assert.ok(existsSync(join(extracted,'sidecar','Airpimo Player')));
    assert.deepEqual(verifyNativeTree(extracted,opts),manifest);
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});
