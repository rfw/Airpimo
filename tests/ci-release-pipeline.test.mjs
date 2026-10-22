import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {exportReleaseArchive,stageReleaseArchive} from '../scripts/ci-native-release.mjs';
import {checkedReleaseAssetInputs,checkAssetSha} from '../scripts/ci-reviewed-asset.mjs';
import {sha256} from '../scripts/native-bundle-core.mjs';
import {RENDERER_PATCH_SHA256} from '../scripts/native-engine-core.mjs';
import {MDNS_FLAGS,readMdnsLock} from '../scripts/win7-mdns-core.mjs';
const root=resolve(import.meta.dirname,'..');

function fixture({platform='darwin',arch='x64',mdns=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'uxplay-ci-'));
  const src=join(dir,'src');mkdirSync(src,{recursive:true});
  const files=platform==='win32' ? {
    'sidecar/uxplay.exe':'exe',
    'gstreamer/bin/libgstreamer-1.0-0.dll':'runtime',
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll':'plugin',
  } : {
    'sidecar/uxplay':'exe',
    'gstreamer/lib/libgstreamer-1.0.dylib':'runtime',
    'gstreamer/lib/gstreamer-1.0/libgstcore.dylib':'plugin',
  };
  const entries=[];
  for(const [name,body] of Object.entries(files)){
    const path=join(src,...name.split('/'));mkdirSync(resolve(path,'..'),{recursive:true});
    writeFileSync(path,body);entries.push({path:name,sha256:sha256(Buffer.from(body))});
  }
  const lock=mdns?readMdnsLock():null;
  const manifest={schema:1,ready:true,os:platform,arch,gstreamerVersion:'1.24.13',upstream:{commit:lock?.commit??'df67c212a433cf6dda3676dd40c097900d24e645',...(!mdns?{rendererPatchSha256:RENDERER_PATCH_SHA256}:{})},files:entries};
  if(mdns){manifest.upstream.tag='1.74-experimental-pinned';manifest.discovery={backend:'internal-mdns',engineSha256:entries.find(v=>v.path==='sidecar/uxplay.exe').sha256};}
  writeFileSync(join(src,'native-manifest.json'),JSON.stringify(manifest));
  return {dir,src};
}

test('native CI exporter and importer preserve reviewed platform archive and hashes',()=>{
  const {dir,src}=fixture();
  try{
    const tar=join(dir,'mac.tar.gz');
    const exported=exportReleaseArchive(src,tar,{platform:'darwin',arch:'x64'});
    assert.equal(exported.files,3);
    const dst=join(dir,'destination');
    const staged=stageReleaseArchive(tar,exported.sha256,dst,{platform:'darwin',arch:'x64'});
    assert.equal(staged.platform,'darwin');
    assert.ok(existsSync(join(dst,'sidecar','uxplay')));
    assert.throws(()=>stageReleaseArchive(tar,'f'.repeat(64),dst,{platform:'darwin',arch:'x64'}),/SHA-256 mismatch/);
    assert.throws(()=>stageReleaseArchive(tar,exported.sha256,dst,{platform:'win32',arch:'x64'}),/Runtime target/);
  } finally{rmSync(dir,{force:true,recursive:true});}
});

test('internal mDNS provenance can be archived without legacy 1.73.7 cache',()=>{
  const {dir,src}=fixture({platform:'win32',arch:'x64',mdns:true});
  try{
    const tar=join(dir,'win.tar.gz');
    const result=exportReleaseArchive(src,tar,{platform:'win32',arch:'x64'});
    const dst=join(dir,'stage');
    const staged=stageReleaseArchive(tar,result.sha256,dst,{platform:'win32',arch:'x64'});
    assert.equal(staged.backend,'internal-mdns');
    assert.deepEqual([...MDNS_FLAGS],['-DNO_MARCH_NATIVE=ON','-DUSE_DNS_SD=OFF','-DUSE_MDNS=ON']);
  } finally {rmSync(dir,{force:true,recursive:true});}
});

