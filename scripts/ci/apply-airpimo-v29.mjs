#!/usr/bin/env node
/** Airpimo UI polish. Only updates known source anchors; never overwrites newer source files. */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const defaultRoot = fileURLToPath(new URL('../..', import.meta.url));
// Fixed, source-reviewed hunks. No external commands, no version changes, no backups.
const patches = [
  {
    "path": "src/App.tsx",
    "before": "  const [updateChecking, setUpdateChecking] = useState(false);",
    "after": "  const [updateChecking, setUpdateChecking] = useState(false);\n  const [updateNoticeOpen, setUpdateNoticeOpen] = useState(false);\n  const [releaseOpenError, setReleaseOpenError] = useState('');"
  },
  {
    "path": "src/App.tsx",
    "before": "    void checkAtStartup(brand.version).then(result => {\n      if (updateRequest.current === request) setUpdateResult(result);\n    }).finally",
    "after": "    void checkAtStartup(brand.version).then(result => {\n      if (updateRequest.current === request) {\n        setUpdateResult(result);\n        if (result.kind === 'available') { setReleaseOpenError(''); setUpdateNoticeOpen(true); }\n      }\n    }).finally"
  },
  {
    "path": "src/App.tsx",
    "before": "      const result = await checkForRelease(brand.version);\n      if (updateRequest.current === request) setUpdateResult(result);\n    } finally",
    "after": "      const result = await checkForRelease(brand.version);\n      if (updateRequest.current === request) {\n        setUpdateResult(result);\n        if (result.kind === 'available') {\n          setReleaseOpenError('');\n          setSettingsOpen(false);\n          setUpdateNoticeOpen(true);\n        }\n      }\n    } finally"
  },
  {
    "path": "src/App.tsx",
    "before": "    try { await desktop.openReleasePage(updateResult.pageUrl); }\n    catch (error) { setUpdateResult({kind:'error', message:`打开下载页面失败：${String(error)}`}); }",
    "after": "    try {\n      await desktop.openReleasePage(updateResult.pageUrl);\n      setReleaseOpenError('');\n      setUpdateNoticeOpen(false);\n    } catch (error) { setReleaseOpenError(`打开下载页面失败：${String(error)}`); }"
  },
  {
    "path": "src/App.tsx",
    "before": "<div className=\"modal-heading\"><div><DialogTitle className=\"modal-title\">设置</DialogTitle><DialogDescription className=\"modal-subtitle\">Airpimo · 配置与维护</DialogDescription></div><button aria-label=\"关闭设置\"",
    "after": "<div className=\"modal-heading\"><div className=\"airpimo-settings-heading\"><DialogTitle className=\"modal-title\">设置</DialogTitle><DialogDescription className=\"modal-subtitle\">Airpimo · 配置与维护</DialogDescription></div><button aria-label=\"关闭设置\""
  },
  {
    "path": "src/App.tsx",
    "before": "修改后需重启接收服务，当前连接不会被中断。",
    "after": "修改设备名称后，重启接收服务生效。"
  },
  {
    "path": "src/App.tsx",
    "before": "默认 60；实际帧率由手机决定",
    "after": "默认 60，实际帧率由手机决定"
  },
  {
    "path": "src/App.tsx",
    "before": "默认 80%；保存后重启接收服务生效",
    "after": "重启接收服务后生效"
  },
  {
    "path": "src/App.tsx",
    "before": "打开软件后自动启动 UxPlay",
    "after": "启动软件时自动开启接收服务"
  },
  {
    "path": "src/App.tsx",
    "before": "新安装默认开启，关闭主窗口后仍继续接收；保留已有用户的选择",
    "after": "开启：关闭窗口后隐藏到托盘，继续接收。关闭：退出软件。"
  },
  {
    "path": "src/App.tsx",
    "before": "非专业人员请勿修改。参数配置不正确可能导致投屏无法启动。保存后需重启接收服务才会生效，不会自动断开当前投屏。",
    "after": "非专业人员请勿修改，错误参数可能导致接收失败。保存后需重启接收服务才会生效。"
  },
  {
    "path": "src/App.tsx",
    "before": "优先级：上方设备名称、帧率与亮度设置 ＞ 此处自定义参数 ＞ 程序默认参数。可按空格或换行分隔，使用引号包裹含空格的参数；-vol 可覆盖默认音量。",
    "after": "优先级：上方设置 ＞ 自定义参数 ＞ 默认参数。支持换行、引号；-vol 可调整音量。"
  },
  {
    "path": "src/App.tsx",
    "before": "选择 Airpimo 的界面颜色。保存后立即生效。",
    "after": "选择界面主题。保存后生效。"
  },
  {
    "path": "src/App.tsx",
    "before": "{releaseOpening ? '打开中…' : '前往下载新版本'}",
    "after": "{releaseOpening ? '打开中…' : '下载'}"
  },
  {
    "path": "src/App.tsx",
    "before": "            <p className=\"airpimo-settings-copy\">启动时自动检测一次，也可以手动检查。发现更新后打开官方 GitHub Release 下载页；当前安装包尚未配置签名自动安装。</p>\n",
    "after": ""
  },
  {
    "path": "src/App.tsx",
    "before": "            <p className=\"airpimo-settings-copy\">只记录脱敏状态与错误类别，不采集投屏画面。</p>\n            <textarea className=\"diagnostics-text\" value={diagnostics} readOnly aria-label=\"诊断日志\"/>\n            <div className=\"modal-actions\">\n              <Button type=\"button\" variant=\"outline\" onClick={() => void loadDiagnostics()}>刷新</Button>\n              <Button type=\"button\" variant=\"outline\" onClick={() => void copy(diagnostics)}>复制</Button>\n              <Button type=\"button\" onClick={() => void exportDiagnostics()} disabled={diagnosticsExporting}>{diagnosticsExporting ? '导出中…' : '导出日志'}</Button>\n            </div>",
    "after": "            <textarea className=\"diagnostics-text\" value={diagnostics} readOnly aria-label=\"诊断日志\"/>\n            <div className=\"airpimo-diagnostics-toolbar\">\n              <p className=\"airpimo-diagnostics-privacy\">只记录脱敏状态与错误类别，不采集投屏画面。</p>\n              <div className=\"modal-actions\">\n                <Button type=\"button\" variant=\"outline\" onClick={() => void loadDiagnostics()}>刷新</Button>\n                <Button type=\"button\" onClick={() => void exportDiagnostics()} disabled={diagnosticsExporting}>{diagnosticsExporting ? '导出中…' : '导出日志'}</Button>\n              </div>\n            </div>"
  },
  {
    "path": "src/App.tsx",
    "before": "    </Dialog>\n  </>;\n}\nexport default App;",
    "after": "    </Dialog>\n\n    <Dialog open={updateNoticeOpen} onOpenChange={setUpdateNoticeOpen}>\n      <DialogContent className={`airpimo-update-notice${dialogMac ? ' is-macos' : ''}`} overlayClassName={overlayClass}>\n        <DialogTitle className=\"modal-title\">发现新版本</DialogTitle>\n        <DialogDescription className=\"airpimo-update-notice-description\">\n          当前版本 v{brand.version}，最新版本 {updateResult?.kind === 'available' ? updateResult.latest : ''}。\n          点击「下载」将在浏览器中打开对应的 GitHub Release 下载页。\n        </DialogDescription>\n        {releaseOpenError && <p className=\"form-error\" role=\"alert\">{releaseOpenError}</p>}\n        <div className=\"modal-actions\">\n          <Button type=\"button\" variant=\"outline\" onClick={() => setUpdateNoticeOpen(false)}>稍后</Button>\n          <Button type=\"button\" onClick={() => void openRelease()} disabled={releaseOpening || updateResult?.kind !== 'available'}>\n            {releaseOpening ? '打开中…' : '下载'}\n          </Button>\n        </div>\n      </DialogContent>\n    </Dialog>\n  </>;\n}\nexport default App;"
  },
  {
    "path": "src/main.tsx",
    "before": "import './styles/airpimo-settings-tabs.css';",
    "after": "import './styles/airpimo-settings-tabs.css';\nimport './styles/airpimo-v29-polish.css';"
  },
  {
    "path": "tests/airpimo-startup-tray-dev-v22.test.mjs",
    "before": "assert.match(read('src/App.tsx'),/新安装默认开启，关闭主窗口后仍继续接收/);",
    "after": "assert.match(read('src/App.tsx'),/开启：关闭窗口后隐藏到托盘，继续接收。关闭：退出软件。/);"
  },
  {
    "path": "tests/airpimo-v23-modal-tray-export.test.mjs",
    "before": "assert.equal((app.match(/<Dialog open=/g) ?? []).length, 1);",
    "after": "assert.equal((app.match(/<Dialog open=/g) ?? []).length, 2);\n  assert.match(app, /<Dialog open=\\{updateNoticeOpen\\}/);"
  }
];
const style = 'src/styles/airpimo-v29-polish.css';

