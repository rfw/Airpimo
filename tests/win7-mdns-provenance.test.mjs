import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readFileSync} from 'node:fs';
import {MDNS_FLAGS,checkMdnsLock,verifyMdnsReceipt,verifyMdnsManifest,fileSha256,MDNS_WATERMARK_PATCH_SHA256} from '../scripts/win7-mdns-core.mjs';
const COMMIT='a'.repeat(40);
const lock={schema:1,upstream:'https://github.com/FDH2/UxPlay.git',track:'1.74-experimental',target:'win32-x64',commit:COMMIT,buildFlags:[...MDNS_FLAGS]};

test('mDNS source lock is explicit, complete SHA-1, and rejects unknown toolchains and moving tags',()=>{
  assert.equal(checkMdnsLock(lock).commit,COMMIT);
  for(const bad of [
    {...lock,commit:'master'},
    {...lock,commit:'v1.74'},
    {...lock,commit:'df67c212a433cf6dda3676dd40c097900d24e645',track:'1.73.7'},
    {...lock,upstream:'https://example.org/mirror'},
    {...lock,buildFlags:['-DUSE_DNS_SD=ON']},
  ]) assert.throws(()=>checkMdnsLock(bad),/Invalid Win7 internal-mDNS pin/);
});

test('1.73.7 legacy package can never pass the self-contained internal-mDNS gate',()=>{
  const manifest={os:'win32',arch:'x64',upstream:{commit:'df67c212a433cf6dda3676dd40c097900d24e645',tag:'v1.73.7'},files:[]};
  assert.throws(()=>verifyMdnsManifest(manifest,{lock}),/requires an audited/);
});

test('mDNS engine build receipt binds exact binary SHA, compiler flags and pinned commit',()=>{
  const root=mkdtempSync(join(tmpdir(),'uxplay-mdns-test-'));
  try {
    const exe=join(root,'uxplay.exe');writeFileSync(exe,Buffer.from('MZfake-internal-mdns-1.74'));
    const receipt={schema:1,discoveryBackend:'internal-mdns',sourceCommit:COMMIT,sha256:fileSha256(exe),watermarkPatchSha256:MDNS_WATERMARK_PATCH_SHA256,buildFlags:[...MDNS_FLAGS]};
    assert.equal(verifyMdnsReceipt(receipt,{lock,binary:exe}),true);
    assert.throws(()=>verifyMdnsReceipt({...receipt,watermarkPatchSha256:'0'.repeat(64)},{lock,binary:exe}),/does not match/);
    assert.throws(()=>verifyMdnsReceipt({...receipt,buildFlags:['-DUSE_DNS_SD=ON']},{lock,binary:exe}),/does not prove/);
    assert.throws(()=>verifyMdnsReceipt({...receipt,sourceCommit:'b'.repeat(40)},{lock,binary:exe}),/does not match/);
    writeFileSync(exe,'tampered');
    assert.throws(()=>verifyMdnsReceipt(receipt,{lock,binary:exe}),/does not match/);
  } finally{rmSync(root,{recursive:true,force:true});}
});

test('release manifest must match engine SHA and pinned experimental commit',()=>{
  const sha='b'.repeat(64);
  const manifest={os:'win32',arch:'x64',upstream:{tag:'1.74-experimental-pinned',commit:COMMIT},discovery:{backend:'internal-mdns',engineSha256:sha,watermarkPatchSha256:MDNS_WATERMARK_PATCH_SHA256},files:[{path:'sidecar/uxplay.exe',sha256:sha}]};
  assert.equal(verifyMdnsManifest(manifest,{lock}),true);
  assert.throws(()=>verifyMdnsManifest({...manifest,discovery:{...manifest.discovery,watermarkPatchSha256:'0'.repeat(64)}},{lock}),/requires an audited/);
  assert.throws(()=>verifyMdnsManifest({...manifest,discovery:{...manifest.discovery,engineSha256:'c'.repeat(64)}},{lock}),/SHA-256 differs/);
  assert.throws(()=>verifyMdnsManifest({...manifest,upstream:{...manifest.upstream,commit:'0'.repeat(40)}},{lock}),/requires an audited/);
});

test('both Windows console suppression and separate legacy/experimental release commands are retained',()=>{
  const rust=readFileSync(new URL('../src-tauri/src/receiver.rs',import.meta.url),'utf8');
  const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
  assert.match(rust,/command\.creation_flags\(CREATE_NO_WINDOW\)/);
  assert.equal(scripts['desktop:build:win7'],'node scripts/build-win7.mjs');
  assert.equal(scripts['desktop:build:win7:mdns'],'node scripts/build-win7.mjs --require-mdns');
  assert.match(scripts['native:bundle:prepare:win7:mdns'],/win7-mdns-stage/);
  const checker=readFileSync(new URL('../scripts/check-native.mjs',import.meta.url),'utf8');
  assert.match(checker,/--require-mdns/);
});
