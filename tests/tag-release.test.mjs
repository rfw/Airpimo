import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync,readFileSync,existsSync,renameSync,symlinkSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {verifyReleaseTag,prepareReleaseAssets,stageMacosDmg} from '../scripts/ci/prepare-release-assets.mjs';
const root=resolve(import.meta.dirname,'..');
const currentVersion=JSON.parse(readFileSync(join(root,'package.json'),'utf8')).version;
const currentTag=`v${currentVersion}`;
function requireFileNames(path){return readdirSync(path).sort();}

function fixture(fn){const dir=mkdtempSync(join(tmpdir(),'uxplay-release-'));return Promise.resolve().then(()=>fn(dir)).finally(()=>rmSync(dir,{recursive:true,force:true}));}
function fakeInstaller(extension){
  const bytes=Buffer.alloc(1_048_577);
  if(extension==='.exe')bytes.write('MZ');
  else bytes.write('koly',bytes.length-512);
  return bytes;
}
function makeFour(input){
  for(const [folder,extension] of [['win7','.exe'],['win10plus','.exe'],['macos-intel','.dmg'],['macos-arm64','.dmg']]){
    const dir=join(input,folder);mkdirSync(dir,{recursive:true});
    writeFileSync(join(dir,'Airpimo'+extension),fakeInstaller(extension));
  }
}
test('stable and prerelease tags must match all three project versions',()=>{
  assert.equal(verifyReleaseTag(currentTag,root),currentVersion);
  assert.equal(verifyReleaseTag(`${currentTag}-rc.1`,root),`${currentVersion}-rc.1`);
  for(const tag of ['main','vlatest','v999.999.999','v0.1','v01.2.3','v0.1.4/drop']){
    assert.throws(()=>verifyReleaseTag(tag,root),/BLOCKED/);
  }
});
test('RC tag is preserved in all four filenames without changing platform labels',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  const tag=`${currentTag}-rc.3`;
  const assets=await prepareReleaseAssets({tag,input,out,projectRoot:root});
  assert.deepEqual(assets.map(({name})=>name),[
    `Airpimo_${currentVersion}-rc.3_windows7-x64.exe`,
    `Airpimo_${currentVersion}-rc.3_windows10-11-x64.exe`,
    `Airpimo_${currentVersion}-rc.3_macos-intel-x64.dmg`,
    `Airpimo_${currentVersion}-rc.3_macos-arm64.dmg`,
  ]);
  const manifest=JSON.parse(readFileSync(join(out,'release-provenance.json'),'utf8'));
  assert.equal(manifest.tag,tag);
  assert.equal(manifest.version,`${currentVersion}-rc.3`);
  assert.deepEqual(manifest.artifacts.map(({name})=>name),assets.map(({name})=>name));
  assert.deepEqual(readFileSync(join(out,'SHA256SUMS.txt'),'utf8').trim().split('\n').map(x=>x.split('  ')[1]),assets.map(({name})=>name));
}));

test('release tag validation allows matching RC project metadata but rejects a different RC or mixed project versions',()=>fixture(dir=>{
  const project=join(dir,'project'),tauri=join(project,'src-tauri');mkdirSync(tauri,{recursive:true});
  const writeVersions=(packageVersion,tauriVersion,cargoVersion)=>{
    writeFileSync(join(project,'package.json'),JSON.stringify({version:packageVersion}));
    writeFileSync(join(tauri,'tauri.conf.json'),JSON.stringify({version:tauriVersion}));
    writeFileSync(join(tauri,'Cargo.toml'),`[package]\nversion = "${cargoVersion}"\n`);
  };
  writeVersions('0.1.0-rc.3','0.1.0-rc.3','0.1.0-rc.3');
  assert.equal(verifyReleaseTag('v0.1.0-rc.3',project),'0.1.0-rc.3');
  assert.throws(()=>verifyReleaseTag('v0.1.0-rc.4',project),/does not match/);
  assert.throws(()=>verifyReleaseTag('v0.1.0',project),/does not match/);
  writeVersions('0.1.0','0.1.0-rc.3','0.1.0');
  assert.throws(()=>verifyReleaseTag('v0.1.0-rc.3',project),/Project versions differ/);
}));

