import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultSnapshot, stageTitle, secondaryText, issueHint, validateDeviceName, validateFps, validateBrightness, showRestartPrompt, formatDuration} from '../src/domain/state.ts';

test('all required six states are described',()=>{
  assert.deepEqual(Object.keys(stageTitle).sort(),['connected','connecting','error','starting','stopped','waiting'].sort());
});
test('waiting status gives an actionable tip without claiming AirPlay discovery is verified', () => {
  const waiting = {
    ...defaultSnapshot,
    stage: 'waiting',
    process_running: true,
    discovery_verified: false,
  };
  assert.equal(secondaryText(waiting), '请在手机上查找 Airpimo');
  assert.doesNotMatch(secondaryText(waiting), /已验证|已核验|已发现/);

  assert.equal(
    secondaryText({...waiting, discovery_verified: true}),
    '可从手机发起投屏',
  );
});
test('connected status prompts audio confirmation only when not verified', () => {
  const connected = {
    ...defaultSnapshot,
    stage: 'connected',
    detail: '投屏画面已连接',
    audio_verified: false,
  };
  assert.equal(secondaryText(connected), '已连接，声音待确认');
  assert.equal(
    secondaryText({...connected, audio_verified: true}),
    '投屏画面已连接',
  );
});
test('other stages keep the original backend detail', () => {
  for (const stage of ['stopped', 'starting', 'connecting', 'error']) {
    const snapshot = {...defaultSnapshot, stage, detail: `诊断详情：${stage}`};
    assert.equal(secondaryText(snapshot), snapshot.detail, stage);
  }
});
test('diagnostic issue messages are actionable',()=>{
  for(const key of ['missing_binary','missing_runtime','port_in_use','mdns','audio','video','crash','unknown']) assert.ok(issueHint(key).length>=10,key);
});
test('device name accepts Chinese and validates controls/injection',()=>{
  assert.equal(validateDeviceName('卧室 AirPlay'),null);
  assert.equal(validateDeviceName('Mac-AirPlay'),null);
  assert.notEqual(validateDeviceName(''),null);
  assert.notEqual(validateDeviceName(' \n '),null);
  assert.notEqual(validateDeviceName('my/name'),null);
  assert.notEqual(validateDeviceName('x'.repeat(49)),null);
});
test('restart warning only when effective name differs and child alive',()=>{
  const state={...defaultSnapshot,process_running:true,applied_device_name:'Old',settings:{...defaultSnapshot.settings,device_name:'New'}};
  assert.equal(showRestartPrompt(state),true);
  assert.equal(showRestartPrompt({...state,process_running:false}),false);
  assert.equal(showRestartPrompt({...state,applied_device_name:'New'}),false);
});
test('duration is bounded and mm/ss padded',()=>{
  assert.equal(formatDuration(null,1000),'');
  assert.equal(formatDuration(1000,1000),'00:00:00');
  assert.equal(formatDuration(0,3661),'01:01:01');
  assert.equal(formatDuration(2000,1000),'00:00:00');
});

test('FPS validation accepts UxPlay 1..255 range, rejects nonintegers',()=>{
  for (const fps of [1,30,60,90,120,240,255]) assert.equal(validateFps(fps),null);
  for (const fps of [0,-1,256,60.5,NaN,Infinity]) assert.ok(validateFps(fps));
});
test('FPS changes prompt restart only while receiver is running',()=>{
  const active = {...defaultSnapshot,process_running:true,applied_device_name:defaultSnapshot.settings.device_name,applied_fps:60,
    settings:{...defaultSnapshot.settings,fps:120}};
  assert.equal(showRestartPrompt(active),true);
  assert.equal(showRestartPrompt({...active,process_running:false}),false);
  assert.equal(showRestartPrompt({...active,settings:{...active.settings,fps:60}}),false);
});


test('brightness 100% default and strict range',()=>{
  assert.equal(defaultSnapshot.settings.brightness,100);
  for (const x of [0,5,50,80,95,100]) assert.equal(validateBrightness(x),null);
  for (const x of [-1,101,80.5,NaN,Infinity]) assert.ok(validateBrightness(x));
});
test('brightness change shows restart note only while active',()=>{
  const state = {...defaultSnapshot,process_running:true,applied_brightness:80,
    settings:{...defaultSnapshot.settings,brightness:65}};
  assert.equal(showRestartPrompt(state),true);
  assert.equal(showRestartPrompt({...state,process_running:false}),false);
  assert.equal(showRestartPrompt({...state,settings:{...state.settings,brightness:80}}),false);
});
