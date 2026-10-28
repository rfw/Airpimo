import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const view = read('src/components/AirpimoSettingsDialog.tsx');
const app = read('src/App.tsx');
const panel = view.split('id="airpimo-panel-about"')[1]?.split('id="airpimo-panel-diagnostics"')[0];

test('settings navigation has four panels, with a single update surface inside About', () => {
  assert.match(view, /SettingsTab = "config" \| "theme" \| "about" \| "diagnostics"/);
  assert.match(view, /grid-cols-4/);
  assert.deepEqual([...view.matchAll(/id="airpimo-panel-([a-z]+)"/g)].map(match => match[1]), ['config', 'theme', 'about', 'diagnostics']);
  assert.doesNotMatch(view, /\["updates",|airpimo-tab-updates|airpimo-panel-updates|grid-cols-5/);
  assert.ok(panel, 'About panel must exist before Diagnostics');
  assert.match(panel, /t\("软件更新"\)[\s\S]*?t\("项目信息"\)/);
});

test('About preserves current version, update status cases, check and download controls', () => {
  assert.match(panel, /v\{brand\.version\}/);
  for (const token of ['updateChecking', '尚未检查更新', '发现新版本', '已是最新版本', 'updateResult.message']) {
    assert.ok(panel.includes(token), `missing status: ${token}`);
  }
  assert.match(panel, /role="status"[\s\S]*?aria-live="polite"/);
  assert.match(panel, /flex flex-wrap items-center justify-between gap-x-3 gap-y-2/);
  assert.match(panel, /role="status"[\s\S]*?<\/div>\s*<div className="flex shrink-0 items-center gap-2">[\s\S]*?runUpdateCheck/);
  assert.doesNotMatch(panel, /CheckCircle2|检查新版本并从 GitHub Release 获取安装包。/);
  assert.match(panel, /onClick=\{\(\) => void runUpdateCheck\(\)\}[\s\S]*?disabled=\{updateChecking\}/);
  assert.match(panel, /updateResult\?\.kind === "available" && \([\s\S]*?onClick=\{\(\) => void openRelease\(\)\}[\s\S]*?disabled=\{releaseOpening\}/);
  assert.match(app, /checkAtStartup\(brand\.version\)/);
  assert.match(app, /setUpdateNoticeOpen\(true\)/);
  assert.match(app, /desktop\.openReleasePage\(updateResult\.pageUrl\)/);
});

test('About preserves project and license and signals available releases from its tab', () => {
  assert.match(panel, /aria-label=\{t\("打开 GitHub 项目主页"\)\}/);
  assert.match(panel, /github\.com\/rfw\/Airpimo/);
  assert.match(panel, /GPL-3\.0-or-later/);
  assert.match(view, /value === "about" && updateResult\?\.kind === "available"/);
  assert.match(view, /aria-label=\{t\("发现新版本"\)\}/);
});

test('About update strings are translated without changing the shared update protocol', async () => {
  const { translate } = await import('../src/lib/i18n.ts');
  for (const [zh, en] of [
    ['软件更新', 'Software updates'],
    ['项目信息', 'Project information'],
    ['检查更新', 'Check for updates'],
    ['已是最新版本', 'You are up to date'],
  ]) assert.equal(translate(zh, 'en'), en);
});
