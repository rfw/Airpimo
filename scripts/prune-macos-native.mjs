#!/usr/bin/env node
/** Select only AirPlay-relevant macOS GStreamer plugins and their complete
 * Mach-O transitive dependency closure. Unknown reachable dependencies fail
 * closed; never remove the relocator/auditor's checks or rewrite Homebrew.
 *
 * Source plugin selection uses the actual gst-inspect element-to-plugin map,
 * rather than guessing .dylib names from a specific GStreamer release.
 */
import {existsSync, readFileSync, writeFileSync, unlinkSync, realpathSync} from 'node:fs';
import {resolve, join, basename, dirname, relative, sep, isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isMachO,parseLibraries} from './audit-macos-native.mjs';

// UxPlay mirrors H.264/AAC, uses appsrc and conversion/balance elements, and
// chooses a macOS audio/video sink. Preserve the known software and macOS
// hardware playback alternatives, not arbitrary Homebrew plugins.
export const REQUIRED_ELEMENTS=Object.freeze([
  'appsrc','queue','h264parse','avdec_h264','avdec_aac','videoconvert',
  'videobalance','textoverlay','audioconvert','audioresample','volume','level','decodebin',
  'autovideosink','autoaudiosink','osxaudiosink',
]);
export const OPTIONAL_ELEMENTS=Object.freeze([
  'glimagesink','osxvideosink','vtdec','videorate','typefind',
  'aacparse','alacparse','audiorate','fpsdisplaysink',
]);
const VIDEO_SINKS=['glimagesink','osxvideosink'];
const ENTRY=/^(sidecar|gstreamer)\/[A-Za-z0-9_.+@()/-]+$/;
const SYS=name=>name.startsWith('/usr/lib/')||name.startsWith('/System/Library/');
function runChecked(run,tool,args) {
  const r=run(tool,args,{encoding:'utf8',timeout:20000,maxBuffer:16*1024*1024});
  return r && !r.error && r.status===0?r:null;
}
function within(root,target) {
  const rel=relative(root,target);
  return rel==='' || (rel!=='..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}
function pluginFromInspect(output) {
  const match=output.match(/^\s*Filename\s+(.+?)\s*$/m);
  if(!match || !/\.(?:so|dylib)$/i.test(match[1]))return null;
  return basename(match[1]);
}
export function planMacPrune(resources,{gst,run=spawnSync,manifest}={}) {
  const root=realpathSync(resolve(resources));
  const prefix=resolve(gst??'');
  const data=manifest??JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
  if(data.os!=='darwin'||data.ready!==true)throw Error('Expected a ready macOS native manifest');
  if(!gst || !existsSync(join(prefix,'bin','gst-inspect-1.0')))
    throw Error('Missing source GStreamer inspector: supply --gst /opt/homebrew or /usr/local');
  const failures=[];
  const paths=new Map();
  const dylibs=new Map();
  const plugins=new Map();
  for(const item of data.files??[]) {
    const name=item.path;
    if(typeof name!=='string'||!ENTRY.test(name)||name.split('/').includes('..')||paths.has(name))
      throw Error(`Invalid or duplicate staged manifest path: ${String(name)}`);
    const full=join(root,name);
    if(!existsSync(full)||!within(root,realpathSync(full)))throw Error(`Unsafe/missing staged asset: ${name}`);
    paths.set(name,full);
    if(name.startsWith('gstreamer/lib/gstreamer-1.0/')) {
      const key=basename(name);
      if(plugins.has(key))throw Error(`Ambiguous plugin filename: ${key}`);
      plugins.set(key,name);
    }
    if(isMachO(full)) {
      const key=basename(name);
      const matching=dylibs.get(key)??[];
      matching.push(name);
      dylibs.set(key,matching);
    }
  }
  const inspector=join(prefix,'bin','gst-inspect-1.0');
  const selected=new Set();
  const provided=[];
  const unavailable=[];
  for(const element of [...REQUIRED_ELEMENTS,...OPTIONAL_ELEMENTS]) {
    const result=runChecked(run,inspector,[element]);
    const plugin=result?pluginFromInspect(result.stdout??''):null;
    if(!plugin || !plugins.has(plugin)) {
      if(REQUIRED_ELEMENTS.includes(element))failures.push(`Missing required GStreamer element/plugin: ${element} (${plugin??'not reported'})`);
      else unavailable.push(element);
      continue;
    }
    selected.add(plugins.get(plugin));
    provided.push(element);
  }
  if(!VIDEO_SINKS.some(element=>provided.includes(element)))
    failures.push('No macOS video sink (glimagesink/osxvideosink) was found in the staged runtime');
  const roots=['sidecar/uxplay','gstreamer/bin/gst-inspect-1.0',
    paths.has('gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner')
      ?'gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner'
      :'gstreamer/bin/gst-plugin-scanner',...selected];
  for(const name of roots)if(!paths.has(name))failures.push(`Missing mandatory packaged entry: ${name}`);

  const retained=new Set();
  const queue=[...roots];
  while(queue.length) {
    const name=queue.shift();
    if(retained.has(name)||!paths.has(name))continue;
    retained.add(name);
    const full=paths.get(name);
    if(!isMachO(full)) {
      failures.push(`Required runtime is not Mach-O: ${name}`);
      continue;
    }
    const output=runChecked(run,'otool',['-L',full]);
    if(!output) {failures.push(`Cannot inspect Mach-O dependencies: ${name}`);continue;}
    const libs=parseLibraries(output.stdout??'');
    for(let i=0;i<libs.length;i++) {
      const dep=libs[i],leaf=basename(dep);
      if(SYS(dep))continue;
      // First `otool -L` item for a dylib is its LC_ID_DYLIB.
      if(i===0 && name.endsWith('.dylib') && basename(name)===leaf)continue;
      const options=dylibs.get(leaf)??[];
      // Do not silently choose one of two identically named libraries.
      if(options.length!==1) {
        failures.push(`${name}: ${options.length?'ambiguous':'missing'} staged dependency ${dep}`);
        continue;
      }
      if(!retained.has(options[0]))queue.push(options[0]);
    }
  }
  const removed=[...paths.keys()].filter(name=>!retained.has(name));
  return {
    ok:failures.length===0,problems:failures,
    selectedPlugins:[...selected].sort(),provided,unavailable,
    kept:[...retained].sort(),removed:removed.sort(),total:paths.size,
  };
}

export function applyMacPrune(resources,options={}) {
  const root=realpathSync(resolve(resources));
  const manifestPath=join(root,'native-manifest.json');
  const data=JSON.parse(readFileSync(manifestPath,'utf8'));
  const plan=planMacPrune(root,{...options,manifest:data});
  if(!plan.ok)throw Error(plan.problems.join('\n'));
  const keep=new Set(plan.kept);
  // Fail closed on interruption: the manifest is invalid until new file hashes
  // and selection provenance have been durably recorded.
  writeFileSync(manifestPath,JSON.stringify({...data,ready:false,reason:'mac_runtime_prune_in_progress'},null,2)+'\n');
  for(const name of plan.removed)unlinkSync(join(root,name));
  data.files=data.files.filter(item=>keep.has(item.path));
  data.macRuntimeSelection={strategy:'element-and-macho-closure',elements:plan.provided,plugins:plan.selectedPlugins};
  data.ready=true;
  writeFileSync(manifestPath,JSON.stringify(data,null,2)+'\n');
  return plan;
}

if(process.argv[1] && realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  const at=process.argv.indexOf('--gst');
  const gst=at>=0?process.argv[at+1]:null;
  const dir=process.argv.indexOf('--resources');
  const resources=dir>=0?process.argv[dir+1]:resolve(import.meta.dirname,'../src-tauri/resources');
  try {
    const result=process.argv.includes('--apply')
      ?applyMacPrune(resources,{gst}):planMacPrune(resources,{gst});
    for(const problem of result.problems)console.error('BLOCKED: '+problem);
    console.log(`[mac-runtime] plugins=${result.selectedPlugins.length}, kept=${result.kept.length}, excluded=${result.removed.length}; absent optional elements: ${result.unavailable.join(', ')||'none'}`);
    if(!result.ok)process.exitCode=2;
    else if(process.argv.includes('--apply'))console.log('[mac-runtime] Pruned unrelated Homebrew Mach-O assets; relocation and audit gates remain mandatory.');
    else console.log('[mac-runtime] DRY RUN: use --apply to prune staged COPY');
  } catch(error) {console.error('BLOCKED: macOS runtime selection: '+error.message);process.exitCode=2;}
}
