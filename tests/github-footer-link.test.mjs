import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('GitHub footer action appears immediately after Settings with an accessible name', () => {
  const source = read('src/components/AirpimoHome.tsx');
  assert.match(source, /import\s*\{[\s\S]*?Github[\s\S]*?\}\s*from\s*"lucide-react"/);
  assert.match(source, /onSettings\(\): void;/);
  assert.match(source, /onProject\(\): void;/);
  assert.match(source, /aria-label="打开设置"[\s\S]*?onClick=\{onSettings\}[\s\S]*?aria-label="打开 GitHub 项目主页"[\s\S]*?onClick=\{onProject\}/);
});

test('GitHub project opens through a fixed-url Tauri command rather than arbitrary shell arguments', () => {
  const app = read('src/App.tsx');
  const desktop = read('src/lib/desktop.ts');
  const rust = read('src-tauri/src/lib.rs');
  assert.match(app, /onProject=\{\(\) => void openProject\(\)\}/);
  assert.match(app, /await desktop\.openProjectPage\(\)/);
  assert.match(app, /window\.open\('https:\/\/github\.com\/rfw\/Airpimo', '_blank', 'noopener,noreferrer'\)/);
  assert.match(desktop, /openProjectPage\(\): Promise<void> \{ requireDesktop\(\); return invoke\('open_project_page'\); \}/);
  assert.match(rust, /fn open_project_page\(\) -> Result<\(\),String> \{\s*open_in_system_browser\("https:\/\/github\.com\/rfw\/Airpimo"\)/);
  assert.match(rust, /generate_handler!\[[^\]]*open_project_page[^\]]*\]/);
  assert.match(rust, /fn open_release_page\(url: String\)[\s\S]*?if !valid \{ return Err\(/);
  assert.doesNotMatch(rust, /fn open_project_page\(url: String\)/);
});
