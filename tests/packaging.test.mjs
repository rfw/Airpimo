import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

const root=resolve(import.meta.dirname,'..');

// Source-only behavior must be tested in an isolated resource tree. The real
// working directory might contain a staged Windows runtime which can be
// ready=true but legitimately BLOCKED by a new ABI/security audit.
test('source ZIP cannot pass the native package gate without real runtime',()=>{
  const fixture=mkdtempSync(join(tmpdir(),'uxplay-source-only-'));
  try {
    writeFileSync(join(fixture,'native-manifest.json'),JSON.stringify({
      schema:1,ready:false,os:process.platform,arch:process.arch,files:[],
    }));
    const result=spawnSync(process.execPath,[
      'scripts/check-native.mjs','--resources',fixture,
    ],{cwd:root,encoding:'utf8',timeout:30000});
    assert.equal(result.error,undefined,result.error?.message);
    assert.equal(result.status,2,`${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr,/BLOCKED native package: UxPlay\/GStreamer 尚未经过本地准备/);
  } finally {
    rmSync(fixture,{recursive:true,force:true});
  }
});

test('Win7 keeps fixed WebView2 109, modern Windows downloads WebView2 only when missing',()=>{
  const normal=JSON.parse(readFileSync(resolve(root,'src-tauri/tauri.conf.json')));
  const legacy=JSON.parse(readFileSync(resolve(root,'src-tauri/tauri.win7.conf.json')));
  assert.equal(normal.bundle.windows.webviewInstallMode.type,'downloadBootstrapper');
  assert.equal(legacy.bundle.windows.webviewInstallMode.type,'fixedRuntime');
  assert.equal(legacy.bundle.windows.webviewInstallMode.path,'./webview2-109');
  assert.deepEqual(legacy.bundle.targets,['nsis']);
});

test('no shell plugin or arbitrary front-end process launch permission',()=>{
  const text=readFileSync(resolve(root,'src-tauri/capabilities/default.json'),'utf8');
  assert.doesNotMatch(text,/shell:allow-execute|shell:allow-spawn/);
});
