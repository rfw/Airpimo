import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync,
  symlinkSync,copyFileSync,lstatSync,chmodSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {LOCK} from '../scripts/native-engine-core.mjs';

function withMacFixture(fn) {
  const folder=mkdtempSync(join(tmpdir(),'uxplay-macos-stage-'));
  const project=join(folder,'project');
  const gst=join(folder,'homebrew');
  const scripts=join(project,'scripts');
  const engine=join(folder,'uxplay');
  mkdirSync(scripts,{recursive:true});
  copyFileSync(new URL('../scripts/stage-native.mjs',import.meta.url),join(scripts,'stage-native.mjs'));
  writeFileSync(engine,Buffer.from('cffaedfe00000000','hex'));
  function put(name,content='mock Mach-O library') {
    const to=join(gst,name);mkdirSync(dirname(to),{recursive:true});writeFileSync(to,content);return to;
  }
  function link(name,target){const to=join(gst,name);mkdirSync(dirname(to),{recursive:true});symlinkSync(target,to);}
  // chmodSync(0o755) cannot set POSIX executable bits on Windows/NTFS.
  // Preload a test-only fs.statSync shim for the single scanner fixture, so
  // all scanner-path/version/Mach-O failure cases run on Windows as well.
  // The production staging script remains unchanged and fail-closed on macOS.
  const shimFile=fileURLToPath(new URL('./fixtures/mock-scanner-exec-mode.cjs',import.meta.url));
  const run=(arch='arm64',extraArgs=[],{scannerExecutable=true}={})=>{
    const index=extraArgs.indexOf('--gst-scanner');
    const scanner=index!==-1?extraArgs[index+1]:null;
    const emulatePosixPermissions=!!scanner &&
      (process.platform==='win32' || process.env.UXPLAY_TEST_FORCE_SCANNER_MODE_SHIM==='1');
    const nodeArgs=emulatePosixPermissions?['--require',shimFile]:[];
    const env=emulatePosixPermissions?{
      ...process.env,
      UXPLAY_TEST_SCANNER_PATH:resolve(scanner),
      UXPLAY_TEST_SCANNER_EXEC_MODE:scannerExecutable?'0755':'0644',
    }:process.env;
    return spawnSync(process.execPath,[
      ...nodeArgs,join(scripts,'stage-native.mjs'),'--uxplay',engine,'--gst',gst,
      '--os','darwin','--arch',arch,'--upstream-commit',LOCK.commit,
      '--gst-version','1.28.8',...extraArgs
    ],{encoding:'utf8',env});
  };
  try {return fn({folder,project,gst,put,link,run});}
  finally {rmSync(folder,{recursive:true,force:true});}
}

