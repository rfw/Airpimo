import { useCallback, useEffect, useRef, useState } from 'react';
import { useI18n } from "./lib/i18n-react";
import { translate } from "./lib/i18n";
import { brand } from './brand';
import { defaultSnapshot, validateDeviceName, validateBrightness, validateFps, validateUxplayArgs, type Settings, type Snapshot, type ThemeChoice } from './domain/state';
import { copyText } from './lib/copy';
import { desktop, isDesktop } from './lib/desktop';
import { AirpimoHome } from './components/AirpimoHome';
import { checkAtStartup, checkForRelease, type ReleaseStatus } from './lib/release-update';
import { AirpimoSettingsDialog, AirpimoUpdateNotice, type SettingsTab } from './components/AirpimoSettingsDialog';

function App() {
  const { language } = useI18n();
  const [snapshot, setSnapshot] = useState<Snapshot>(() => {
    // Browser preview also retains appearance across reloads; the native app
    // always uses the persisted Rust Settings as its source of truth.
    if (isDesktop()) return defaultSnapshot;
    try {
      const stored = localStorage.getItem('airpimo.theme');
      const theme: ThemeChoice = stored === 'dark' || stored === 'light' ? stored : 'system';
      return { ...defaultSnapshot, settings: { ...defaultSnapshot.settings, theme } };
    } catch { return defaultSnapshot; }
  });
  const [ready, setReady] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('config');
  const [updateResult, setUpdateResult] = useState<ReleaseStatus | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateNoticeOpen, setUpdateNoticeOpen] = useState(false);
  const [releaseOpenError, setReleaseOpenError] = useState('');
  const [releaseOpening, setReleaseOpening] = useState(false);
  const updateRequest = useRef(0);
  const [diagnostics, setDiagnostics] = useState('');
  const [diagnosticsExportStatus, setDiagnosticsExportStatus] = useState('');
  const [diagnosticsExporting, setDiagnosticsExporting] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [draft, setDraft] = useState<Settings>(defaultSnapshot.settings);
  const [formError, setFormError] = useState('');
  const [bootError, setBootError] = useState('');
  const [themeSaving, setThemeSaving] = useState(false);
  const [themeError, setThemeError] = useState('');
  const themeSaveInFlight = useRef(false);
  const [traySaving, setTraySaving] = useState(false);
  const [trayError, setTrayError] = useState('');
  const [trayPersisted, setTrayPersisted] = useState(false);
  const traySaveInFlight = useRef(false);
  const pendingTray = useRef<boolean | null>(null);
  // Hide stale native snapshots while an appearance write is pending.
  const pendingTheme = useRef<ThemeChoice | null>(null);
  const applyNativeSnapshot = useCallback((value: Snapshot) => {
    // A receiver://snapshot may race either isolated preference write.
    const selectedTheme = pendingTheme.current;
    const selectedTray = pendingTray.current;
    setSnapshot(selectedTheme === null && selectedTray === null ? value : {
      ...value, settings: {
        ...value.settings,
        ...(selectedTheme === null ? {} : { theme: selectedTheme }),
        ...(selectedTray === null ? {} : { stay_in_tray: selectedTray }),
      },
    });
  }, []);

  // Keep the static boot screen until backend snapshot/error initialization completes.
  useEffect(() => {
    if (ready) document.getElementById('airpimo-startup')?.remove();
  }, [ready]);

  useEffect(() => {
    let alive = true;
    let unlisten: (() => void) | undefined;
    if (!isDesktop()) {
      setBootError('当前是浏览器 UI 预览，尚未连接到本机 AirPlay 引擎。');
      setReady(true);
      return;
    }
    (async () => {
      try {
        unlisten = await desktop.watch(value => { if (alive) applyNativeSnapshot(value); });
        const value = await desktop.snapshot();
        if (alive) applyNativeSnapshot(value);
      } catch (error) {
        if (alive) setBootError(String(error));
      } finally { if (alive) setReady(true); }
    })();
    return () => { alive = false; unlisten?.(); };
  }, [applyNativeSnapshot]);
  useEffect(() => {
    // Keep the bootstrapped color until the real persisted Tauri settings arrive.
    if (!ready) return;
    const theme = snapshot.settings.theme;
    try { localStorage.setItem('airpimo.theme', theme); } catch { /* storage may be unavailable */ }
    const query = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      const dark = theme === 'dark' || (theme === 'system' && query.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.backgroundColor = dark ? '#1b1e23' : '#ffffff';
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    sync();
    if (theme !== 'system') return;
    if (query.addEventListener) { query.addEventListener('change', sync); return () => query.removeEventListener('change', sync); }
    query.addListener(sync); return () => query.removeListener(sync);
  }, [ready, snapshot.settings.theme]);
  // One actual network check per application launch (also under React StrictMode).
  useEffect(() => {
    if (!isDesktop()) return;
    const request = ++updateRequest.current;
    setUpdateChecking(true);
    void checkAtStartup(brand.version).then(result => {
      if (updateRequest.current === request) {
        setUpdateResult(result);
        if (result.kind === 'available') { setReleaseOpenError(''); setUpdateNoticeOpen(true); }
      }
    }).finally(() => {
      if (updateRequest.current === request) setUpdateChecking(false);
    });
  }, []);
  // A copied-name confirmation must not mask live receiver state indefinitely.
  useEffect(() => {
    if (!['复制成功', '诊断日志已导出'].includes(feedback)) return;
    const timer = setTimeout(() => setFeedback(prev => prev === feedback ? '' : prev), 3200);
    return () => clearTimeout(timer);
  }, [feedback]);
  useEffect(() => {
    if (snapshot.stage !== 'connected') return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [snapshot.stage]);

  const execute = useCallback(async (action: () => Promise<Snapshot>) => {
    setFeedback(''); setActionBusy(true);
    try { setSnapshot(await action()); }
    catch (error) { setFeedback(String(error)); }
    finally { setActionBusy(false); }
  }, []);

  function openSettings(tab: SettingsTab = 'config') {
    setDraft({ ...snapshot.settings }); setFormError(''); setThemeError(''); setTrayError(''); setTrayPersisted(false); setSettingsTab(tab); setSettingsOpen(true);
    if (tab === 'diagnostics') void loadDiagnostics();
  }
  function chooseTab(tab: SettingsTab) {
    setSettingsTab(tab); setFormError('');
    if (tab === 'diagnostics') void loadDiagnostics();
  }
  async function runUpdateCheck() {
    const request = ++updateRequest.current;
    setUpdateChecking(true);
    try {
      const result = await checkForRelease(brand.version);
      if (updateRequest.current === request) {
        setUpdateResult(result);
        if (result.kind === 'available') {
          setReleaseOpenError('');
          setSettingsOpen(false);
          setUpdateNoticeOpen(true);
        }
      }
    } finally {
      if (updateRequest.current === request) setUpdateChecking(false);
    }
  }
  async function openRelease() {
    if (updateResult?.kind !== 'available' || releaseOpening) return;
    setReleaseOpening(true);
    try {
      await desktop.openReleasePage(updateResult.pageUrl);
      setReleaseOpenError('');
      setUpdateNoticeOpen(false);
    } catch (error) { setReleaseOpenError(`打开下载页面失败：${String(error)}`); }
    finally { setReleaseOpening(false); }
  }
  async function chooseTheme(value: ThemeChoice) {
    if (!ready || actionBusy || themeSaveInFlight.current || traySaveInFlight.current || value === snapshot.settings.theme) return;
    const previous = snapshot.settings.theme;
    themeSaveInFlight.current = true;
    pendingTheme.current = value;
    setThemeSaving(true);
    setThemeError('');
    // Optimistic appearance change: no receiver restart or configuration commit.
    setSnapshot(current => ({ ...current, settings: { ...current.settings, theme: value } }));
    try {
      // Keep the standalone browser UI preview interactive without invoking Tauri.
      if (isDesktop()) {
        const updated = await desktop.setTheme(value);
        pendingTheme.current = null;
        setSnapshot(updated);
      } else {
        pendingTheme.current = null;
      }
    } catch (error) {
      pendingTheme.current = null;
      setSnapshot(current => ({ ...current, settings: { ...current.settings, theme: previous } }));
      setThemeError(`主题保存失败：${String(error)}`);
    } finally {
      themeSaveInFlight.current = false;
      setThemeSaving(false);
    }
  }

  async function chooseTrayPreference(value: boolean) {
    if (!ready || actionBusy || themeSaveInFlight.current || traySaveInFlight.current || value === snapshot.settings.stay_in_tray) return;
    const previous = snapshot.settings.stay_in_tray;
    traySaveInFlight.current = true;
    pendingTray.current = value;
    setTraySaving(true);
    setTrayError('');
    setTrayPersisted(false);
    // Update the switch immediately, then commit the one persisted native field.
    setSnapshot(current => ({ ...current, settings: { ...current.settings, stay_in_tray: value } }));
    setDraft(current => ({ ...current, stay_in_tray: value }));
    try {
      if (isDesktop()) {
        const updated = await desktop.setStayInTray(value);
        pendingTray.current = null;
        setSnapshot(updated);
        setDraft(current => ({ ...current, stay_in_tray: updated.settings.stay_in_tray }));
        setTrayPersisted(true);
      } else {
        pendingTray.current = null;
        setTrayPersisted(true);
      }
    } catch (error) {
      pendingTray.current = null;
      setSnapshot(current => ({ ...current, settings: { ...current.settings, stay_in_tray: previous } }));
      setDraft(current => ({ ...current, stay_in_tray: previous }));
      setTrayError(`保存托盘设置失败：${String(error)}`);
    } finally {
      traySaveInFlight.current = false;
      setTraySaving(false);
    }
  }

  async function saveSettings() {
    // A receiver configuration save must not overwrite a pending preference write.
    if (themeSaveInFlight.current || traySaveInFlight.current) return;
    const problem = validateDeviceName(draft.device_name);
    if (problem) { setFormError(problem); return; }
    const fpsError = validateFps(draft.fps);
    if (fpsError) { setFormError(fpsError); return; }
    const brightnessError = validateBrightness(draft.brightness);
    if (brightnessError) { setFormError(brightnessError); return; }
    const argsError = validateUxplayArgs(draft.uxplay_args);
    if (argsError) { setFormError(argsError); return; }
    setFormError(''); setActionBusy(true);
    try { setSnapshot(await desktop.save({ ...draft, theme: snapshot.settings.theme, stay_in_tray: snapshot.settings.stay_in_tray, device_name: draft.device_name.trim() })); setSettingsOpen(false); }
    catch (error) { setFormError(String(error)); }
    finally { setActionBusy(false); }
  }
  async function loadDiagnostics() {
    setDiagnostics('读取中…'); setDiagnosticsExportStatus('');
    try { setDiagnostics(await desktop.diagnostics()); }
    catch (error) { setDiagnostics(`诊断读取失败：${String(error)}`); }
  }
  async function exportDiagnostics() {
    if (diagnosticsExporting) return;
    setDiagnosticsExporting(true); setDiagnosticsExportStatus('正在导出…');
    try {
      const path = await desktop.exportDiagnostics();
      setDiagnosticsExportStatus(`已导出到：${path}`);
      setFeedback('诊断日志已导出');
    } catch (error) {
      const message = `导出失败：${String(error)}`;
      setDiagnosticsExportStatus(message);
      setFeedback(message);
    } finally { setDiagnosticsExporting(false); }
  }
  async function openProject() {
    if (!isDesktop()) {
      window.open('https://github.com/rfw/Airpimo', '_blank', 'noopener,noreferrer');
      return;
    }
    try {
      await desktop.openProjectPage();
    } catch (error) {
      setFeedback(`打开 GitHub 失败：${String(error)}`);
    }
  }

  async function copy(value: string) {
    try { await copyText(value); setFeedback('复制成功'); }
    catch (error) { setFeedback(String(error)); }
  }

  return <>
    <AirpimoHome
      snapshot={snapshot} ready={ready} busy={actionBusy} now={now} bootError={bootError} feedback={feedback}
      onStart={() => void execute(desktop.start)} onStop={() => void execute(desktop.stop)}
      onRetry={() => void execute(desktop.retry)} onCopy={(value) => void copy(value)}
      onSettings={() => openSettings()}
      onClearFeedback={() => setFeedback('')} updateAvailable={updateResult?.kind === 'available'}
    />

    <AirpimoSettingsDialog
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      settingsTab={settingsTab}
      chooseTab={chooseTab}
      onProject={() => void openProject()}
      draft={draft}
      setDraft={setDraft}
      saveSettings={saveSettings}
      formError={translate(formError, language)}
      actionBusy={actionBusy || themeSaving || traySaving}
      traySaving={traySaving}
      trayError={trayError}
      trayPersisted={trayPersisted}
      onTrayPreferenceChange={(value) => void chooseTrayPreference(value)}
      theme={snapshot.settings.theme}
      themeSaving={themeSaving}
      themeDisabled={themeSaving || traySaving || actionBusy || !ready}
      themeError={themeError}
      onThemeChange={(value) => void chooseTheme(value)}
      updateResult={updateResult}
      updateChecking={updateChecking}
      runUpdateCheck={runUpdateCheck}
      openRelease={openRelease}
      releaseOpening={releaseOpening}
      diagnostics={translate(diagnostics, language)}
      loadDiagnostics={loadDiagnostics}
      exportDiagnostics={exportDiagnostics}
      diagnosticsExportStatus={diagnosticsExportStatus}
      diagnosticsExporting={diagnosticsExporting}
    />
    <AirpimoUpdateNotice
      updateNoticeOpen={updateNoticeOpen}
      setUpdateNoticeOpen={setUpdateNoticeOpen}
      updateResult={updateResult}
      releaseOpenError={releaseOpenError}
      releaseOpening={releaseOpening}
      openRelease={openRelease}
    />
  </>;
}
export default App;
