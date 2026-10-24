import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {plan} from '../scripts/ci/apply-airpimo-v23.mjs';
const root = resolve(import.meta.dirname,'..');
const file = relative => readFileSync(resolve(root,relative),'utf8');

test('native diagnostics export remains bound to settings panel',()=>{
 assert.match(file('src/components/AirpimoSettingsDialog.tsx'),/airpimo-panel-diagnostics/);
 assert.match(file('src/App.tsx'),/await desktop\.exportDiagnostics\(\)/);
 assert.match(file('src/lib/desktop.ts'),/invoke\('export_diagnostics'\)/);
});

test('settings and update dialogs are separate with macOS titlebar-safe positioning',()=>{
 const view=file('src/components/AirpimoSettingsDialog.tsx');
 assert.match(view,/function AirpimoSettingsDialog/);
 assert.match(view,/function AirpimoUpdateNotice/);
 assert.match(view,/airpimo-panel-diagnostics/);
 assert.match(view,/dialogMac/);
 assert.match(view,/46px/);
});

test('export log uses native file write, reports actual path and errors',()=> {
  const app=file('src/App.tsx'), lib=file('src-tauri/src/lib.rs'), bridge=file('src/lib/desktop.ts');
  assert.ok(!app.includes('URL.createObjectURL'));
  assert.match(app,/await desktop\.exportDiagnostics\(\)/);
  assert.match(app,/setDiagnosticsExportStatus\(`已导出到：/);
  assert.match(app,/导出失败：/);
  assert.match(bridge,/invoke\('export_diagnostics'\)/);
  assert.match(lib,/fn export_diagnostics\(app:AppHandle\) -> Result<String,String>/);
  assert.match(lib,/app\.path\(\)\.download_dir\(\)/);
  assert.match(lib,/std::fs::write\(&destination,controller\(&app\)\.diagnostics\(\)\)/);
  assert.match(lib,/save_settings,get_diagnostics,export_diagnostics,open_release_page\]/);
});

test('Windows double-click and macOS left-click restore main without changing quit/tray policy',()=> {
  const lib=file('src-tauri/src/lib.rs');
  assert.match(lib,/TrayIconEvent::DoubleClick \{button:tauri::tray::MouseButton::Left/);
  assert.match(lib,/TrayIconEvent::Click \{button:tauri::tray::MouseButton::Left,button_state:tauri::tray::MouseButtonState::Up/);
  assert.match(lib,/show_main\(app\)/);
  assert.match(lib,/"quit"=>\{controller\(app\)\.stop\(app\);app\.exit\(0\);\}/);
});

test('NSIS uses the pinned Airpimo clean-upgrade template and shared process cleanup hooks',()=> {
  const conf=JSON.parse(file('src-tauri/tauri.conf.json'));
  assert.equal(conf.bundle.windows.nsis.displayLanguageSelector,false);
  assert.equal(conf.bundle.windows.nsis.template,'./windows/airpimo-installer.nsi');
  assert.equal(conf.bundle.windows.nsis.installerHooks,'./windows/installer-hooks.nsh');
});
