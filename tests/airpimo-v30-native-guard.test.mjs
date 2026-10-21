import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root = resolve(import.meta.dirname, '..');
const read = file => readFileSync(resolve(root, file), 'utf8');

test('Windows/macOS -avdec default is in canonical argv, not an obsolete direct command call', () => {
  const args = read('src-tauri/src/uxplay_args.rs');
  const receiver = read('src-tauri/src/receiver.rs');
  assert.match(args, /#\[cfg\(any\(windows, target_os = "macos"\)\)\]\s*push_default\(&mut args, &custom, "-avdec", None\);/);
  assert.match(receiver, /let effective_args = match crate::uxplay_args::effective\(&name, fps, brightness, &user_args\)/);
  assert.match(receiver, /command\.args\(&effective_args\)/);
  assert.doesNotMatch(receiver, /#\[cfg\(windows\)\]\s*command\.arg\("-avdec"\)/);
});

test('native regression assertions follow the real Rust implementation', () => {
  const integration = read('tests/native-engine-integration.test.mjs');
  assert.match(integration, /assert\.match\(args,\/#\\\[cfg\\\(any\\\(windows/);
  assert.match(integration, /assert\.match\(receiver,\/command\\\.args\\\(&effective_args\\\)\/\);/);
  assert.doesNotMatch(integration, /assert\.match\(receiver,\/#\\\[cfg\\\(windows/);
});

test('patch is repeatable and preserves the v28 installer check', () => {
  const run = (script, ...args) => spawnSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8'});
  const p = run('scripts/ci/apply-airpimo-v30-native-guard.mjs','--check');
  assert.equal(p.status,0,p.stderr);
  const v28 = run('scripts/ci/apply-airpimo-uxplay-args.mjs','--check');
  assert.equal(v28.status,0,v28.stderr);
});
