import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolveGlobalGit,globalGitEnv} from '../scripts/win7-global-git.mjs';

const msys='C:\\msys64';
const git='C:\\Program Files\\Git\\cmd\\git.exe';
const available=new Set([`${msys}\\usr\\bin\\git.exe`,git]);
const exists=p=>available.has(p);

test('mDNS uses global Git for Windows rather than MSYS2 Git even if MSYS2 is first on PATH',()=>{
  assert.equal(resolveGlobalGit({env:{PATH:`${msys}\\usr\\bin;C:\\Program Files\\Git\\cmd`},msysRoot:msys,exists}),git);
});

test('explicit global Git path takes priority; explicitly providing MSYS2 Git is rejected',()=>{
  assert.equal(resolveGlobalGit({override:git,env:{PATH:`${msys}\\usr\\bin`},msysRoot:msys,exists}),git);
  assert.throws(()=>resolveGlobalGit({override:`${msys}\\usr\\bin\\git.exe`,msysRoot:msys,exists}),/points into MSYS2/);
});

test('build fails with useful instructions when there is no global Git for Windows',()=>{
  assert.throws(()=>resolveGlobalGit({env:{PATH:`${msys}\\usr\\bin`},msysRoot:msys,exists: p=>p.includes('msys64')}),/Git for Windows not found/);
});

test('Git process environment removes MSYS2 and GStreamer DLL search paths without altering caller environment',()=>{
  const env={PATH:`${msys}\\mingw64\\bin;F:\\gstreamer\\1.0\\mingw_x86_64\\bin;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32`,GIT_EXEC_PATH:`${msys}\\usr\\lib\\git-core`,MSYSTEM:'MINGW64',HTTP_PROXY:'http://127.0.0.1:7897'};
  const result=globalGitEnv({git,env,msysRoot:msys,gstRoot:'F:\\gstreamer\\1.0\\mingw_x86_64'});
  assert.equal(result.PATH,`C:\\Program Files\\Git\\cmd;C:\\Program Files\\Git\\cmd;C:\\Windows\\System32`);
  assert.equal(result.GIT_EXEC_PATH,undefined);
  assert.equal(result.MSYSTEM,undefined);
  assert.equal(result.HTTP_PROXY,env.HTTP_PROXY);
  assert.ok(env.PATH.includes('msys64'));
});

test('both mDNS pin and build use the resolved global git and separate process environment',()=>{
  const source=readFileSync(new URL('../scripts/win7-mdns-engine.mjs',import.meta.url),'utf8');
  assert.match(source,/resolveGlobalGit\(\{override:option\('--git'\),msysRoot:msys\}\)/);
  assert.match(source,/run\(git,\['clone'.*\],\{env:gitEnv\}\)/);
  assert.match(source,/run\(git,\['fetch'.*\],\{cwd:src,env:gitEnv\}\)/);
  assert.doesNotMatch(source,/exe\('git',usr\)/);
});