test('one complete four-platform release generates unique assets and digest list',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  const assets=await prepareReleaseAssets({tag:currentTag,input,out,projectRoot:root,sourceCommit:'a'.repeat(40)});
  assert.equal(assets.length,4);
  assert.equal(new Set(assets.map(x=>x.name)).size,4);
  assert.deepEqual(assets.map(x=>x.name),[
    `Airpimo_${currentVersion}_windows7-x64.exe`,
    `Airpimo_${currentVersion}_windows10-11-x64.exe`,
    `Airpimo_${currentVersion}_macos-intel-x64.dmg`,
    `Airpimo_${currentVersion}_macos-arm64.dmg`,
  ]);
  assert.ok(assets.every(x=>existsSync(join(out,x.name))));
  const checksums=readFileSync(join(out,'SHA256SUMS.txt'),'utf8').trim().split('\n');
  assert.equal(checksums.length,4);
  assert.deepEqual(checksums.map(line=>line.split('  ')[1]),assets.map(x=>x.name));
  const manifest=JSON.parse(readFileSync(join(out,'release-provenance.json'),'utf8'));
  assert.equal(manifest.sourceCommit,'a'.repeat(40));
  assert.deepEqual(manifest.artifacts.map(x=>x.name),assets.map(x=>x.name));
  assert.deepEqual(manifest.artifacts.map(x=>x.platform),[
    'windows7-x64','windows10-11-x64','macos-intel-x64','macos-arm64',
  ]);
}));
test('no partial release when a platform is missing',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  rmSync(join(input,'macos-arm64'),{force:true,recursive:true});
  await assert.rejects(prepareReleaseAssets({tag:currentTag,input,out}),/Missing macos-arm64/);
  assert.equal(existsSync(out),false);
}));
test('renaming an invalid installer does not bypass real format checks',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  writeFileSync(join(input,'win7','Airpimo.exe'),Buffer.alloc(1_048_577));
  await assert.rejects(prepareReleaseAssets({tag:currentTag,input,out}),/not a Windows PE executable/);
  assert.equal(existsSync(out),false);
}));
test('the tag workflow uses hosted runners, requires every platform, and publishes only after validation',()=>{
  const release=readFileSync(join(root,'.github/workflows/release-gate.yml'),'utf8');
    assert.match(release,/push:\s*\n\s+tags:\s*\n\s+- 'v\*'/);
  assert.doesNotMatch(release,/workflow_dispatch:|inputs\.win7|runs-on: \[self-hosted/);
  assert.match(release,/needs: \[win7, win10plus, macos_intel, macos_arm64\]/);
  assert.match(release,/permissions:\s*\n\s+contents: write/);
  assert.match(release,/gh release create "\$RELEASE_TAG"/);
  assert.match(release,/--verify-tag/);
  assert.match(release,/prepare-release-assets\.mjs prepare/);
  assert.match(release,/native:verify:win7:mdns/);
  assert.match(release,/native:verify:app -- --target x86_64-apple-darwin/);
  assert.match(release,/native:verify:app -- --target aarch64-apple-darwin/);
  assert.doesNotMatch(release,/UXPLAY_NATIVE_RELEASE_TAG|vars\.UXPLAY_WEBVIEW109_/);
  assert.equal(existsSync(join(root,'.github/workflows/ci.yml')),false);
  assert.equal(existsSync(join(root,'.github/workflows/audit-webview109.yml')),false);
  assert.match(release,/^  source:/m);
  assert.match(release,/npm test/);
  assert.match(release,/npm run test:source/);
});

test('legacy GitHub v4 artifacts with target-qualified macOS directories still publish safely',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  for(const [folder,target] of [['macos-intel','x86_64-apple-darwin'],['macos-arm64','aarch64-apple-darwin']]){
    const nested=join(input,folder,target,'release','bundle','dmg');
    mkdirSync(nested,{recursive:true});
    renameSync(join(input,folder,'Airpimo.dmg'),join(nested,'Airpimo.dmg'));
  }
  const assets=await prepareReleaseAssets({tag:currentTag,input,out,projectRoot:root});
  assert.equal(assets.length,4);
  assert.ok(assets.every(asset=>existsSync(join(out,asset.name))));
}));

test('legacy GitHub host-native macOS artifact layout is also accepted',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  const nested=join(input,'macos-intel','release','bundle','dmg');
  mkdirSync(nested,{recursive:true});
  renameSync(join(input,'macos-intel','Airpimo.dmg'),join(nested,'Airpimo.dmg'));
  const assets=await prepareReleaseAssets({tag:currentTag,input,out,projectRoot:root});
  assert.equal(assets.length,4);
}));

test('release rejects unexpected nested paths rather than traversing arbitrary folders',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  const nested=join(input,'macos-intel','unrelated');mkdirSync(nested);
  renameSync(join(input,'macos-intel','Airpimo.dmg'),join(nested,'Airpimo.dmg'));
  await assert.rejects(prepareReleaseAssets({tag:currentTag,input,out,projectRoot:root}),/Unexpected directory/);
  assert.equal(existsSync(out),false);
}));

