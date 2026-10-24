#!/usr/bin/env node
/** Conservative Windows GStreamer runtime pruning.
 * Select codec, conversion, textoverlay and platform sink plugins by gst-inspect
 * from the STAGED tree. Keep the complete PE import closure of those plugins,
 * UxPlay and GStreamer tools. Failure means NO deletions are made. The
 * existing Win7 ABI, C++ exports and real plugin-load release gates still run.
 */
import {existsSync,readFileSync,writeFileSync,realpathSync,unlinkSync,statSync} from 'node:fs';
import {resolve,join,basename,relative,isAbsolute,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parsePE,isSystemDll} from './win7-pe-audit.mjs';

export const REQUIRED=Object.freeze([
  'appsrc','queue','h264parse','avdec_h264','avdec_aac',
  'videoconvert','videobalance','textoverlay','audioconvert','audioresample',
  'volume','level','autovideosink','autoaudiosink'
]);
export const OPTIONAL=Object.freeze([
  'decodebin','typefind','videorate','videoscale','audiomixer','audiointerleave',
  'avdec_alac','alacparse','aacparse','audiorate','fpsdisplaysink',
  'glimagesink','d3d11videosink','d3d12videosink','directdrawsink',
  'directsoundsink','wasapisink','wasapi2sink','waveformsink','dshowvideosink',
  'd3d11convert','d3d11upload','d3d11download','d3d11compositor',
  'fakesink','identity','capsfilter','videoflip'
]);
const prefix='gstreamer/lib/gstreamer-1.0/';
const dllPath=/\.(?:dll|exe)$/i;
function within(root,p){const rel=relative(root,p);return rel===''||(rel!=='..'&&!rel.startsWith(`..${sep}`)&&!isAbsolute(rel));}
function inspectPlugin(output){const match=output.match(/^\s*Filename\s+(.+?)\s*$/mi);return match?match[1].trim().split(/[\\/]/).at(-1).toLowerCase():null;}

export function planWindowsPrune(resources,{manifest,inspect,read=readFileSync,parse=parsePE}={}){
 const root=realpathSync(resolve(resources));
 const data=manifest??JSON.parse(read(join(root,'native-manifest.json'),'utf8'));
 if(data.os!=='win32'||data.arch!=='x64'||!data.ready)throw Error('Only ready Windows x64 native bundles can be pruned');
 const files=new Map(),dlls=new Map(),plugins=new Map(),errors=[],chosen=new Set(),elements=[];
 for(const item of data.files??[]){
   const name=item.path;
   if(typeof name!=='string'||! /^(sidecar|gstreamer)\/[A-Za-z0-9_.+@()/-]+$/.test(name)||name.split('/').includes('..')||files.has(name))throw Error('Invalid or duplicate staged native entry: '+name);
   const full=join(root,...name.split('/'));
   if(!existsSync(full)||!within(root,realpathSync(full))||!statSync(full).isFile())throw Error('Missing/unsafe staged file: '+name);
   files.set(name,full);
   if(name.startsWith(prefix)){
     const key=basename(name).toLowerCase();
     if(plugins.has(key))throw Error('Ambiguous GStreamer plugin basename: '+key);
     plugins.set(key,name);
   }
   if(dllPath.test(name)){
     const key=basename(name).toLowerCase();
     if(!dlls.has(key))dlls.set(key,[]);
     dlls.get(key).push(name);
   }
 }
 if(typeof inspect!=='function')throw Error('A staged gst-inspect executor is required');
 for(const element of [...REQUIRED,...OPTIONAL]){
   let output=null;
   try{output=inspect(element);}catch(error){if(REQUIRED.includes(element))errors.push(`${element}: ${error.message}`);continue;}
   const plugin=output?inspectPlugin(output):null;
   if(!plugin||!plugins.has(plugin)){
     if(REQUIRED.includes(element))errors.push(`Required GStreamer element missing: ${element} (${plugin??'gst-inspect failed'})`);
     continue;
   }
   chosen.add(plugins.get(plugin));elements.push(element);
 }
 // Automatic video/audio sinks discover platform backends at runtime. Keep
 // all known sink plugins when available, never rely on autovideosink alone.
 for(const [key,name] of plugins) if(/(?:d3d11|d3d12|directsound|wasapi|wasapi2|dshow|opengl|glimagesink)/i.test(key)) chosen.add(name);
 const roots=[(data.files?.some(f=>f.path==='sidecar/AirpimoPlayer.exe')?'sidecar/AirpimoPlayer.exe':'sidecar/uxplay.exe'),'gstreamer/bin/gst-inspect-1.0.exe',
   'gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner.exe',...chosen];
 for(const path of roots)if(!files.has(path))errors.push('Required native root missing: '+path);
 const retained=new Set(),queue=roots.filter(path=>files.has(path));
 while(queue.length){
   const name=queue.shift();if(retained.has(name))continue;retained.add(name);
   if(!dllPath.test(name))continue;
   let pe;try{pe=parse(read(files.get(name)));}catch(err){errors.push(`${name}: cannot inspect PE imports: ${err.message}`);continue;}
   if(!pe.pe64)errors.push(`${name}: expected Windows x64 PE`);
   for(const dll of pe.imports.keys()){
     const options=dlls.get(dll.toLowerCase())??[];
     // A DLL can exist both in plugin and main bin; prioritize the runtime's
     // actual bin loader search path instead of silently picking a plugin.
     const binOptions=options.filter(p=>p.startsWith('gstreamer/bin/'));
     const candidates=binOptions.length?binOptions:options;
     if(candidates.length!==1){
       if(candidates.length>1||!isSystemDll(dll.toLowerCase()))errors.push(`${name}: ${candidates.length?'ambiguous':'unbundled'} import ${dll}`);
       continue;
     }
     if(!retained.has(candidates[0]))queue.push(candidates[0]);
   }
 }
 // gst-plugin-scanner and gst-inspect are retained for existing release-time
 // load gates; no runtime DLLs are deleted unless every static edge resolves.
 const removed=[...files.keys()].filter(path=>!retained.has(path));
 const removedBytes=removed.reduce((sum,name)=>sum+statSync(files.get(name)).size,0);
 const keptBytes=[...retained].reduce((sum,name)=>sum+statSync(files.get(name)).size,0);
 return {removedBytes,keptBytes,ok:errors.length===0,problems:[...new Set(errors)].sort(),selectedPlugins:[...chosen].sort(),elements:elements.sort(),
   kept:[...retained].sort(),removed:removed.sort(),total:files.size};
}

