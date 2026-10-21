#!/usr/bin/env node
/** Read-only diagnosis of incompatible Windows MinGW C++ CRT candidates. */
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {collectCrtImports, auditPackagedCxxAbi} from '../win7-cxx-abi.mjs';
import {parsePE} from '../win7-pe-audit.mjs';
const project=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const args=process.argv.slice(2);
function arg(name, fallback=null) {
  const index=args.indexOf(name);
  if(index===-1)return fallback;
  if(!args[index+1]||args[index+1].startsWith('--'))throw Error(`${name} requires a directory`);
  return resolve(args[index+1]);
}
const root=arg('--resources',join(project,'src-tauri','resources'));
const sdk=arg('--gst');
const msys=arg('--msys-bin');
function score(path,requirements) {
  if(!path||!existsSync(path))return {available:false,reason:path?`missing: ${path}`:'not supplied'};
  try {
    const pe=parsePE(readFileSync(path));
    if(!pe.pe64)return {available:true,reason:'not a 64-bit PE'};
    const missing=[];
    for(const [module,symbols] of requirements)for(const symbol of symbols) {
      if(!symbol.startsWith('#')&&!pe.exports.has(symbol))missing.push(`${module} -> ${symbol}`);
    }
    return {available:true,missing};
  }catch(err){return {available:true,reason:`invalid PE: ${err.message}`};}
}
try {
  const manifestFile=join(root,'native-manifest.json');
  if(!existsSync(manifestFile))throw Error(`Missing native manifest: ${manifestFile}`);
  const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));
  if(!manifest.ready||manifest.os!=='win32'||manifest.arch!=='x64')throw Error('Requires a ready, staged Windows x64 native manifest');
  const imported=collectCrtImports(root,manifest);
  const audit=auditPackagedCxxAbi(root,manifest);
  console.log(`[cxx] Packaged native modules: ${audit.modulesChecked}`);
  console.log(`[cxx] Full packaged import/export check: ${audit.ok?'PASS':`BLOCKED (${audit.problems.length} unresolved imports)`}`);
  for(const issue of audit.problems.slice(0,12))console.log(`  ${issue}`);
  if(audit.problems.length>12)console.log(`  ... ${audit.problems.length-12} more`);
  for(const dll of ['libstdc++-6.dll','libwinpthread-1.dll']){
    const required=imported.get(dll);
    console.log(`\n[cxx] ${dll}: ${required.size} importing modules`);
    for(const [name,bin] of [
      ['packaged',join(root,'gstreamer','bin',dll)],
      ['GStreamer SDK',sdk?join(sdk,'bin',dll):null],
      ['MSYS2 MINGW64',msys?join(msys,dll):null],
    ]) {
      const result=score(bin,required);
      if(!result.available||result.reason)console.log(`  ${name}: ${result.reason}`);
      else console.log(`  ${name}: ${result.missing.length===0?'PASS':`MISSING ${result.missing.length} imports`}`);
      if(result.missing?.length)for(const line of result.missing.slice(0,6))console.log(`    ${line}`);
    }
  }
  if(!audit.ok){
    console.error('\nBLOCKED: Current staged runtime is incompatible. Do not build a release installer from this native tree.');
    process.exitCode=2;
  }
} catch(e){console.error(`BLOCKED: ${e.message}`);process.exitCode=2;}
