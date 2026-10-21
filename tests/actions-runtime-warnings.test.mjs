import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const yaml = readFileSync(resolve(import.meta.dirname, '../.github/workflows/release-gate.yml'), 'utf8');

test('official Node24 GitHub actions replace all Node20 versions', () => {
  const expected = new Map([
    ['checkout', 'v7'],
    ['setup-node', 'v7'],
    ['upload-artifact', 'v7'],
    ['download-artifact', 'v8'],
  ]);
  for (const match of yaml.matchAll(/actions\/(checkout|setup-node|upload-artifact|download-artifact)@v(\d+)/g)) {
    const name = match[1];
    assert.equal(`v${match[2]}`, expected.get(name), `Unexpected ${name} action runtime`);
  }
  for (const name of expected.keys()) {
    assert.match(yaml, new RegExp(`actions/${name}@${expected.get(name)}`));
  }
  assert.doesNotMatch(yaml, /actions\/(?:checkout|setup-node|upload-artifact|download-artifact)@v4/);
});

test('project runtime and Win7 msvcrt compiler baseline are unchanged', () => {
  assert.match(yaml, /node-version: '22'/);
  assert.match(yaml, /msystem: MINGW64/);
  assert.match(yaml, /suppress-deprecation-warnings: msystem-mingw64/);
  assert.match(yaml, /mingw-w64-x86_64-gcc/);
  assert.match(yaml, /mingw64\\bin/);
  assert.doesNotMatch(yaml, /msystem: UCRT64/);
  assert.match(yaml, /desktop:build:win7:mdns/);
  assert.match(yaml, /native:verify:win7:mdns/);
});

test('four-platform gate, artifact names and macOS build signatures remain locked', () => {
  assert.match(yaml, /needs: \[win7, win10plus, macos_intel, macos_arm64\]/);
  for (const name of ['airpimo-ci-windows-native', 'airpimo-win7-nsis-candidate', 'airpimo-win10plus-nsis-candidate', 'airpimo-macos-intel-dmg-candidate', 'airpimo-macos-arm64-dmg-candidate']) {
    assert.ok(yaml.includes(name), name);
  }
  assert.match(yaml, /--target x86_64-apple-darwin --bundles app,dmg/);
  assert.match(yaml, /--target aarch64-apple-darwin --bundles app,dmg/);
  assert.match(yaml, /prepare-release-assets\.mjs prepare/);
  assert.match(yaml, /gh release create/);
});
