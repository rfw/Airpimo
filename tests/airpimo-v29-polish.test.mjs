import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { plan, apply } from '../scripts/ci/apply-airpimo-v29.mjs';
const root = resolve(import.meta.dirname, '..');
const read = p => readFileSync(join(root,p),'utf8');

test('new release is presented as a prompt; download opens GitHub in browser only on click', () => {
  const app = read('src/App.tsx');
  assert.match(app,/if \(result\.kind === 'available'\) \{ setReleaseOpenError\(''\); setUpdateNoticeOpen\(true\); \}/);
  assert.match(app,/setSettingsOpen\(false\);\s*setUpdateNoticeOpen\(true\)/);
  assert.match(app,/<Dialog open=\{updateNoticeOpen\}/);
  assert.match(app,/<DialogTitle className="modal-title">发现新版本<\/DialogTitle>/);
  assert.match(app,/>稍后<\/Button>/);
  assert.match(app,/'下载'\}/);
  assert.match(app,/onClick=\{\(\) => void openRelease\(\)\}/);
  assert.match(app,/await desktop\.openReleasePage\(updateResult\.pageUrl\)/);
  assert.doesNotMatch(app,/fetch\([^)]*browser_download_url[^)]*\)/);
});

test('settings UI has one scrolling panel with fixed actions and input borders',()=>{
  const css = read('src/styles/airpimo-v29-polish.css');
  const app = read('src/App.tsx');
  assert.match(css,/form\.airpimo-settings-body\s*\{[^}]*overflow: hidden/s);
  assert.match(css,/\[role="tabpanel"\]\s*\{[^}]*overflow-y: auto/s);
  assert.match(css,/\.airpimo-settings-actions\s*\{[^}]*position: static/s);
  assert.match(css,/\.airpimo-expert-input\s*\{[^}]*border: 1px solid hsl\(var\(--border\)\)/s);
  assert.match(app,/className="airpimo-settings-heading"/);
  assert.match(read('src/main.tsx'),/airpimo-v29-polish\.css/);
});

test('diagnostics toolbar keeps privacy note on left with refresh and export only',()=>{
  const app = read('src/App.tsx');
  const pane = app.split('id="airpimo-panel-diagnostics"')[1].split('id="airpimo-panel-config"')[0];
  assert.match(pane,/className="airpimo-diagnostics-toolbar"/);
  assert.match(pane,/className="airpimo-diagnostics-privacy"/);
  assert.match(pane,/>刷新<\/Button>/);
  assert.match(pane,/'>导出日志'|\{diagnosticsExporting \? '导出中…' : '导出日志'\}/);
  assert.doesNotMatch(pane,/copy\(diagnostics\)/);
  assert.doesNotMatch(app,/启动时自动检测一次，也可以手动检查/);
});

test('tray behavior is explained without changing saved settings or release version',()=>{
  const app = read('src/App.tsx');
  assert.match(app,/开启：关闭窗口后隐藏到托盘，继续接收。关闭：退出软件。/);
  assert.match(app,/checked=\{draft\.stay_in_tray\}/);
  assert.match(app,/优先级：上方设置/);
  const packageJson = JSON.parse(read('package.json'));
  assert.equal(packageJson.version,'0.1.0');
});

test('v29 install is idempotent and rejects unknown source anchors before writing',()=>{
  assert.deepEqual([...plan(root).keys()],[]);
  const tmp = mkdtempSync(join(tmpdir(),'airpimo-v29-'));
  try {
    for (const file of ['src/App.tsx','src/main.tsx','src/styles/airpimo-v29-polish.css','tests/airpimo-startup-tray-dev-v22.test.mjs','tests/airpimo-v23-modal-tray-export.test.mjs']) {
      const path=join(tmp,file);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,read(file));
    }
    assert.deepEqual(apply(tmp,false),[]);
    const app=join(tmp,'src/App.tsx');
    writeFileSync(app,'export default function App(){return null;}');
    assert.throws(()=>apply(tmp,true),/锚点不匹配/);
    assert.equal(readFileSync(app,'utf8'),'export default function App(){return null;}');
  } finally { rmSync(tmp,{recursive:true,force:true}); }
});
