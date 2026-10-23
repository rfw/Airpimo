#!/usr/bin/env node
/** Fail-closed Mach-O dependency audit for packaged UxPlay/GStreamer assets.
 * All referenced non-system libraries must resolve INSIDE the bundle.
 * It does not rewrite install names, sign, notarize, or prove AirPlay playback.
 */
import {existsSync, readFileSync, realpathSync, openSync, readSync, closeSync} from 'node:fs';
import {join, resolve, dirname, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const MACHO_MAGIC=new Set(['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca']);
export function isMachO(path) {
  const fd=openSync(path,'r');
  try { const buffer=Buffer.alloc(4); return readSync(fd,buffer,0,4,0)===4 && MACHO_MAGIC.has(buffer.toString('hex')); }
  finally { closeSync(fd); }
}
export function parseLibraries(output) {
  // `otool -L` lists the binary itself as the first header line.
  return output.split(/\r?\n/).slice(1).map(line => line.match(/^\s+(.+?)\s+\(compatibility version /)?.[1]).filter(Boolean);
}
export function parseRpaths(output) {
  const paths=[];
  for(const block of output.split(/(?=Load command \d+)/g)) {
    if (!/\bcmd LC_RPATH\b/.test(block)) continue;
    const found=block.match(/\bpath (.*?) \(offset \d+\)/);
    if(found) paths.push(found[1]);
  }
  return paths;
}
function within(root,path) {
  const r=relative(root,path);
  return r==='' || (r!=='..' && !r.startsWith(`..${sep}`) && !isAbsolute(r));
}
export function auditMacNative(resourceDir,{run=spawnSync, manifest}={}) {
  const root=realpathSync(resolve(resourceDir));
  const data=manifest??JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
  const problems=[];const entries=[];
  const allowed=new Set();
  for(const item of data.files??[]) {
    const name=item.path;
    if(typeof name!=='string' || !/^(sidecar|gstreamer)\/[\w.+@()/-]+$/.test(name) || name.split('/').includes('..')) {
      problems.push(`Invalid manifest entry: ${String(name)}`);continue;
    }
    const file=join(root,name);
    if(!existsSync(file)) {problems.push(`Missing: ${name}`);continue;}
    const real=realpathSync(file);
    if(!within(root,real)) {problems.push(`Escapes bundle: ${name}`);continue;}
    allowed.add(real);
    if(isMachO(real)) entries.push({name,file:real});
  }
  const stagedName=data.files?.some(f=>f.path==='sidecar/Airpimo')?'Airpimo':'uxplay';
  const executable=realpathSync(join(root,'sidecar',stagedName));
  if(!entries.some(v=>v.file===executable)) problems.push('Missing Mach-O UxPlay executable');
  const scanned=new Map();
  function command(args,file) {
    const result=run('otool',[...args,file],{encoding:'utf8',timeout:10000,maxBuffer:16*1024*1024});
    if(result.error||result.status!==0) { problems.push(`otool ${args.join(' ')} failed: ${relative(root,file)} (${result.error?.message??result.stderr??result.status})`); return ''; }
    return result.stdout;
  }
  for(const entry of entries) {
    const arch=run('lipo',['-archs',entry.file],{encoding:'utf8',timeout:10000});
    const required=data.arch==='x64'?'x86_64':data.arch==='arm64'?'arm64':null;
    if(!required || arch.status!==0 || arch.error || !arch.stdout.trim().split(/\s+/).includes(required))
      problems.push(`${entry.name}: Mach-O architecture does not match manifest (${required??'unknown'})`);
    scanned.set(entry.file,{libs:parseLibraries(command(['-L'],entry.file)),rpaths:parseRpaths(command(['-l'],entry.file))});
  }
  function expand(token,loader){
    if(token==='@loader_path') return dirname(loader);
    if(token.startsWith('@loader_path/')) return resolve(dirname(loader),token.slice(13));
    if(token==='@executable_path') return dirname(executable);
    if(token.startsWith('@executable_path/')) return resolve(dirname(executable),token.slice(17));
    if(isAbsolute(token)) return token;
    return null;
  }
  const executablePaths=scanned.get(executable)?.rpaths??[];
  const report=[];
  for(const entry of entries) {
    const {libs,rpaths}=scanned.get(entry.file);
    const refs=[];
    for(let index=0;index<libs.length;index++) {
      const name=libs[index];
      // For MH_DYLIB, `otool -L` lists its own install ID first. This is not
      // a dependency, though an absolute developer-machine ID is still unsafe.
      if(index===0 && entry.name.endsWith('.dylib') && name.split('/').at(-1)===entry.name.split('/').at(-1)) {
        if(isAbsolute(name) && !name.startsWith('/System/Library/') && !name.startsWith('/usr/lib/'))
          problems.push(`${entry.name}: absolute install ID ${name}`);
        refs.push({name,resolution:'install-id'});
        continue;
      }
      if (name.startsWith('/System/Library/') || name.startsWith('/usr/lib/')) { refs.push({name,resolution:'system'});continue; }
      if(isAbsolute(name)) {problems.push(`${entry.name}: developer/absolute dependency ${name}`);refs.push({name,resolution:'blocked'});continue;}
      let choices=[];
      if(name.startsWith('@rpath/')) {
        const suffix=name.slice('@rpath/'.length);
        for(const [rpath,owner] of [...rpaths.map(p=>[p,entry.file]),...executablePaths.map(p=>[p,executable])]) {
          const rootPath=expand(rpath,owner);
          if(rootPath) choices.push(resolve(rootPath,suffix));
        }
      } else {
        const dest=expand(name,entry.file);
        if(dest) choices=[dest];
      }
      const found=choices.find(path=>{
        if(!existsSync(path))return false;
        const actual=realpathSync(path);
        return within(root,actual) && allowed.has(actual);
      });
      if(!found) {
        problems.push(`${entry.name}: unresolved or non-bundled dependency ${name}`);
        refs.push({name,resolution:'blocked'});
      } else refs.push({name,resolution:relative(root,found)});
    }
    report.push({path:entry.name,rpaths,dependencies:refs});
  }
  return {ok:problems.length===0, filesExamined:entries.length, problems, report};
}

if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  const flag=process.argv.indexOf('--resources');
  const resources=flag>=0?process.argv[flag+1]:resolve(import.meta.dirname,'../src-tauri/resources');
  if(!resources) {console.error('Usage: node scripts/audit-macos-native.mjs --resources /path/to/Resources');process.exit(2);}
  try {
    const result=auditMacNative(resources);
    for(const problem of result.problems) console.error(`BLOCKED: ${problem}`);
    console.log(`macOS Mach-O audit: ${result.filesExamined} binaries inspected, ${result.problems.length} problem(s)`);
    if(process.argv.includes('--json')) console.log(JSON.stringify(result,null,2));
    process.exit(result.ok?0:2);
  } catch(error) {console.error('BLOCKED macOS audit: '+error.message);process.exit(2);}
}
