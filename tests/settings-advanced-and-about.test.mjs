import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('advanced toggle defaults closed, persists separately, and does not mutate saved engine args', () => {
  const view = read('src/components/AirpimoSettingsDialog.tsx');
  const app = read('src/App.tsx');
  assert.match(view, /useState\(\(\) => \{[\s\S]*?localStorage\.getItem\("airpimo\.settings\.showAdvanced"\) === "true"[\s\S]*?catch \{ return false; \}/);
  assert.match(view, /localStorage\.setItem\("airpimo\.settings\.showAdvanced", String\(checked\)\)/);
  assert.match(view, /<label htmlFor="showAdvanced" className="flex[^\"]*justify-between/);
  assert.match(view, /id="showAdvanced"[\s\S]*?type="checkbox"[\s\S]*?checked=\{showAdvanced\}/);
  assert.match(view, /\{showAdvanced && <div[\s\S]*?<textarea[\s\S]*?value=\{draft\.uxplay_args\}/);
  assert.match(app, /validateUxplayArgs\(draft\.uxplay_args\)/);
  assert.doesNotMatch(view, /toggleAdvanced\([^)]*\)[\s\S]{0,90}setDraft/);
});

test('About merges software updates and project details in the four-tab layout', () => {
  const view = read('src/components/AirpimoSettingsDialog.tsx');
  assert.match(view, /SettingsTab = "config" \| "theme" \| "about" \| "diagnostics"/);
  assert.match(view, /grid-cols-4/);
  assert.match(view, /\["about", t\("关于"\)\][\s\S]*?\["diagnostics", t\("诊断"\)\]/);
  assert.match(view, /id="airpimo-panel-about"[\s\S]*?hidden=\{settingsTab !== "about"\}/);
  assert.match(view, /src=\{airpimoIcon\}[\s\S]*?brand\.version[\s\S]*?iPhone \/ iPad/);
  assert.match(view, /github\.com\/rfw\/Airpimo/);
  assert.match(view, /t\("软件更新"\)[\s\S]*?runUpdateCheck[\s\S]*?openRelease[\s\S]*?t\("项目信息"\)/);
  assert.doesNotMatch(view, /airpimo-tab-updates|airpimo-panel-updates/);
  assert.match(view, /GPL-3\.0-or-later/);
  assert.match(view, /id="airpimo-panel-diagnostics"/);
});

test('macOS does not drop a zero-sized Job Object placeholder, Windows retains actual drop', () => {
  const receiver = read('src-tauri/src/receiver.rs');
  assert.match(receiver, /#\[cfg\(windows\)\]\s*drop\(receiver_job\)/);
  assert.match(receiver, /#\[cfg\(not\(windows\)\)\]\s*let _ = receiver_job;/);
  assert.match(receiver, /#\[cfg\(windows\)\]\s*let job=i\.receiver_job\.take\(\)/);
});
