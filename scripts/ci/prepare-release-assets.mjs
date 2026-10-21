#!/usr/bin/env node
// Pure Node release gate: validate tag/version and turn four audited artifacts
// into uniquely named GitHub Release assets with SHA-256 provenance.
import {createReadStream, readFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, openSync, readSync, closeSync, writeFileSync, existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, resolve, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {finished} from 'node:stream/promises';

const defaultRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const specs=Object.freeze([
  {folder:'win7',name:'windows7-x64',extension:'.exe'},
  {folder:'win10plus',name:'windows10-11plus-x64',extension:'.exe'},
  {folder:'macos-intel',name:'macos-intel-x64',target:'x86_64-apple-darwin',extension:'.dmg'},
  {folder:'macos-arm64',name:'macos-arm64',target:'aarch64-apple-darwin',extension:'.dmg'},
]);

export function verifyReleaseTag(tag,projectRoot=defaultRoot){
  if (!/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$/.test(tag??'')) {
    throw new Error(`BLOCKED: Expected version tag vMAJOR.MINOR.PATCH[-prerelease], got ${JSON.stringify(tag)}`);
  }
  const version=tag.slice(1).split('-')[0];
  const packageVersion=JSON.parse(readFileSync(join(projectRoot,'package.json'),'utf8')).version;
  const tauriVersion=JSON.parse(readFileSync(join(projectRoot,'src-tauri','tauri.conf.json'),'utf8')).version;
  const cargo=readFileSync(join(projectRoot,'src-tauri','Cargo.toml'),'utf8');
  const cargoVersion=cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  for(const [name,found] of [['package.json',packageVersion],['tauri.conf.json',tauriVersion],['Cargo.toml',cargoVersion]]){
    if(found!==version) throw new Error(`BLOCKED: ${tag} does not match ${name} version ${found??'(missing)'}`);
  }
  return version;
}

function validateBinary(path,extension){
  const handle=openSync(path,'r');
  try {
    const size=lstatSync(path).size;
    if(size<1_048_576)throw new Error(`BLOCKED: ${path} is too small to be an installer (${size} bytes)`);
    if(extension==='.exe'){
      const magic=Buffer.alloc(2);
      if(readSync(handle,magic,0,2,0)!==2 || magic.toString('ascii')!=='MZ')throw new Error(`BLOCKED: ${path} is not a Windows PE executable`);
    } else {
      // UDIF disk images use a 512-byte koly trailer. Fail on placeholder assets.
      const magic=Buffer.alloc(4);
      if(readSync(handle,magic,0,4,size-512)!==4 || magic.toString('ascii')!=='koly')throw new Error(`BLOCKED: ${path} has no macOS UDIF (koly) trailer`);
    }
  }finally{closeSync(handle)}
}

// Artifact v4 can preserve subdirectories when multiple upload paths share a
// common ancestor. Accept only the exact legacy macOS layouts we produced;
// never recursively select a convenient .dmg from an arbitrary artifact tree.
function releaseAssetPath(artifactRoot,spec){
  const allowed=spec.extension==='.dmg'
    ? [[],[spec.target,'release','bundle','dmg'],['release','bundle','dmg']]
    : [[]];
  const found=[];
  const visit=(directory,parts)=>{
    for(const name of readdirSync(directory)){
      const path=join(directory,name);
      const info=lstatSync(path); // do not follow symlinks from downloaded artifacts
      if(info.isSymbolicLink())throw new Error(`BLOCKED: Symlink in release artifact for ${spec.name}: ${path}`);
      if(info.isDirectory()){
        const next=[...parts,name];
        if(!allowed.some(prefix=>next.length<=prefix.length && next.every((p,i)=>p===prefix[i]))) {
          throw new Error(`BLOCKED: Unexpected directory for ${spec.name}: ${next.join('/')}`);
        }
        visit(path,next);
      }else if(info.isFile()){
        if(!allowed.some(prefix=>parts.length===prefix.length && parts.every((p,i)=>p===prefix[i])) || extname(name).toLowerCase()!==spec.extension){
          throw new Error(`BLOCKED: Unexpected release asset for ${spec.name}: ${[...parts,name].join('/')}`);
        }
        found.push(path);
      }else{
        throw new Error(`BLOCKED: Unsupported release asset type for ${spec.name}: ${path}`);
      }
    }
  };
  visit(artifactRoot,[]);
  if(found.length!==1)throw new Error(`BLOCKED: Expected exactly one ${spec.extension} for ${spec.name}, found ${found.length}`);
  return found[0];
}

export function stageMacosDmg({target,out,projectRoot=defaultRoot}={}){
  const targets=['x86_64-apple-darwin','aarch64-apple-darwin'];
  if(!targets.includes(target))throw new Error(`BLOCKED: Unknown macOS DMG target ${JSON.stringify(target)}`);
  if(!out)throw new Error('BLOCKED: --out is required for macOS DMG staging');
  const to=resolve(out);
  if(existsSync(to) && readdirSync(to).length)throw new Error(`BLOCKED: Refusing nonempty staged DMG output ${to}`);
  const targetRoot=join(projectRoot,'src-tauri','target');
  const dirs=[join(targetRoot,target,'release','bundle','dmg'),join(targetRoot,'release','bundle','dmg')];
  // Tauri's DMG bundler retains its generated script and volume icon beside
  // the final .dmg. They are build inputs, not release assets. Ignore only the
  // two known *regular files*; unknown sidecars/directories/symlinks fail shut.
  const tauriSidecars=new Set(['bundle_dmg.sh','icon.icns']);
  const matches=[];
  for(const directory of dirs){
    if(!existsSync(directory))continue;
    for(const name of readdirSync(directory)){
      const path=join(directory,name), info=lstatSync(path);
      if(info.isSymbolicLink() || !info.isFile()){
        throw new Error(`BLOCKED: Unexpected macOS DMG candidate: ${path}`);
      }
      if(tauriSidecars.has(name))continue;
      if(extname(name).toLowerCase()!=='.dmg'){
        throw new Error(`BLOCKED: Unexpected macOS DMG candidate: ${path}`);
      }
      matches.push({path,name});
    }
  }
  if(matches.length!==1)throw new Error(`BLOCKED: Expected exactly one ${target} DMG across Tauri output paths; found ${matches.length}`);
  const {path:source,name}=matches[0];
  validateBinary(source,'.dmg');
  mkdirSync(to,{recursive:true});
  const destination=join(to,name);
  copyFileSync(source,destination);
  validateBinary(destination,'.dmg');
  return destination;
}

async function sha256(path){
  const hash=createHash('sha256');
  const stream=createReadStream(path);
  stream.on('data',chunk=>hash.update(chunk));
  await finished(stream);
  return hash.digest('hex');
}

export async function prepareReleaseAssets({tag,input,out,projectRoot=defaultRoot,sourceCommit='unknown'}={}){
  const version=verifyReleaseTag(tag,projectRoot);
  if (!input || !out)throw new Error('BLOCKED: --input and --out are required');
  const from=resolve(input),to=resolve(out);
  if(from===to)throw new Error('BLOCKED: Input and output must differ');
  if(existsSync(to) && readdirSync(to).length)throw new Error(`BLOCKED: Refusing nonempty release output ${to}`);
  // Validate every artifact *before* copying anything, so one missing target
  // can never produce a partially prepared release.
  const files=specs.map(spec=>{
    const dir=join(from,spec.folder);
    if(!existsSync(dir))throw new Error(`BLOCKED: Missing ${spec.name} artifact directory: ${dir}`);
    if(!lstatSync(dir).isDirectory())throw new Error(`BLOCKED: Invalid ${spec.name} artifact directory: ${dir}`);
    const src=releaseAssetPath(dir,spec);
    validateBinary(src,spec.extension);
    return {...spec,src,filename:`Airpimo_${version}_${spec.name}${spec.extension}`};
  });
  mkdirSync(to,{recursive:true});
  const result=[];
  for(const item of files){
    const dest=join(to,item.filename);
    copyFileSync(item.src,dest);
    const digest=await sha256(dest);
    result.push({name:item.filename,platform:item.name,sha256:digest,bytes:lstatSync(dest).size});
  }
  writeFileSync(join(to,'SHA256SUMS.txt'),result.map(i=>`${i.sha256}  ${i.name}`).join('\n')+'\n');
  writeFileSync(join(to,'release-provenance.json'),JSON.stringify({schema:1,tag,version,sourceCommit,artifacts:result},null,2)+'\n');
  return result;
}

function getArg(args,name){const index=args.indexOf(name);return index<0?null:args[index+1];}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [mode,...args]=process.argv.slice(2);
  try {
    const tag=getArg(args,'--tag');
    if(mode==='verify-tag') {
      console.log(`[release] Version ${verifyReleaseTag(tag)} matches npm/Tauri/Cargo`);
    }else if(mode==='stage-dmg'){
      const result=stageMacosDmg({target:getArg(args,'--target'),out:getArg(args,'--out')});
      console.log(`[release] Staged verified macOS DMG: ${result}`);
    }else if(mode==='prepare'){
      const result=await prepareReleaseAssets({tag,input:getArg(args,'--input'),out:getArg(args,'--out'),sourceCommit:process.env.SOURCE_COMMIT??'unknown'});
      for(const asset of result)console.log(`[release] Verified ${asset.platform}: ${asset.name}, SHA-256 ${asset.sha256}`);
    }else throw new Error(`Unknown release preparation mode: ${mode}`);
  }catch(error){console.error(error.message);process.exitCode=2;}
}
