import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {planAirpimoBrand} from '../scripts/ci/apply-airpimo-brand.mjs';
const root = resolve(import.meta.dirname,'..');
const read = name => readFileSync(join(root,name),'utf8');
const json = name => JSON.parse(read(name));

test('Airpimo release package, bundle identifier and Rust crate agree',()=>{
  const pkg=json('package.json'), lock=json('package-lock.json');
  const config=json('src-tauri/tauri.conf.json');
  assert.equal(pkg.name,'airpimo');
  assert.equal(lock.name,'airpimo');
  assert.equal(lock.packages[''].name,'airpimo');
  assert.equal(config.productName,'Airpimo');
  assert.equal(config.identifier,'com.airpimo.desktop');
  assert.ok(config.app.windows.every(w=>w.title==='Airpimo'));
  assert.match(read('src-tauri/Cargo.toml'),/^name = "airpimo"/m);
  assert.match(read('src-tauri/Cargo.toml'),/^name = "airpimo_lib"/m);
  assert.match(read('src-tauri/Cargo.lock'),/^name = "airpimo"/m);
  assert.match(read('src-tauri/src/main.rs'),/airpimo_lib::run\(\)/);
  // Tauri v2 accepts either an explicit version or a package.json reference.
  // Resolve the source file before comparing the effective release version.
  const tauriVersion = config.version === '../package.json'
    ? json('package.json').version
    : config.version;
  assert.equal(tauriVersion,pkg.version);
  // Lockfile project-version fields are intentionally excluded from brand consistency.
});

test('Airpimo UI, configurable receiver, diagnostics and settings migration are consistent',()=>{
  assert.match(read('src/brand.ts'),/appName: 'Airpimo'/);
  assert.match(read('src/brand.ts'),/airpimoPackage.version/);
  assert.match(read('src/domain/state.ts'),/defaultSettings[\s\S]{0,700}?device_name:\s*['"][^'"]+['"]/);
  assert.match(read('src-tauri/src/settings.rs'),/Self\s*\{\s*device_name:\s*"[^"\r\n]+"/);
  assert.match(read('src-tauri/src/lib.rs'),/\.tooltip\("Airpimo"\)/);
  assert.match(read('src-tauri/src/lib.rs'),/fn migrate_legacy_airpimo_settings/);
  assert.match(read('src-tauri/src/lib.rs'),/migrate_legacy_airpimo_settings\(&path\)/);
  assert.match(read('index.html'),/<title>Airpimo<\/title>/);
  const app = read('src/App.tsx');
  if (/await desktop\.exportDiagnostics\(\)/.test(app)) {
    // Native export is a cross-layer contract: verify frontend + IPC + Rust,
    // not only the old download filename location.
    assert.match(app,/setDiagnosticsExportStatus\(/);
    assert.doesNotMatch(app,/URL\.createObjectURL/);
    assert.match(read('src/lib/desktop.ts'),/invoke\('export_diagnostics'\)/);
    const rust = read('src-tauri/src/lib.rs');
    assert.match(rust,/fn export_diagnostics\(app:AppHandle\)/);
    assert.match(rust,/let filename=format!\("airpimo-diagnostics-/);
    assert.match(rust,/std::fs::write\(&destination,controller\(&app\)\.diagnostics\(\)\)/);
    assert.match(rust,/save_settings,get_diagnostics,export_diagnostics(?:,open_release_page)?\]/);
  } else {
    // Keep older v19/v21 snapshot tests useful for pre-v23 source trees.
    assert.match(app,/airpimo-diagnostics-/);
  }
  assert.match(read('src-tauri/src/receiver.rs'),/AIRPIMO \/ LOCAL DIAGNOSTICS/);
});

test('native UxPlay engine remains unchanged and branding patch is idempotent',()=>{
  assert.match(read('src-tauri/src/receiver.rs'),/uxplay/);
  assert.match(read('src-tauri/tauri.conf.json'),/resources\/sidecar\//);
  const assets = join(root,'scripts/ci/prepare-release-assets.mjs');
  if (existsSync(assets)) {
    assert.match(read('scripts/ci/prepare-release-assets.mjs'),/filename:`Airpimo_\$\{version\}_/);
  }
  assert.equal(planAirpimoBrand(root).files.size,0);
});
