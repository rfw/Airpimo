import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('macOS player helper retains system green-button fullscreen in Accessory mode', () => {
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

test('macOS accessory dock policy is reasserted after Cocoa/GStreamer initialization', () => {
  const native = load('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native, /\[NSApp activationPolicy\] != NSApplicationActivationPolicyAccessory/);
  assert.match(native, /\[NSApp setActivationPolicy:NSApplicationActivationPolicyAccessory\]/);
  assert.match(native, /AIRPIMO_DOCK_ACCESSORY_ACTIVE/);
  assert.match(native, /dispatch_get_main_queue\(\)/);
  assert.doesNotMatch(native, /NSApplicationActivationPolicyProhibited/);
});

test('macOS UxPlay child blocks GStreamer Regular activation before Cocoa starts', () => {
  const native = load('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native, /@interface NSApplication \(AirpimoChildActivation\)/);
  assert.match(native, /policy == NSApplicationActivationPolicyRegular/);
  assert.match(native, /policy = NSApplicationActivationPolicyAccessory/);
  assert.match(native, /class_getInstanceMethod\(\[NSApplication class\], @selector\(setActivationPolicy:\)\)/);
  assert.match(native, /method_exchangeImplementations\(original, guarded\)/);
  assert.match(native, /AIRPIMO_DOCK_REGULAR_BLOCKED/);
  assert.match(native, /AIRPIMO_DOCK_GUARD_INSTALLED/);
  const constructorBody = native.slice(native.indexOf('__attribute__((constructor))'));
  assert.ok(constructorBody.indexOf('airpimoInstallDockGuard();') < constructorBody.indexOf('dispatch_async(dispatch_get_main_queue()'),
    'policy guard must install before the Cocoa main-queue timer starts');
  assert.match(constructorBody, /if \(!getenv\("AIRPIMO_PLAYER_TITLE_CHILD"\)\) return;/);
  assert.doesNotMatch(native, /NSApplicationActivationPolicyProhibited/);
  assert.doesNotMatch(native, /\[NSApplication sharedApplication\]/);
});

// The previous activation-policy swizzle ran in the child but did not hide
// Dock on the Ventura test machine. Compare Launch Services' policy, perform
// a bounded OS-level UIElement transition and preserve its outcome in logs.
test('macOS dock fallback checks Launch Services and retains bounded UIElement diagnostics', () => {
  const native = load('native/fullscreen/uxplay-fullscreen-macos.m');
  const rust = load('src-tauri/src/receiver.rs');
  const build = load('scripts/ci/build-macos-fullscreen.sh');
  assert.match(native, /\[NSRunningApplication currentApplication\]/);
  assert.match(native, /\[running activationPolicy\]/);
  assert.match(native, /TransformProcessType\(&psn, kProcessTransformToUIElementApplication\)/);
  assert.match(native, /self\.transformAttempts < 3/);
  assert.match(native, /AIRPIMO_DOCK_TRANSFORM status=%ld attempt=%lu/);
  assert.match(native, /AIRPIMO_DOCK_STATE appkit=%ld running=%ld/);
  assert.match(native, /\[\[NSProcessInfo processInfo\] setProcessName:@"Airpimo Player"\]/);
  assert.match(build, /-framework Cocoa -framework ApplicationServices/);
  assert.match(rust, /line\.starts_with\("AIRPIMO_DOCK_"\)/);
  assert.match(rust, /i\.log\(line\.trim\(\)\)/);
  assert.match(rust, /i\.epoch == epoch && !i\.stopping && i\.child\.is_some\(\)/);
  assert.doesNotMatch(native, /NSApplicationActivationPolicyProhibited/);
});
