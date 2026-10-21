import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const load=(p)=>readFileSync(resolve(root,p),'utf8');

test('Win7 109 Fixed Runtime source uses version-pinned historical CAB archive, not defunct Microsoft CDN or Evergreen',()=>{
  const lock=JSON.parse(load('native/webview2-109-lock.json'));
  assert.equal(lock.schema,1);
  assert.equal(lock.version,'109.0.1518.78');
  assert.equal(lock.arch,'x64');
  assert.equal(lock.format,'cab');
  assert.equal(lock.url,'https://github.com/westinyang/WebView2RuntimeArchive/releases/download/109.0.1518.78/Microsoft.WebView2.FixedVersionRuntime.109.0.1518.78.x64.cab');
  assert.doesNotMatch(lock.url,/\/latest\/|Evergreen|WebView2RuntimeInstaller/i);
  assert.ok(lock.sha256==='' || /^[0-9a-f]{64}$/.test(lock.sha256),'unreviewed hash must not be fabricated');
});
test('Win7 release refuses unknown digest; SHA-256 is validated before unpack/stage',()=>{
  const script=load('scripts/ci/install-webview109-win.ps1');
  assert.match(script,/\[switch\]\$AuditOnly/);
  assert.match(script,/!\$AuditOnly -and \$expected -notmatch/);
  assert.match(script,/Get-FileHash -LiteralPath \$archive -Algorithm SHA256/);
  assert.match(script,/\$actual -ne \$expected\.ToLowerInvariant\(\)/);
  assert.match(script, /Get-AuthenticodeSignature/);
  assert.match(script, /Microsoft Corporation/);
  assert.match(script, /109\\\.0\\\.1518\\\.78/);
  assert.match(script, /expand\.exe/);
  assert.match(script, /msedgewebview2\.exe/);
  assert.match(script, /msedge\.dll/);
  assert.match(script, /icudtl\.dat/);
  assert.match(script, /\$AuditOnly\) \{[\s\S]*?return/);
  assert.match(script, /Refusing to overwrite an existing WebView2 runtime/);
  assert.match(script, /third-party historical archive/);
  assert.match(script, /Could not retrieve WebView2/);
  assert.match(script, /WebView2 109 CAB unexpectedly small/);
});
test('pinned WebView2 109 is staged in hosted Win7 tag release without a legacy audit workflow',()=>{
  const release=load('.github/workflows/release-gate.yml');
  assert.match(release,/runs-on: windows-2022/);
  assert.match(release,/install-webview109-win\.ps1/);
  assert.match(release,/native:verify:win7:mdns/);
  assert.doesNotMatch(release,/vars\.UXPLAY_WEBVIEW109_URL|vars\.UXPLAY_WEBVIEW109_SHA256/);
  assert.doesNotMatch(release,/runs-on:\s*\[?self-hosted|E:\\git|F:\\gstreamer/);
});
test('Win7 uses the fixed flat runtime; Win10 uses an Evergreen bootstrapper',()=>{
  const win7=JSON.parse(load('src-tauri/tauri.win7.conf.json'));
  const modern=JSON.parse(load('src-tauri/tauri.conf.json'));
  assert.equal(win7.bundle.windows.webviewInstallMode.type,'fixedRuntime');
  assert.equal(win7.bundle.windows.webviewInstallMode.path,'./webview2-109');
  assert.equal(modern.bundle.windows.webviewInstallMode.type,'downloadBootstrapper');
});
