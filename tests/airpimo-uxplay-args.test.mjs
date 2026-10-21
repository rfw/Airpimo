import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {defaultSnapshot, showRestartPrompt, validateUxplayArgs} from '../src/domain/state.ts';
const root=resolve(import.meta.dirname,'..');
const read = (name) => readFileSync(resolve(root,name),'utf8');

test('custom settings are optional and backward-compatible',()=>{
  const rs=read('src-tauri/src/settings.rs');
  assert.match(rs,/#\[serde\(default\)\]\s+pub uxplay_args: String/);
  assert.match(rs,/uxplay_args: String::new\(\)/);
  assert.match(rs,/uxplay_args:"-vol 0\.75"\.into\(\)/);
  assert.equal(defaultSnapshot.settings.uxplay_args,'');
  assert.equal(validateUxplayArgs('-vol 0.8'),null);
  assert.equal(validateUxplayArgs('-vol 0.8\n-debug 1'),null);
  assert.ok(validateUxplayArgs('x'.repeat(2050)));
});

test('editing advanced parameters requests restart only for running receiver',()=>{
  const s={...defaultSnapshot, process_running:true, applied_uxplay_args:'-vol 0.5',settings:{...defaultSnapshot.settings,uxplay_args:'-vol 0.9'}};
  assert.equal(showRestartPrompt(s),true);
  assert.equal(showRestartPrompt({...s,process_running:false}),false);
  assert.equal(showRestartPrompt({...s,settings:{...s.settings,uxplay_args:'-vol 0.5'}}),false);
});

test('receiver passes effective argv to spawn directly, without shell',()=>{
  const rust=read('src-tauri/src/receiver.rs');
  const argv=read('src-tauri/src/uxplay_args.rs');
  assert.match(rust,/uxplay_args::effective\(&name, fps, brightness, &user_args\)/);
  assert.match(rust,/command\.args\(&effective_args\)\.stdin\(Stdio::null\(\)\)/);
  assert.doesNotMatch(rust,/\.shell\(|cmd\.exe|powershell\.exe/);
  for (const key of ['"-n"','"-fps"','"-vc"']) assert.match(argv,new RegExp(key));
  assert.match(argv,/push_default\(&mut args, &custom, "-vol", Some\("0\.5"\)\)/);
  assert.match(argv,/if brightness < 100/);
  assert.match(argv,/quote\.is_some\(\)/);
});

test('settings provide warning, explicit restart semantics and existing controls remain',()=>{
  const app=read('src/App.tsx');
  for(const value of ['id="deviceName"','aria-label="最大请求帧率"','aria-label="画面亮度"','id="uxplayArgs"','非专业人员请勿修改','重启接收服务才会生效']) {
    assert.ok(app.includes(value),value);
  }
  assert.match(app,/setDraft\(x=>\(\{\.\.\.x,uxplay_args:e\.target\.value\}\)\)/);
  assert.match(app,/await desktop\.save\(/);
});

test('idempotent patch check completes without rewriting files',()=>{
  const result=spawnSync(process.execPath,['scripts/ci/apply-airpimo-uxplay-args.mjs','--check'],{cwd:root,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/PASS/);
});
