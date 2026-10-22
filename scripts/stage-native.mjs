#!/usr/bin/env node
/** Staging is intentionally offline: vendor binaries must come from an audited build. */
import {existsSync, mkdirSync, cpSync, copyFileSync, readFileSync, writeFileSync, chmodSync, readdirSync, statSync, lstatSync, realpathSync, rmSync} from 'node:fs';
import {resolve, join, basename, relative, dirname, isAbsolute, sep} from 'node:path';
import {createHash} from 'node:crypto';

const REPO=resolve(import.meta.dirname,'..');
const defaultDestination=join(REPO,'src-tauri','resources');
const UPSTREAM='df67c212a433cf6dda3676dd40c097900d24e645';
const args=process.argv.slice(2);
function value(flag){const idx=args.indexOf(flag); return idx===-1 ? null : args[idx+1]}
function die(text){console.error(`BLOCKED: ${text}`);process.exit(2)}
const DEST=value('--destination')?resolve(value('--destination')):defaultDestination;
const uxplay=value('--uxplay'), gst=value('--gst'), os=value('--os'), arch=value('--arch'), commit=value('--upstream-commit'), gstVersion=value('--gst-version');
const gstScanner=value('--gst-scanner');
const patchSha=value('--renderer-patch-sha256');
const internalMdns=value('--discovery-backend')==='internal-mdns';
const mdnsReceiptFile=value('--mdns-receipt');
if (!uxplay || !gst || !os || !arch || !commit || !gstVersion) die('必要参数: --uxplay <file> --gst <dir> --os darwin|win32 --arch x64|arm64 --upstream-commit <40hex> --gst-version <version>');
if (!['darwin','win32'].includes(os) || !['x64','arm64'].includes(arch)) die('未知平台或架构');
if (os==='win32' && arch==='arm64') die('Windows ARM64 尚未列入 MVP 目标');
if (gstScanner && os!=='darwin') die('--gst-scanner is only supported for macOS runtime staging');
if(internalMdns) {
  if(os!=='win32'||arch!=='x64')die('Internal mDNS variant is only accepted for Win7 x64');
  const {readMdnsLock,verifyMdnsReceipt}=await import('./win7-mdns-core.mjs');
  if(!mdnsReceiptFile)die('Cannot mark an engine internal-mDNS without the pinned build receipt');
  const receipt=JSON.parse(readFileSync(resolve(mdnsReceiptFile),'utf8'));
  verifyMdnsReceipt(receipt,{lock:readMdnsLock(),binary:resolve(uxplay)});
  if(commit.toLowerCase()!==readMdnsLock().commit)die('Internal mDNS variant must use the explicitly pinned 1.74 experimental commit');
} else if (commit.toLowerCase()!==UPSTREAM) die(`上游 UxPlay 源码必须按已选基线固定: ${UPSTREAM}`);
if(!internalMdns) {
  if(!/^[a-f0-9]{64}$/i.test(patchSha??''))die('Pinned UxPlay 1.73.7 staging requires --renderer-patch-sha256 from the reviewed native:prepare build');
  // In the actual repository (unlike isolated staging fixtures), revalidate
  // the pinned, patched engine receipt rather than trusting a caller-supplied hash.
  if(existsSync(join(REPO,'scripts','native-engine-core.mjs'))) {
    const {verifiedCachedEngine,RENDERER_PATCH_SHA256}=await import('./native-engine-core.mjs');
    if(patchSha.toLowerCase()!==RENDERER_PATCH_SHA256)die('Renderer patch source digest differs from the requested runtime');
    const cached=verifiedCachedEngine({platform:os,arch});
    if(!cached || realpathSync(cached)!==realpathSync(resolve(uxplay)))die('Release staging requires the SHA-verified, patched native:prepare executable');
  }
}

