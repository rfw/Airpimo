import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {preserveNsisInstaller} from '../scripts/windows-build-artifacts.mjs';
const root=resolve(import.meta.dirname,'..');

test('Win10+ uses an online WebView2 bootstrapper, Win7 uses fixed 109',()=> {
  const modern=JSON.parse(readFileSync(join(root,'src-tauri/tauri.conf.json'),'utf8'));
  const win7=JSON.parse(readFileSync(join(root,'src-tauri/tauri.win7.conf.json'),'utf8'));
  assert.deepEqual(modern.bundle.windows.webviewInstallMode,{type:'downloadBootstrapper'});
  assert.deepEqual(win7.bundle.windows.webviewInstallMode,{type:'fixedRuntime',path:'./webview2-109'});
  assert.ok(!JSON.stringify(modern.bundle.resources).includes('webview2-109'));
  assert.deepEqual(modern.bundle.targets,['nsis']);
});

test('separate build scripts use explicit selected configs and protect native manifests',()=> {
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.equal(pkg.scripts['desktop:build:win7'],'node scripts/build-win7.mjs');
  assert.equal(pkg.scripts['desktop:build:win10'],'node scripts/build-win10.mjs');
  const win7=readFileSync(join(root,'scripts/build-win7.mjs'),'utf8');
  const modern=readFileSync(join(root,'scripts/build-win10.mjs'),'utf8');
  assert.match(win7,/tauri\.win7\.conf\.json/);
  assert.match(modern,/downloadBootstrapper/);
  assert.match(modern,/scripts\/check-native\.mjs/);
  assert.doesNotMatch(modern,/--config src-tauri\/tauri\.win7\.conf\.json/);
});

test('distinct build outputs are preserved without touching the original NSIS file',()=> {
  const temp=mkdtempSync(join(tmpdir(),'uxplay-win-targets-'));
  try {
    const src=join(temp,'src-tauri','target','release','bundle','nsis');
    mkdirSync(src,{recursive:true});
    writeFileSync(join(src,'Airpimo_0.1.4_x64-setup.exe'),'fixture');
    const a=preserveNsisInstaller(temp,'win7');
    const b=preserveNsisInstaller(temp,'win10plus');
    assert.notEqual(a,b);
    assert.ok(existsSync(a));assert.ok(existsSync(b));
    assert.throws(()=>preserveNsisInstaller(temp,'unknown'));
  } finally {rmSync(temp,{recursive:true,force:true})}
});
