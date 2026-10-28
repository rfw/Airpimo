/* Runs synchronously before the React/CSS entry point to prevent a light-theme
   first paint when the app was last used in Dark mode. CSP-safe external file. */
(function () {
  var theme = 'system';
  try { theme = localStorage.getItem('airpimo.theme') || 'system'; } catch (_) {}
  var dark = theme === 'dark';
  if (theme !== 'dark' && theme !== 'light') {
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) {}
  }
  // Resolve language synchronously before the first document paint.
  var choice = 'system';
  try { choice = localStorage.getItem('airpimo.language') || 'system'; } catch (_) {}
  var preferred = (typeof navigator !== 'undefined' ? (navigator.languages && navigator.languages.length ? navigator.languages[0] : navigator.language) : '') || '';
  var systemLocale = preferred.trim().replace(/_/g, '-').toLowerCase();
  var systemLanguage = /^zh-(tw|hk|mo|hant)(-|$)/.test(systemLocale) ? 'zh-TW'
    : /^zh(-|$)/.test(systemLocale) ? 'zh-CN'
    : /^ja(-|$)/.test(systemLocale) ? 'ja-JP'
    : /^ko(-|$)/.test(systemLocale) ? 'ko-KR' : 'en';
  document.documentElement.lang = ['zh-CN', 'zh-TW', 'en', 'ja-JP', 'ko-KR'].indexOf(choice) !== -1
    ? choice : systemLanguage;
  if (dark) document.documentElement.classList.add('dark');
  document.documentElement.style.backgroundColor = dark ? '#1b1e23' : '#ffffff';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
