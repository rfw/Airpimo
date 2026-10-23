#!/usr/bin/env node
/** Stage a VERIFIED native runtime from a trusted self-hosted machine's local checkout.
 * No GitHub Release assets, no network downloads, no silently rebuilt native DLLs.
 * Source directory must be an existing src-tauri/ directory outside this checkout.
 */
import {existsSync, realpathSync, lstatSync, mkdirSync, copyFileSync, cpSync, rmSync, renameSync, readdirSync, chmodSync} from 'node:fs';
import {resolve, join, dirname, relative, isAbsolute, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyNativeTree} from './native-bundle-core.mjs';
import {readMdnsLock, verifyMdnsManifest} from './win7-mdns-core.mjs';

const projectRoot=resolve(import.meta.dirname,'..');
const buildTauri=join(projectRoot,'src-tauri');
const targetMap={win7:{platform:'win32',arch:'x64',webview:true},win10plus:{platform:'win32',arch:'x64',webview:false},'macos-x64':{platform:'darwin',arch:'x64',webview:false},'macos-arm64':{platform:'darwin',arch:'arm64',webview:false}};
const inside=(root,file)=>{const r=relative(root,file);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
function assert(condition,message){if(!condition)throw Error(message);}
function safeFile(root,name){
  const file=join(root,...name.split('/'));
  assert(existsSync(file) && lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(),`Missing or symlinked native asset: ${name}`);
  assert(inside(root,realpathSync(file)),`Native asset escapes source tree: ${name}`);
  return file;
}
function checkWebviewTree(root){
  const exe=join(root,'msedgewebview2.exe');
  assert(existsSync(exe)&&lstatSync(exe).isFile(),'WebView2 fixedRuntime root must directly contain msedgewebview2.exe');
  function visit(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){
    assert(!entry.isSymbolicLink(),`WebView2 symlink forbidden: ${entry.name}`);
    assert(entry.isFile()||entry.isDirectory(),`Unexpected WebView2 file: ${entry.name}`);
    if(entry.isDirectory())visit(join(dir,entry.name));
  }}
  visit(root);
}
export function stageSelfHosted(sourceTauri, target, {destinationTauri=buildTauri, platform=process.platform,arch=process.arch}={}){
  const spec=targetMap[target];assert(spec,`Unknown release target: ${target}`);
  assert(spec.platform===platform&&spec.arch===arch,`Target ${target} requires ${spec.platform}/${spec.arch}; current host is ${platform}/${arch}`);
  assert(typeof sourceTauri==='string'&&isAbsolute(sourceTauri),'--source must be an absolute local src-tauri path');
  const source=realpathSync(resolve(sourceTauri));
  // Resolve existing ancestors as well: /var -> /private/var is the same
  // location on macOS, even when a future destination leaf does not exist.
  const requested=resolve(destinationTauri);
  let ancestor=requested;
  const suffix=[];
  while(!existsSync(ancestor)) {
    const parent=dirname(ancestor);
    if(parent===ancestor) throw Error('Cannot resolve self-hosted destination');
    suffix.unshift(ancestor.slice(parent.length).replace(/^[/\\]/,''));
    ancestor=parent;
  }
  const destination=resolve(realpathSync(ancestor),...suffix);
  assert(!inside(source,destination)&&!inside(destination,source),'Self-hosted asset source must be outside the GitHub Actions checkout');
  const sourceResources=join(source,'resources');
  const manifest=verifyNativeTree(sourceResources,{platform,arch});
  if(platform==='win32'){
    assert(manifest.discovery?.backend==='internal-mdns','Windows release requires pinned internal-mDNS runtime; legacy Bonjour engine is not permitted');
    verifyMdnsManifest(manifest,{lock:readMdnsLock()});
  }
  let webviewSource;
  if(spec.webview){webviewSource=join(source,'webview2-109');checkWebviewTree(webviewSource);}
  const pending=join(destination,`.ci-native-pending-${process.pid}`);
  assert(!existsSync(pending),'Self-hosted staging directory already exists');
  try{
    mkdirSync(pending,{recursive:true});
    for(const asset of manifest.files){
      const from=safeFile(sourceResources,asset.path);
      const to=join(pending,...asset.path.split('/'));
      mkdirSync(dirname(to),{recursive:true});
      copyFileSync(from,to);
      if(platform==='darwin'&&asset.path.startsWith('sidecar/'))chmodSync(to,0o755);
    }
    copyFileSync(safeFile(sourceResources,'native-manifest.json'),join(pending,'native-manifest.json'));
    verifyNativeTree(pending,{platform,arch});
    // The GitHub Actions checkout is disposable. Never mutate the machine's audited source.
    const dst=join(destination,'resources');
    rmSync(dst,{recursive:true,force:true});
    renameSync(pending,dst);
    if(spec.webview){
      const webDst=join(destination,'webview2-109');
      rmSync(webDst,{recursive:true,force:true});
      cpSync(webviewSource,webDst,{recursive:true,force:true,dereference:false});
      checkWebviewTree(webDst);
    }
    return {files:manifest.files.length,backend:manifest.discovery?.backend??'external-dnssd',webview:spec.webview};
  }finally{rmSync(pending,{recursive:true,force:true});}
}
const asEntrypoint=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(asEntrypoint){
  const args=process.argv.slice(2);
  const param=(name)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
  try {
    const result=stageSelfHosted(param('--source'),param('--target'));
    console.log(`[selfhost] PASS: ${result.files} verified native files, backend=${result.backend}, WebView2 fixed=${result.webview}`);
    console.log('[selfhost] Host asset staging is not an OS compatibility certification; native ABI, playback and installer tests still required.');
  }catch(e){console.error(`[selfhost] BLOCKED: ${e.message}`);process.exitCode=2;}
}
