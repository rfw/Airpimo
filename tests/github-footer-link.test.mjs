import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('GitHub entry moves from home footer to About tab, before diagnostics', () => {
  const home = read('src/components/AirpimoHome.tsx');
  const dialog = read('src/components/AirpimoSettingsDialog.tsx');
  const app = read('src/App.tsx');
  assert.doesNotMatch(home, /Github|onProject|aria-label=\{t\(["']打开 GitHub 项目主页["']\)\}/);
  assert.match(home, /aria-label=\{t\(["']打开设置["']\)\}/);
  assert.match(dialog, /import\s*\{[^}]*Github[^}]*\}\s*from\s*"lucide-react"/);
  assert.match(dialog, /\["about", t\("关于"\)\][\s\S]*?\["diagnostics", t\("诊断"\)\]/);
  assert.match(dialog, /id="airpimo-panel-about"[\s\S]*?onClick=\{onProject\}[\s\S]*?aria-label=\{t\(["']打开 GitHub 项目主页["']\)\}/);
  assert.match(app, /<AirpimoSettingsDialog[\s\S]*?onProject=\{\(\) => void openProject\(\)\}/);
});

test('GitHub project still opens through fixed-url Tauri command and safe browser fallback', () => {
  const app = read('src/App.tsx');
  const desktop = read('src/lib/desktop.ts');
  const rust = read('src-tauri/src/lib.rs');
  assert.match(app, /await desktop\.openProjectPage\(\)/);
  assert.match(app, /window\.open\('https:\/\/github\.com\/rfw\/Airpimo', '_blank', 'noopener,noreferrer'\)/);
  assert.match(desktop, /openProjectPage\(\): Promise<void> \{ requireDesktop\(\); return invoke\('open_project_page'\); \}/);
  assert.match(rust, /fn open_project_page\(\) -> Result<\(\),String> \{\s*open_in_system_browser\("https:\/\/github\.com\/rfw\/Airpimo"\)/);
  assert.match(rust, /generate_handler!\[[^\]]*open_project_page[^\]]*\]/);
  assert.doesNotMatch(rust, /fn open_project_page\(url: String\)/);
});