const sourceBinary=resolve(uxplay), sourceGst=resolve(gst);
if (!existsSync(sourceBinary) || !statSync(sourceBinary).isFile()) die('找不到 UxPlay 可执行文件');
if (!existsSync(sourceGst) || !statSync(sourceGst).isDirectory()) die('找不到 GStreamer runtime 目录');
const binName=os==='win32'?'uxplay.exe':'uxplay';
if (basename(sourceBinary).toLowerCase()!==binName) die(`引擎文件名必须为 ${binName}`);
for(const suffix of ['bin','lib/gstreamer-1.0']) if(!existsSync(join(sourceGst,suffix))) die(`GStreamer 缺少 ${suffix}`);
const sourceStart=readFileSync(sourceBinary).subarray(0,4);
if(os==='win32' && sourceStart.toString('latin1',0,2)!=='MZ') die('Windows 版本必须为 PE 可执行文件');
if(os==='darwin' && !['feedfacf','cffaedfe','cafebabe','bebafeca'].includes(sourceStart.toString('hex'))) die('macOS 版本必须为 Mach-O 或通用二进制');
const outSidecar=join(DEST,'sidecar'); const outGst=join(DEST,'gstreamer');
mkdirSync(outSidecar,{recursive:true});
for(const name of ['uxplay','uxplay.exe']) rmSync(join(outSidecar,name),{force:true});
copyFileSync(sourceBinary,join(outSidecar,binName));
if(os==='darwin') chmodSync(join(outSidecar,binName),0o755);
rmSync(join(outGst,'bin'),{recursive:true,force:true}); rmSync(join(outGst,'lib'),{recursive:true,force:true}); rmSync(join(outGst,'libexec'),{recursive:true,force:true});
// The host SDK contains static libraries, development files and unrelated
// Homebrew tools. The macOS prefix also contains dangling formula symlinks
// (e.g. python3.13t and libgstnice.dylib). Never traverse that whole prefix.
// Only copy explicit runtime subtrees and dereference *valid*, prefix-local
// links; the mandatory Mach-O closure and CPU architecture gates run later.
const skippedLinks=[];
function safeRuntimeEntry(source) {
  const metadata=lstatSync(source);
  if (!metadata.isSymbolicLink()) return metadata;
  let resolved;
  try {resolved=realpathSync(source);}
  catch(error) {
    if(['ENOENT','ENOTDIR','ELOOP'].includes(error.code)) {
      skippedLinks.push(relative(sourceGst,source).replaceAll('\\','/'));
      return null;
    }
    throw error;
  }
  // A Homebrew runtime must not silently copy an unrelated external file.
  const inside=relative(sourceGst,resolved);
  if(os==='darwin' && (inside==='..' || inside.startsWith('../') || inside.startsWith('..\\') || inside.startsWith('/') || inside==='')) {
    // External symlinks are omitted, then the release-time Mach-O closure
    // validation rejects any indispensable dependency that was omitted.
    skippedLinks.push(relative(sourceGst,source).replaceAll('\\','/'));
    return null;
  }
  return statSync(source);
}
function macRuntimeOnly(name) {
  const parts=name.split('/');
  const leaf=parts.at(-1).toLowerCase();
  const binary=/\.(?:dylib|so)(?:\.\d+)*$/i.test(leaf);
  if(name==='bin'||name==='lib'||name==='libexec')return true;
  if(parts[0]==='bin') {
    return parts.length===2 && (binary || leaf==='gst-inspect-1.0' || leaf==='gst-plugin-scanner');
  }
  if(parts[0]==='lib') {
    if(parts.length===2) return binary || parts[1]==='gstreamer-1.0' || parts[1]==='gio';
    if(parts[1]==='gstreamer-1.0')return parts.length===3 && binary;
    if(parts[1]==='gio') {
      if(parts.length===3) return parts[2]==='modules';
      return parts.length===4 && parts[2]==='modules' && binary;
    }
    return false;
  }
  if(parts[0]==='libexec') {
    if(parts.length===2)return parts[1]==='gstreamer-1.0';
    return parts.length===3 && parts[1]==='gstreamer-1.0' &&
      (leaf==='gst-plugin-scanner' || binary);
  }
  return false;
}
function runtimeOnly(source) {
  const relativeName=relative(sourceGst,source).replaceAll('\\','/');
  if (!relativeName) return true;
  if(os==='darwin') {
    // Filter by pathname BEFORE stat/lstat: avoid touching unrelated tools.
    if(!macRuntimeOnly(relativeName))return false;
    const info=safeRuntimeEntry(source);
    return !!info && (info.isFile() || info.isDirectory());
  }
  if (relativeName==='bin' || relativeName==='lib') return true;
  const info=statSync(source);
  if(info.isDirectory()) return !relativeName.split('/').some(p=>['pkgconfig','cmake','include','gir-1.0','girepository-1.0'].includes(p));
  if(!info.isFile()) return false;
  const file=basename(source).toLowerCase();
  if(relativeName.startsWith('bin/')) {
    return file.endsWith('.dll') || /^gst-(inspect-1\.0|plugin-scanner)\.exe$/.test(file);
  }
  if(relativeName.startsWith('lib/')) return /\.(dylib|dll|so)(?:\.\d+)*$/i.test(file);
  return false;
}
cpSync(join(sourceGst,'bin'),join(outGst,'bin'),{recursive:true,dereference:true,filter:runtimeOnly});
cpSync(join(sourceGst,'lib'),join(outGst,'lib'),{recursive:true,dereference:true,filter:runtimeOnly});
// gst-plugin-scanner is commonly under libexec on both platforms. Filter the
// macOS source; copying the whole Homebrew libexec pulls unrelated tooling.
const libexec=join(sourceGst,'libexec','gstreamer-1.0');
if(existsSync(libexec)) cpSync(libexec,join(outGst,'libexec','gstreamer-1.0'),{
  recursive:true,dereference:true,...(os==='darwin'?{filter:runtimeOnly}:{})
});
// Homebrew installs gst-plugin-scanner in the GStreamer formula's keg,
// which is not necessarily symlinked into the global brew prefix's libexec.
// The release build passes `brew --prefix gstreamer`'s exact scanner path.
// Verify that this runtime helper belongs to the same trusted prefix and
// (for a Cellar install) version before copying it into the standard layout.
if(os==='darwin' && gstScanner) {
  const scanner=resolve(gstScanner);
  let actual;
  try {actual=realpathSync(scanner);}
  catch(error){die(`macOS gst-plugin-scanner cannot be resolved at ${scanner}: ${error.message}`);}
  const root=realpathSync(sourceGst);
  const rel=relative(root,actual);
  if(rel==='' || rel==='..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    die(`macOS gst-plugin-scanner is outside the selected GStreamer/Homebrew prefix: ${actual}`);
  const file=statSync(actual);
  if(!file.isFile() || !(file.mode & 0o111))
    die(`macOS gst-plugin-scanner is not an executable regular file: ${actual}`);
  const scannerMagic=readFileSync(actual).subarray(0,4).toString('hex');
  if(!['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca','cafebabf','bfbafeca'].includes(scannerMagic))
    die(`macOS gst-plugin-scanner must be a Mach-O executable: ${actual}`);
  const segments=actual.split(sep);
  const cellar=segments.lastIndexOf('Cellar');
  if(cellar!==-1 && segments[cellar+1]==='gstreamer') {
    const kegVersion=segments[cellar+2];
    if(kegVersion!==gstVersion && !kegVersion?.startsWith(`${gstVersion}_`))
      die(`macOS gst-plugin-scanner formula version ${kegVersion} differs from GStreamer ${gstVersion}`);
  }
  const staged=join(outGst,'libexec','gstreamer-1.0','gst-plugin-scanner');
  mkdirSync(dirname(staged),{recursive:true});
  copyFileSync(actual,staged);
  chmodSync(staged,file.mode & 0o777);
  console.log(`[native-stage] Staged formula-specific gst-plugin-scanner: ${relative(root,actual).replaceAll('\\','/')}`);
}
if(skippedLinks.length)console.warn(`[native-stage] Skipped ${skippedLinks.length} broken/out-of-prefix optional Homebrew links: ${skippedLinks.slice(0,12).join(', ')}${skippedLinks.length>12?' ...':''}`);
if(os==='darwin') {
  const pluginRoot=join(outGst,'lib','gstreamer-1.0');
  const plugins=existsSync(pluginRoot)?readdirSync(pluginRoot):[];
  if(!existsSync(join(outGst,'bin','gst-inspect-1.0')))die('macOS GStreamer runtime is missing staged gst-inspect-1.0');
  if(!plugins.some(name=>/^libgstlibav\.(?:dylib|so)$/i.test(name)))die('macOS runtime missing staged libgstlibav decoder plugin; check dangling links and Homebrew install');
  if(!plugins.some(name=>/^libgstcoreelements\.(?:dylib|so)$/i.test(name)))die('macOS runtime missing staged libgstcoreelements plugin');
  if(!existsSync(join(outGst,'libexec','gstreamer-1.0','gst-plugin-scanner')) &&
     !existsSync(join(outGst,'bin','gst-plugin-scanner')))die('macOS runtime is missing gst-plugin-scanner');
}
const files=[];
function walk(p,relative='') {
  for(const dirent of readdirSync(p,{withFileTypes:true})) {
    const rel=join(relative,dirent.name), full=join(p,dirent.name);
    if(dirent.isSymbolicLink()) die(`包中不允许未解析的链接: ${rel}`);
    if(dirent.isDirectory()) walk(full,rel);
    else if(dirent.isFile() && !dirent.name.endsWith('.txt')) files.push({path:rel.replaceAll('\\','/'),sha256:createHash('sha256').update(readFileSync(full)).digest('hex')});
  }
}
walk(outSidecar,'sidecar');walk(outGst,'gstreamer');
const manifest={schema:1,ready:true,os,arch,upstream:{repository:'https://github.com/FDH2/UxPlay',tag:internalMdns?'1.74-experimental-pinned':'v1.73.7',commit:internalMdns?commit.toLowerCase():UPSTREAM,...(!internalMdns?{rendererPatchSha256:patchSha.toLowerCase()}:{})},...(internalMdns?{discovery:{backend:'internal-mdns',engineSha256:createHash('sha256').update(readFileSync(sourceBinary)).digest('hex')}}:{}),gstreamerVersion:gstVersion,files:files.sort((a,b)=>a.path.localeCompare(b.path))};
writeFileSync(join(DEST,'native-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`已准备 ${files.length} 个本地运行时文件。注意：静态文件检查不代表 Win7/macOS 干净机测试通过。`);
