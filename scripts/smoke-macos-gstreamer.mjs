#!/usr/bin/env node
/** Prove the sealed macOS GStreamer runtime actually loads its required
 * plugins from the staged/app bundle, never from an installed Homebrew SDK.
 * Static Mach-O relocation/audit remain separate mandatory release gates.
 */
import {existsSync, readFileSync, realpathSync, mkdtempSync, rmSync} from 'node:fs';
import {resolve, join, relative, sep, isAbsolute} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {REQUIRED_ELEMENTS} from './prune-macos-native.mjs';

export function smokeMacPackagedGstreamer(resources,{run=spawnSync}={}) {
  const root=realpathSync(resolve(resources));
  const data=JSON.parse(readFileSync(join(root,'native-manifest.json'),'utf8'));
  if(data.os!=='darwin'||!data.ready||!data.relocated)throw Error('Requires relocated ready macOS native manifest');
  const gst=join(root,'gstreamer');
  const inspector=join(gst,'bin','gst-inspect-1.0');
  const scanner=join(gst,'libexec','gstreamer-1.0','gst-plugin-scanner');
  const pluginRoot=join(gst,'lib','gstreamer-1.0');
  if(!existsSync(inspector)||!existsSync(scanner)||!existsSync(pluginRoot))
    throw Error('Bundled inspector, scanner or GStreamer plugins are missing');
  const registry=mkdtempSync(join(tmpdir(),'uxplay-mac-gst-smoke-'));
  try {
    const env={...process.env,
      DYLD_LIBRARY_PATH:[join(gst,'lib'),join(gst,'bin')].join(':'),
      GST_PLUGIN_PATH_1_0:pluginRoot,GST_PLUGIN_SYSTEM_PATH_1_0:'',
      GST_PLUGIN_PATH:pluginRoot,GST_PLUGIN_SYSTEM_PATH:'',
      GST_PLUGIN_SCANNER_1_0:scanner,GST_REGISTRY_1_0:join(registry,'registry.bin'),
    };
    const packagedFiles=new Set((data.files??[]).map(item=>item.path));
    let count=0;
    let workingVideoSinks=0;
    for(const element of [...REQUIRED_ELEMENTS,'glimagesink','osxvideosink']) {
      // At least one video sink must be present; macOS may use either.
      const optionalSink=element==='glimagesink'||element==='osxvideosink';
      const r=run(inspector,[element],{encoding:'utf8',env,timeout:30000,maxBuffer:8*1024*1024});
      if(r?.error||r?.status!==0) {
        if(optionalSink)continue;
        throw Error(`Packaged GStreamer element ${element} failed to load: ${r?.error?.message??r?.stderr??r?.status}`);
      }
      const match=(r.stdout??'').match(/^\s*Filename\s+(.+?)\s*$/m);
      if(!match)throw Error(`Packaged GStreamer element ${element} has no inspectable plugin filename`);
      const file=resolve(match[1]);
      const actual=existsSync(file)?realpathSync(file):null;
      const rel=actual?relative(pluginRoot,actual):null;
      
      if(!actual||rel===''||rel==='..'||rel.startsWith(`..${sep}`)||isAbsolute(rel)||
        !packagedFiles.has(relative(root,actual).split(sep).join('/')))
        throw Error(`GStreamer element ${element} loaded outside packaged plugins or manifest: ${match[1]}`);
      count++;
      if(optionalSink)workingVideoSinks++;
    }
    if(workingVideoSinks===0)
      throw Error('Neither glimagesink nor osxvideosink loads from the packaged runtime');
    return {elementsChecked:count};
  } finally {rmSync(registry,{recursive:true,force:true});}
}

if(process.argv[1]&&realpathSync(process.argv[1])===realpathSync(fileURLToPath(import.meta.url))) {
  if(process.platform!=='darwin') {console.error('BLOCKED: macOS plugin load smoke must run on macOS');process.exitCode=2;}
  else try {
    const at=process.argv.indexOf('--resources');
    const resources=at>=0?process.argv[at+1]:resolve(import.meta.dirname,'../src-tauri/resources');
    const result=smokeMacPackagedGstreamer(resources);
    console.log(`[mac-runtime] PASS: ${result.elementsChecked} packaged GStreamer elements loaded from self-contained runtime`);
  } catch(error) {console.error('BLOCKED: '+error.message);process.exitCode=2;}
}
