import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {planAirpimoBrand} from '../scripts/ci/apply-airpimo-brand.mjs';
import {applyAirpimoCiBrandV20} from '../scripts/ci/apply-airpimo-ci-brand-v20.mjs';

const root=resolve(import.meta.dirname,'..');
const read = path => readFileSync(resolve(root,path),'utf8');
const labels = new Map([
  ['airpimo-ci-windows-native',3],
  ['airpimo-win7-nsis-candidate',2],
  ['airpimo-win10plus-nsis-candidate',2],
  ['airpimo-macos-intel-dmg-candidate',2],
  ['airpimo-macos-arm64-dmg-candidate',2],
]);

test('Airpimo CI artifact upload/download names stay matched across all four platforms',()=>{
  const yaml=read('.github/workflows/release-gate.yml');
  const testSource=read('tests/actions-runtime-warnings.test.mjs');
  assert.match(yaml,/needs: \[win7, win10plus, macos_intel, macos_arm64\]/);
  assert.match(yaml,/--target x86_64-apple-darwin --bundles app,dmg/);
  assert.match(yaml,/--target aarch64-apple-darwin --bundles app,dmg/);
  for (const [label,expectedOccurrences] of labels) {
    const actual=yaml.split(`name: ${label}`).length-1;
    assert.equal(actual,expectedOccurrences,`${label}: upload/download handshake changed`);
    assert.ok(testSource.includes(label),`${label}: missing Actions runtime test assertion`);
    assert.equal(yaml.includes(label.replace(/^airpimo-/,'uxplay-')),false);
    assert.equal(testSource.includes(label.replace(/^airpimo-/,'uxplay-')),false);
  }
  assert.match(yaml,/--title "Airpimo \$RELEASE_TAG"/);
  assert.doesNotMatch(yaml,/--title "UxPlay Desktop \$RELEASE_TAG"/);
});

test('the v19 brand script knows the v13 runtime test and v20 is idempotent',()=>{
  assert.match(read('scripts/ci/apply-airpimo-brand.mjs'),/transform\('tests\/actions-runtime-warnings\.test\.mjs'/);
  assert.deepEqual(applyAirpimoCiBrandV20(root),[]);
  assert.equal(planAirpimoBrand(root).files.size,0);
});
