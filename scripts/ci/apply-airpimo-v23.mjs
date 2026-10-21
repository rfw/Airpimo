#!/usr/bin/env node
/** Airpimo v23: full-height dialogs, working native log export, tray restore.
 * Narrow patches on top of v21/v22; no stale v0.1.4 Rust/React file overwrite.
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const project = fileURLToPath(new URL('../..', import.meta.url));
const already = (s, text) => s.includes(text);
function one(s, from, to, label) {
  if (s.includes(to)) return s;
  let pos = s.indexOf(from);
  if (pos === -1 || s.indexOf(from, pos+from.length)!==-1) throw Error(`${label}: missing/ambiguous source anchor`);
  return s.slice(0,pos)+to+s.slice(pos+from.length);
}
export function plan(root=project) {
  if (!existsSync(join(root,'src/styles/airpimo-dialogs.css'))) throw Error('v23 CSS file not found, unzip the complete ZIP first');
  const changes = new Map();
  function edit(rel, fn) {
    const path = join(root,rel);
    if(!existsSync(path)) throw Error(`missing ${rel}`);
    const before=readFileSync(path,'utf8'), after=fn(before);
    if(after!==before) changes.set(rel,{before,after,path});
  }
  edit('src/main.tsx',s=>one(s,"import './styles/airpimo-home.css';", "import './styles/airpimo-home.css';\nimport './styles/airpimo-dialogs.css';",'styles import'));
  edit('src/components/ui/dialog.tsx',s=>one(s,
    `export const DialogContent = ({children, className}: {children: ReactNode; className?: string}) => <DialogPrimitive.Portal><DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/30"/><DialogPrimitive.Content`,
    `export const DialogContent = ({children, className, overlayClassName}: {children: ReactNode; className?: string; overlayClassName?: string}) => <DialogPrimitive.Portal><DialogPrimitive.Overlay className={cn('fixed inset-0 z-40 bg-black/30',overlayClassName)}/><DialogPrimitive.Content`, 'dialog overlay class'));
  edit('src/lib/desktop.ts',s=>one(s,
    "  async diagnostics(): Promise<string> { requireDesktop(); return invoke('get_diagnostics'); },",
    "  async diagnostics(): Promise<string> { requireDesktop(); return invoke('get_diagnostics'); },\n  async exportDiagnostics(): Promise<string> { requireDesktop(); return invoke('export_diagnostics'); },", 'native export invoke'));
  edit('src/App.tsx',initial=>{
    if (initial.includes("type SettingsTab = 'config' | 'theme' | 'updates' | 'diagnostics';")) {
      // v25 moves the old independent diagnostic dialog into Settings.
      // Verify its complete native export chain instead of reintroducing old JSX.
      if (!initial.includes('await desktop.exportDiagnostics()') ||
          !initial.includes('role="tabpanel"') ||
          !initial.includes('diagnosticsExportStatus')) throw Error('v25 diagnostics integration incomplete');
      return initial;
    }
    let s=initial;
    s=one(s,"  const [diagnostics, setDiagnostics] = useState('');", "  const [diagnostics, setDiagnostics] = useState('');\n  const [diagnosticsExportStatus, setDiagnosticsExportStatus] = useState('');\n  const [diagnosticsExporting, setDiagnosticsExporting] = useState(false);",'diagnostics state');
    s=one(s,"    setDiagnosticsOpen(true); setDiagnostics('读取中…');", "    setDiagnosticsOpen(true); setDiagnostics('读取中…'); setDiagnosticsExportStatus('');",'diagnostics reset');
    const oldExport=`  function exportDiagnostics() {
    const blob = new Blob([diagnostics], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = \`airpimo-diagnostics-\${new Date().toISOString().slice(0,10)}.txt\`;
    document.body.appendChild(link); link.click(); link.remove();
    URL.revokeObjectURL(url);
  }`;
    const newExport=`  async function exportDiagnostics() {
    if (diagnosticsExporting) return;
    setDiagnosticsExporting(true); setDiagnosticsExportStatus('正在导出…');
    try {
      const path = await desktop.exportDiagnostics();
      setDiagnosticsExportStatus(\`已导出到：\${path}\`);
      setFeedback('诊断日志已导出');
    } catch (error) {
      const message = \`导出失败：\${String(error)}\`;
      setDiagnosticsExportStatus(message);
      setFeedback(message);
    } finally { setDiagnosticsExporting(false); }
  }`;
    s=one(s,oldExport,newExport,'native log export');
    s=one(s,'  return <>\n    <AirpimoHome',
      `  const dialogMac = /Macintosh|Mac OS X/i.test(navigator.userAgent);
  const dialogClass = \`airpimo-full-dialog\${dialogMac ? ' is-macos' : ''}\`;
  const overlayClass = \`airpimo-modal-overlay\${dialogMac ? ' is-macos' : ''}\`;

  return <>
    <AirpimoHome`, 'dialog target platform');
    // Exactly two dialogs, and two Radix dialog portals.
    if(!s.includes('    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>') || !s.includes('    <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>')) throw Error('missing settings/diagnostics dialog');
    s=one(s,'    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>\n      <DialogContent>',
      '    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>\n      <DialogContent className={dialogClass} overlayClassName={overlayClass}>','settings full dialog');
    s=one(s,'    <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>\n      <DialogContent><div className="modal-heading">',
      '    <Dialog open={diagnosticsOpen} onOpenChange={setDiagnosticsOpen}>\n      <DialogContent className={dialogClass} overlayClassName={overlayClass}><div className="modal-heading">','diagnostics full dialog');
    s=one(s,'<div className="modal-actions"><Button variant="outline" onClick={() => void copy(diagnostics)}>复制</Button><Button onClick={exportDiagnostics}>导出日志</Button></div>',
      '<div className="modal-actions"><Button variant="outline" onClick={() => void copy(diagnostics)}>复制</Button><Button onClick={() => void exportDiagnostics()} disabled={diagnosticsExporting}>{diagnosticsExporting ? \'导出中…\' : \'导出日志\'}</Button></div>\n        {diagnosticsExportStatus && <p className={`airpimo-export-status${diagnosticsExportStatus.startsWith(\'导出失败\') ? \' is-error\' : \'\'}`} role="status" title={diagnosticsExportStatus}>{diagnosticsExportStatus}</p>}','export status');
    return s;
  });
  edit('src-tauri/src/lib.rs',s=>{
    if (s.includes('fn open_release_page(url: String)')) {
      if (!s.includes('get_diagnostics,export_diagnostics,open_release_page]')) throw Error('v25 IPC registration incomplete');
      return s;
    }
    s=one(s,'fn get_diagnostics(app:AppHandle) -> String { controller(&app).diagnostics() }',
`fn get_diagnostics(app:AppHandle) -> String { controller(&app).diagnostics() }

// The WebView's Blob download is not a dependable native-file export.
// Export only sanitized diagnostics supplied by Controller; never raw receiver stderr.
#[tauri::command]
fn export_diagnostics(app:AppHandle) -> Result<String,String> {
    let downloads=app.path().download_dir().map_err(|e| format!("无法定位下载目录：{e}"))?;
    let epoch=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("系统时间异常：{e}"))?.as_millis();
    let filename=format!("airpimo-diagnostics-{epoch}-{}.txt", std::process::id());
    let destination=downloads.join(filename);
    std::fs::write(&destination,controller(&app).diagnostics())
        .map_err(|e| format!("导出诊断日志失败（{}）：{e}",destination.display()))?;
    Ok(destination.to_string_lossy().to_string())
}`, 'native export command');
    s=one(s,'.plugin(tauri_plugin_single_instance::init(|app,_,_| show_main(app)))',
`.plugin(tauri_plugin_single_instance::init(|app,_,_| show_main(app)))
        .on_tray_icon_event(|app,event| {
            match event {
                #[cfg(target_os="windows")]
                tauri::tray::TrayIconEvent::DoubleClick {button:tauri::tray::MouseButton::Left,..} => show_main(app),
                // Tauri's native DoubleClick tray event is Windows-only.
                #[cfg(target_os="macos")]
                tauri::tray::TrayIconEvent::Click {button:tauri::tray::MouseButton::Left,button_state:tauri::tray::MouseButtonState::Up,..} => show_main(app),
                _=>{},
            }
        })`, 'tray click handler');
    s=one(s,'save_settings,get_diagnostics])','save_settings,get_diagnostics,export_diagnostics])', 'command registration');
    return s;
  });
  edit('.gitignore',s=>s.includes('.airpimo-v23-backup/')?s:`${s.replace(/\s*$/,'')}\n.airpimo-v23-backup/\n`);
  return changes;
}
export function apply(root=project,write=false) {
 const changes=plan(root);
 if(write) {
  for(const [rel,{before}] of changes) {
   const target=join(root,'.airpimo-v23-backup',rel);
   mkdirSync(dirname(target),{recursive:true});
   if(!existsSync(target))writeFileSync(target,before,'utf8');
  }
  for(const {path,after} of changes.values())writeFileSync(path,after,'utf8');
 }
 return [...changes.keys()];
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const mode=process.argv[2]??'--check';
  if(!['--apply','--check'].includes(mode))throw Error('Usage: --apply|--check');
  const result=apply(project,mode==='--apply');
  for(const f of result)console.log(`[airpimo-v23] ${mode==='--apply'?'UPDATED':'PENDING'} ${f}`);
  if(mode==='--check' && result.length)throw Error('v23 not fully applied');
  console.log(`[airpimo-v23] PASS`);
 }catch(err){console.error(`[airpimo-v23] BLOCKED: ${err.message}`);process.exitCode=2;}
}
