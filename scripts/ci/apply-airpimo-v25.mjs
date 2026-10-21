#!/usr/bin/env node
/** Airpimo v25: guarded, minimal line-hunk transformations; never replace stale full sources. */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const rootDefault=fileURLToPath(new URL('../..', import.meta.url));
const patchManifest=fileURLToPath(new URL('./airpimo-v25-edits.json',import.meta.url));

function normalize(s){return s.replace(/\r\n/g,'\n');}
export function plan(root=rootDefault){
  const manifest=JSON.parse(readFileSync(join(root,'scripts/ci/airpimo-v25-edits.json'),'utf8'));
  if(manifest.version!==25)throw Error('v25 edits file has the wrong version');
  for(const asset of manifest.assets){
    const p=join(root,asset.path);
    if(!existsSync(p)) throw Error(`ZIP 缺少新增文件: ${asset.path}`);
    const digest=createHash('sha256').update(readFileSync(p)).digest('hex');
    if(digest!==asset.sha256)throw Error(`新增文件与 ZIP 校验值不同，拒绝覆盖: ${asset.path}`);
  }
  const changes=new Map();
  for(const edit of manifest.edits){
    const p=join(root,edit.path);
    if(!existsSync(p)) throw Error(`缺少项目文件: ${edit.path}`);
    const original=readFileSync(p,'utf8');
    const crlf=original.includes('\r\n');
    let result=normalize(original);
    for(let idx=0;idx<edit.hunks.length;idx++){
      const {before,after}=edit.hunks[idx];
      if(before===after)continue;
      if(result.includes(after)) continue; // Includes append-only hunks whose original prefix remains.
      const pos=result.indexOf(before);
      if(pos>=0){
        if(result.indexOf(before,pos+before.length)>=0)throw Error(`${edit.path} patch ${idx+1}: 原锚点不唯一，已阻止修改`);
        result=result.slice(0,pos)+after+result.slice(pos+before.length);
      }else if(!result.includes(after)){
        throw Error(`${edit.path} patch ${idx+1}: 与当前源码不匹配，未修改任何旧文件；请提供最新源码 ZIP`);
      }
    }
    if(result!==normalize(original))changes.set(edit.path,{before:original,after:crlf?result.replace(/\n/g,'\r\n'):result,path:p});
  }
  return changes;
}
export function apply(root=rootDefault,write=false){
  const changes=plan(root); // Entire patch is validated before any existing file changes.
  if(write){
    for(const [rel,{before}] of changes){
      const backup=join(root,'.airpimo-v25-backup',rel);
      mkdirSync(dirname(backup),{recursive:true});
      if(!existsSync(backup))writeFileSync(backup,before,'utf8');
    }
    for(const change of changes.values())writeFileSync(change.path,change.after,'utf8');
  }
  return [...changes.keys()];
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const mode=process.argv[2]??'--check';
    if(!['--apply','--check'].includes(mode))throw Error('Usage: --apply | --check');
    const changed=apply(rootDefault,mode==='--apply');
    for(const file of changed)console.log(`[airpimo-v25] ${mode==='--apply'?'UPDATED':'PENDING'} ${file}`);
    if(mode==='--check'&&changed.length)throw Error(`${changed.length} 个文件尚未应用；先运行 --apply`);
    console.log(`[airpimo-v25] PASS, ${changed.length} changed`);
  }catch(error){console.error(`[airpimo-v25] BLOCKED: ${error.message}`);process.exitCode=2;}
}