export function makeStagedInspector(resources,{run=spawnSync}={}){
 const root=resolve(resources),bin=join(root,'gstreamer','bin'),plugins=join(root,'gstreamer','lib','gstreamer-1.0');
 const scanner=join(root,'gstreamer','libexec','gstreamer-1.0','gst-plugin-scanner.exe');
 const exe=join(bin,'gst-inspect-1.0.exe');
 if(!existsSync(exe)||!existsSync(scanner))throw Error('Windows packaged inspector/scanner missing');
 return element=>{
   const env={...process.env,PATH:`${bin};${process.env.PATH??''}`,GST_PLUGIN_SYSTEM_PATH_1_0:'',GST_PLUGIN_SYSTEM_PATH:'',
     GST_PLUGIN_PATH_1_0:plugins,GST_PLUGIN_PATH:plugins,GST_PLUGIN_SCANNER_1_0:scanner};
   // Avoid rewriting/reading a global registry on the CI runner.
   env.GST_REGISTRY_1_0=join(resolve(process.env.RUNNER_TEMP??process.env.TEMP??bin),`airpimo-prune-${process.pid}.bin`);
   const result=run(exe,[element],{encoding:'utf8',env,timeout:30000,windowsHide:true,maxBuffer:5*1024*1024});
   return !result.error&&result.status===0?result.stdout:null;
 };
}
export function applyWindowsPrune(resources,options={}){
 const root=realpathSync(resolve(resources)),file=join(root,'native-manifest.json');
 const data=JSON.parse(readFileSync(file,'utf8'));
 const plan=planWindowsPrune(root,{...options,manifest:data,inspect:options.inspect??makeStagedInspector(root)});
 if(!plan.ok)throw Error('Windows pruning blocked without deleting files:\n'+plan.problems.join('\n'));
 const keep=new Set(plan.kept);
 // Mark the candidate invalid before deleting. Win7 staging is transactional;
 // a failed candidate is never published over the known-working runtime.
 writeFileSync(file,JSON.stringify({...data,ready:false,reason:'windows_prune_in_progress'},null,2)+'\n');
 for(const name of plan.removed)unlinkSync(join(root,...name.split('/')));
 data.files=data.files.filter(item=>keep.has(item.path));
 data.windowsRuntimeSelection={strategy:'gst-element-pe-import-closure',elements:plan.elements,plugins:plan.selectedPlugins};
 data.ready=true;
 writeFileSync(file,JSON.stringify(data,null,2)+'\n');
 return plan;
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){
 try{
  const at=process.argv.indexOf('--resources');const root=at<0?resolve(import.meta.dirname,'../src-tauri/resources'):resolve(process.argv[at+1]);
  const out=process.argv.includes('--apply')?applyWindowsPrune(root):planWindowsPrune(root,{inspect:makeStagedInspector(root)});
  for(const p of out.problems)console.error('[win-prune] BLOCKED: '+p);
  console.log(`[win-prune] selected ${out.selectedPlugins.length} plugin DLLs, kept ${out.kept.length}/${out.total} native files, removed ${out.removed.length}; excluded ${(out.removedBytes/1048576).toFixed(1)} MiB uncompressed`);
  if(!out.ok)process.exitCode=2;
  else if(!process.argv.includes('--apply'))console.log('[win-prune] DRY RUN; pass --apply only to prune a verified staging copy');
 }catch(error){console.error('[win-prune] BLOCKED: '+error.message);process.exitCode=2;}
}
