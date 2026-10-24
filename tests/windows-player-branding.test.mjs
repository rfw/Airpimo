import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {brandWindowsPlayer, SOURCE, BRANDED} from '../scripts/brand-windows-player.mjs';

const digest = b=>createHash('sha256').update(b).digest('hex');
function withStage(run, {mdns=false}={}) {
 const root=mkdtempSync(join(tmpdir(),'airpimo-player-brand-'));
 const binary=Buffer.from('MZ\u0000airpimo-audited-upstream-binary');
 const legacy=join(root,'sidecar',SOURCE);
 mkdirSync(join(root,'sidecar'),{recursive:true});writeFileSync(legacy,binary);
 const manifest={schema:1,ready:true,os:'win32',arch:'x64',files:[{path:`sidecar/${SOURCE}`,sha256:digest(binary)}],...(mdns?{discovery:{backend:'internal-mdns',engineSha256:digest(binary)}}:{})};
 writeFileSync(join(root,'native-manifest.json'),JSON.stringify(manifest));
 try { run({root,legacy,manifest,binary,branded:join(root,'sidecar',BRANDED)}); }
 finally {rmSync(root,{recursive:true,force:true});}
}
test('branded Windows installed receiver preserves upstream binary bytes and manifest SHA-256',()=>withStage(({root,legacy,manifest,binary,branded})=>{
 const result=brandWindowsPlayer(root);
 assert.equal(result.changed,true);
 assert.equal(existsSync(legacy),false);
 assert.deepEqual(readFileSync(branded),binary);
 const updated=JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
 assert.equal(updated.files[0].path,`sidecar/${BRANDED}`);
 assert.equal(updated.files[0].sha256,digest(binary));
 const second=brandWindowsPlayer(root);
 assert.equal(second.changed,false);
 assert.deepEqual(readFileSync(branded),binary);
}));
test('branded Windows receiver keeps Win7 internal mDNS source provenance hash intact',()=>withStage(({root,binary})=>{
 brandWindowsPlayer(root);
 const manifest=JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
 assert.equal(manifest.discovery.engineSha256,digest(binary));
 assert.equal(manifest.files[0].sha256,manifest.discovery.engineSha256);
},{mdns:true}));
test('Windows player branding fails closed on tampered source and conflicting names',()=>withStage(({root,legacy,branded})=>{
 writeFileSync(legacy,Buffer.from('MZ-tampered'));
 assert.throws(()=>brandWindowsPlayer(root),/SHA-256 mismatch/);
 assert.equal(existsSync(branded),false);
 writeFileSync(branded,Buffer.from('MZ-brand'));
 assert.throws(()=>brandWindowsPlayer(root),/Both legacy and branded/);
}));
test('Windows player branding recovers from rename before the manifest update',()=>withStage(({root,legacy,branded})=>{
 renameSync(legacy,branded);
 assert.equal(brandWindowsPlayer(root).changed,true);
 assert.equal(brandWindowsPlayer(root).changed,false);
}));
test('both Windows installer entry points brand before running full integrity gates',()=>{
 const root=resolve(import.meta.dirname,'..');
 for(const name of ['build-win7.mjs','build-win10.mjs']){
  const source=readFileSync(join(root,'scripts',name),'utf8');
  assert.ok(source.indexOf('brandWindowsPlayer(')<source.indexOf("['scripts/check-native.mjs"));
  assert.match(source,/--require-branded-receiver/);
 }
 const generic=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).scripts['desktop:build'];
 assert.match(generic,/brand-windows-player.mjs --if-windows/);
});
test('installer cleanup recognises new and old engine filenames with scoped paths',()=>{
 const root=resolve(import.meta.dirname,'..');
 const script=readFileSync(join(root,'src-tauri/windows/process-cleanup.ps1'),'utf8');
 const hooks=readFileSync(join(root,'src-tauri/windows/installer-hooks.nsh'),'utf8');
 for(const filename of [SOURCE,BRANDED]) {
   assert.ok(script.includes(`sidecar\\${filename}`));
   assert.ok(hooks.includes(`sidecar\\${filename}`));
   assert.ok(script.includes(`Name='${filename}'`));
   assert.ok(hooks.includes(`Name='${filename}'`));
 }
 assert.match(script,/OrdinalIgnoreCase/);
 assert.doesNotMatch(script,/taskkill|Stop-Process -Name/i);
 assert.match(readFileSync(join(root,'src-tauri/src/receiver.rs'),'utf8'),/\#\[cfg\(windows\)\] let filename = "AirpimoPlayer\.exe"/);
});
