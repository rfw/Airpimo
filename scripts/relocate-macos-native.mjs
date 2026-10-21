#!/usr/bin/env node
/** Deliberately explicit Mach-O install-name relocation of STAGED assets.
 * No modifications to developer's UxPlay/Homebrew directories. Run --apply only
 * after dry-run. Unsafe or ambiguous dependencies are a hard error.
 */
import {existsSync, readFileSync, writeFileSync, realpathSync} from 'node:fs';
import {resolve, join, dirname, relative, sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isMachO, parseLibraries, auditMacNative} from './audit-macos-native.mjs';

function validName(name) {return /^(sidecar|gstreamer)\/[\w.+@()/-]+$/.test(name) && !name.split('/').includes('..');}
export function planMacRelocation(resources,{run=spawnSync, manifest}={}) {
  const root=realpathSync(resolve(resources));
  const data=manifest??JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
  const problems=[];const bins=[];const byBase=new Map();
  for(const entry of data.files??[]) {
    if(!validName(entry.path)) {problems.push('Unsafe manifest path: '+entry.path);continue;}
    const file=join(root,entry.path);
    if(!existsSync(file)) {problems.push('Missing staged asset: '+entry.path);continue;}
    const real=realpathSync(file);
    if(!real.startsWith(root+sep)) {problems.push('Asset escapes staged resources: '+entry.path);continue;}
    if(!isMachO(file))continue;
    bins.push({file,path:entry.path});
    const base=entry.path.split('/').at(-1);
    byBase.set(base,[...(byBase.get(base)??[]),file]);
  }
  const operations=[];
  for(const entry of bins) {
    const result=run('otool',['-L',entry.file],{encoding:'utf8',timeout:10000});
    if(result.status!==0||result.error) {problems.push('Cannot inspect: '+entry.path);continue;}
    const libraries=parseLibraries(result.stdout);
    for(let index=0;index<libraries.length;index++) {
      const name=libraries[index];
      const base=name.split('/').at(-1);
      const ownId=entry.path.endsWith('.dylib') && index===0 && base===entry.path.split('/').at(-1);
      if(ownId) {
        const id='@loader_path/'+base;
        if(name!==id)operations.push({type:'id',file:entry.file,path:entry.path,from:name,to:id});
        continue;
      }
      if(name.startsWith('/System/Library/')||name.startsWith('/usr/lib/'))continue;
      const matches=byBase.get(base)??[];
      if(matches.length!==1) {
        problems.push(`${entry.path}: ${matches.length===0?'missing':'ambiguous'} packaged dependency: ${name}`);
        continue;
      }
      const rel=relative(dirname(entry.file),matches[0]).split(sep).join('/');
      const replacement='@loader_path/'+rel;
      if(name!==replacement)operations.push({type:'change',file:entry.file,path:entry.path,from:name,to:replacement});
    }
  }
  if(!bins.some(v=>v.path==='sidecar/uxplay')) problems.push('No Mach-O sidecar/uxplay found');
  return {ok:problems.length===0,filesExamined:bins.length,problems,operations};
}
export function applyMacRelocation(resources,{run=spawnSync}={}) {
  const root=realpathSync(resolve(resources));
  const manifestPath=join(root,'native-manifest.json');
  const data=JSON.parse(readFileSync(manifestPath,'utf8'));
  if(data.ready!==true || data.os!=='darwin')throw Error('Only a ready staged macOS manifest can be relocated');
  const plan=planMacRelocation(root,{run,manifest:data});
  if(!plan.ok)throw Error(plan.problems.join('\n'));
  // All operations are against a staging copy. Fail-closed release gate on
  // any interrupted rewrite: explicit re-staging is required to recover.
  writeFileSync(manifestPath,JSON.stringify({...data,ready:false,reason:'relocation_in_progress'},null,2)+'\n');
  for(const op of plan.operations) {
    const args=op.type==='id'?['-id',op.to,op.file]:['-change',op.from,op.to,op.file];
    const result=run('install_name_tool',args,{encoding:'utf8',timeout:10000});
    if(result.status!==0||result.error)throw Error(`Relocation failed at ${op.path}: ${result.stderr??result.error?.message??result.status}`);
  }
  for(const entry of data.files) {
    const source=join(root,entry.path);
    entry.sha256=createHash('sha256').update(readFileSync(source)).digest('hex');
  }
  const audit=auditMacNative(root,{run,manifest:data});
  if(!audit.ok)throw Error('Relocation incomplete: '+audit.problems.join('; '));
  data.ready=true;
  data.relocated=true;
  writeFileSync(manifestPath,JSON.stringify(data,null,2)+'\n');
  return {operations:plan.operations.length,filesExamined:plan.filesExamined};
}

if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  if(process.platform!=='darwin'){console.error('BLOCKED: install_name_tool is only supported on macOS');process.exit(2);}
  const index=process.argv.indexOf('--resources');
  const resources=index>=0?process.argv[index+1]:resolve(import.meta.dirname,'../src-tauri/resources');
  try {
    if(process.argv.includes('--apply')) {
      const result=applyMacRelocation(resources);
      console.log(`PASS: relocated ${result.operations} Mach-O load commands in ${result.filesExamined} staged binaries. Run npm run desktop:build:mac for packaging.`);
    } else {
      const result=planMacRelocation(resources);
      for(const issue of result.problems)console.error('BLOCKED: '+issue);
      console.log(`DRY RUN: ${result.filesExamined} binaries, ${result.operations.length} install-name edits; use --apply to modify staged COPY (never source/Homebrew)`);
      if(!result.ok)process.exit(2);
    }
  } catch(e){console.error('BLOCKED: '+e.message);process.exit(2);}
}