test('macOS staging ignores stale Homebrew Python/link entries but bundles valid dylibs and GStreamer plugins',()=>withMacFixture(({project,put,link,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/libgstreamer-1.0.0.dylib','gst dylib');
  link('lib/libgstreamer-1.0.dylib','libgstreamer-1.0.0.dylib');
  put('lib/gstreamer-1.0/libgstlibav.so','gstreamer decoder');
  put('lib/gstreamer-1.0/libgstcoreelements.dylib','core plugin');
  put('libexec/gstreamer-1.0/gst-plugin-scanner','plugin scanner');
  put('lib/pkgconfig/gstreamer-1.0.pc','development');
  put('lib/libdevelopment.a','static');
  put('bin/brew','unrelated binary');
  link('bin/python3.13t','/nonexistent/bin/python3.13t');
  link('lib/gstreamer-1.0/libgstnice.dylib','/nonexistent/libgstnice.dylib');
  link('lib/gstreamer-1.0/libgstexternal.so','/etc/hosts');
  const result=run();
  assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  assert.match(result.stderr,/Skipped 2 broken\/out-of-prefix optional Homebrew links/);
  const dir=join(project,'src-tauri','resources');
  assert.equal(existsSync(join(dir,'gstreamer','bin','gst-inspect-1.0')),true);
  assert.equal(existsSync(join(dir,'gstreamer','bin','python3.13t')),false);
  assert.equal(existsSync(join(dir,'gstreamer','bin','brew')),false);
  assert.equal(existsSync(join(dir,'gstreamer','lib','gstreamer-1.0','libgstnice.dylib')),false);
  assert.equal(existsSync(join(dir,'gstreamer','lib','gstreamer-1.0','libgstexternal.so')),false);
  assert.equal(existsSync(join(dir,'gstreamer','lib','pkgconfig')),false);
  assert.equal(existsSync(join(dir,'gstreamer','lib','libdevelopment.a')),false);
  assert.equal(readFileSync(join(dir,'gstreamer','lib','libgstreamer-1.0.dylib'),'utf8'),'gst dylib');
  assert.equal(lstatSync(join(dir,'gstreamer','lib','libgstreamer-1.0.dylib')).isSymbolicLink(),false);
  assert.equal(existsSync(join(dir,'gstreamer','libexec','gstreamer-1.0','gst-plugin-scanner')),true);
  const manifest=JSON.parse(readFileSync(join(dir,'native-manifest.json'),'utf8'));
  assert.equal(manifest.arch,'arm64');
  assert.equal(manifest.os,'darwin');
  assert.ok(manifest.files.some(v=>v.path==='gstreamer/lib/gstreamer-1.0/libgstlibav.so'));
  assert.ok(!manifest.files.some(v=>v.path.includes('python3.13t')||v.path.includes('libgstnice.dylib')));
}));


test('macOS missing decoder plugin blocks staging even if a dead libgstlibav symlink exists',()=>withMacFixture(({put,link,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/libgstreamer-1.0.0.dylib','gst dylib');
  put('lib/gstreamer-1.0/libgstcoreelements.dylib','core plugin');
  put('libexec/gstreamer-1.0/gst-plugin-scanner','plugin scanner');
  link('lib/gstreamer-1.0/libgstlibav.so','/nonexistent/gst-libav.so');
  const result=run('x64');
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/missing staged libgstlibav decoder plugin/);
}));

test('macOS missing plugin scanner blocks staging',()=>withMacFixture(({put,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/libgstreamer-1.0.0.dylib','gst dylib');
  put('lib/gstreamer-1.0/libgstlibav.dylib','libav');
  put('lib/gstreamer-1.0/libgstcoreelements.so','core');
  const result=run();
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/missing gst-plugin-scanner/);
}));


test('macOS stages Homebrew keg-only plugin scanner to its packaged libexec path',()=>withMacFixture(({project,put,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/gstreamer-1.0/libgstlibav.so','libav');
  put('lib/gstreamer-1.0/libgstcoreelements.so','core');
  const scanner=put('Cellar/gstreamer/1.28.8/libexec/gstreamer-1.0/gst-plugin-scanner',Buffer.from('cffaedfe00000000','hex'));
  chmodSync(scanner,0o755);
  const result=run('arm64',['--gst-scanner',scanner]);
  assert.equal(result.status,0,result.stderr+'\n'+result.stdout);
  assert.match(result.stdout,/Staged formula-specific gst-plugin-scanner/);
  const resources=join(project,'src-tauri','resources');
  const packaged=join(resources,'gstreamer','libexec','gstreamer-1.0','gst-plugin-scanner');
  assert.equal(existsSync(packaged),true);
  assert.equal(readFileSync(packaged).toString('hex'),'cffaedfe00000000');
  assert.ok(JSON.parse(readFileSync(join(resources,'native-manifest.json'),'utf8')).files.some(e=>e.path==='gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner'));
}));

test('macOS refuses a scanner outside the selected Homebrew prefix',()=>withMacFixture(({folder,put,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/gstreamer-1.0/libgstlibav.so','libav');
  put('lib/gstreamer-1.0/libgstcoreelements.so','core');
  const scanner=join(folder,'outside','gst-plugin-scanner');
  mkdirSync(dirname(scanner),{recursive:true});
  writeFileSync(scanner,Buffer.from('cffaedfe00000000','hex'));
  chmodSync(scanner,0o755);
  const result=run('arm64',['--gst-scanner',scanner]);
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/outside the selected GStreamer\/Homebrew prefix/);
}));

test('macOS rejects a scanner from a different GStreamer Cellar version',()=>withMacFixture(({put,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/gstreamer-1.0/libgstlibav.so','libav');
  put('lib/gstreamer-1.0/libgstcoreelements.so','core');
  const scanner=put('Cellar/gstreamer/1.28.7/libexec/gstreamer-1.0/gst-plugin-scanner',Buffer.from('cffaedfe00000000','hex'));
  chmodSync(scanner,0o755);
  const result=run('arm64',['--gst-scanner',scanner]);
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/formula version 1\.28\.7 differs from GStreamer 1\.28\.8/);
}));

test('macOS refuses a scanner that is not executable',()=>withMacFixture(({put,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/gstreamer-1.0/libgstlibav.so','libav');
  put('lib/gstreamer-1.0/libgstcoreelements.so','core');
  const scanner=put('Cellar/gstreamer/1.28.8/libexec/gstreamer-1.0/gst-plugin-scanner','not executable');
  chmodSync(scanner,0o644);
  const result=run('arm64',['--gst-scanner',scanner],{scannerExecutable:false});
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/not an executable regular file/);
}));


test('macOS refuses an executable scanner that is not a Mach-O binary',()=>withMacFixture(({put,run})=>{
  put('bin/gst-inspect-1.0','inspector');
  put('lib/gstreamer-1.0/libgstlibav.so','libav');
  put('lib/gstreamer-1.0/libgstcoreelements.so','core');
  const scanner=put('Cellar/gstreamer/1.28.8/libexec/gstreamer-1.0/gst-plugin-scanner','#!/bin/sh\nexit 0\n');
  chmodSync(scanner,0o755);
  const result=run('arm64',['--gst-scanner',scanner]);
  assert.equal(result.status,2,result.stderr);
  assert.match(result.stderr,/must be a Mach-O executable/);
}));


test('macOS CI passes scanner through the intermediate native-release-prepare wrapper',()=>{
  const runner=readFileSync(new URL('../scripts/ci/prepare-macos.sh',import.meta.url),'utf8');
  const wrapper=readFileSync(new URL('../scripts/native-release-prepare.mjs',import.meta.url),'utf8');
  assert.match(runner,/--gst-scanner "\$SCANNER"/);
  assert.match(wrapper,/gstScanner=option\('--gst-scanner'\)/);
  assert.match(wrapper,/command\.push\('--gst-scanner',resolve\(gstScanner\)\)/);
});
