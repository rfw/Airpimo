/**
 * Reconcile a pinned MSYS2/MINGW64-built UxPlay sidecar with a separate
 * candidate MinGW GStreamer SDK. This runs on the Windows BUILD HOST only.
 * Never overwrite arbitrary GStreamer media DLLs to silence an ABI error.
 */
import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {basename, join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {auditWin7Runtime, parsePE} from './win7-pe-audit.mjs';
import {selectCompatibleStdCxx, auditPackagedCxxAbi} from './win7-cxx-abi.mjs';

// These two runtime DLLs MUST come from the SAME compiler environment as uxplay.exe.
// Other DLLs are only added when the hard-import graph proves they are required.
export const ENGINE_CRT = Object.freeze(['libstdc++-6.dll', 'libwinpthread-1.dll']);

function dllIndex(folder) {
  if(!existsSync(folder)) throw Error(`DLL source directory does not exist: ${folder}`);
  const out=new Map();
  for(const item of readdirSync(folder,{withFileTypes:true})) {
    if(item.isFile() && item.name.toLowerCase().endsWith('.dll')) {
      const key=item.name.toLowerCase();
      if(out.has(key)) throw Error(`Case-colliding DLL files in ${folder}: ${item.name}`);
      out.set(key,join(folder,item.name));
    }
  }
  return out;
}
function checkedCopy(name, sourceIndex, destination, {replace=false}={}) {
  const src=sourceIndex.get(name.toLowerCase());
  if(!src) throw Error(`Missing ${name} in toolchain DLL source; use the MINGW64 bin that built the cached uxplay.exe`);
  const bytes=readFileSync(src);
  const pe=parsePE(bytes);
  if(!pe.pe64) throw Error(`DLL source ${src} is not a 64-bit PE`);
  const target=join(destination,name);
  if(existsSync(target) && !replace) return false;
  copyFileSync(src,target);
  return true;
}

export function refreshNativeManifest(root) {
  const file=join(root,'native-manifest.json');
  const manifest=JSON.parse(readFileSync(file,'utf8'));
  const included=new Map(manifest.files.map(item=>[item.path,item]));
  const dllBin=join(root,'gstreamer','bin');
  for(const entry of readdirSync(dllBin,{withFileTypes:true})) {
    if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.dll')) continue;
    const path=`gstreamer/bin/${entry.name}`;
    const sha256=createHash('sha256').update(readFileSync(join(dllBin,entry.name))).digest('hex');
    included.set(path,{path,sha256});
  }
  manifest.files=[...included.values()].sort((a,b)=>a.path.localeCompare(b.path));
  writeFileSync(file,JSON.stringify(manifest,null,2)+'\n');
  return manifest;
}

/**
 * Fix ONLY verified engine runtime gaps. Fail closed when another GStreamer
 * component is incompatible, or when a DLL itself uses unsupported Win7 APIs.
 * The caller must operate on a throwaway candidate staging directory.
 */
export function alignWin7Runtime(root, dllSource, {report=auditWin7Runtime}={}) {
  const sourceIndex=dllIndex(resolve(dllSource));
  const destination=join(root,'gstreamer','bin');
  if(!existsSync(destination)) throw Error('Staged gstreamer/bin directory missing');
  const changed=[];
  let manifest=refreshNativeManifest(root);
  // Never overwrite the SDK's libstdc++ with MSYS2's before checking all
  // optional GStreamer plug-ins (D3D11, QSV, NVCodec, etc.).
  const selected=selectCompatibleStdCxx(root,manifest,sourceIndex.get('libstdc++-6.dll'));
  if(selected.kind==='msys2') {
    checkedCopy('libstdc++-6.dll',sourceIndex,destination,{replace:true});
    changed.push('compatible engine CRT: libstdc++-6.dll (MSYS2)');
  } else changed.push('compatible SDK CRT: libstdc++-6.dll (preserved)');
  if(checkedCopy('libwinpthread-1.dll',sourceIndex,destination,{replace:true})) changed.push('paired CRT: libwinpthread-1.dll');
  manifest=refreshNativeManifest(root);
  const copied=new Set();
  for(let round=0;round<100;round++) {
    const result=report(root,manifest);
    if(result.ok) {
      const cxx=auditPackagedCxxAbi(root,manifest);
      if(!cxx.ok) throw Error(`Windows GStreamer C++ import/export mismatch (${cxx.modulesChecked} modules):\n${cxx.problems.slice(0,24).join('\n')}`);
      return {manifest,changed,inspected:result.inspected};
    }
    const missing=result.problems.filter(p=>p.startsWith('unbundled dependency: '));
    const other=result.problems.filter(p=>!p.startsWith('unbundled dependency: '));
    if(other.length) throw Error(`Win7 ABI gate still rejects ${other.length} issue(s):\n${other.join('\n')}`);
    if(!missing.length) throw Error('Win7 ABI gate has no resolvable DLL imports');
    let progress=0;
    for(const issue of missing) {
      const name=issue.split(' -> ').at(-1).toLowerCase();
      if(!/^[a-z0-9_.+-]+\.dll$/.test(name)) throw Error(`Unsafe/malformed missing DLL name: ${name}`);
      if(copied.has(name)) throw Error(`Recursive dependency resolution stalled on ${name}`);
      if(checkedCopy(name,sourceIndex,destination)) {
        changed.push(`transitive dependency: ${name}`);progress++;
      }
      copied.add(name);
    }
    if(!progress) throw Error(`No progress resolving mandatory DLLs:\n${missing.join('\n')}`);
    manifest=refreshNativeManifest(root);
  }
  throw Error('DLL dependency expansion exceeded 100 rounds');
}

/** Perform an actual host-side GStreamer plugin load; ABI scan alone is insufficient. */
export function smokeWin7Plugins(root,{run=spawnSync,host=process.platform,env=process.env}={}) {
  if(host!=='win32') throw Error('Plugin load smoke requires Windows x64 build host');
  const gst=join(root,'gstreamer'),bin=join(gst,'bin');
  const inspector=join(bin,'gst-inspect-1.0.exe');
  const pluginDir=join(gst,'lib','gstreamer-1.0');
  const scanner=join(gst,'libexec','gstreamer-1.0','gst-plugin-scanner.exe');
  for(const f of [inspector,scanner]) if(!existsSync(f)) throw Error(`Required GStreamer binary missing: ${f}`);
  const registryFolder=join(tmpdir(),`uxplay-win7-gst-${process.pid}-${Date.now()}`);
  mkdirSync(registryFolder,{recursive:true});
  const runtimeEnv={...env,
    PATH:[bin,env.PATH??''].join(';'),
    GST_PLUGIN_SYSTEM_PATH_1_0:pluginDir,
    GST_PLUGIN_PATH_1_0:pluginDir,
    GST_PLUGIN_SYSTEM_PATH:'',
    GST_PLUGIN_PATH:pluginDir,
    GST_PLUGIN_SCANNER_1_0:scanner,
    GST_REGISTRY_1_0:join(registryFolder,'registry.bin'),
  };
  try {
    for(const element of ['libav','avdec_h264','avdec_aac']) {
      const result=run(inspector,[element],{encoding:'utf8',env:runtimeEnv,timeout:30000,windowsHide:true});
      if(result.error||result.status!==0) {
        // Rerun only a failing probe without registry forking to expose the actual
        // plugin module load error instead of an unhelpful 'No such element'.
        const debugEnv={...runtimeEnv, GST_REGISTRY_FORK:'no', GST_DEBUG:'GST_PLUGIN_LOADING:4,*:2', GST_DEBUG_NO_COLOR:'1',
          GST_REGISTRY_1_0:join(registryFolder,'debug-registry.bin')};
        const debug=run(inspector,[element],{encoding:'utf8',env:debugEnv,timeout:30000,windowsHide:true});
        const diagnostic=[result.stderr,result.stdout,result.error?.message,debug.stderr,debug.stdout,debug.error?.message].filter(Boolean).join('\n').slice(-5000);
        throw Error(`GStreamer ${element} plugin load failed on build host (${result.status??'error'}):\n${diagnostic||'No diagnostic output'}\nDo not publish this runtime; inspect the matching GStreamer 1.24 libav/FFmpeg dependencies.`);
      }
    }
    return true;
  } finally {rmSync(registryFolder,{recursive:true,force:true});}
}
