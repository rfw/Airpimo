import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const load = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
test('macOS player helper only sets window title; system fullscreen is untouched', () => {
  const native = load('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native, /window\.title = @"Airpimo Player"/);
  assert.doesNotMatch(native, /addSubview:|NSEventMaskLeftMouseDown|clickCount|toggleWindow:|toggleFromButton/);
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
