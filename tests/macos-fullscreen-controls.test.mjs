import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('macOS player helper retains native green-button fullscreen in normal app mode', () => {
  const native = load('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native, /window\.title = @"Airpimo Player"/);
  assert.match(native, /NSWindowCollectionBehaviorFullScreenPrimary/);
  assert.match(native, /NSWindowCollectionBehaviorFullScreenNone/);
  assert.match(native, /window\.collectionBehavior = desired/);
  assert.doesNotMatch(native, /toggleFullScreen:|zoom:|addSubview:|NSEventMaskLeftMouseDown|clickCount|toggleWindow:|toggleFromButton/);
  assert.match(native, /AIRPIMO_PLAYER_TITLE_CHILD/);
});
test('helper is injected only into macOS child and built for both macOS architectures', () => {
  const rust = load('src-tauri/src/receiver.rs');
  const prep = load('scripts/ci/prepare-macos.sh');
  const build = load('scripts/ci/build-macos-fullscreen.sh');
  assert.match(rust, /setup_mac_video_controls\(app, &mut command, dev_binary\)/);
  assert.match(rust, /command\.env\("AIRPIMO_PLAYER_TITLE_CHILD", "1"\)/);
  assert.match(prep, /build-macos-fullscreen\.sh "\$TARGET"/);
  assert.match(build, /mmacosx-version-min=13\.0/);
});

test('macOS video player is a visible regular Dock application named Airpimo Player', () => {
  const native = load('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native, /\[NSApp setActivationPolicy:NSApplicationActivationPolicyRegular\]/);
  assert.match(native, /\[\[NSProcessInfo processInfo\] setProcessName:@"Airpimo Player"\]/);
  assert.match(native, /applicationItem.title = @"Airpimo Player"/);
  assert.match(native, /window.title = @"Airpimo Player"/);
  assert.match(native, /dispatch_get_main_queue\(\)/);
  assert.doesNotMatch(native, /NSApplicationActivationPolicyAccessory|TransformProcessType|kProcessTransformToUIElementApplication/);
  assert.doesNotMatch(native, /airpimoInstallDockGuard|AIRPIMO_DOCK_|policy = NSApplicationActivationPolicyAccessory/);
});
test('macOS player retains safe-close notification, scoped injection and fullscreen support', () => {
  const native = load('native/fullscreen/uxplay-fullscreen-macos.m');
  const rust = load('src-tauri/src/receiver.rs');
  assert.match(native, /airpimoInstallSafeClose\(\)/);
  assert.match(native, /\[self orderOut:nil\]/);
  assert.match(native, /AIRPIMO_PLAYER_WINDOW_HIDDEN/);
  assert.match(native, /NSWindowCollectionBehaviorFullScreenPrimary/);
  assert.match(native, /if \(!getenv\("AIRPIMO_PLAYER_TITLE_CHILD"\)\) return;/);
  assert.match(rust, /line.trim\(\) == "AIRPIMO_PLAYER_WINDOW_HIDDEN"/);
  assert.doesNotMatch(native, /NSApplicationActivationPolicyProhibited|addSubview:|toggleFullScreen:/);
});
