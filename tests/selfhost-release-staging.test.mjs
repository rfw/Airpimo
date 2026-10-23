import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {stageSelfHosted} from '../scripts/ci-selfhost-stage.mjs';
import {sha256} from '../scripts/native-bundle-core.mjs';
import {readMdnsLock,MDNS_WATERMARK_PATCH_SHA256} from '../scripts/win7-mdns-core.mjs';
import {LOCK,RENDERER_PATCH_SHA256} from '../scripts/native-engine-core.mjs';
function fixture({platform='win32',arch='x64',legacy=false}={}){
  const root=mkdtempSync(join(tmpdir(),'uxplay-selfhost-'));
  const source=join(root,'trusted','src-tauri'), dest=join(root,'gha','src-tauri');
  const files=platform==='win32'?{
    'sidecar/uxplay.exe':'engine',
    'gstreamer/bin/libstdc++-6.dll':'crt',
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll':'codec',
  }:{
    'sidecar/uxplay':'engine',
    'gstreamer/lib/libgstreamer-1.0.dylib':'crt',
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dylib':'codec',
  };
  const entries=Object.entries(files).map(([path,content])=>{
    const absolute=join(source,'resources',...path.split('/'));
    mkdirSync(dirname(absolute),{recursive:true});
    writeFileSync(absolute,content);
    return {path,sha256:sha256(Buffer.from(content))};
  });
  const lock=readMdnsLock();
  const manifest={schema:1,ready:true,os:platform,arch,gstreamerVersion:'1.24.13',
    upstream:{commit:platform==='darwin'?LOCK.commit:(legacy?'df67c212a433cf6dda3676dd40c097900d24e645':lock.commit),tag:'1.74-experimental-pinned',...(platform==='darwin'||legacy?{rendererPatchSha256:RENDERER_PATCH_SHA256}:{})},
    files:entries};
  if(platform==='win32'&&!legacy)manifest.discovery={backend:'internal-mdns',engineSha256:entries[0].sha256,watermarkPatchSha256:MDNS_WATERMARK_PATCH_SHA256};
  writeFileSync(join(source,'resources','native-manifest.json'),JSON.stringify(manifest));
  const browser=join(source,'webview2-109');mkdirSync(browser,{recursive:true});
  writeFileSync(join(browser,'msedgewebview2.exe'),'webview109-placeholder');
  mkdirSync(dest,{recursive:true});
  return {root,source,dest,files};
}
function clean(f){rmSync(f.root,{recursive:true,force:true});}
test('selfhost Win7 reads only reviewed local files and stages fixed WebView2',()=>{
  const f=fixture();
  try{
    const result=stageSelfHosted(f.source,'win7',{destinationTauri:f.dest,platform:'win32',arch:'x64'});
    assert.equal(result.backend,'internal-mdns');
    assert.equal(result.webview,true);
    assert.equal(readFileSync(join(f.dest,'resources','sidecar','uxplay.exe'),'utf8'),'engine');
    assert.ok(existsSync(join(f.dest,'webview2-109','msedgewebview2.exe')));
    assert.ok(existsSync(join(f.source,'resources','sidecar','uxplay.exe')));
  }finally{clean(f);}
});
test('selfhost Win10 stages the exact same engine without fixed WebView2',()=>{
  const f=fixture();
  try{
    stageSelfHosted(f.source,'win10plus',{destinationTauri:f.dest,platform:'win32',arch:'x64'});
    assert.ok(!existsSync(join(f.dest,'webview2-109')));
  }finally{clean(f);}
});
test('selfhost refuses wrong arch, legacy Bonjour, bad content and self-copies',()=>{
  const f=fixture();
  try{
    assert.throws(()=>stageSelfHosted(f.source,'macos-x64',{destinationTauri:f.dest,platform:'win32',arch:'x64'}),/requires darwin\/x64/);
    assert.throws(()=>stageSelfHosted(f.source,'win7',{destinationTauri:f.source,platform:'win32',arch:'x64'}),/outside the GitHub Actions checkout/);
    writeFileSync(join(f.source,'resources','sidecar','uxplay.exe'),'corrupt');
    assert.throws(()=>stageSelfHosted(f.source,'win7',{destinationTauri:f.dest,platform:'win32',arch:'x64'}),/SHA-256 mismatch/);
    assert.ok(!existsSync(join(f.dest,'resources')));
  }finally{clean(f);}
  const g=fixture({legacy:true});
  try{assert.throws(()=>stageSelfHosted(g.source,'win10plus',{destinationTauri:g.dest,platform:'win32',arch:'x64'}),/internal-mDNS runtime/);}
  finally{clean(g);}
});
test('selfhost accepts a target-specific macOS source and does not copy WebView2',()=>{
  const f=fixture({platform:'darwin',arch:'x64'});
  try{
    const result=stageSelfHosted(f.source,'macos-x64',{destinationTauri:f.dest,platform:'darwin',arch:'x64'});
    assert.equal(result.webview,false);
    assert.ok(existsSync(join(f.dest,'resources','sidecar','uxplay')));
    assert.ok(!existsSync(join(f.dest,'webview2-109')));
  }finally{clean(f);}
});
