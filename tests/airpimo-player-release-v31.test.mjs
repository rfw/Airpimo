import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname,'..');
const read = (name) => readFileSync(resolve(root,name),'utf8');
test('AirPlay device name always has @Airpimo suffix exactly once, with -nh',()=>{
  const args=read('src-tauri/src/uxplay_args.rs');
  const home=read('src/components/AirpimoHome.tsx');
  assert.match(args,/pub fn advertised_name\(name: &str\) -> String/);
  assert.match(args,/format!\("\{base\}@Airpimo"\)/);
  assert.match(args,/"-nh"\.into\(\), "-n"\.into\(\), advertised_name\(name\)/);
  assert.match(args, /\["-n", "-fps", "-vc", "-nh"\]/);
  assert.match(home,/const name = `\$\{baseName\.replace\(/);
});
test('settings no longer expose or persist picture brightness',()=>{
  assert.doesNotMatch(read('src/domain/state.ts'),/brightness/i);
  assert.doesNotMatch(read('src-tauri/src/settings.rs'),/brightness/i);
  assert.doesNotMatch(read('src-tauri/src/uxplay_args.rs'),/videobalance|brightness/i);
});
test('published and locally built Windows 10/11 installer names agree',()=>{
  assert.match(read('scripts/ci/prepare-release-assets.mjs'),/name:'windows10-11-x64'/);
  assert.match(read('scripts/windows-build-artifacts.mjs'),/windows10-11-x64/);
  assert.doesNotMatch(read('scripts/ci/prepare-release-assets.mjs'),/windows10-11plus-x64|windows10plus-x64/);
  assert.doesNotMatch(read('scripts/windows-build-artifacts.mjs'),/windows10-11plus-x64/);
});
test('macOS uses only native titlebar fullscreen; title is changed in child process',()=>{
  const native=read('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native,/Airpimo Player/);
  assert.doesNotMatch(native,/toggleWindow|NSEventMaskLeftMouseDown|addSubview:button|clickCount/);
  assert.match(read('src-tauri/src/receiver.rs'),/AIRPIMO_PLAYER_TITLE_CHILD/);
});
test('Windows video window title, fullscreen and Windows 7 taskbar icon are native',()=>{
  const win=read('src-tauri/src/windows_player.rs');
  assert.match(win,/"Airpimo Player"/);
  assert.match(win,/GetWindowThreadProcessId/);
  assert.match(win,/GetDoubleClickTime/);
  assert.match(win,/IsZoomed/);
  assert.match(win,/SetWindowLongPtrW/);
  assert.doesNotMatch(win,/SetWindowsHookEx|CreateRemoteThread/);
  assert.match(read('src-tauri/src/lib.rs'),/configure_windows_taskbar_id/);
  assert.match(read('src-tauri/src/lib.rs'),/window\.set_icon\(icon\.clone\(\)\)/);
});
