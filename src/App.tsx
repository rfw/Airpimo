import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { brand } from './brand';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Switch } from './components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './components/ui/dialog';
import { defaultSnapshot, validateDeviceName, validateBrightness, validateFps, validateUxplayArgs, type Settings, type Snapshot, type ThemeChoice } from './domain/state';
import { copyText } from './lib/copy';
import { desktop, isDesktop } from './lib/desktop';
import { AirpimoHome } from './components/AirpimoHome';
import { checkAtStartup, checkForRelease, type ReleaseStatus } from './lib/release-update';

type SettingsTab = 'config' | 'theme' | 'updates' | 'diagnostics';

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
  async function copy(value: string) {
    try { await copyText(value); setFeedback('复制成功'); }
    catch (error) { setFeedback(String(error)); }
  }

  const dialogMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
  const dialogClass = `airpimo-full-dialog${dialogMac ? ' is-macos' : ''}`;
  const overlayClass = `airpimo-modal-overlay${dialogMac ? ' is-macos' : ''}`;

  return <>
    <AirpimoHome
      snapshot={snapshot} ready={ready} busy={actionBusy} now={now} bootError={bootError} feedback={feedback}
      onStart={() => void execute(desktop.start)} onStop={() => void execute(desktop.stop)}
      onRetry={() => void execute(desktop.retry)} onCopy={(value) => void copy(value)}
      onSettings={() => openSettings()} onClearFeedback={() => setFeedback('')} updateAvailable={updateResult?.kind === 'available'}
    />

    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className={`${dialogClass} airpimo-settings-dialog`} overlayClassName={overlayClass}>
        <div className="modal-heading"><div className="airpimo-settings-heading"><DialogTitle className="modal-title">设置</DialogTitle><DialogDescription className="modal-subtitle">Airpimo · 配置与维护</DialogDescription></div><button aria-label="关闭设置" className="close-button" onClick={() => setSettingsOpen(false)}><X size={18}/></button></div>
        <div className="airpimo-settings-tabs" role="tablist" aria-label="设置选项卡">
          {([['config','配置'],['theme','主题'],['updates','升级'],['diagnostics','诊断']] as const).map(([value,label]) =>
            <button key={value} type="button" id={`airpimo-tab-${value}`} role="tab" aria-controls={`airpimo-panel-${value}`} aria-selected={settingsTab === value}
              tabIndex={settingsTab === value ? 0 : -1} onClick={() => chooseTab(value)} className="airpimo-settings-tab">{label}{value === 'updates' && updateResult?.kind === 'available' ? ' •' : ''}</button>
          )}
        </div>
        <form className="airpimo-settings-body" onSubmit={e => {e.preventDefault(); void saveSettings();}}>
          <section id="airpimo-panel-config" role="tabpanel" aria-labelledby="airpimo-tab-config" hidden={settingsTab !== 'config'}>
            <label htmlFor="deviceName" className="form-label">投屏设备名称</label>
            <Input id="deviceName" value={draft.device_name} maxLength={48} onChange={e => setDraft(x=>({...x,device_name:e.target.value}))} autoComplete="off" spellCheck={false}/>
            <p className="form-hint">修改设备名称后，重启接收服务生效。</p>
            <div className="setting-row"><div><strong>最大请求帧率（FPS）</strong><small>默认 60，实际帧率由手机决定</small></div>
              <Input className="fps-input" aria-label="最大请求帧率" type="number" min={1} max={255} step={1} value={draft.fps} onChange={e => setDraft(x=>({...x,fps:Number(e.target.value)}))}/></div>
            <div className="setting-row brightness-setting"><div className="brightness-description"><strong>画面亮度</strong><small>重启接收服务后生效</small></div>
              <div className="brightness-control"><input aria-label="画面亮度" type="range" min={0} max={100} step={5} value={draft.brightness} onChange={e => setDraft(x=>({...x,brightness:Number(e.target.value)}))}/><output aria-label="当前画面亮度">{draft.brightness}%</output></div></div>
            <div className="setting-row"><div><strong>启动时开启接收</strong><small>启动软件时自动开启接收服务</small></div><Switch aria-label="启动时开启接收" checked={draft.auto_start} onCheckedChange={value=>setDraft(x=>({...x,auto_start:value}))}/></div>
            <div className="setting-row"><div><strong>关闭后驻留托盘</strong><small>开启：关闭窗口后隐藏到托盘，继续接收。关闭：退出软件。</small></div><Switch aria-label="关闭后驻留托盘" checked={draft.stay_in_tray} onCheckedChange={value=>setDraft(x=>({...x,stay_in_tray:value}))}/></div>
            <div className="airpimo-expert-args">
              <label className="form-label" htmlFor="uxplayArgs">UxPlay 自定义启动参数（高级）</label>
              <textarea id="uxplayArgs" className="airpimo-expert-input" rows={3} value={draft.uxplay_args}
                maxLength={2048} placeholder="例如：-vol 0.7 -vsync no" spellCheck={false} autoCapitalize="off" autoComplete="off"
                onChange={e => setDraft(x=>({...x,uxplay_args:e.target.value}))} />
              <p className="airpimo-expert-warning" role="note">非专业人员请勿修改，错误参数可能导致接收失败。保存后需重启接收服务才会生效。</p>
              <p className="form-hint">优先级：上方设置 ＞ 自定义参数 ＞ 默认参数。支持换行、引号；-vol 可调整音量。</p>
            </div>
          </section>
          <section id="airpimo-panel-theme" role="tabpanel" aria-labelledby="airpimo-tab-theme" hidden={settingsTab !== 'theme'}>
            <p className="airpimo-settings-copy">选择界面主题。保存后生效。</p>
            <div className="theme-options" role="radiogroup" aria-label="主题">
              {([['system','跟随系统'],['light','浅色'],['dark','深色']] as const).map(([value,label]) =>
                <label className="theme-option" key={value}><input type="radio" name="theme" value={value} checked={draft.theme===value}
                    onChange={()=>setDraft(x=>({...x,theme:value as ThemeChoice}))}/><span>{label}</span></label>
              )}
            </div>
          </section>
          <section id="airpimo-panel-updates" role="tabpanel" aria-labelledby="airpimo-tab-updates" hidden={settingsTab !== 'updates'}>
            <div className="setting-row"><div><strong>当前版本</strong><small>Airpimo v{brand.version}</small></div></div>
            <div className={`airpimo-update-status${updateResult?.kind === 'error' ? ' is-error' : ''}`} role="status" aria-live="polite">
              {updateChecking ? '正在检查更新…' : !updateResult ? '尚未检查更新' : updateResult.kind === 'available' ? `发现新版本 ${updateResult.latest}`
                : updateResult.kind === 'latest' ? `已是最新版本（v${updateResult.current}）` : updateResult.message}
            </div>
            <div className="airpimo-update-actions">
              <Button type="button" variant="outline" onClick={() => void runUpdateCheck()} disabled={updateChecking}>{updateChecking ? '检查中…' : '检查更新'}</Button>
              {updateResult?.kind === 'available' && <Button type="button" onClick={() => void openRelease()} disabled={releaseOpening}>{releaseOpening ? '打开中…' : '下载'}</Button>}
            </div>
          </section>
          <section id="airpimo-panel-diagnostics" role="tabpanel" aria-labelledby="airpimo-tab-diagnostics" hidden={settingsTab !== 'diagnostics'} className="airpimo-diagnostics-pane">
            <textarea className="diagnostics-text" value={diagnostics} readOnly aria-label="诊断日志"/>
            <div className="airpimo-diagnostics-toolbar">
              <p className="airpimo-diagnostics-privacy">只记录脱敏状态与错误类别，不采集投屏画面。</p>
              <div className="modal-actions">
                <Button type="button" variant="outline" onClick={() => void loadDiagnostics()}>刷新</Button>
                <Button type="button" onClick={() => void exportDiagnostics()} disabled={diagnosticsExporting}>{diagnosticsExporting ? '导出中…' : '导出日志'}</Button>
              </div>
            </div>
            {diagnosticsExportStatus && <p className={`airpimo-export-status${diagnosticsExportStatus.startsWith('导出失败') ? ' is-error' : ''}`} role="status" title={diagnosticsExportStatus}>{diagnosticsExportStatus}</p>}
          </section>
          {formError && (settingsTab === 'config' || settingsTab === 'theme') && <div className="form-error" role="alert">{formError}</div>}
          {(settingsTab === 'config' || settingsTab === 'theme') && <div className="modal-actions airpimo-settings-actions">
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button><Button type="submit" disabled={actionBusy}>保存设置</Button>
          </div>}
        </form>
      </DialogContent>
    </Dialog>

    <Dialog open={updateNoticeOpen} onOpenChange={setUpdateNoticeOpen}>
      <DialogContent className={`airpimo-update-notice${dialogMac ? ' is-macos' : ''}`} overlayClassName={overlayClass}>
        <DialogTitle className="modal-title">发现新版本</DialogTitle>
        <DialogDescription className="airpimo-update-notice-description">
          当前版本 v{brand.version}，最新版本 {updateResult?.kind === 'available' ? updateResult.latest : ''}。
          点击「下载」将在浏览器中打开对应的 GitHub Release 下载页。
        </DialogDescription>
        {releaseOpenError && <p className="form-error" role="alert">{releaseOpenError}</p>}
        <div className="modal-actions">
          <Button type="button" variant="outline" onClick={() => setUpdateNoticeOpen(false)}>稍后</Button>
          <Button type="button" onClick={() => void openRelease()} disabled={releaseOpening || updateResult?.kind !== 'available'}>
            {releaseOpening ? '打开中…' : '下载'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  </>;
}
export default App;
