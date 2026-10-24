import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const view = read('src/components/AirpimoSettingsDialog.tsx');
const app = read('src/App.tsx');
const bridge = read('src/lib/desktop.ts');
const native = read('src-tauri/src/receiver.rs');
const commands = read('src-tauri/src/lib.rs');

test('Interface tab reuses the existing theme identifier and preserves the four-tab layout', () => {
  assert.match(view, /SettingsTab = "config" \| "theme" \| "about" \| "diagnostics"/);
  assert.match(view, /\["theme", t\("界面"\)\]/);
  assert.match(view, /grid-cols-4/);
  assert.match(view, /id="airpimo-panel-theme"[\s\S]*?hidden=\{settingsTab !== "theme"\}/);
  assert.match(view, /id="airpimo-interface-language-label"[\s\S]*?id="airpimo-appearance-theme-label"/);
  assert.match(view, /name="interfaceLanguage"[\s\S]*?checked=\{choice === value\}[\s\S]*?setChoice\(value\)/);
  assert.match(view, /name="theme"[\s\S]*?checked=\{theme === value\}[\s\S]*?onThemeChange\(value\)/);
});

test('Only receiver configuration has Save/Cancel; interface preferences apply immediately', () => {
  assert.match(view, /if \(settingsTab === "config"\) void saveSettings\(\)/);
  assert.match(view, /\{settingsTab === "config" && \([\s\S]*?type="submit"/);
  assert.doesNotMatch(view, /settingsTab === "config" \|\| settingsTab === "theme"/);
  assert.match(view, /themeSaving && <p[^>]*role="status"/);
  assert.match(view, /themeError && <p[^>]*role="alert"/);
});

test('Theme updates only the stored appearance field, using its own native IPC command', () => {
  assert.match(bridge, /async setTheme\(theme: ThemeChoice\): Promise<Snapshot>[^\n]*invoke\('set_theme', \{ theme \}\)/);
  assert.match(commands, /fn set_theme\(app: AppHandle, theme: Theme\) -> Result<Snapshot,String>/);
  assert.match(commands, /generate_handler!\[[^\]]*set_theme[^\]]*\]/);
  const isolated = native.match(/pub fn set_theme\([\s\S]*?\n    pub fn diagnostics/);
  assert.ok(isolated, 'Expected a dedicated backend theme-only update');
  for (const fragment of [
    'let mut next = inner.settings.clone();',
    'next.theme = theme;',
    'settings::save(&self.settings_path, &next)?;',
    'inner.settings = next;',
    'self.publish(app);',
  ]) assert.ok(isolated[0].includes(fragment), fragment);
  assert.doesNotMatch(isolated[0], /self\.stop\(|self\.start\(|\.uxplay_args =|\.device_name =/);
  assert.doesNotMatch(bridge, /setTheme\([\s\S]*?invoke\('save_settings'/);
});

test('Theme click is optimistic, prevents concurrent writes, and rolls back on errors', () => {
  assert.match(app, /themeSaveInFlight\.current \|\| traySaveInFlight\.current \|\| value === snapshot\.settings\.theme/);
  assert.match(app, /pendingTheme\.current = value;[\s\S]*?setSnapshot\(current => \(\{ \.\.\.current, settings: \{ \.\.\.current\.settings, theme: value \} \}\)\);/);
  assert.match(app, /await desktop\.setTheme\(value\)/);
  assert.match(app, /catch \(error\) \{[\s\S]*?theme: previous[\s\S]*?setThemeError\(/);
  assert.match(app, /if \(themeSaveInFlight\.current \|\| traySaveInFlight\.current\) return;[\s\S]*?desktop\.save\(\{ \.\.\.draft, theme: snapshot\.settings\.theme, stay_in_tray: snapshot\.settings\.stay_in_tray/);
  assert.match(app, /themeDisabled=\{themeSaving \|\| traySaving \|\| actionBusy \|\| !ready\}/);
  assert.doesNotMatch(app.match(/async function chooseTheme\([\s\S]*?\n  async function chooseTrayPreference/)[0], /desktop\.(start|stop|retry|save)\(/);
});

test('Interface tab and new appearance messages have English translations', async () => {
  const { translate } = await import('../src/lib/i18n.ts');
  for (const [chinese, english] of [
    ['界面', 'Interface'],
    ['外观主题', 'Appearance'],
    ['选择外观主题，切换后立即生效。', 'Choose a theme. Changes apply immediately.'],
    ['正在保存外观设置…', 'Saving appearance…'],
    ['主题保存失败', 'Failed to save appearance'],
  ]) assert.equal(translate(chinese, 'en'), english);
  assert.equal(translate('主题保存失败：disk error', 'en'), 'Failed to save appearance: disk error');
});
