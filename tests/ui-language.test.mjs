import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { registerHooks } from 'node:module';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const {
  LANGUAGE_STORAGE_KEY, parseLanguageChoice, systemLanguage, resolveLanguage,
  detectSystemLanguage, readLanguageChoice, translate,
} = await import('../src/lib/i18n.ts');

test('language preference, manual priority, unsupported locale fallback', () => {
  assert.equal(LANGUAGE_STORAGE_KEY, 'airpimo.language');
  for (const x of [null, undefined, '', 'auto', 'fr', {}, 7]) assert.equal(parseLanguageChoice(x), 'system');
  for (const x of ['system', 'en', 'zh-CN']) assert.equal(parseLanguageChoice(x), x);
  assert.equal(systemLanguage(['zh-CN', 'en-US']), 'zh-CN');
  assert.equal(systemLanguage(['zh-TW', 'en']), 'zh-CN');
  assert.equal(systemLanguage(['ZH-hk']), 'zh-CN');
  assert.equal(systemLanguage(['ja-JP', 'zh-CN']), 'en');
  assert.equal(systemLanguage([]), 'en');
  assert.equal(detectSystemLanguage({ languages: [], language: 'zh-CN' }), 'zh-CN');
  assert.equal(detectSystemLanguage({ languages: ['fr-FR'], language: 'zh-CN' }), 'en');
  assert.equal(resolveLanguage('system', 'zh-CN'), 'zh-CN');
  assert.equal(resolveLanguage('system', 'en'), 'en');
  assert.equal(resolveLanguage('en', 'zh-CN'), 'en');
  assert.equal(resolveLanguage('zh-CN', 'en'), 'zh-CN');
});

test('storage persists front-end choice and degrades safely when disabled', () => {
  const store = new Map();
  const localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  assert.equal(readLanguageChoice(localStorage), 'system');
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'en');
  assert.equal(readLanguageChoice(localStorage), 'en');
  localStorage.setItem(LANGUAGE_STORAGE_KEY, 'zh-CN');
  assert.equal(readLanguageChoice(localStorage), 'zh-CN');
  assert.equal(readLanguageChoice({ getItem: () => { throw Error('blocked'); } }), 'system');
  assert.equal(readLanguageChoice(null), 'system');
});

test('English catalog covers user-facing labels, receiver status and validation errors', () => {
  for (const [source, english] of [
    ['界面语言', 'Interface language'],
    ['设置', 'Settings'],
    ['屏幕镜像', 'Screen Mirroring'],
    ['接收已停止', 'Receiver stopped'],
    ['设备名称不能为空', 'Device name cannot be empty'],
  ]) {
    assert.equal(translate(source, 'zh-CN'), source);
    assert.equal(translate(source, 'en'), english);
  }
  assert.equal(translate('UxPlay 意外退出（退出码 42）', 'en'), 'UxPlay exited unexpectedly (exit code 42)');
  assert.equal(translate('更新服务请求失败（HTTP 403）。', 'en'), 'Update service request failed (HTTP 403).');
  assert.equal(translate('Diagnostics: raw command output', 'en'), 'Diagnostics: raw command output');
});

const bootstrap = read('public/theme-bootstrap.js');
function simulateBootstrap({ choice, languages, dark = false, locked = false }) {
  const html = { lang: 'en', classList: { add() {} }, style: {} };
  const context = {
    document: { documentElement: html },
    navigator: { language: languages[0], languages },
    localStorage: { getItem: key => {
      if (locked) throw new Error('blocked');
      return key === LANGUAGE_STORAGE_KEY ? choice : null;
    } },
    window: { matchMedia: () => ({ matches: dark }) },
  };
  runInNewContext(bootstrap, context);
  return html;
}