test('release asset requirements never accept unpinned files or arbitrary URLs',()=>{
  const base={repo:'owner/repo',tag:'native-reviewed-v1',name:'runtime.tar.gz',sha:'a'.repeat(64),output:join(tmpdir(),'runtime.tar.gz')};
  assert.equal(checkedReleaseAssetInputs(base).sha,base.sha);
  assert.throws(()=>checkedReleaseAssetInputs({...base,sha:''}),/reviewed SHA-256/);
  assert.throws(()=>checkedReleaseAssetInputs({...base,name:'..\\evil.tar.gz'}),/Unsafe/);
  assert.throws(()=>checkedReleaseAssetInputs({...base,tag:'https://somewhere'}),/GitHub Release tag/);
  const dir=mkdtempSync(join(tmpdir(),'uxplay-asset-'));
  try{
    const file=join(dir,'test.zip');writeFileSync(file,'bytes');
    checkAssetSha(file,sha256(Buffer.from('bytes')));
    assert.throws(()=>checkAssetSha(file,'0'.repeat(64)),/mismatch/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('tag release is the sole GitHub workflow and uses hosted runners with source checks',()=>{
  const workflows=readdirSync(join(root,'.github/workflows')).filter(name=>/\.ya?ml$/.test(name)).sort();
  assert.deepEqual(workflows,['release-gate.yml']);
  const release=readFileSync(join(root,'.github/workflows/release-gate.yml'),'utf8');
  assert.match(release,/^  source:/m);
  for(const command of ['npm ci','npm test','npm run test:source','npm run build','npm run check:rust-lock','verify-tag --tag']){
    assert.ok(release.includes(command),`Missing source release check: ${command}`);
  }
  assert.match(release,/^  push:/m);
  assert.match(release,/tags:/);
  assert.doesNotMatch(release,/workflow_dispatch:/);
  assert.match(release,/runs-on: windows-2022/g);
  assert.match(release,/runs-on: macos-15-intel/);
  assert.match(release,/runs-on: macos-15\r?\n/);
  assert.doesNotMatch(release,/runs-on: \[self-hosted/);
  assert.doesNotMatch(release,/UXPLAY_WINDOWS_SOURCE_DIR|UXPLAY_MACOS_INTEL_SOURCE_DIR|ci-selfhost-stage\.mjs/);
  assert.doesNotMatch(release,/UXPLAY_NATIVE_RELEASE_TAG|ci-reviewed-asset/);
  assert.match(release,/GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(release,/native:mdns:build:win7/);
  assert.match(release,/native:bundle:prepare:win7:mdns/);
  assert.match(release,/ci-native-release\.mjs export/);
  assert.match(release,/ci-native-release\.mjs stage/g);
  assert.match(release,/native:verify:win7:mdns/);
  assert.match(release,/desktop:build:win7:mdns/);
  assert.match(release,/desktop:build:win10/);
  assert.match(release,/native:relocate:mac -- --apply/g);
  assert.match(release,/--target x86_64-apple-darwin --bundles app,dmg/);
  assert.match(release,/--target aarch64-apple-darwin --bundles app,dmg/);
  assert.match(release,/native:verify:app/g);
  assert.match(release,/if-no-files-found: error/g);
});

test('Win7 cloud build retains exact source pin, MinGW64, SHA gate and WebView109 checksum gate',()=>{
  const release=readFileSync(join(root,'.github/workflows/release-gate.yml'),'utf8');
  const gst=readFileSync(join(root,'scripts/ci/install-gstreamer-win.ps1'),'utf8');
  const webview=readFileSync(join(root,'scripts/ci/install-webview109-win.ps1'),'utf8');
  const mac=readFileSync(join(root,'scripts/ci/prepare-macos.sh'),'utf8');
  assert.match(release,/msystem: MINGW64/);
  assert.match(release,/MSYS2_ROOT:/);
  assert.doesNotMatch(release,/msystem: UCRT64/);
  assert.match(gst,/1\.24\.13/);
  assert.match(gst,/Get-FileHash/);
  assert.match(webview,/UXPLAY_WEBVIEW109_SHA256/);
  assert.match(webview,/Get-FileHash/);
  assert.match(webview,/Expected WebView2 109/);
  assert.match(mac,/npm run native:prepare/);
  assert.match(mac,/npm run native:bundle:from-build/);
});
