import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareFirstPrerelease, RELEASE_VERSION, PRERELEASE_TAG} from '../scripts/ci/prepare-airpimo-first-prerelease.mjs';

function fixture(fn, {publish = true} = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'airpimo-first-preview-'));
  const write = (path, text) => {
    const full = join(dir, path);
    mkdirSync(join(full, '..'), {recursive:true});
    writeFileSync(full, text, 'utf8');
  };
  try {
    write('package.json', '{\n  "name": "airpimo",\n  "version": "0.1.8",\n  "dependencies": {"example": "^2.5.0"}\n}\n');
    write('package-lock.json', '{\n  "name": "airpimo",\n  "version": "0.1.8",\n  "lockfileVersion": 3,\n  "packages": {\n    "": {"name": "airpimo", "version": "0.1.8"},\n    "node_modules/example": {"version": "2.5.7"}\n  }\n}\n');
    write('src-tauri/tauri.conf.json', '{\n  "productName": "Airpimo",\n  "version": "0.1.8",\n  "identifier": "com.airpimo.desktop"\n}\n');
    write('src-tauri/Cargo.toml', '[package]\nname = "airpimo"\nversion = "0.1.8"\n\n[dependencies]\nexample = "1.2.3"\n');
    write('src-tauri/Cargo.lock', 'version = 3\n\n[[package]]\nname = "airpimo"\nversion = "0.1.8"\n\n[[package]]\nname = "example"\nversion = "1.2.3"\n');
    write('.github/workflows/release-gate.yml', publish ? `on:\n  push:\n    tags:\n      - 'v*'\nsteps:\n  - run: |\n      if [[ "$RELEASE_TAG" == *-* ]]; then release_opts+=(--prerelease --latest=false); fi\n      gh release create "$RELEASE_TAG" release-assets/*` : 'on:\n  push:\n    tags:\n      - \'v*\'\n');
    return fn({dir, read: (p) => readFileSync(join(dir,p), 'utf8')});
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('0.1.8 -> 0.1.0: all five metadata sources, do not change dependencies or app identity', () => fixture(({dir,read}) => {
  const expected = prepareFirstPrerelease(dir, {apply:false});
  assert.equal(expected.changed.length,5);
  const outcome = prepareFirstPrerelease(dir, {apply:true});
  assert.equal(outcome.version,RELEASE_VERSION);
  assert.equal(outcome.tag,PRERELEASE_TAG);
  assert.deepEqual(outcome.changed, expected.changed);
  assert.equal(JSON.parse(read('package.json')).version,'0.1.0');
  assert.equal(JSON.parse(read('package.json')).dependencies.example,'^2.5.0');
  const lock = JSON.parse(read('package-lock.json'));
  assert.equal(lock.version,'0.1.0');
  assert.equal(lock.packages[''].version,'0.1.0');
  assert.equal(lock.packages['node_modules/example'].version,'2.5.7');
  assert.match(read('src-tauri/tauri.conf.json'), /"identifier": "com\.airpimo\.desktop"/);
  assert.match(read('src-tauri/Cargo.toml'), /example = "1\.2\.3"/);
  assert.match(read('src-tauri/Cargo.lock'), /name = "example"\nversion = "1\.2\.3"/);
  assert.deepEqual(prepareFirstPrerelease(dir).changed, []);
}));
test('does not write if release workflow cannot mark prereleases', () => fixture(({dir,read}) => {
  assert.throws(() => prepareFirstPrerelease(dir,{apply:true}),/must publish annotated prerelease/);
  assert.match(read('package.json'), /"version": "0\.1\.8"/);
}, {publish:false}));
test('already configured 0.1.0 is idempotent', () => fixture(({dir}) => {
  prepareFirstPrerelease(dir, {apply:true});
  assert.deepEqual(prepareFirstPrerelease(dir, {apply:true}).changed, []);
}));
