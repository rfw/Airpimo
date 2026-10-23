#!/usr/bin/env node
/** Prepare a pinned UxPlay binary plus a matching GStreamer runtime.
 * Win7 staging is transactional: never replace a working staged runtime with a
 * candidate that fails the PE ABI gate or actual build-host plugin load test.
 */
import {existsSync, mkdirSync, renameSync, rmSync, cpSync, readdirSync, lstatSync, copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {LOCK,PROJECT_ROOT,verifiedCachedEngine,RENDERER_PATCH_SHA256} from './native-engine-core.mjs';
import {alignWin7Runtime,smokeWin7Plugins} from './win7-runtime-align.mjs';
import {verifyNativeTree} from './native-bundle-core.mjs';
import {readFileSync} from 'node:fs';
import {readMdnsLock,verifyMdnsReceipt} from './win7-mdns-core.mjs';
import {readWin7GstSdkVersion} from './ci/gst-sdk-version.mjs';
import {applyWindowsPrune} from './prune-windows-native.mjs';
const args=process.argv.slice(2);
function option(flag){const i=args.indexOf(flag);return i<0?null:args[i+1]}
const win7=args.includes('--win7');
const gst=option('--gst')??process.env.UXPLAY_GST_RUNTIME??(process.platform==='darwin'?'/Library/Frameworks/GStreamer.framework/Versions/1.0':process.platform==='win32'?'C:\\msys64\\mingw64':null);
const dllSource=option('--dll-source');
const gstScanner=option('--gst-scanner');
const mdnsReceiptFile=option('--mdns-receipt');
function blocked(message){console.error(`[native-stage] BLOCKED: ${message}`);process.exitCode=2;}

/**
 * Mirror a verified native tree without renaming its root directory. Windows
 * sometimes rejects a directory rename while editors, scanners or filesystem
 * filters hold a directory handle, even when the individual files are writable.
 *
 * Only used after a complete backup has been created. No path outside the
 * sidecar/gstreamer staging roots is changed. The caller verifies hashes after
 * the last manifest write.
 */
function mirrorNativeDirectory(source,target,{copyFile=copyFileSync}={}) {
  const sourceType=lstatSync(source);
  if(!sourceType.isDirectory()||sourceType.isSymbolicLink()) throw Error(`Expected an ordinary native directory: ${source}`);
  if(existsSync(target) && !lstatSync(target).isDirectory()) rmSync(target,{recursive:true,force:true});
  mkdirSync(target,{recursive:true});
  const sourceEntries=new Map(readdirSync(source,{withFileTypes:true}).map(item=>[item.name,item]));
  for(const item of readdirSync(target,{withFileTypes:true})) {
    if(!sourceEntries.has(item.name)) rmSync(join(target,item.name),{recursive:true,force:true});
  }
  for(const [name,entry] of sourceEntries) {
    if(entry.isSymbolicLink()||!(entry.isFile()||entry.isDirectory()))throw Error(`Unsupported native filesystem entry: ${join(source,name)}`);
    const from=join(source,name),to=join(target,name);
    if(entry.isDirectory()) mirrorNativeDirectory(from,to,{copyFile});
    else {
      if(existsSync(to)&&!lstatSync(to).isFile()) rmSync(to,{recursive:true,force:true});
      copyFile(from,to);
    }
  }
}

function promoteByFileMirror(candidate,destination,{copyFile=copyFileSync}={}) {
  const names=['sidecar','gstreamer','native-manifest.json'];
  const backups=join(candidate,'old-resources-backup');
  const previous=new Set(names.filter(name=>existsSync(join(destination,name))));
  // Complete the backup before mutating any destination file. If the update
  // is interrupted abruptly, the candidate and its backup remain on disk.
  for(const name of previous) cpSync(join(destination,name),join(backups,name),{recursive:true,force:false,errorOnExist:true});
  try {
    for(const name of ['sidecar','gstreamer']) mirrorNativeDirectory(join(candidate,name),join(destination,name),{copyFile});
    // Publish the new manifest last, after all corresponding payload files.
    copyFile(join(candidate,'native-manifest.json'),join(destination,'native-manifest.json'));
    verifyNativeTree(destination);
  } catch(error) {
    const rollbackErrors=[];
    // Restore the original manifest last, after restoring both binary trees.
    for(const name of ['sidecar','gstreamer']) {
      try {
        if(previous.has(name)) mirrorNativeDirectory(join(backups,name),join(destination,name),{copyFile});
        else rmSync(join(destination,name),{recursive:true,force:true});
      } catch(restoreError) {rollbackErrors.push(`${name}: ${restoreError.message}`);}
    }
    try {
      if(previous.has('native-manifest.json'))copyFile(join(backups,'native-manifest.json'),join(destination,'native-manifest.json'));
      else rmSync(join(destination,'native-manifest.json'),{force:true});
    } catch(restoreError) {rollbackErrors.push(`native-manifest.json: ${restoreError.message}`);}
    if(rollbackErrors.length) {
      const fatal=Error(`Fallback promotion failed: ${error.message}. Recovery also failed: ${rollbackErrors.join('; ')}. Preserve recovery files at ${backups}`);
      fatal.preserveCandidate=true;
      throw fatal;
    }
    throw Error(`Fallback promotion failed; old native resources restored: ${error.message}`);
  }
  console.log('[win7] Windows-safe file-level promotion succeeded; SHA-256/native manifest verified.');
}

/**
 * Prefer same-volume directory renames, preserving native resources as a unit.
 * If Windows refuses a rename, restore any already moved directories before
 * falling back to a backed-up, verified in-place file update.
 * Note: unlike directory swapping, in-place copying is not power-loss atomic.
 */
export function promoteNativeCandidate(candidate,destination,{
  rename=renameSync,copyFile=copyFileSync,allowInPlaceFallback=process.platform==='win32',
}={}) {
  const names=['sidecar','gstreamer','native-manifest.json'];
  const backups=join(candidate,'old-resources-backup');
  mkdirSync(destination,{recursive:true});
  mkdirSync(backups,{recursive:true});
  // Fail before touching existing resources if staging is incomplete.
  for(const name of names) {
    if(!existsSync(join(candidate,name)))throw Error(`Native candidate is missing ${name}`);
  }
  const movedOld=[],movedNew=[];
  try {
    for(const name of names) {
      const old=join(destination,name);
      if(existsSync(old)) {rename(old,join(backups,name));movedOld.push(name);}
    }
    for(const name of names) {rename(join(candidate,name),join(destination,name));movedNew.push(name);}
    return;
  } catch(error) {
    const recoveryErrors=[];
    for(const name of [...movedNew].reverse()) {
      try {rename(join(destination,name),join(candidate,name));}
      catch(recoveryError){recoveryErrors.push(`new ${name}: ${recoveryError.message}`);}
    }
    for(const name of [...movedOld].reverse()) {
      try {rename(join(backups,name),join(destination,name));}
      catch(recoveryError){recoveryErrors.push(`old ${name}: ${recoveryError.message}`);}
    }
    if(recoveryErrors.length) {
      const fatal=Error(`Directory promotion failed: ${error.message}; rollback incomplete: ${recoveryErrors.join('; ')}. Recovery files at ${backups}`);
      fatal.preserveCandidate=true;
      throw fatal;
    }
    if(!allowInPlaceFallback||!['EPERM','EACCES','EBUSY'].includes(error.code))throw error;
    console.warn(`[win7] Native directory rename blocked (${error.code}); trying backed-up file-level promotion.`);
    return promoteByFileMirror(candidate,destination,{copyFile});
  }
}

function main() {
  if(gstScanner && process.platform!=='darwin')throw Error('--gst-scanner is supported only on macOS');
  if(win7 && (process.platform!=='win32'||process.arch!=='x64'))throw Error('--win7 requires a Windows x64 build host');
  if(win7 && !dllSource) throw Error('--win7 requires --dll-source "C:\\msys64\\mingw64\\bin" (the same toolchain that built cached uxplay.exe)');
  if(!win7 && dllSource)throw Error('--dll-source is allowed only with --win7 to prevent unexpected runtime mixing');
  if(mdnsReceiptFile && !win7)throw Error('--mdns-receipt requires --win7');
  let bin=verifiedCachedEngine();
  let mdnsLock=null;
  if(mdnsReceiptFile) {
    mdnsLock=readMdnsLock();
    const receipt=JSON.parse(readFileSync(resolve(mdnsReceiptFile),'utf8'));
    if(typeof receipt.binary!=='string')throw Error('Internal-mDNS receipt has no executable path');
    bin=resolve(receipt.binary);
    verifyMdnsReceipt(receipt,{lock:mdnsLock,binary:bin});
    console.log(`[win7] Pinned experimental internal-mDNS engine verified: ${mdnsLock.commit}`);
  }
  if(!bin)throw Error('No verified engine. Build pinned UxPlay with native:prepare, or build the 1.74 internal-mDNS candidate first');
  if(!gst||!existsSync(gst))throw Error(`Missing GStreamer runtime ${gst??'unspecified'}. Supply --gst with absolute SDK root`);
  const inspector=join(gst,'bin',process.platform==='win32'?'gst-inspect-1.0.exe':'gst-inspect-1.0');
  if(!existsSync(inspector))throw Error('Missing gst-inspect in GStreamer SDK bin');
  // The unaligned SDK process may hang before the transactional Win7 stage.
  // Validate BOTH installed SDK metadata sources, then let the staged plugin
  // smoke and full ABI checks prove the actual selected DLL set works.
  let gstVersion;
  if(win7) {
    gstVersion=readWin7GstSdkVersion(gst);
    console.log(`[win7] Cross-checked GStreamer SDK pkg-config/header: ${gstVersion} (no pre-staging SDK executable launched)`);
  } else {
    const env={...process.env,PATH:[join(gst,'bin'),process.env.PATH??''].join(process.platform==='win32'?';':':')};
    const probe=spawnSync(inspector,['--version'],{encoding:'utf8',timeout:10000,env});
    if(probe.error||probe.status!==0)throw Error(`GStreamer version probe failed: ${probe.error?.message??probe.stderr??probe.status}`);
    const match=probe.stdout.match(/\b([1-9]\d*\.\d+\.\d+)\b/);
    if(!match)throw Error('Could not extract GStreamer version');
    gstVersion=match[1];
  }
  const candidate=win7?join(PROJECT_ROOT,'src-tauri',`.win7-native-candidate-${process.pid}`):null;
  if(candidate) {if(existsSync(candidate))throw Error(`Candidate staging directory already exists: ${candidate}`);mkdirSync(candidate,{recursive:true});}
  let preserveCandidate=false;
  try {
    const command=['scripts/stage-native.mjs','--uxplay',bin,'--gst',resolve(gst),'--os',process.platform,'--arch',process.arch,'--upstream-commit',mdnsLock?.commit??LOCK.commit,'--gst-version',gstVersion];
    if(!mdnsLock)command.push('--renderer-patch-sha256',RENDERER_PATCH_SHA256);
    if(gstScanner)command.push('--gst-scanner',resolve(gstScanner));
    if(mdnsLock)command.push('--discovery-backend','internal-mdns','--mdns-receipt',resolve(mdnsReceiptFile));
    if(candidate)command.push('--destination',candidate);
    const result=spawnSync(process.execPath,command,{cwd:PROJECT_ROOT,stdio:'inherit'});
    if(result.error||result.status!==0)throw Error(`Native staging failed: ${result.error?.message??`exit ${result.status}`}`);
    if(candidate) {
      const aligned=alignWin7Runtime(candidate,resolve(dllSource));
      console.log(`[win7] Paired MSYS2 engine runtime and resolved mandatory DLLs: ${aligned.changed.join(', ')||'none'}`);
      console.log(`[win7] Static ABI check PASS (${aligned.inspected} PE dependency nodes)`);
      const pruned=applyWindowsPrune(candidate);
      console.log(`[win-runtime] Selected ${pruned.selectedPlugins.length} plugin DLLs; excluded ${pruned.removed.length} unused native assets (${(pruned.removedBytes/1048576).toFixed(1)} MiB uncompressed)`);
      smokeWin7Plugins(candidate);
      console.log('[win7] Build-host GStreamer libav/H.264/AAC plugin smoke PASS');
      promoteNativeCandidate(candidate,join(PROJECT_ROOT,'src-tauri','resources'));
    } else if(process.platform==='win32') {
      const pruned=applyWindowsPrune(join(PROJECT_ROOT,'src-tauri','resources'));
      console.log(`[win-runtime] Selected ${pruned.selectedPlugins.length} plugin DLLs; excluded ${pruned.removed.length} unused native assets (${(pruned.removedBytes/1048576).toFixed(1)} MiB uncompressed)`);
    }
    console.log('Staging complete. Independent Windows 7 SP1 clean-host AirPlay/mDNS test is still mandatory.');
  } catch(error) {
    preserveCandidate=Boolean(error.preserveCandidate);
    throw error;
  } finally {
    if(candidate&&!preserveCandidate)rmSync(candidate,{recursive:true,force:true});
    if(candidate&&preserveCandidate)console.error(`[win7] Kept native candidate and backup for manual recovery: ${candidate}`);
  }
}

// Allow imports from deterministic tests without starting a real platform build.
if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  try{main();}catch(err){blocked(err.message);}
}
