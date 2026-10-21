/* Runs synchronously before the React/CSS entry point to prevent a light-theme
   first paint when the app was last used in Dark mode. CSP-safe external file. */
(function () {
  var theme = 'system';
  try { theme = localStorage.getItem('airpimo.theme') || 'system'; } catch (_) {}
  var dark = theme === 'dark';
  if (theme !== 'dark' && theme !== 'light') {
    try { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (_) {}
  }
  if (dark) document.documentElement.classList.add('dark');
  document.documentElement.style.backgroundColor = dark ? '#1b1e23' : '#ffffff';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
})();
