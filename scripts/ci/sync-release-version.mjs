#!/usr/bin/env node
// Synchronize only the local project's own version metadata; never update dependency versions.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const versionPattern=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;
function replaceExactlyOnce(content, pattern, update, file){
  const matches=[...content.matchAll(new RegExp(pattern.source,pattern.flags.includes('g')?pattern.flags:pattern.flags+'g'))];
  if(matches.length!==1)throw new Error(`BLOCKED: ${file}: expected exactly one own-package version, found ${matches.length}`);
  return content.replace(pattern,update);
}
function planVersionSync(root=projectRoot){
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const version=manifest.version;
  if(manifest.name!=='airpimo'||!versionPattern.test(version??'')){
    throw new Error(`BLOCKED: invalid package name or version in package.json: ${manifest.name} ${version}`);
  }
  const npmLock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
  if(npmLock.name!==manifest.name||npmLock.version!==version||npmLock.packages?.['']?.version!==version){
    throw new Error('BLOCKED: package-lock.json differs from package.json; run npm install --package-lock-only --ignore-scripts');
  }
  const changes=[];
  const tauriPath=join(root,'src-tauri','tauri.conf.json');
  const tauri=readFileSync(tauriPath,'utf8');
  const tauriData=JSON.parse(tauri);
  if(typeof tauriData.version!=='string')throw new Error('BLOCKED: invalid Tauri config version');
  // When Tauri inherits the npm version, preserve its version reference.
  // Changing it back to a literal would break the single-source version model.
  // Only the known in-repository reference is allowed here; other references
  // remain a deliberate failure rather than rewriting an arbitrary path.
  let newTauri;
  if(tauriData.version==='../package.json'){
    newTauri=tauri;
  }else if(versionPattern.test(tauriData.version)){
    newTauri=replaceExactlyOnce(tauri, /^(\s{2}"version"\s*:\s*")([^"]+)(")/m,(_whole,start,_current,end)=>start+version+end,'tauri.conf.json');
  }else{
    throw new Error(`BLOCKED: unsupported Tauri version reference ${JSON.stringify(tauriData.version)}`);
  }
  changes.push({path:tauriPath,before:tauri,after:newTauri,old:tauriData.version});

  const cargoPath=join(root,'src-tauri','Cargo.toml');
  const cargo=readFileSync(cargoPath,'utf8');
  const header=/\[package\]([^]*?)(?=^\[|$(?![\s\S]))/m;
  const cargoMatch=cargo.match(header);
  if(!cargoMatch||!/^(name\s*=\s*"airpimo")\s*$/m.test(cargoMatch[1]))throw new Error('BLOCKED: Cargo.toml package table missing or has wrong project name');
  const nextPackage=replaceExactlyOnce(cargoMatch[1],/^version\s*=\s*"([^"]+)"/m,()=>`version = "${version}"`,'Cargo.toml [package]');
  changes.push({path:cargoPath,before:cargo,after:cargo.replace(cargoMatch[0],`[package]${nextPackage}`)});

  const lockPath=join(root,'src-tauri','Cargo.lock');
  const lock=readFileSync(lockPath,'utf8');
  const lockPattern=/(^\[\[package\]\]\s*\r?\nname\s*=\s*"airpimo"\s*\r?\nversion\s*=\s*")([^"]+)(")/m;
  const nextLock=replaceExactlyOnce(lock,lockPattern,(_whole,start,_current,end)=>start+version+end,'Cargo.lock [[package]] airpimo');
  changes.push({path:lockPath,before:lock,after:nextLock});
  return {version,changes};
}
export function syncProjectVersion(root=projectRoot,{apply=false}={}){
  const plan=planVersionSync(root);
  const updated=plan.changes.filter(change=>change.before!==change.after);
  if(apply){
    for(const change of updated)writeFileSync(change.path,change.after,'utf8');
  }
  return {version:plan.version,files:updated.map(change=>change.path),applied:apply};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const mode=process.argv[2]??'--check';
    if(!['--check','--apply'].includes(mode))throw new Error('Usage: node scripts/ci/sync-release-version.mjs [--check|--apply]');
    const result=syncProjectVersion(projectRoot,{apply:mode==='--apply'});
    if(mode==='--check'&&result.files.length)throw new Error(`BLOCKED: ${result.files.length} version files differ from ${result.version}. Run --apply.`);
    console.log(`[version-sync] PASS ${result.version}: ${result.files.length} project file(s) ${mode==='--apply'?'synchronized':'checked'}`);
  }catch(error){console.error(error.message);process.exitCode=2;}
}
