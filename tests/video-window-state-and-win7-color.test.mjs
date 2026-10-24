import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root = resolve(import.meta.dirname, '..');
const source = name => readFileSync(resolve(root, name), 'utf8');

test('Windows child window closing re-arms only its own still-connected receiver', () => {
  const windows = source('src-tauri/src/windows_player.rs');
  const receiver = source('src-tauri/src/receiver.rs');
  assert.match(windows, /pub fn watch\(child_pid: u32, mut on_closed: impl FnMut\(\) -> bool \+ Send \+ 'static\)/);
  assert.match(windows, /let mut saw_video_window = false/);
  assert.match(windows, /Duration::from_millis\(800\)/);
  assert.match(windows, /if on_closed\(\) \{ break; \}/);
  assert.match(receiver, /crate::windows_player::watch\(receiver_pid, move \|\| \{/);
  assert.match(receiver, /owner\.player_window_closed\(&app_clone, epoch\)/);
  assert.match(receiver, /i\.epoch == epoch && should_rearm_closed_player\(i\.stage, i\.child\.is_some\(\), i\.stopping\)/);
  assert.match(receiver, /self\.retry\(app\);\s*true/);
  assert.match(receiver, /fn should_rearm_closed_player\([\s\S]*?stage == "connected" && process_running && !stopping/);
});

test('macOS protected close uses the same epoch-guarded rearm and never silently skips its development helper', () => {
  const sourceCode = source('src-tauri/src/receiver.rs');
  const native = source('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native, /\[self orderOut:nil\];[\s\S]*?AIRPIMO_PLAYER_WINDOW_HIDDEN/);
  assert.match(sourceCode, /line\.trim\(\) == "AIRPIMO_PLAYER_WINDOW_HIDDEN" \{\s*let _ = self\.player_window_closed\(app, epoch\)/);
  assert.match(sourceCode, /开发模式缺少 macOS 播放器安全关闭扩展/);
  assert.doesNotMatch(sourceCode, /if development \{ return Ok\(\(\)\); \}/);
});

test('Win7 color path is brightness-neutral and retains the watermark',()=>{
  const receiver=source('src-tauri/src/receiver.rs');
  const settings=source('src-tauri/src/settings.rs');
  const args=source('src-tauri/src/uxplay_args.rs');
  assert.doesNotMatch(receiver,/brightness/i);
  assert.doesNotMatch(settings,/brightness/i);
  assert.doesNotMatch(args,/videobalance|brightness|hue=|saturation=|format=RGBx|format=BGRA/i);
  assert.match(args,/let mut converter = String::from\("videoconvert"\)/);
  assert.match(args,/converter\.push_str\(concat!\(/);
});
