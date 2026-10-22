import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const file = path=>readFileSync(resolve(root,path),'utf8');
globalThis.__AIRPIMO_RELEASE_REPO__='sample-owner/sample-app';
const {compareReleaseVersion, checkForRelease, checkAtStartup, releaseRepository}=await import('../src/lib/release-update.ts');

test('stable version comparison is numeric and rejects prereleases',()=>{
  assert.equal(releaseRepository,'sample-owner/sample-app');
  assert.equal(compareReleaseVersion('v0.1.10','0.1.9'),1);
  assert.equal(compareReleaseVersion('1.0.0','v1.0.0'),0);
  assert.equal(compareReleaseVersion('0.1.8','0.2.0'),-1);
  assert.throws(()=>compareReleaseVersion('v1.0.0-beta','0.1.8'),/稳定版/);
});
test('manual update checks handle newer, latest, missing and API errors',async()=>{
  const old=globalThis.fetch;
  try {
    const ok=(body)=>({ok:true,status:200,json:async()=>body});
    globalThis.fetch=async(input,init)=>{
      assert.equal(input,'https://api.github.com/repos/sample-owner/sample-app/releases/latest');
      assert.equal(init.cache,'no-store');
      return ok({tag_name:'v0.1.9',draft:false,prerelease:false});
    };
    assert.deepEqual(await checkForRelease('0.1.8'),{
      kind:'available',current:'0.1.8',latest:'v0.1.9',pageUrl:'https://github.com/sample-owner/sample-app/releases/tag/v0.1.9'
    });
    assert.equal((await checkForRelease('0.1.9')).kind,'latest');
    globalThis.fetch=async()=>({ok:false,status:404});
    assert.match((await checkForRelease('0.1.8')).message,/公开/);
    globalThis.fetch=async()=>ok({tag_name:'v1.0.0-beta',draft:false,prerelease:true});
    assert.equal((await checkForRelease('0.1.8')).kind,'error');
    globalThis.fetch=async()=>{throw Error('offline')};
    assert.equal((await checkForRelease('0.1.8')).kind,'error');
  } finally { globalThis.fetch=old; }
});
test('startup update check is only requested once per app session',async()=>{
  const old=globalThis.fetch;
  let calls=0;
  try {
    globalThis.fetch=async()=>{calls++;return {ok:true,status:200,json:async()=>({tag_name:'v0.1.9',draft:false,prerelease:false})};};
    const [a,b]=await Promise.all([checkAtStartup('0.1.8'),checkAtStartup('0.1.8')]);
    assert.equal(a.kind,'available');assert.deepEqual(a,b);assert.equal(calls,1);
  }finally{globalThis.fetch=old;}
});
test('settings tabs, diagnostics, feedback timeout and tray default retain functional behavior',()=>{
  const app=file('src/App.tsx'),home=file('src/components/AirpimoHome.tsx');
  for(const key of ['config','theme','updates','diagnostics'])assert.match(app,new RegExp(`airpimo-panel-${key}`));
  assert.match(app,/checkAtStartup\(brand\.version\)/);
  assert.match(app,/checkForRelease\(brand\.version\)/);
  assert.match(app,/setTimeout\(\(\) => setFeedback/);
  assert.match(app,/3200/);
  assert.match(app,/await desktop\.exportDiagnostics\(\)/);
  assert.match(app,/await desktop\.openReleasePage\(updateResult\.pageUrl\)/);
  assert.doesNotMatch(home,/onDiagnostics|CircleHelp|查看诊断/);
  assert.match(home,/updateAvailable && \(\s*<span className="airpimo-update-dot"/);
  assert.match(file('src/domain/state.ts'),/stay_in_tray:true/);
  assert.match(file('src-tauri/src/settings.rs'),/stay_in_tray: true/);
  assert.match(app,/checked=\{draft\.stay_in_tray\}/);
});
test('network is allowlisted in CSP and native release opening does not execute downloaded installers',()=>{
  const cfg=JSON.parse(file('src-tauri/tauri.conf.json'));
  assert.match(cfg.app.security.csp,/https:\/\/api\.github\.com/);
  const rust=file('src-tauri/src/lib.rs');
  assert.match(rust,/fn open_release_page\(url: String\)/);
  assert.match(rust,/url\.strip_prefix\("https:\/\/github\.com\/"\)/);
  assert.match(rust,/open_release_page\]\)/);
  assert.doesNotMatch(rust,/\.arg\("\/C"\)/);
});
