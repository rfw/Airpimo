import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const receiver = readFileSync(resolve(import.meta.dirname, '../src-tauri/src/receiver.rs'), 'utf8');

test('stdout and stderr are dispatched separately without a mixed-type array', () => {
  assert.doesNotMatch(receiver, /\[\s*stdout\s*,\s*stderr\s*\]/);
  assert.match(receiver, /if let Some\(output\) = stdout\s*\{\s*spawn_log_reader\(output,/);
  assert.match(receiver, /if let Some\(output\) = stderr\s*\{\s*spawn_log_reader\(output,/);
});

test('both pipes use a single generic Read + Send line consumer', () => {
  assert.match(receiver, /fn consume_lines<R: Read>\(/);
  assert.match(receiver, /fn spawn_log_reader<R: Read \+ Send \+ 'static>\(/);
  assert.match(receiver, /BufReader::new\(input\)\.lines\(\)/);
  assert.match(receiver, /owner\.observe\(&app, epoch, line\)/);
});

test('Rust unit coverage includes both simulated log streams and Unicode', () => {
  assert.match(receiver, /fn handles_stdout_and_stderr_independently\(/);
  assert.match(receiver, /fn empty_and_unicode_lines_are_safe\(/);
});

test('Windows UxPlay process is launched without a console window and keeps output pipes', () => {
  assert.match(receiver, /#\[cfg\(windows\)\]\s*use std::os::windows::process::CommandExt;/);
  assert.match(receiver, /#\[cfg\(windows\)\]\s*const CREATE_NO_WINDOW: u32 = 0x0800_0000;/);
  assert.match(receiver, /#\[cfg\(windows\)\]\s*command\.creation_flags\(CREATE_NO_WINDOW\);/);
  assert.match(receiver, /command\.args\(&effective_args\)\.stdin\(Stdio::null\(\)\)\.stdout\(Stdio::piped\(\)\)\.stderr\(Stdio::piped\(\)\)/);
  assert.ok(receiver.indexOf('command.creation_flags(CREATE_NO_WINDOW)') < receiver.indexOf('command.spawn()'));
  assert.doesNotMatch(receiver, /DETACHED_PROCESS\s*\|/);
});
