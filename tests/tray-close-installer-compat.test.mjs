import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

const rust = read('src-tauri/src/lib.rs');
const receiver = read('src-tauri/src/receiver.rs');
const settings = read('src-tauri/src/settings.rs');
const app = read('src/App.tsx');
const dialog = read('src/components/AirpimoSettingsDialog.tsx');
const bridge = read('src/lib/desktop.ts');
const hooks = read('src-tauri/windows/installer-hooks.nsh');

test('both platforms share one native main-window close policy, with explicit tray hide or application exit', () => {
  assert.match(rust, /enum MainWindowCloseAction \{ HideToTray, Exit \}/);
  assert.match(rust, /fn main_window_close_action\(stay_in_tray: bool\)[\s\S]*?if stay_in_tray \{ MainWindowCloseAction::HideToTray \} else \{ MainWindowCloseAction::Exit \}/);
  assert.match(rust, /if window\.label\(\) != "main" \{ return; \}/);
  assert.match(rust, /WindowEvent::CloseRequested \{api,\.\.\}=event \{[\s\S]*?api\.prevent_close\(\);[\s\S]*?main_window_close_action\(controller\(app\)\.settings\(\)\.stay_in_tray\)/);
  assert.match(rust, /MainWindowCloseAction::HideToTray => \{ let _=window\.hide\(\); \}/);
  assert.match(rust, /MainWindowCloseAction::Exit => \{ app\.exit\(0\); \}/);
  assert.match(rust, /if let RunEvent::Exit=event \{ controller\(app\)\.stop\(app\); \}/);
});

test('tray preference is enabled by default even when migrating a settings file without the property', () => {
  assert.match(settings, /#\[serde\(default = "default_stay_in_tray"\)\][\s\S]*?pub stay_in_tray: bool/);
  assert.match(settings, /pub const fn default_stay_in_tray\(\) -> bool \{ true \}/);
  assert.match(settings, /stay_in_tray: true, theme: Theme::System/);
  assert.match(read('src/domain/state.ts'), /stay_in_tray:true/);
  assert.match(settings, /assert!\(!disabled\.stay_in_tray\)/);
});

test('tray switch invokes only the isolated native persistence IPC, not a receiver restart or draft save', () => {
  assert.match(bridge, /setStayInTray\(stayInTray: boolean\)[\s\S]*?invoke\('set_stay_in_tray', \{ stayInTray \}\)/);
  assert.match(rust, /fn set_stay_in_tray\(app: AppHandle, stay_in_tray: bool\)/);
  assert.match(receiver, /pub fn set_stay_in_tray[\s\S]*?let mut next = inner.settings.clone\(\);[\s\S]*?next.stay_in_tray = stay_in_tray;[\s\S]*?settings::save\(&self.settings_path, &next\)\?;[\s\S]*?inner.settings = next;/);
  const preference = app.split('  async function chooseTrayPreference(value: boolean) {')[1]?.split('\n  async function saveSettings()')[0];
  assert.ok(preference, 'Isolated UI handler exists');
  assert.match(preference, /await desktop\.setStayInTray\(value\)/);
  assert.match(preference, /setTrayError\(`/);
  assert.doesNotMatch(preference, /desktop\.(start|retry|stop|save)\(/);
  assert.match(dialog, /checked=\{draft\.stay_in_tray\}[\s\S]*?onCheckedChange=\{onTrayPreferenceChange\}/);
});

test('saving receiver settings cannot overwrite an immediately saved tray/appearance preference', () => {
  assert.match(app, /if \(themeSaveInFlight\.current \|\| traySaveInFlight\.current\) return;/);
  assert.match(app, /desktop\.save\(\{ \.\.\.draft, theme: snapshot\.settings\.theme, stay_in_tray: snapshot\.settings\.stay_in_tray,/);
  assert.match(app, /themeSaveInFlight\.current \|\| traySaveInFlight\.current \|\| value === snapshot\.settings\.stay_in_tray/);
  assert.match(app, /themeDisabled=\{themeSaving \|\| traySaving \|\| actionBusy \|\| !ready\}/);
});

test('NSIS v2-compatible PowerShell invocation bypasses redirected STDIN and uses child plugin directory', () => {
  assert.match(hooks, /CreateDirectory "\$PLUGINSDIR\\AirpimoCleanup"/);
  assert.match(hooks, /FileOpen \$R9 "\$PLUGINSDIR\\AirpimoCleanup\\airpimo-cleanup\.ps1" w/);
  assert.match(hooks, /nsExec::ExecToStack '[^\n]*-InputFormat None -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "\$PLUGINSDIR\\AirpimoCleanup\\airpimo-cleanup\.ps1" {2}'/);
  assert.match(hooks, /Delete "\$PLUGINSDIR\\AirpimoCleanup\\airpimo-cleanup\.ps1"/);
  assert.match(hooks, /RMDir "\$PLUGINSDIR\\AirpimoCleanup"/);
  assert.doesNotMatch(hooks, /FileOpen \$R9 "\$PLUGINSDIR\\airpimo-cleanup\.ps1"/);
});

test('installer still fails closed and only terminates same-installation executable-path matches', () => {
  const source = read('src-tauri/windows/process-cleanup.ps1');
  assert.match(source, /Get-WmiObject Win32_Process/);
  assert.match(source, /\[string\]::Equals\(\$item\.ExecutablePath, \$target, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.match(source, /\$result = \$item\.Terminate\(\)/);
  assert.match(source, /if \(\$null -ne \$result -and \$result.ReturnValue -ne 0/);
  assert.doesNotMatch(source, /taskkill|Stop-Process -Force/);
  assert.match(hooks, /\$0 != "0"[\s\S]*?MessageBox MB_ICONSTOP\|MB_OK "\$\(airpimoCleanupProcessError\)"[\s\S]*?Abort/);
  assert.match(hooks, /!macro NSIS_HOOK_PREUNINSTALL/);
  assert.match(hooks, /!macro NSIS_HOOK_PREINSTALL/);
});
