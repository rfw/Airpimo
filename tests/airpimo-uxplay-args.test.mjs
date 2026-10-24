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
  assert.match(rust,/uxplay_args::effective\(&name, fps, &user_args\)/);
  assert.match(rust,/command\.args\(&effective_args\)\.stdin\(Stdio::null\(\)\)/);
  assert.doesNotMatch(rust,/\.shell\(|cmd\.exe|powershell\.exe/);
  for (const key of ['"-n"','"-fps"','"-vc"']) assert.match(argv,new RegExp(key));
  assert.match(argv,/push_default\(&mut args, &custom, "-vol", Some\("0\.5"\)\)/);
  assert.doesNotMatch(argv,/videobalance|brightness/);
  assert.match(argv,/quote\.is_some\(\)/);
});

test('settings retain advanced option warning and existing controls',()=>{
 const view=read('src/components/AirpimoSettingsDialog.tsx');
 assert.match(view,/id="uxplayArgs"/);
 assert.match(view,/非专业人员请勿修改/);
 assert.match(view,/重启接收服务才会生效/);
 assert.match(view,/aria-label=\{t\(["']最大请求帧率["']\)\}/);
 assert.doesNotMatch(view,/画面亮度|draft\.brightness/);
});

test('native receiver retains advanced parameter support and UI ownership',()=>{
 const view=read('src/components/AirpimoSettingsDialog.tsx');
 assert.match(view,/draft.uxplay_args/);
 assert.match(read('src/App.tsx'),/validateUxplayArgs/);
 assert.match(read('src-tauri/src/receiver.rs'),/effective_args/);
});