test('synchronous bootstrap selects html language before React paint', () => {
  assert.equal(simulateBootstrap({ languages: ['zh-CN'] }).lang, 'zh-CN');
  assert.equal(simulateBootstrap({ languages: ['fr-FR'] }).lang, 'en');
  assert.equal(simulateBootstrap({ languages: ['zh-CN'], choice: 'en' }).lang, 'en');
  assert.equal(simulateBootstrap({ languages: ['en'], choice: 'zh-CN' }).lang, 'zh-CN');
  assert.equal(simulateBootstrap({ languages: ['ja'], locked: true }).lang, 'en');
  assert.equal(simulateBootstrap({ languages: ['zh'], dark: true }).style.colorScheme, 'dark');
  assert.match(read('index.html'), /<script src="\/theme-bootstrap\.js"><\/script>[\s\S]*?<div id="airpimo-startup"/);
  assert.match(read('public/startup.css'), /html\[lang="en"\] \.airpimo-startup-zh \{ display: none; \}/);
});

test('language selector lives in the Interface panel and never saves to receiver', () => {
  const settings = read('src/components/AirpimoSettingsDialog.tsx');
  const context = read('src/lib/i18n-react.tsx');
  const app = read('src/App.tsx');
  assert.match(settings, /\["theme", t\("界面"\)\]/);
  assert.match(settings, /id="airpimo-panel-theme"[\s\S]*?id="airpimo-interface-language-label"[\s\S]*?id="airpimo-appearance-theme-label"/);
  assert.match(settings, /name="interfaceLanguage"[\s\S]*?checked=\{choice === value\}[\s\S]*?setChoice\(value\)/);
  assert.match(settings, /\["system", t\("跟随系统"\)\][\s\S]*?\["zh-CN", "简体中文"\][\s\S]*?\["en", "English"\]/);
  assert.match(context, /useState<LanguageChoice>\(\(\) => \{/);
  assert.match(context, /return readLanguageChoice\(window\.localStorage\)/);
  assert.match(context, /localStorage\.setItem\(LANGUAGE_STORAGE_KEY, value\)/);
  assert.match(context, /window\.addEventListener\('languagechange', sync\)/);
  assert.doesNotMatch(context, /desktop\.save|invoke\(|restart\(/);
  assert.match(app, /desktop\.save\(\{ \.\.\.draft, theme: snapshot\.settings\.theme, device_name:/);
  assert.doesNotMatch(read('src/domain/state.ts'), /language:/);
});

test('display localization changes render-only layer without mutating receiver model', async () => {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === '../lib/i18n' && context.parentURL?.endsWith('/home-status.ts')) return nextResolve('../lib/i18n.ts', context);
      if (specifier === './state' && context.parentURL?.endsWith('/home-status.ts')) return nextResolve('./state.ts', context);
      return nextResolve(specifier, context);
    },
  });
  const { homeStatus } = await import('../src/domain/home-status.ts');
  const { defaultSnapshot } = await import('../src/domain/state.ts');
  const s = { ...defaultSnapshot, stage: 'connected', process_running: true, connected_since: 100 };
  const english = homeStatus(s, true, '', 161, 'en');
  assert.equal(english.label, 'Mirroring · 00:01:01');
  assert.match(english.details, /audio/i);
  assert.equal(s.stage, 'connected');
  assert.equal(homeStatus(s, true, '', 161, 'zh-CN').label, '正在投屏 · 00:01:01');
});

test('all visible translated literals have English translations', () => {
  for (const file of [
    'src/components/AirpimoHome.tsx',
    'src/components/AirpimoSettingsDialog.tsx',
    'src/components/AirpimoSignal.tsx',
    'src/components/ScreenMirroringGuide.tsx',
  ]) {
    const source = read(file);
    const keys = Array.from(source.matchAll(/\bt\(["']([^"']+)["']/g), match => match[1]);
    assert.ok(keys.length > 0, `No translation keys found in ${file}`);
    for (const key of keys) {
      assert.notEqual(translate(key, 'en'), key, `${file}: missing English translation for ${key}`);
    }
  }
});
