import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

const manifest = readFileSync(resolve(import.meta.dirname, '../src-tauri/Cargo.toml'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf8'));
function dependency(crate) {
  const name = crate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = manifest.split(/\r?\n/).find((value) =>
    new RegExp(`^\\s*${name}\\s*=`).test(value));
  assert.ok(line, `缺少 ${crate} 依赖`);
  return line;
}

const pins = new Map([
  ['tauri', '2.11.1'],
  ['tauri-runtime', '2.11.1'],
  ['tauri-runtime-wry', '2.11.1'],
  ['tauri-build', '2.6.1'],
  ['tauri-codegen', '2.6.1'],
  ['tauri-macros', '2.6.1'],
  ['tauri-utils', '2.9.1'],
  ['tauri-plugin-single-instance', '2.3.7'],
]);
for (const [name, version] of pins) {
  test(`Tauri dependency ${name} pinned to ${version}`, () => {
    assert.match(dependency(name), new RegExp(`"=${version.replace(/\./g, '\\.') }"`));
  });
}
test('Tauri JS API and CLI stay aligned with the Rust core baseline', () => {
  assert.equal(pkg.dependencies['@tauri-apps/api'], '2.11.1');
  assert.equal(pkg.devDependencies['@tauri-apps/cli'], '2.11.1');
});
