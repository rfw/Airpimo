import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('macOS full-screen button is installed inside child AppKit video window', () => {
  const native=load('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native,/addSubview:button/);
  assert.match(native,/toggleFromButton/);
  assert.match(native,/NSEventMaskLeftMouseDown/);
  assert.match(native,/event\.clickCount == 2/);
  assert.match(native,/event\.keyCode == 53/);
  assert.match(native,/setFrame:oldFrame\.rectValue/);
  assert.match(native,/UXPLAY_DESKTOP_FULLSCREEN_CHILD/);
});
test('Tauri attaches helper ONLY to the macOS UxPlay process', () => {
  const rust=load('src-tauri/src/receiver.rs');
  assert.match(rust,/\#\[cfg\(target_os = "macos"\)\]/);
  assert.match(rust,/setup_mac_video_controls\(app, &mut command, dev_binary\)/);
  assert.match(rust,/command\.env\("DYLD_INSERT_LIBRARIES", shipped\)/);
  assert.doesNotMatch(rust,/\.set_fullscreen\(/);
});
test('macOS helper is built and shipped with the app resources', () => {
  const sh=load('scripts/ci/prepare-macos.sh');
  const build=load('scripts/ci/build-macos-fullscreen.sh');
  const conf=load('src-tauri/tauri.conf.json');
  assert.match(sh,/build-macos-fullscreen\.sh "\$TARGET"/);
  assert.match(build,/mmacosx-version-min=13\.0/);
  assert.match(conf,/"resources\/fullscreen\/"/);
});