test('release rejects multiple DMGs, including mixed flat/nested artifacts',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  const nested=join(input,'macos-intel','x86_64-apple-darwin','release','bundle','dmg');mkdirSync(nested,{recursive:true});
  writeFileSync(join(nested,'Another.dmg'),fakeInstaller('.dmg'));
  await assert.rejects(prepareReleaseAssets({tag:currentTag,input,out,projectRoot:root}),/exactly one \.dmg/);
  assert.equal(existsSync(out),false);
}));

test('release refuses non-installers even under known nested paths',()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  const nested=join(input,'macos-arm64','aarch64-apple-darwin','release','bundle','dmg');mkdirSync(nested,{recursive:true});
  renameSync(join(input,'macos-arm64','Airpimo.dmg'),join(nested,'Airpimo.dmg'));
  writeFileSync(join(nested,'unexpected.txt'),'wrong');
  await assert.rejects(prepareReleaseAssets({tag:currentTag,input,out,projectRoot:root}),/Unexpected release asset/);
  assert.equal(existsSync(out),false);
}));

test('stage-dmg selects the sole target-qualified DMG and copies it flat',()=>fixture(dir=>{
  const projectRoot=join(dir,'project'),out=join(dir,'candidate');
  const dmgDir=join(projectRoot,'src-tauri','target','x86_64-apple-darwin','release','bundle','dmg');
  mkdirSync(dmgDir,{recursive:true});
  writeFileSync(join(dmgDir,`Airpimo_${currentVersion}.dmg`),fakeInstaller('.dmg'));
  const staged=stageMacosDmg({target:'x86_64-apple-darwin',projectRoot,out});
  assert.equal(staged,join(out,`Airpimo_${currentVersion}.dmg`));
  assert.ok(existsSync(staged));
}));

test('stage-dmg ignores only Tauri-generated regular bundle_dmg.sh and icon.icns on Intel and ARM64',()=>fixture(dir=>{
  for(const [index,target] of ['x86_64-apple-darwin','aarch64-apple-darwin'].entries()){
    const projectRoot=join(dir,`project-${index}`),out=join(dir,`staged-${index}`);
    const dmgDir=join(projectRoot,'src-tauri','target',target,'release','bundle','dmg');
    mkdirSync(dmgDir,{recursive:true});
    writeFileSync(join(dmgDir,'bundle_dmg.sh'),'#!/bin/bash\n# Created by Tauri\n');
    writeFileSync(join(dmgDir,'icon.icns'),Buffer.from('icns'));
    writeFileSync(join(dmgDir,'Airpimo.dmg'),fakeInstaller('.dmg'));
    const staged=stageMacosDmg({target,projectRoot,out});
    assert.equal(staged,join(out,'Airpimo.dmg'));
    assert.deepEqual(requireFileNames(out),['Airpimo.dmg']);
    assert.equal(readFileSync(staged).subarray(-512,-508).toString('ascii'),'koly');
  }
}));

test('stage-dmg tolerates Tauri auxiliary files in alternate host-native output layout',()=>fixture(dir=>{
  const projectRoot=join(dir,'project'),out=join(dir,'staged');
  const dmgDir=join(projectRoot,'src-tauri','target','release','bundle','dmg');
  mkdirSync(dmgDir,{recursive:true});
  writeFileSync(join(dmgDir,'bundle_dmg.sh'),'shell script');
  writeFileSync(join(dmgDir,'icon.icns'),Buffer.from('icns'));
  writeFileSync(join(dmgDir,'Airpimo.dmg'),fakeInstaller('.dmg'));
  assert.equal(stageMacosDmg({target:'aarch64-apple-darwin',projectRoot,out}),join(out,'Airpimo.dmg'));
}));

test('stage-dmg still rejects unknown Tauri-sidecar lookalikes and nested directories',()=>fixture(dir=>{
  const projectRoot=join(dir,'project'),out=join(dir,'staged');
  const dmgDir=join(projectRoot,'src-tauri','target','aarch64-apple-darwin','release','bundle','dmg');
  mkdirSync(dmgDir,{recursive:true});
  writeFileSync(join(dmgDir,'Airpimo.dmg'),fakeInstaller('.dmg'));
  for(const candidate of ['bundle_dmg.sh.bak','icon-2.icns','extra.txt']){
    const extra=join(dmgDir,candidate);
    writeFileSync(extra,'unexpected');
    assert.throws(()=>stageMacosDmg({target:'aarch64-apple-darwin',projectRoot,out}),/Unexpected macOS DMG candidate/);
    rmSync(extra);
    assert.equal(existsSync(out),false);
  }
  mkdirSync(join(dmgDir,'support'));
  assert.throws(()=>stageMacosDmg({target:'aarch64-apple-darwin',projectRoot,out}),/Unexpected macOS DMG candidate/);
  rmSync(join(dmgDir,'support'),{recursive:true});
  mkdirSync(join(dmgDir,'bundle_dmg.sh'));
  assert.throws(()=>stageMacosDmg({target:'aarch64-apple-darwin',projectRoot,out}),/Unexpected macOS DMG candidate/);
  assert.equal(existsSync(out),false);
}));

