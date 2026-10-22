import { useCallback, useEffect, useRef, useState } from 'react';
import { brand } from './brand';
import { defaultSnapshot, validateDeviceName, validateBrightness, validateFps, validateUxplayArgs, type Settings, type Snapshot } from './domain/state';
import { copyText } from './lib/copy';
import { desktop, isDesktop } from './lib/desktop';
import { AirpimoHome } from './components/AirpimoHome';
import { checkAtStartup, checkForRelease, type ReleaseStatus } from './lib/release-update';
import { AirpimoSettingsDialog, AirpimoUpdateNotice, type SettingsTab } from './components/AirpimoSettingsDialog';

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(defaultSnapshot);
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
        unlisten = await desktop.watch(value => { if (alive) setSnapshot(value); });
        const value = await desktop.snapshot();
        if (alive) setSnapshot(value);
      } catch (error) {
        if (alive) setBootError(String(error));
      } finally { if (alive) setReady(true); }
    })();
    return () => { alive = false; unlisten?.(); };
  }, []);
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
    setDraft({ ...snapshot.settings }); setFormError(''); setSettingsTab(tab); setSettingsOpen(true);
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
  async function saveSettings() {
    const problem = validateDeviceName(draft.device_name);
    if (problem) { setFormError(problem); return; }
    const fpsError = validateFps(draft.fps);
    if (fpsError) { setFormError(fpsError); return; }
    const brightnessError = validateBrightness(draft.brightness);
    if (brightnessError) { setFormError(brightnessError); return; }
    const argsError = validateUxplayArgs(draft.uxplay_args);
    if (argsError) { setFormError(argsError); return; }
    setFormError(''); setActionBusy(true);
    try { setSnapshot(await desktop.save({ ...draft, device_name: draft.device_name.trim() })); setSettingsOpen(false); }
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
      onSettings={() => openSettings()} onProject={() => void openProject()}
      onClearFeedback={() => setFeedback('')} updateAvailable={updateResult?.kind === 'available'}
    />

    <AirpimoSettingsDialog
      settingsOpen={settingsOpen}
      setSettingsOpen={setSettingsOpen}
      settingsTab={settingsTab}
      chooseTab={chooseTab}
      draft={draft}
      setDraft={setDraft}
      saveSettings={saveSettings}
      formError={formError}
      actionBusy={actionBusy}
      updateResult={updateResult}
      updateChecking={updateChecking}
      runUpdateCheck={runUpdateCheck}
      openRelease={openRelease}
      releaseOpening={releaseOpening}
      diagnostics={diagnostics}
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
