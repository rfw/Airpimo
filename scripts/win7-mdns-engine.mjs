#!/usr/bin/env node
/** Intentionally explicit two-step source pin + compile of UxPlay 1.74 experimental.
 * Never mutate the existing 1.73.7 engine/cache used on working installations.
 */
import {existsSync,mkdirSync,readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {PROJECT_ROOT} from './native-engine-core.mjs';
import {MDNS_UPSTREAM,MDNS_LOCK_FILE,MDNS_FLAGS,readMdnsLock,fileSha256} from './win7-mdns-core.mjs';
import {resolveGlobalGit,globalGitEnv} from './win7-global-git.mjs';
import {win7MdnsEnvironments} from './win7-mdns-env.mjs';
const args=process.argv.slice(2);
function option(key){const i=args.indexOf(key);return i>=0?args[i+1]:null;}
function run(cmd,argv,{cwd=PROJECT_ROOT,env=process.env,live=false}={}) {
  if(live)console.log(`[mdns] RUN ${cmd} ${argv.join(' ')}`);
  const result=spawnSync(cmd,argv,{
    cwd,env,windowsHide:true,
    ...(live ? {stdio:'inherit'} : {encoding:'utf8',maxBuffer:8*1024*1024}),
  });
  if(result.error || result.status!==0) {
    const detail=result.error?.message??(live ? `exit ${result.status??'unknown'} (see command output above)` : (result.stderr||result.stdout||`exit ${result.status}`).slice(-2500));
    throw Error(`${cmd} ${argv.join(' ')} failed: ${detail}`);
  }
  return live ? '' : (result.stdout||'').trim();
}
function tool(bin,root){const p=join(root,bin);if(!existsSync(p))throw Error(`Missing ${p}. Windows build host requires MSYS2 MINGW64, not UCRT64; do not install it on Win7 user machines.`);return p;}
function exe(name,folder){return tool(name+'.exe',folder);}
function requireHost(){if(process.platform!=='win32'||process.arch!=='x64')throw Error('Win7 internal-mDNS native engine must be built on Windows x64');}
function pin() {
  if(existsSync(MDNS_LOCK_FILE))throw Error(`Already pinned: ${MDNS_LOCK_FILE}. This operation intentionally never auto-upgrades an existing source pin.`);
  const msys=resolve(option('--msys-root')||process.env.MSYS2_ROOT||'C:\\msys64');
  const git=resolveGlobalGit({override:option('--git'),msysRoot:msys});
  const output=run(git,['ls-remote',MDNS_UPSTREAM,'refs/heads/master'],{env:globalGitEnv({git,msysRoot:msys})});
  const sha=output.match(/^([a-f0-9]{40})\s+refs\/heads\/master$/mi)?.[1];
  if(!sha)throw Error('Unable to obtain a full upstream commit hash for UxPlay 1.74 experimental. No pin written.');
  const lock={schema:1,upstream:MDNS_UPSTREAM,track:'1.74-experimental',target:'win32-x64',commit:sha,buildFlags:[...MDNS_FLAGS]};
  writeFileSync(MDNS_LOCK_FILE,JSON.stringify(lock,null,2)+'\n',{flag:'wx'});
  console.log(`[mdns] Pinned experimental upstream once: ${sha}. Review this commit before distribution.`);
}
function build() {
  requireHost();
  const lock=readMdnsLock();
  const msys=resolve(option('--msys-root')||process.env.MSYS2_ROOT||'C:\\msys64');
  const mingw=join(msys,'mingw64','bin'),usr=join(msys,'usr','bin');
  const git=resolveGlobalGit({override:option('--git'),msysRoot:msys});
  const gcc=exe('gcc',mingw),gxx=exe('g++',mingw),cmake=exe('cmake',mingw),ninja=exe('ninja',mingw),pkgconf=exe('pkg-config',mingw);
  const gst=resolve(option('--gst')||process.env.UXPLAY_GST_RUNTIME||'F:\\gstreamer\\1.0\\mingw_x86_64');
  const inspector=exe('gst-inspect-1.0',join(gst,'bin'));
  // GStreamer 1.24 ships an older MinGW C++ runtime. Never let it shadow GCC's
  // own runtime when running CMake/Ninja/GCC (GCC 16 can silently fail its probe).
  // gst-inspect instead needs its matching GStreamer DLLs first.
  const {toolEnv,gstEnv}=win7MdnsEnvironments({gst,mingw,usr,msys});
  const gitEnv=globalGitEnv({git,msysRoot:msys,gstRoot:gst});
  const version=run(inspector,['--version'],{env:gstEnv});
  const gstVersion=version.match(/\b1\.24\.\d+\b/)?.[0];
  if(!gstVersion)throw Error('Win7 candidate requires GStreamer 1.24.x SDK. Existing newer MSYS2 runtime is not certified for Win7.');
  if(!existsSync(join(gst,'include')) || !existsSync(join(gst,'lib','pkgconfig')))throw Error(`GStreamer Development SDK not installed under ${gst}`);
  const linkedGst=run(pkgconf,['--modversion','gstreamer-1.0'],{env:toolEnv});
  if(linkedGst!==gstVersion)throw Error(`pkg-config is resolving GStreamer ${linkedGst} instead of selected ${gstVersion}. Refusing to link mixed GStreamer runtimes.`);
  const dir=join(PROJECT_ROOT,'native-artifacts','win7-internal-mdns',lock.commit),src=join(dir,'source'),buildDir=join(dir,'build');
  mkdirSync(dir,{recursive:true});
  if(!existsSync(join(src,'.git'))) {
    if(existsSync(src))throw Error(`Source directory already exists but is not git: ${src}`);
    run(git,['clone','--no-checkout',MDNS_UPSTREAM,src],{env:gitEnv});
  }
  const rev=spawnSync(git,['cat-file','-e',`${lock.commit}^{commit}`],{cwd:src,env:gitEnv,windowsHide:true});
  if(rev.status!==0)run(git,['fetch','origin',lock.commit],{cwd:src,env:gitEnv});
  run(git,['checkout','--detach','--force',lock.commit],{cwd:src,env:gitEnv});
  if(run(git,['rev-parse','HEAD'],{cwd:src,env:gitEnv}).toLowerCase()!==lock.commit)throw Error('Checkout is not the source pin');
  if(run(git,['status','--porcelain'],{cwd:src,env:gitEnv}))throw Error('Pinned upstream source is modified');
  const cmakelists=readFileSync(join(src,'CMakeLists.txt'),'utf8');
  if(!/USE_DNS_SD/.test(cmakelists)||!/USE_MDNS/.test(cmakelists)||!existsSync(join(src,'lib','mdnsd','CMakeLists.txt')))throw Error('Pinned source does not contain UxPlay 1.74 internal lib/mdnsd; refusing legacy Bonjour implementation');
  run(cmake,['-S',src,'-B',buildDir,'-G','Ninja','-DCMAKE_BUILD_TYPE=Release',`-DCMAKE_C_COMPILER=${gcc}`,`-DCMAKE_CXX_COMPILER=${gxx}`,...MDNS_FLAGS],{env:toolEnv,live:true});
  const cache=readFileSync(join(buildDir,'CMakeCache.txt'),'utf8');
  if(!/USE_DNS_SD:[^\n]*=OFF/.test(cache)||!/USE_MDNS:[^\n]*=ON/.test(cache))throw Error('CMake did not accept required internal-mDNS configuration');
  const ninjaGraph=readFileSync(join(buildDir,'build.ninja'),'utf8');
  if(!/lib\/mdnsd/.test(ninjaGraph) || /lib\/dns_sd\//.test(ninjaGraph))throw Error('CMake build graph is not exclusively using internal lib/mdnsd; aborting Bonjour-free release');
  run(cmake,['--build',buildDir,'--config','Release','--parallel','2'],{env:toolEnv,live:true});
  const built=join(buildDir,'uxplay.exe');if(!existsSync(built))throw Error(`Missing built engine: ${built}`);
  const output=join(dir,'uxplay.exe'); copyFileSync(built,output);
  const receipt={schema:1,discoveryBackend:'internal-mdns',sourceCommit:lock.commit,sha256:fileSha256(output),buildFlags:[...MDNS_FLAGS],gstreamerVersion:gstVersion,binary:output};
  writeFileSync(join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(`[mdns] Experimental engine compiled and SHA-256 recorded: ${output}`);
  console.log('[mdns] Still NOT Win7-certified. Next: native:bundle:prepare:win7:mdns with matching MINGW64 DLLs, followed by Win7 real-host test without Bonjour.');
}
try {
  const mode=args[0];
  if(mode==='pin')pin();
  else if(mode==='build')build();
  else throw Error('Use pin or build. Neither step ever overwrites the working 1.73.7 engine.');
} catch(e){console.error(`[mdns] BLOCKED: ${e.message}`);process.exitCode=2;}
