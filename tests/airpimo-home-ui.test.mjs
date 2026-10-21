import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {planAirpimoUI,applyAirpimoUI} from '../scripts/ci/apply-airpimo-ui-v21.mjs';

const root = resolve(import.meta.dirname, '..');
const read = p => readFileSync(join(root,p),'utf8');

function fixture(fn) {
  const tmp = mkdtempSync(join(tmpdir(),'airpimo-ui-v21-'));
  try { for (const p of ['src/App.tsx','src/main.tsx','src-tauri/tauri.conf.json','src-tauri/capabilities/default.json','.gitignore','src/components/AirpimoHome.tsx','src/domain/home-status.ts','src/styles/airpimo-home.css']) {
    const destination = join(tmp,p); mkdirSync(dirname(destination),{recursive:true}); cpSync(join(root,p),destination);
  } return fn(tmp); }
  finally { rmSync(tmp,{recursive:true,force:true}); }
}

test('Windows native titlebar remains; macOS HTML Header is conditional and overlay-safe',()=>{
  const home=read('src/components/AirpimoHome.tsx');
  const config=JSON.parse(read('src-tauri/tauri.conf.json'));
  const win=config.app.windows.find(w=>w.label==='main');
  assert.match(home,/\{macOS && <header className="airpimo-header" data-tauri-drag-region>/);
  assert.match(home, /isMacOS\(\)/);
  assert.equal(win.titleBarStyle,'Overlay');
  assert.equal(win.hiddenTitle,true);
  const cap=JSON.parse(read('src-tauri/capabilities/default.json'));
  assert.ok(cap.permissions.includes('core:window:allow-start-dragging'));
  assert.equal(win.width,480); assert.equal(win.height,420);
  assert.equal(win.maximizable,false);
});

test('home UI contains only one real start/stop action and preserves the live receiver name',()=>{
  const home=read('src/components/AirpimoHome.tsx');
  const app=read('src/App.tsx');
  assert.match(home,/const baseName = active \? \(snapshot\.applied_device_name \?\? snapshot\.settings\.device_name\) : snapshot\.settings\.device_name;/);
  assert.match(home,/const name = `\$\{baseName\.replace\(\/@Airpimo\$\/, ''\)\}@Airpimo`/);
  assert.match(home,/const onPrimaryAction = active \? onStop : retry \? onRetry : onStart;/);
  assert.match(home,/const label = active \? '停止接收' : '开始接收';/);
  assert.match(home,/disabled=\{disabled\}/);
  assert.match(home,/aria-label="复制投屏设备名称"/);
  assert.match(home,/onCopy\(name\)/);
  assert.match(home,/airpimo-guide-device">\{name\}/);
  assert.match(app,/onStart=\{\(\) => void execute\(desktop\.start\)\}/);
  assert.match(app,/onStop=\{\(\) => void execute\(desktop\.stop\)\}/);
  assert.match(app,/onRetry=\{\(\) => void execute\(desktop\.retry\)\}/);
  assert.doesNotMatch(home, /等待连接|接收进程运行中/);
});

test('Footer contains a single accurate status, version, settings and help',()=>{
  const home=read('src/components/AirpimoHome.tsx');
  const status=read('src/domain/home-status.ts');
  assert.match(home,/aria-label="打开设置"/);
  assert.doesNotMatch(home,/aria-label="查看诊断"/);
  assert.match(read('src/App.tsx'),/airpimo-tab-diagnostics/);
  assert.match(home,/v\{brand\.version\}/);
  assert.match(home,/aria-live=\{statusTone === 'error'/);
  assert.match(home,/const statusLabel = serviceError \? status\.label : feedback/);
  assert.match(home,/canRestart \? <button/);
  assert.match(home,/onClick=\{onClearFeedback\}/);
  assert.doesNotMatch(home, /airpimo-feedback|airpimo-restart|<div className="status-description"/);
  assert.match(status,/snapshot\.discovery_verified/);
  assert.match(status,/发现未验证/);
  assert.match(status,/接收异常：/);
  assert.match(status,/桌面服务错误：/);
  assert.match(read('src/styles/airpimo-home.css'),/max-height: 390px/);
});

test('UI patch is idempotent, preserves product version and backend code',()=>fixture(tmp=>{
  const main=join(tmp,'src/App.tsx');
  const before=readFileSync(main,'utf8');
  assert.deepEqual(applyAirpimoUI(tmp),[]);
  assert.deepEqual(applyAirpimoUI(tmp,true),[]);
  assert.equal(readFileSync(main,'utf8'),before);
}));

test('invalid App anchor aborts without mutating other files',()=>fixture(tmp=>{
  const file=join(tmp,'src/App.tsx');
  const main=join(tmp,'src/main.tsx');
  const config=join(tmp,'src-tauri/tauri.conf.json');
  writeFileSync(file,'export default function OtherApp() {return null;}');
  const originalMain=readFileSync(main,'utf8');
  const originalConfig=readFileSync(config,'utf8');
  assert.throws(()=>planAirpimoUI(tmp),/不完整|不匹配/);
  assert.equal(readFileSync(main,'utf8'),originalMain);
  assert.equal(readFileSync(config,'utf8'),originalConfig);
}));
