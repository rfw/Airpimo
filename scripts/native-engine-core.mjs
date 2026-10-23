/** One authoritative, commit-pinned native UxPlay engine cache. No shell execution from React. */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync, chmodSync, realpathSync, renameSync, rmSync} from 'node:fs';
import {homedir} from 'node:os';
import {join, resolve, isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {applyRendererPatch} from '../native/patches/renderer-lifetime.mjs';
import {applyAudioEmptyPacketPatch} from '../native/patches/audio-empty-packets.mjs';
import {applyResponsiveWatermarkPatch} from '../native/patches/watermark-auto-size.mjs';

export const PROJECT_ROOT=resolve(fileURLToPath(new URL('..',import.meta.url)));
export const LOCK=JSON.parse(readFileSync(join(PROJECT_ROOT,'native/engine-lock.json'),'utf8'));
const SHA=/^[a-f0-9]{64}$/i;
const COMMIT=/^[a-f0-9]{40}$/i;
const ALLOWED_HOST='https://github.com/FDH2/UxPlay.git';
// Changing the reviewed source transform invalidates every older engine receipt.
// Historical manifest key `rendererPatchSha256` covers ALL reviewed source
// transforms. Keeping this key retains the existing staging/release security
// gates and invalidates all binaries built without the no-data audio fix.
export const RENDERER_PATCH_SHA256=createHash('sha256')
  .update(readFileSync(join(PROJECT_ROOT,'native/patches/renderer-lifetime.mjs')))
  .update('\0')
  .update(readFileSync(join(PROJECT_ROOT,'native/patches/audio-empty-packets.mjs')))
  .update('\0')
  .update(readFileSync(join(PROJECT_ROOT,'native/patches/watermark-auto-size.mjs')))
  .digest('hex');
export function targetId(platform=process.platform,arch=process.arch) {
  const id=`${platform}-${arch}`;
  if(!LOCK.platforms.includes(id)) throw Error(`Unsupported engine target ${id}; Win7 is Windows x64 only`);
  return id;
}
export function engineName(platform=process.platform) {return platform==='win32'?'uxplay.exe':'uxplay';}
export function cacheRoot(env=process.env,home=homedir()) {
  const supplied=env.UXPLAY_NATIVE_CACHE;
  if(supplied && !isAbsolute(supplied)) throw Error('UXPLAY_NATIVE_CACHE must be absolute');
  return supplied ? resolve(supplied) : join(home,'.cache','uxplay-desktop','native');
}
export function engineDir({platform=process.platform,arch=process.arch,env=process.env,home=homedir()}={}) {
  return join(cacheRoot(env,home),targetId(platform,arch),LOCK.commit);
}
export function digest(path) {return createHash('sha256').update(readFileSync(path)).digest('hex');}
export function isBinaryForPlatform(path,platform) {
  if(!existsSync(path)||!statSync(path).isFile())return false;
  const b=readFileSync(path).subarray(0,4);
  return platform==='win32' ? b.subarray(0,2).toString('ascii')==='MZ'
    : ['feedfacf','cffaedfe','cafebabe','bebafeca','feedface','cefaedfe'].includes(b.toString('hex'));
}
export function verifiedCachedEngine(options={}) {
  const platform=options.platform??process.platform;
  const folder=engineDir(options), path=join(folder,engineName(platform));
  const receiptPath=join(folder,'receipt.json');
  try {
    const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
    if(receipt.commit!==LOCK.commit||receipt.rendererPatchSha256!==RENDERER_PATCH_SHA256||receipt.target!==targetId(platform,options.arch??process.arch)||!SHA.test(receipt.sha256))return null;
    if(!isBinaryForPlatform(path,platform)||digest(path)!==receipt.sha256)return null;
    if(platform!=='win32'&&!(statSync(path).mode&0o111))return null;
    return realpathSync(path);
  } catch{return null;}
}
export function storeEngine(source,{platform=process.platform,arch=process.arch,env=process.env,home=homedir(),origin='local-build'}={}) {
  const id=targetId(platform,arch);
  if(!isBinaryForPlatform(source,platform))throw Error(`${source}: not a recognized ${platform} executable`);
  const dir=engineDir({platform,arch,env,home});
  mkdirSync(dir,{recursive:true});
  const target=join(dir,engineName(platform));
  const temp=join(dir,`${engineName(platform)}.incoming-${process.pid}`);
  try {
    copyFileSync(source,temp);
    if(platform!=='win32')chmodSync(temp,0o755);
    const hash=digest(temp);
    renameSync(temp,target);
    const receipt={schema:2,commit:LOCK.commit,rendererPatchSha256:RENDERER_PATCH_SHA256,target:id,sha256:hash,origin};
    writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
    return {binary:realpathSync(target),sha256:hash,receipt};
  } finally {rmSync(temp,{force:true});}
}
export function prebuiltForTarget(id, registry) {
  const item=registry.targets?.[id];
  if(!item)return null;
  if(item.commit!==LOCK.commit||item.rendererPatchSha256!==RENDERER_PATCH_SHA256||!SHA.test(item.sha256)||typeof item.url!=='string') throw Error(`Invalid prebuilt registry for ${id}: exact pinned commit, SHA-256 and HTTPS URL required`);
  const url=new URL(item.url);
  if(url.protocol!=='https:'||url.username||url.password||!url.hostname)throw Error('Prebuilt must use authenticated-reviewed HTTPS artifact URL without URL credentials');
  return item;
}
export async function downloadVerified(url,expectedSha,output,{fetchImpl=fetch}={}) {
  if(!SHA.test(expectedSha))throw Error('Missing strong SHA-256 digest');
  const parsed=new URL(url);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw Error('Unsafe prebuilt URL');
  // Intentionally cap single executable downloads. GStreamer bundles are staged separately.
  const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw Error(`Artifact HTTP ${response.status}`);
  const max=100*1024*1024;
  const claimed=Number(response.headers?.get?.('content-length')||0);
  if(claimed>max)throw Error('Artifact exceeds 100 MB');
  const body=Buffer.from(await response.arrayBuffer());
  if(body.length>max)throw Error('Artifact exceeds 100 MB');
  if(createHash('sha256').update(body).digest('hex')!==expectedSha.toLowerCase())throw Error('Prebuilt SHA-256 mismatch; refusing executable');
  writeFileSync(output,body,{flag:'wx'});
}
export function validateSourceLock(lock=LOCK) {
  if(lock.upstream!==ALLOWED_HOST||!COMMIT.test(lock.commit)||!Array.isArray(lock.buildFlags)||!lock.buildFlags.includes('-DNO_MARCH_NATIVE=ON'))throw Error('Invalid upstream lock or distribution portability flags');
  return true;
}
export function runOrThrow(bin,args,{cwd,env=process.env,run=spawnSync}={}) {
  const result=run(bin,args,{cwd,env,stdio:'inherit',shell:false});
  if(result.error||result.status!==0)throw Error(`${bin} ${args.join(' ')} failed: ${result.error?.message??`exit ${result.status}`}`);
}
export function buildEngine({platform=process.platform,arch=process.arch,env=process.env,home=homedir(),run=spawnSync}={}) {
  validateSourceLock(); targetId(platform,arch);
  // Windows PowerShell may launch the MSYS2 MINGW64 toolchain directly.
  // Never let a UCRT64 runtime accidentally enter the Win7 candidate build.
  if(platform==='win32') {
    const msys=env.MSYS2_ROOT??'C:\\msys64';
    const bin=join(msys,'mingw64','bin');
    const usr=join(msys,'usr','bin');
    if(!existsSync(join(bin,'cmake.exe'))||!existsSync(join(bin,'gcc.exe'))||!existsSync(join(usr,'git.exe')))
      throw Error('MSYS2 MINGW64 dependencies missing. Install gcc/cmake/ninja/libplist/gstreamer/plugins in MINGW64 (not UCRT64); see native/README.md');
    env={...env,MSYSTEM:'MINGW64',MSYSTEM_PREFIX:'/mingw64',PATH:[bin,usr,env.PATH??''].join(';')};
  }
  const base=join(cacheRoot(env,home),'sources',LOCK.commit),src=join(base,'UxPlay'),build=join(base,`build-${targetId(platform,arch)}`);
  mkdirSync(base,{recursive:true});
  const exec=(bin,args,cwd=base)=>runOrThrow(bin,args,{cwd,env,run});
  if(!existsSync(join(src,'.git'))) {
    if(existsSync(src))throw Error('Source dir already exists but is not a Git repository; refusing to overwrite it');
    exec('git',['clone','--no-checkout',LOCK.upstream,src]);
  }
  // Ensure pinned commit is available; do not silently build HEAD/latest.
  const rev=run('git',['cat-file','-e',`${LOCK.commit}^{commit}`],{cwd:src,env,encoding:'utf8'});
  if(rev.status!==0)exec('git',['fetch','origin',LOCK.commit],src);
  exec('git',['checkout','--force','--detach',LOCK.commit],src);
  const checked=run('git',['rev-parse','HEAD'],{cwd:src,env,encoding:'utf8'});
  if(checked.status!==0||checked.stdout.trim().toLowerCase()!==LOCK.commit)throw Error('Upstream checkout does not match pinned SHA');
  const dirty=run('git',['status','--porcelain'],{cwd:src,env,encoding:'utf8'});
  if(dirty.status!==0||dirty.stdout.trim())throw Error('Pinned source tree has local changes; refusing to build');
  // Checkout above restores pristine pinned upstream on every build.
  // Fail closed when upstream source no longer matches the reviewed anchors.
  applyRendererPatch(join(src,'renderers','video_renderer.c'));
  if(platform==='darwin' || platform==='win32') applyResponsiveWatermarkPatch(join(src,'renderers','video_renderer.c'));
  applyAudioEmptyPacketPatch(join(src,'lib','raop_buffer.c'), join(src,'lib','raop_rtp.c'));
  exec('git',['diff','--check','--','renderers/video_renderer.c','lib/raop_buffer.c','lib/raop_rtp.c'],src);
  const generator=platform==='win32'?['-G','Ninja']:[];
  exec('cmake',['-S',src,'-B',build,...generator,...LOCK.buildFlags]);
  exec('cmake',['--build',build,'--config','Release','--parallel','2']);
  const binary=join(build,engineName(platform));
  if(!existsSync(binary))throw Error(`Build completed but engine missing at ${binary}`);
  return storeEngine(binary,{platform,arch,env,home,origin:'pinned-source-build'});
}
