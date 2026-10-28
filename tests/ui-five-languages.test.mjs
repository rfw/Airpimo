import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const { LANGUAGE_STORAGE_KEY, parseLanguageChoice, systemLanguage, resolveLanguage, translate, translateTemplate } = await import('../src/lib/i18n.ts');
const choices = ['zh-CN', 'en', 'zh-TW', 'ja-JP', 'ko-KR'];

function prepaint({ language = 'fr-FR', choice = null }) {
  const html = { lang: 'en', classList: { add() {} }, style: {} };
  runInNewContext(read('public/theme-bootstrap.js'), {
    document: { documentElement: html },
    window: { matchMedia: () => ({ matches: false }) },
    navigator: { languages: [language], language },
    localStorage: { getItem: key => key === LANGUAGE_STORAGE_KEY ? choice : null },
  });
  return html.lang;
}

test('all five choices survive persistence and override OS preference', () => {
  for (const language of choices) {
    assert.equal(parseLanguageChoice(language), language);
    assert.equal(resolveLanguage(language, 'en'), language);
    assert.equal(prepaint({ language: 'fr-FR', choice: language }), language);
  }
  assert.equal(parseLanguageChoice('fr'), 'system');
  assert.equal(parseLanguageChoice('ko'), 'system');
});

test('system language and first paint use identical locale mapping', () => {
  for (const [locale, expected] of [
    ['zh-CN', 'zh-CN'], ['zh-Hans-CN', 'zh-CN'], ['zh-SG', 'zh-CN'],
    ['zh-TW', 'zh-TW'], ['zh-HK', 'zh-TW'], ['zh-MO', 'zh-TW'], ['zh-Hant-TW', 'zh-TW'],
    ['ja', 'ja-JP'], ['ja-JP', 'ja-JP'], ['ko', 'ko-KR'], ['ko-KR', 'ko-KR'],
    ['fr-FR', 'en'], ['de-DE', 'en'],
  ]) {
    assert.equal(systemLanguage([locale]), expected, locale);
    assert.equal(prepaint({ language: locale }), expected, locale);
  }
  assert.equal(systemLanguage(['fr-FR', 'ja-JP']), 'en', 'only first OS language chooses the UI');
});

test('all English source keys have translations in the three new locales', () => {
  const source = read('src/lib/i18n.ts');
  const english = source.split('const english: Record<string, string> = {')[1].split('\n};')[0];
  const keys = [...english.matchAll(/'((?:\\.|[^'])*)':\s*'((?:\\.|[^'])*)'/g)].map(m => m[1]);
  assert.ok(keys.length >= 185, 'catalog unexpectedly shrank');
  for (const key of keys) {
    for (const locale of ['zh-TW', 'ja-JP', 'ko-KR']) {
      const catalog = source.split(`const locale_${locale.replace('-', '_')}: Record<string, string> = {`)[1].split('\n};')[0];
      assert.ok(catalog.includes(`'${key.replaceAll("'", "\\'")}':`), `${locale}: missing translation for ${key}`);
      assert.ok(translate(key, locale).length > 0);
    }
  }
  assert.equal(translateTemplate('当前版本 v{current}，最新版本 {latest}。', 'ja-JP', { current: '0.2.0', latest: '0.3.0' }).includes('0.3.0'), true);
  assert.match(translate('UxPlay 意外退出（退出码 17）', 'ko-KR'), /17/);
  assert.match(translate('更新服务请求失败（HTTP 429）。', 'ja-JP'), /429/);
  assert.equal(translate('Raw: no translation needed', 'ko-KR'), 'Raw: no translation needed');
});

test('five native language names fit a two-column selector; startup messages are localized', () => {
  const settings = read('src/components/AirpimoSettingsDialog.tsx');
  assert.match(settings, /grid grid-cols-2/);
  for (const [code, label] of [['zh-TW','繁體中文'],['ja-JP','日本語'],['ko-KR','한국어']]) {
    assert.ok(settings.includes(`["${code}", "${label}"]`));
    assert.match(read('public/startup.css'), new RegExp(`html\\[lang="${code}"\\]`));
  }
  assert.match(read('index.html'), /airpimo-startup-ja/);
  assert.match(read('index.html'), /airpimo-startup-ko/);
});

test('NSIS language lists and custom cleanup prompts match exactly five supported languages', () => {
  const conf = JSON.parse(read('src-tauri/tauri.conf.json'));
  const win7 = JSON.parse(read('src-tauri/tauri.win7.conf.json'));
  assert.deepEqual(conf.bundle.windows.nsis.languages, ['English','SimpChinese','TradChinese','Japanese','Korean']);
  assert.ok(!('languages' in win7.bundle.windows.nsis));
  assert.equal(conf.bundle.windows.nsis.displayLanguageSelector, false);
  const nsis = read('scripts/prepare-windows-nsis.mjs');
  for (const message of ['airpimoCleanupCreateError','airpimoCleanupWriteError','airpimoCleanupLocationError','airpimoCleanupProcessError','airpimoPreparingUninstall']) {
    for (const lang of ['ENGLISH','SIMPCHINESE','TRADCHINESE','JAPANESE','KOREAN']) {
      assert.ok(nsis.includes('LangString ' + message + ' \\${LANG_' + lang + '}'), `${message} in ${lang}`);
    }
  }
});