test('stage-dmg rejects an auxiliary script symlink and still requires a DMG', {skip:process.platform==='win32'},()=>fixture(dir=>{
  const projectRoot=join(dir,'project'),out=join(dir,'staged');
  const dmgDir=join(projectRoot,'src-tauri','target','x86_64-apple-darwin','release','bundle','dmg');
  mkdirSync(dmgDir,{recursive:true});
  writeFileSync(join(dmgDir,'Airpimo.dmg'),fakeInstaller('.dmg'));
  symlinkSync('Airpimo.dmg',join(dmgDir,'bundle_dmg.sh'));
  assert.throws(()=>stageMacosDmg({target:'x86_64-apple-darwin',projectRoot,out}),/Unexpected macOS DMG candidate/);
  rmSync(join(dmgDir,'bundle_dmg.sh'));
  rmSync(join(dmgDir,'Airpimo.dmg'));
  writeFileSync(join(dmgDir,'bundle_dmg.sh'),'only helper script');
  writeFileSync(join(dmgDir,'icon.icns'),'only icon');
  assert.throws(()=>stageMacosDmg({target:'x86_64-apple-darwin',projectRoot,out}),/Expected exactly one x86_64-apple-darwin DMG/);
  assert.equal(existsSync(out),false);
}));

test('stage-dmg supports alternate native Tauri output and rejects duplicate copies',()=>fixture(dir=>{
  const projectRoot=join(dir,'project'),out=join(dir,'candidate');
  const native=join(projectRoot,'src-tauri','target','release','bundle','dmg');
  mkdirSync(native,{recursive:true});
  writeFileSync(join(native,'Airpimo.dmg'),fakeInstaller('.dmg'));
  assert.ok(existsSync(stageMacosDmg({target:'aarch64-apple-darwin',projectRoot,out})));
  const qualified=join(projectRoot,'src-tauri','target','aarch64-apple-darwin','release','bundle','dmg');
  mkdirSync(qualified,{recursive:true});
  writeFileSync(join(qualified,'Airpimo.dmg'),fakeInstaller('.dmg'));
  assert.throws(()=>stageMacosDmg({target:'aarch64-apple-darwin',projectRoot,out:join(dir,'other')}),/exactly one aarch64-apple-darwin DMG/);
  assert.throws(()=>stageMacosDmg({target:'aarch64-apple-darwin',projectRoot,out}),/nonempty staged DMG output/);
}));

test('stage-dmg rejects unsupported target and invalid container without producing output',()=>fixture(dir=>{
  const projectRoot=join(dir,'project'),out=join(dir,'candidate');
  assert.throws(()=>stageMacosDmg({target:'win32',projectRoot,out}),/Unknown macOS/);
  const native=join(projectRoot,'src-tauri','target','x86_64-apple-darwin','release','bundle','dmg');mkdirSync(native,{recursive:true});
  writeFileSync(join(native,'Bad.dmg'),Buffer.alloc(1_048_577));
  assert.throws(()=>stageMacosDmg({target:'x86_64-apple-darwin',projectRoot,out}),/UDIF/);
  assert.equal(existsSync(out),false);
}));

test('release rejects symlink files from artifacts', {skip:process.platform==='win32'},()=>fixture(async dir=>{
  const input=join(dir,'input'),out=join(dir,'release');makeFour(input);
  const link=join(input,'macos-intel','alias.dmg');
  symlinkSync('Airpimo.dmg',link);
  await assert.rejects(prepareReleaseAssets({tag:currentTag,input,out,projectRoot:root}),/Symlink in release artifact/);
  assert.equal(existsSync(out),false);
}));

test('GitHub Actions publishes flat normalized macOS DMG artifacts',()=>{
  const workflow=readFileSync(join(root,'.github/workflows/release-gate.yml'),'utf8');
  assert.match(workflow,/stage-dmg --target x86_64-apple-darwin --out ci-dmg/);
  assert.match(workflow,/stage-dmg --target aarch64-apple-darwin --out ci-dmg/);
  assert.equal(workflow.match(/path: ci-dmg\/\*\.dmg/g)?.length,2);
  assert.doesNotMatch(workflow,/src-tauri\/target\/release\/bundle\/dmg\/\*\.dmg/);
});
