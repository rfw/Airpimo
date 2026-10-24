#!/usr/bin/env node
import {existsSync, readFileSync, statSync, realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {auditMacNative} from './audit-macos-native.mjs';
import {LOCK,RENDERER_PATCH_SHA256} from './native-engine-core.mjs';
import {auditWin7Runtime} from './win7-pe-audit.mjs';
import {auditPackagedCxxAbi} from './win7-cxx-abi.mjs';
import {verifyFixedWebview2} from './win7-release-core.mjs';
import {readMdnsLock,verifyMdnsManifest} from './win7-mdns-core.mjs';
const appIndex=process.argv.indexOf('--resources');
const root=appIndex<0 ? resolve(import.meta.dirname,'..','src-tauri','resources') : resolve(process.argv[appIndex+1]??'');
if (appIndex>=0 && !process.argv[appIndex+1]) {console.error('BLOCKED native package: --resources requires a directory');process.exit(2)}
const manifestPath=join(root,'native-manifest.json');
function fail(reason){console.error('BLOCKED native package: '+reason);process.exit(2)}
if(!existsSync(manifestPath)) fail('native-manifest.json 缺失');
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
if(!manifest.ready) fail('UxPlay/GStreamer 尚未经过本地准备');
if(manifest.os!==process.platform || manifest.arch!==process.arch) fail(`本机 ${process.platform}/${process.arch} 与依赖 ${manifest.os}/${manifest.arch} 不一致`);
if(manifest.discovery?.backend==='internal-mdns') {
  try{verifyMdnsManifest(manifest,{lock:readMdnsLock()});}catch(e){fail(e.message);}
} else {
  if(manifest.upstream?.commit!==LOCK.commit)fail('UxPlay commit 不匹配');
  if(manifest.upstream?.rendererPatchSha256!==RENDERER_PATCH_SHA256)fail('UxPlay renderer patch 缺失或已过期；请重新 native:prepare 并准备完整原生运行时');
}
if(process.argv.includes('--require-mdns') && manifest.discovery?.backend!=='internal-mdns')fail('Bonjour-free package requires pinned UxPlay 1.74 internal-mDNS provenance. Current staged engine is legacy Bonjour 1.73.7.');
if(!Array.isArray(manifest.files) || manifest.files.length<3) fail('原生依赖不完整');
const seen = new Set();
let hasPlugin=false;
let hasLibrary=false;
for(const file of manifest.files){
  if(!/^(sidecar|gstreamer)\/[A-Za-z0-9_.+@()/-]+$/.test(file.path) || file.path.split('/').includes('..')) fail('原生文件路径不安全');
  if(seen.has(file.path)) fail(`原生文件重复声明: ${file.path}`);
  seen.add(file.path);
  if(file.path.startsWith('gstreamer/lib/gstreamer-1.0/') && /\.(so|dll|dylib)$/.test(file.path)) hasPlugin=true;
  if(manifest.os==='win32') {
    if(file.path.startsWith('gstreamer/bin/') && /\.dll$/i.test(file.path)) hasLibrary=true;
  } else {
    if(file.path.startsWith('gstreamer/lib/') && /\.(so|dylib)$/.test(file.path) && !file.path.startsWith('gstreamer/lib/gstreamer-1.0/')) hasLibrary=true;
  }
  const full=join(root,file.path);
  if(!existsSync(full) || !statSync(full).isFile()) fail(`缺少 ${file.path}`);
  const hash=createHash('sha256').update(readFileSync(full)).digest('hex');
  if(hash!==file.sha256) fail(`SHA256 校验失败: ${file.path}`);
}
const windowsReceiver=manifest.files.some(file=>file.path==='sidecar/AirpimoPlayer.exe')?'AirpimoPlayer.exe':'uxplay.exe';
if(process.platform==='win32' && process.argv.includes('--require-branded-receiver') && windowsReceiver!=='AirpimoPlayer.exe')fail('Windows installer must package AirpimoPlayer.exe');
const binName=process.platform==='win32'?windowsReceiver:'Airpimo';
const ux=join(root,'sidecar',binName);
if(!existsSync(ux)) fail('缺少 UxPlay 引擎');
if(!existsSync(join(root,'gstreamer','lib','gstreamer-1.0'))) fail('插件目录缺失');
if(!hasPlugin) fail('清单中没有 GStreamer 插件二进制');
if(!hasLibrary) fail('清单中没有 GStreamer 运行时动态库');
if(process.platform==='darwin') {
  const result=auditMacNative(root,{manifest});
  if(!result.ok) fail(`Mach-O 依赖未完全内置 (${result.problems.length}):\n`+result.problems.join('\n'));
  console.log(`PASS: macOS ${result.filesExamined} 个 Mach-O 文件依赖均可从本包解析或属于系统库`);
  const {smokeMacPackagedGstreamer}=await import('./smoke-macos-gstreamer.mjs');
  try {
    const smoke=smokeMacPackagedGstreamer(root);
    console.log(`PASS: macOS ${smoke.elementsChecked} GStreamer elements load from packaged plugin directory`);
  } catch(error) {fail(`macOS bundled GStreamer plugin smoke: ${error.message}`);}
}
if(manifest.os==='win32') {
  const cxx=auditPackagedCxxAbi(root,manifest);
  if(!cxx.ok) fail(`GStreamer C++ DLL export mismatch (${cxx.modulesChecked} packaged native modules):\n`+cxx.problems.slice(0,24).join('\n'));
  console.log(`PASS: GStreamer C++ DLL ABI checked across ${cxx.modulesChecked} packaged executables and DLLs`);
  // All Windows releases use the same video -vc pipeline, including Win7.
  // Verify the packaged Pango textoverlay plugin instead of only checking
  // that the installation SDK provides it.
  const gst=join(root,'gstreamer'), bin=join(gst,'bin');
  const pluginDir=join(gst,'lib','gstreamer-1.0');
  const inspector=join(bin,'gst-inspect-1.0.exe');
  const scanner=join(gst,'libexec','gstreamer-1.0','gst-plugin-scanner.exe');
  if(!existsSync(inspector)||!existsSync(scanner)) fail('Windows GStreamer packaged inspector/scanner missing');
  const env={...process.env,PATH:[bin,process.env.PATH??''].join(';'),
    GST_PLUGIN_PATH_1_0:pluginDir,GST_PLUGIN_SYSTEM_PATH_1_0:'',
    GST_PLUGIN_PATH:pluginDir,GST_PLUGIN_SYSTEM_PATH:'',
    GST_PLUGIN_SCANNER_1_0:scanner,
    GST_REGISTRY_1_0:join(process.env.TEMP??process.env.TMP??bin,`airpimo-watermark-${process.pid}.bin`)};
  const inspect=spawnSync(inspector,['textoverlay'],{encoding:'utf8',env,timeout:30000,windowsHide:true});
  if(inspect.error||inspect.status!==0) fail(`Packaged Windows textoverlay plugin load failed: ${inspect.error?.message??(inspect.stderr||inspect.stdout||inspect.status).toString().slice(-600)}`);
  const required='gstreamer/lib/gstreamer-1.0/libgstpango.dll';
  if(!manifest.files.some(file=>file.path.toLowerCase()===required))
    fail('Packaged Windows textoverlay requires the libgstpango.dll plugin in the verified manifest');
  const pluginMatch=(inspect.stdout??'').match(/^\s*Filename\s+(.+?)\s*$/m);
  const reportedPlugin=pluginMatch?.[1];
  const expectedPlugin=join(root,'gstreamer','lib','gstreamer-1.0','libgstpango.dll');
  if(!reportedPlugin||!existsSync(reportedPlugin)||
    realpathSync(reportedPlugin).toLowerCase()!==realpathSync(expectedPlugin).toLowerCase())
    fail('Windows textoverlay plugin loaded from outside the packaged native runtime');
  console.log('PASS: packaged Windows GStreamer textoverlay plugin loaded from verified bundle');
}
if(process.argv.includes('--win7')) {
  if(process.platform!=='win32'||process.arch!=='x64') fail('Win7 候选包须在 Windows x64 宿主运行');
  try {
    const webview=verifyFixedWebview2();
    console.log(`PASS: WebView2 Fixed Runtime ${webview.version} at ${webview.path}`);
  } catch (error) {fail(`WebView2 109: ${error.message}`);}
  const result=auditWin7Runtime(root,manifest);
  if(!result.ok) fail(`Windows 7 ABI gate rejected ${result.problems.length} hard incompatibilities (closure ${result.inspected} PE binaries):\n`+result.problems.join('\n'));
  console.log(`PASS: Win7 known unsupported API/mandatory import gate (${result.inspected} PE binaries). Not an OS runtime certification.`);
  // A real plugin-load smoke test, in addition to static PE checks. Host success != Win7 success.
  const runtime=join(root,'gstreamer'), bin=join(runtime,'bin');
  const inspector=join(bin,'gst-inspect-1.0.exe');
  const pluginDir=join(runtime,'lib','gstreamer-1.0');
  const scanner=join(runtime,'libexec','gstreamer-1.0','gst-plugin-scanner.exe');
  if(!existsSync(inspector)||!existsSync(scanner)) fail('缺少 gst-inspect-1.0.exe / gst-plugin-scanner.exe');
  const env={...process.env, PATH:[bin,process.env.PATH??''].join(';'),
    GST_PLUGIN_SYSTEM_PATH_1_0:pluginDir, GST_PLUGIN_PATH_1_0:pluginDir,
    GST_PLUGIN_SYSTEM_PATH:'',GST_PLUGIN_PATH:pluginDir,
    GST_PLUGIN_SCANNER_1_0:scanner,
    GST_REGISTRY_1_0:join(process.env.TEMP??process.env.TMP??bin,`uxplay-win7-build-${process.pid}.bin`)};
  for(const element of ['libav','avdec_h264','avdec_aac']) {
    const r=spawnSync(inspector,[element],{encoding:'utf8',env,timeout:30000,windowsHide:true});
    if(r.error||r.status!==0) fail(`Host plugin smoke failed for ${element}: ${r.error?.message??(r.stderr||r.stdout||`exit ${r.status}`).slice(-600)}`);
  }
  console.log('PASS: build-host libav/avdec_h264/avdec_aac load smoke; Windows 7 real-machine validation still required.');
}
console.log(`PASS: ${manifest.files.length} native assets SHA-256 verified. Native playback and clean OS installations remain separate release gates.`);
