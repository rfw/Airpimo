#!/usr/bin/env node
// Verify the Cargo-resolved graph, not merely the manifest's top-level requirements.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const filename = resolve(import.meta.dirname, '../src-tauri/Cargo.lock');
const expected = {
  'tauri': '2.11.1',
  'tauri-runtime': '2.11.1',
  'tauri-runtime-wry': '2.11.1',
  'tauri-utils': '2.9.1',
  'tauri-build': '2.6.1',
  'tauri-codegen': '2.6.1',
  'tauri-macros': '2.6.1',
  'tauri-plugin-single-instance': '2.3.7',
};
let content;
try { content = readFileSync(filename, 'utf8'); }
catch {
  console.error('BLOCKED: 缺少 src-tauri/Cargo.lock。请先运行 cargo check --manifest-path src-tauri/Cargo.toml。');
  process.exit(2);
}
const actual = new Map();
for (const entry of content.split(/^\[\[package\]\]\s*$/m).slice(1)) {
  const name = /^name\s*=\s*"([^"]+)"/m.exec(entry)?.[1];
  const version = /^version\s*=\s*"([^"]+)"/m.exec(entry)?.[1];
  if (name && version && Object.hasOwn(expected, name)) {
    actual.set(name, [...(actual.get(name) ?? []), version]);
  }
}
let failures = 0;
for (const [name, want] of Object.entries(expected)) {
  const found = actual.get(name) ?? [];
  if (found.length !== 1 || found[0] !== want) {
    console.error(`FAIL: ${name}: 预期 ${want}；Cargo.lock 实际 ${found.join(', ') || '未找到'}`);
    failures++;
  } else {
    console.log(`PASS: ${name}@${want}`);
  }
}
if (failures) process.exit(1);
console.log('PASS: Tauri 2.11.1 内部依赖锁定完整（仅检查 Cargo.lock，不代表原生编译成功）');
