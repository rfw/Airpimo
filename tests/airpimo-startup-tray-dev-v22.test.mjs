import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {runInNewContext} from 'node:vm';
import {defaultDevPlan, stagedNativePaths} from '../scripts/dev-launch-plan.mjs';
import {planAirpimoV22, applyAirpimoV22} from '../scripts/ci/apply-airpimo-v22.mjs';
const root=resolve(import.meta.dirname, '..');
const read = p=>readFileSync(join(root,p),'utf8');
function sandbox(fn) {const dir=mkdtempSync(join(tmpdir(),'airpimo-v22-'));try{return fn(dir);}finally{rmSync(dir,{force:true,recursive:true});}}
function touch(path){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'test');}

test('fresh defaults enable tray, but legacy settings stay persisted and new UI copy is accurate',()=>{
  assert.match(read('src-tauri/src/settings.rs'),/stay_in_tray: true, theme: Theme::System/);
  assert.match(read('src/domain/state.ts'),/stay_in_tray:true, theme:'system'/);
  assert.match(read('src-tauri/src/settings.rs'),/pub stay_in_tray: bool/);
  assert.match(read('src/App.tsx'),/checked=\{draft.stay_in_tray\}/);
  assert.match(read('src/App.tsx'),/开启：关闭窗口后隐藏到托盘，继续接收。关闭：退出软件。/);
});

test('theme bootstrap runs before React and works for persisted dark, system dark and light',()=>{
  const html=read('index.html');
  assert.ok(html.indexOf('src="/theme-bootstrap.js"') < html.indexOf('src="/src/main.tsx"'));
  assert.equal(JSON.parse(read('src-tauri/tauri.conf.json')).app.windows[0].backgroundColor, '#20232A');
  const boot=read('public/theme-bootstrap.js');
  for(const [preference,system,isDark] of [['dark',false,true],['light',true,false],['system',true,true],['system',false,false],['',true,true]]) {
    const classes=new Set(); const style={};
    const ctx={localStorage:{getItem:()=>preference}, window:{matchMedia:()=>({matches:system})},document:{documentElement:{classList:{add:c=>classes.add(c)},style}}};
    runInNewContext(boot,ctx,{timeout:200});
    assert.equal(classes.has('dark'),isDark,`${preference}/${system}`);
    assert.equal(style.colorScheme,isDark?'dark':'light');
  }
  assert.match(read('src/App.tsx'),/if \(!ready\) return;[\s\S]*localStorage.setItem\('airpimo.theme', theme\)/);
  assert.match(read('src/styles.css'),/--foreground: 220 9% 82%/);
});

test('project staged runtime wins over a stale valid cache in both Win and macOS modes',()=>sandbox(dir=>{
  for(const [platform, filename] of [['win32','uxplay.exe'],['darwin','uxplay']]) {
    const binary=join(dir,'src-tauri','resources','sidecar',filename);
    touch(binary);
    mkdirSync(join(dir,'src-tauri','resources','gstreamer','bin'),{recursive:true});
    mkdirSync(join(dir,'src-tauri','resources','gstreamer','lib','gstreamer-1.0'),{recursive:true});
    const found=stagedNativePaths(dir,platform);
    assert.equal(found.binary,binary);
    const result=defaultDevPlan({root:dir,platform,bundle:'/old-cache',fallback:()=>'/not-used'});
    assert.equal(result.source,'project');
    assert.equal(result.injectOverride,false);
    assert.equal(result.runtime,null);
  }
}));

test('legacy cache fallback and manual override remain supported',()=>sandbox(dir=>{
  const bundle=join(dir,'cache');
  const win=defaultDevPlan({root:dir,platform:'win32',bundle,fallback:()=>null});
  assert.equal(win.source,'cache'); assert.equal(win.injectOverride,true);
  assert.equal(win.runtime,join(bundle,'gstreamer')); assert.equal(win.binary,join(bundle,'sidecar','uxplay.exe'));
  const mac=defaultDevPlan({root:dir,platform:'darwin',fallback:()=>'/explicit-existing-local-engine'});
  assert.equal(mac.source,'system'); assert.equal(mac.injectOverride,true);
  const shell=read('scripts/desktop-dev.mjs');
  assert.match(shell,/if \(requested\) \{\s*binary = findDevelopmentBinary\(\{root, requested\}\);/);
  assert.match(shell,/if \(source === 'project'\)/);
  assert.match(shell,/binary && injectOverride\?\{UXPLAY_DEV_BINARY:binary\}/);
  assert.match(read('src-tauri/src/receiver.rs'),/exit_code == Some\(-1073741515\)/);
  assert.match(read('src-tauri/src/receiver.rs'),/missing_runtime/);
}));

test('v22 native behavior remains present after later UI revisions',()=>{
  const app=read('src/App.tsx');
  const main=read('src-tauri/src/lib.rs');
  const state=read('src/domain/state.ts');
  assert.match(app,/checked={draft.stay_in_tray}/);
  assert.match(app,/localStorage.setItem\('airpimo.theme', theme\)/);
  assert.match(state,/stay_in_tray:true/);
  assert.match(main,/TrayIconEvent::DoubleClick/);
  assert.match(read('src-tauri/src/receiver.rs'),/exit_code == Some\(-1073741515\)/);
});
