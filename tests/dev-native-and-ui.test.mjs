import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, readFileSync, realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {candidatePaths, findDevelopmentBinary} from '../scripts/dev-native-paths.mjs';
const root=resolve(import.meta.dirname,'..');
function sandbox(fn){const dir=mkdtempSync(join(tmpdir(),'uxplay-v5-'));try {return fn(dir);}finally{rmSync(dir,{force:true,recursive:true});}}
function stub(path,mode=0o755) {mkdirSync(resolve(path,'..'),{recursive:true});writeFileSync(path,'fake mac binary for path-only test');chmodSync(path,mode);}

test('debug native resolver finds an existing sibling build and respects executable bit', {skip: process.platform==='win32' ? 'Windows cannot simulate POSIX executable mode bits with chmodSync' : false}, ()=>sandbox(dir=>{
  const project=join(dir,'UxPlay-Desktop');mkdirSync(project);const binary=join(dir,'UxPlay','build','uxplay');
  stub(binary,0o644);
  assert.equal(findDevelopmentBinary({root:project,home:join(dir,'home'),platform:'darwin',pathLookup:''}),null);
  chmodSync(binary,0o755);
  assert.equal(findDevelopmentBinary({root:project,home:join(dir,'home'),platform:'darwin',pathLookup:''}),realpathSync(binary));
}));

test('Windows development resolver finds .exe without POSIX executable bits', {skip: process.platform!=='win32'}, ()=>sandbox(dir=>{
  const project=join(dir,'UxPlay-Desktop');mkdirSync(project);
  const binary=join(dir,'UxPlay','build','uxplay.exe');stub(binary,0o644);
  assert.equal(findDevelopmentBinary({root:project,home:join(dir,'home'),platform:'win32',pathLookup:''}),realpathSync(binary));
}));

test('explicit developer binary takes priority and fails closed if invalid',()=>sandbox(dir=>{
  const project=join(dir,'UxPlay-Desktop');mkdirSync(project);
  const platform=process.platform==='win32'?'win32':'darwin';
  const name=platform==='win32'?'uxplay.exe':'uxplay';
  const sibling=join(dir,'UxPlay','build',name), custom=join(dir,'bin',name);
  stub(sibling);stub(custom);
  assert.equal(findDevelopmentBinary({root:project,home:join(dir,'home'),requested:custom,platform,pathLookup:sibling}),realpathSync(custom));
  assert.throws(()=>findDevelopmentBinary({root:project,home:join(dir,'home'),requested:'relative/uxplay',platform,pathLookup:sibling}),/绝对路径/);
  assert.throws(()=>findDevelopmentBinary({root:project,home:join(dir,'home'),requested:join(dir,'notfound'),platform,pathLookup:sibling}),/不可执行/);
}));

test('PATH fallback and conventional HOME locations only (no arbitrary filesystem scan)',()=>sandbox(dir=>{
  const platform=process.platform==='win32'?'win32':'darwin';
  const custom=join(dir,'bin',platform==='win32'?'uxplay.exe':'uxplay');stub(custom);
  assert.ok(candidatePaths({root:dir,home:dir,platform,fromPath:custom}).includes(custom));
  assert.equal(findDevelopmentBinary({root:dir,home:dir,platform,pathLookup:custom}),realpathSync(custom));
}));

test('debug runner doctor rejects a nonexistent override without launching Tauri',()=>{
  const result=spawnSync(process.execPath,['scripts/desktop-dev.mjs','--doctor','--uxplay','/not/existing/uxplay'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,2);assert.match(result.stderr,/不可执行或不存在/);
});

test('development override cannot be selected in release and release requires bundled GStreamer',()=>{
  const rust=readFileSync(join(root,'src-tauri/src/receiver.rs'),'utf8');
  assert.match(rust,/#\[cfg\(debug_assertions\)\]\s*if let Some\(override_path\)/);
  assert.match(rust,/#\[cfg\(not\(debug_assertions\)\)\]/);
  assert.match(rust, /if development \{/);
  assert.match(rust, /#\[cfg\(windows\)\]/);
  assert.match(rust, /UXPLAY_DEV_GST_ROOT/);
  assert.match(rust,/if !bin\.is_dir\(\) \|\| !plugins\.is_dir\(\)/);
});

test('settings use accessible radio choices and retain Radix window bounds',()=>{
 const view=readFileSync(join(root,'src/components/AirpimoSettingsDialog.tsx'),'utf8');
 const dialog=readFileSync(join(root,'src/components/ui/dialog.tsx'),'utf8');
 assert.doesNotMatch(view,/<select[^>]+id="theme"/);
 assert.match(view,/role="radiogroup" aria-label="主题"/);
 assert.match(view,/type="radio" name="theme"/);
 assert.match(view,/46px/);
 assert.match(dialog,/overflow-y-auto/);
});

test('development and release expose distinct missing-binary messages', async()=>{
  const {issueHint}=await import('../src/domain/state.ts');
  assert.match(issueHint('missing_binary',true),/native:doctor/);
  assert.match(issueHint('missing_binary',false),/安装包/);
  assert.doesNotMatch(issueHint('missing_binary',false),/native:doctor|--uxplay/);
});