export function plan(root=defaultRoot) {
  if (!existsSync(join(root,style))) throw new Error(`缺少 ZIP 中的样式文件：${style}`);
  const changes = new Map();
  for (const path of [...new Set(patches.map(p=>p.path))]) {
    const absolute = join(root,path);
    if (!existsSync(absolute)) throw new Error(`缺少源码文件：${path}`);
    const raw = readFileSync(absolute,'utf8');
    const isCrlf = raw.includes('\r\n');
    let current = raw.replace(/\r\n/g,'\n');
    for (const [index, {before,after}] of patches.filter(p=>p.path===path).entries()) {
      if (after && current.includes(after)) continue;
      const first = current.indexOf(before);
      if (first < 0) {
        if (after === '') continue; // deleted phrase is already gone
        throw new Error(`${path} 补丁 ${index+1}: 源码锚点不匹配，已阻止修改（需要最新源码）`);
      }
      if (current.indexOf(before,first+before.length)>=0) {
        throw new Error(`${path} 补丁 ${index+1}: 锚点重复，已阻止修改`);
      }
      current = current.slice(0,first) + after + current.slice(first+before.length);
    }
    if (current !== raw.replace(/\r\n/g,'\n')) {
      changes.set(path,{absolute,content:isCrlf?current.replace(/\n/g,'\r\n'):current});
    }
  }
  return changes;
}

export function apply(root=defaultRoot,write=false){
  const changes = plan(root);
  if(write) for(const change of changes.values()) writeFileSync(change.absolute,change.content,'utf8');
  return [...changes.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if(!['--apply','--check'].includes(mode)) throw new Error('用法: --apply | --check');
    const pending = apply(defaultRoot,mode==='--apply');
    for (const item of pending) console.log(`[Airpimo UI] ${mode==='--apply'?'已更新':'待更新'} ${item}`);
    if(mode==='--check' && pending.length) throw new Error('存在未应用的改动，请先运行 --apply');
    console.log('[Airpimo UI] PASS');
  } catch(error) {
    console.error(`[Airpimo UI] BLOCKED: ${error.message}`);
    process.exitCode=2;
  }
}
