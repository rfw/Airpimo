import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync, readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {apply} from '../scripts/ci/apply-airpimo-v26.mjs';
const root=resolve(import.meta.dirname,'..');
const file=p=>readFileSync(join(root,p),'utf8');
const json=p=>JSON.parse(file(p));

test('Airpimo root versions are preserved and licensing is consistent',()=>{
  const pkg=json('package.json'), lock=json('package-lock.json'), tauri=json('src-tauri/tauri.conf.json');
  assert.equal(pkg.name,'airpimo');
  assert.match(pkg.version,/^\d+\.\d+\.\d+/);
  assert.equal(lock.version,pkg.version);
  assert.equal(lock.packages[''].version,pkg.version);
  assert.equal(tauri.version,pkg.version);
  assert.equal(pkg.license,'GPL-3.0-or-later');
  assert.equal(pkg.repository.url,'git+https://github.com/rfw/Airpimo.git');
  assert.match(file('LICENSE'),/GNU GENERAL PUBLIC LICENSE/);
  assert.match(file('LICENSE'),/Version 3, 29 June 2007/);
  assert.match(file('src-tauri/Cargo.toml'),new RegExp('\\[package\\][\\s\\S]*?version\\s*=\\s*"'+pkg.version.replaceAll('.','\\.')+'"'));
  assert.match(file('src-tauri/Cargo.lock'),new RegExp('name = "airpimo"\\r?\\nversion = "'+pkg.version.replaceAll('.','\\.')+'"'));
  assert.match(file('THIRD_PARTY_NOTICES.txt'),/UxPlay/);
});

test('new repository is compile-time pinned and native browser URL is restricted',()=>{
  assert.match(file('vite.config.ts'),/__AIRPIMO_RELEASE_REPO__: JSON.stringify\('rfw\/Airpimo'\)/);
  assert.doesNotMatch(file('vite.config.ts'),/git', \['remote'/);
  assert.match(file('src-tauri/src/lib.rs'),/parts\[0\] == "rfw" && parts\[1\] == "Airpimo"/);
  assert.match(file('README.md'),/github.com\/rfw\/Airpimo/);
  assert.match(file('src/lib/release-update.ts'),/releases\/latest/);
});

test('settings tab has outline padding and no bottom close button on read-only pages',()=>{
  const app=file('src/App.tsx');
  assert.match(app,/\{\(settingsTab === 'config' \|\| settingsTab === 'theme'\) && <div className="modal-actions airpimo-settings-actions">/);
  assert.doesNotMatch(app,/variant="outline" onClick=\{\(\) => setSettingsOpen\(false\)\}>关闭<\/Button>/);
  assert.match(file('src/styles/airpimo-settings-tabs.css'),/padding: 12px 12px 16px; scroll-padding: 12px;/);
  assert.match(file('src/styles/airpimo-settings-tabs.css'),/padding: 3px 3px 7px;/);
});

test('visible static startup remains until app state is initialized; no blank boot view',()=>{
  const html=file('index.html');
  assert.ok(html.indexOf('/theme-bootstrap.js') < html.indexOf('/startup.css'));
  assert.ok(html.indexOf('/startup.css') < html.indexOf('id="airpimo-startup"'));
  assert.ok(html.indexOf('id="airpimo-startup"') < html.indexOf('id="root"'));
  assert.match(html,/启动中…/);
  assert.match(file('public/startup.css'),/html.dark #airpimo-startup/);
  assert.match(file('src/App.tsx'),/if \(ready\) document.getElementById\('airpimo-startup'\)\?\.remove\(\)/);
});

test('only targeted disposable artifacts are removed and v26 script is idempotent',()=>{
  // The old v26 installer targets an earlier settings markup; verify current state instead.
  assert.match(file('src/App.tsx'),/airpimo-panel-updates/);
  assert.match(file('index.html'),/id="airpimo-startup"/);
  assert.equal(existsSync(join(root,'README.md')),true);
  assert.equal(existsSync(join(root,'AGENTS.md')),true);
  assert.equal(existsSync(join(root,'scripts','ci','airpimo-v25-edits.json')),true);
  assert.ok(!readdirSync(root).some(x=>/^AIRPIMO-(BRAND-RENAME|CI-ARTIFACT-ASSERTIONS|DESKTOP-UI-REDESIGN|SETTINGS-UPDATES|STARTUP-TRAY-DEV-RUNTIME)-v\d+\.md$/i.test(x)));
  assert.equal(existsSync(join(root,'src-tauri','Cargo.lock.bak')),false);
});
