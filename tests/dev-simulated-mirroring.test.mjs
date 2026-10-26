import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const receiver = source('src-tauri/src/receiver.rs');
const lib = source('src-tauri/src/lib.rs');
const dialog = source('src/components/AirpimoSettingsDialog.tsx');
const app = source('src/App.tsx');

test('simulator is only accessible from the dev Diagnostics tab and excluded from release native IPCs', () => {
  assert.match(app, /simulationAvailable=\{import\.meta\.env\.DEV && isDesktop\(\)\}/);
  assert.match(app, /if \(!import\.meta\.env\.DEV \|\| simulationBusy \|\| !isDesktop\(\)\) return/);
  assert.match(app, /import\('\.\/lib\/dev-simulation'\)/);
  assert.match(dialog, /id="airpimo-panel-diagnostics"[\s\S]+\{simulationAvailable && \(/);
  assert.match(dialog, /开始模拟投屏/);
  assert.match(dialog, /结束模拟/);
  assert.match(lib, /#\[cfg\(debug_assertions\)\]\s*#\[tauri::command\]\s*fn start_simulated_mirroring/);
  assert.match(lib, /#\[cfg\(not\(debug_assertions\)\)\]\s*let builder = builder\.invoke_handler/);
  const production = lib.match(/#\[cfg\(not\(debug_assertions\)\)\]\s*let builder = builder\.invoke_handler\(([^\n]+)\);/);
  assert.ok(production);
  assert.doesNotMatch(production[1], /simulated/);
  assert.doesNotMatch(source('src/lib/desktop.ts'), /start_simulated_mirroring|stop_simulated_mirroring/);
});

test('simulated video uses GStreamer test source and reuses native Windows/macOS presentation', () => {
  assert.match(receiver, /"videotestsrc", "is-live=true", "pattern=ball"/);
  assert.match(receiver, /"videoconvert", "!", "autovideosink"/);
  assert.match(receiver, /setup_gstreamer\(app, &mut command, development\)/);
  assert.match(receiver, /setup_mac_video_controls\(app, &mut command, true\)/);
  assert.match(receiver, /windows_player::watch\(pid, move \|\|/);
  assert.match(receiver, /AIRPIMO_PLAYER_WINDOW_HIDDEN/);
  assert.match(receiver, /AIRPIMO_DEV_GST_LAUNCH/);
});

test('simulation rejects real mirroring, owns the child and power request, and restores receiver state', () => {
  assert.match(receiver, /if i\.stage == "connected" \|\| i\.stage == "connecting"/);
  assert.match(receiver, /self\.stop_internal\(app, true\);[\s\S]*command\.spawn\(\)/);
  assert.match(receiver, /simulation: Option<DevSimulation>/);
  assert.match(receiver, /self\.child\.is_some\(\) \|\| self\.simulation\.is_some\(\)/);
  assert.match(receiver, /sim\.child\.kill\(\)/);
  assert.match(receiver, /if resume \{ self\.start\(app, true\) \}/);
  assert.match(receiver, /i\.power_inhibitor = None/);
  assert.doesNotMatch(source('src-tauri/src/settings.rs'), /simulat(e|ion|ed)/i);
});

test('simulation documents external limitations and includes both languages', () => {
  assert.match(source('src/lib/i18n.ts'), /'开始模拟投屏': 'Start simulation'/);
  assert.match(source('src/lib/i18n.ts'), /'结束模拟': 'Stop simulation'/);
  const docs = source('docs/DEVELOPMENT.md');
  assert.match(docs, /不是 AirPlay 协议测试/);
  assert.match(docs, /powercfg \/requests/);
  assert.match(docs, /pmset -g assertions/);
});
