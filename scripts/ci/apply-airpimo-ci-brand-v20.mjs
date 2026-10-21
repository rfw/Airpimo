#!/usr/bin/env node
// Airpimo v20: reconcile the v13 Actions test with the v19 artifact rename
// without overwriting newer workflow, scripts or test changes.
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const labelPairs = Object.freeze([
  ['uxplay-ci-windows-native','airpimo-ci-windows-native'],
  ['uxplay-win7-nsis-candidate','airpimo-win7-nsis-candidate'],
  ['uxplay-win10plus-nsis-candidate','airpimo-win10plus-nsis-candidate'],
  ['uxplay-macos-intel-dmg-candidate','airpimo-macos-intel-dmg-candidate'],
  ['uxplay-macos-arm64-dmg-candidate','airpimo-macos-arm64-dmg-candidate'],
]);
const titleOld = '--title "UxPlay Desktop $RELEASE_TAG"';
const titleNew = '--title "Airpimo $RELEASE_TAG"';

const replaceAll = (src, from, to) => src.split(from).join(to);
function assertNoLegacyLabels(file, content) {
  for (const [old] of labelPairs) {
    if (content.includes(old)) throw new Error(`${file}: legacy artifact label remains: ${old}`);
  }
}
function transformer(root) {
  const changes = new Map();
  function patch(file, fn) {
    const path = join(root,file);
    if (!existsSync(path)) throw new Error(`Required file not found: ${file}`);
    const before = readFileSync(path,'utf8');
    const after = fn(before);
    if (before !== after) changes.set(file,{path,before,after});
  }
  patch('tests/actions-runtime-warnings.test.mjs', src => {
    if (!src.includes('four-platform gate, artifact names and macOS build signatures remain locked')) {
      throw new Error('Unexpected actions-runtime-warnings.test.mjs; refusing unsafe edit');
    }
    for (const [old,next] of labelPairs) src = replaceAll(src,old,next);
    for (const [,next] of labelPairs) {
      if (!src.includes(next)) throw new Error(`actions-runtime-warnings test lost artifact assertion: ${next}`);
    }
    assertNoLegacyLabels('tests/actions-runtime-warnings.test.mjs',src);
    return src;
  });
  patch('.github/workflows/release-gate.yml', src => {
    for (const [,next] of labelPairs) {
      if (!src.includes(`name: ${next}`)) throw new Error(`Workflow missing Airpimo artifact: ${next}`);
    }
    assertNoLegacyLabels('.github/workflows/release-gate.yml',src);
    if (!src.includes(titleOld) && !src.includes(titleNew)) throw new Error('Release title anchor changed; inspect it manually');
    return replaceAll(src,titleOld,titleNew);
  });
  patch('scripts/ci/apply-airpimo-brand.mjs', src => {
    const testAnchor = "  transform('.github/workflows/release-gate.yml', src => {";
    const addition = "  transform('tests/actions-runtime-warnings.test.mjs', src => {\n    for (const [oldLabel, newLabel] of artifactLabels) src = replace(src, oldLabel, newLabel);\n    return src;\n  }, {optional:true});\n";
    if (!src.includes("transform('tests/actions-runtime-warnings.test.mjs'")) {
      if (!src.includes(testAnchor)) throw new Error('v19 brand script workflow anchor missing');
      src = src.replace(testAnchor, addition + testAnchor);
    }
    const workflowAnchor = "    src = src.replace(/^name:\\s*[^\\r\\n]+/m, 'name: Airpimo Release (Windows + macOS)');";
    if (!src.includes('src = replace(src, \'--title "UxPlay Desktop $RELEASE_TAG"\'')) {
      if (!src.includes(workflowAnchor)) throw new Error('v19 workflow title anchor missing');
      src = src.replace(workflowAnchor, workflowAnchor + '\n    src = replace(src, \'--title "UxPlay Desktop $RELEASE_TAG"\', \'--title "Airpimo $RELEASE_TAG"\');');
    }
    return src;
  });
  return changes;
}

export function applyAirpimoCiBrandV20(root = projectRoot,{apply = false} = {}) {
  const changes = transformer(root);
  if (apply && changes.size) {
    const backupBase = join(root,'.airpimo-brand-backup','v20-ci-artifacts');
    for (const [name, change] of changes) {
      const destination=join(backupBase,name);
      mkdirSync(dirname(destination),{recursive:true});
      if (!existsSync(destination)) writeFileSync(destination,change.before,'utf8');
    }
    for (const change of changes.values()) writeFileSync(change.path,change.after,'utf8');
  }
  return [...changes.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2] ?? '--check';
    if (!['--apply','--check'].includes(mode)) throw new Error('Usage: node scripts/ci/apply-airpimo-ci-brand-v20.mjs --apply | --check');
    const modified=applyAirpimoCiBrandV20(projectRoot,{apply:mode==='--apply'});
    for (const name of modified) console.log(`[airpimo-ci] ${mode==='--apply'?'UPDATED':'PENDING'} ${name}`);
    if (mode==='--check' && modified.length) throw new Error(`${modified.length} files still require v20 edits; use --apply`);
    console.log(`[airpimo-ci] PASS, ${modified.length} file(s) changed`);
  }catch(error){console.error(`[airpimo-ci] BLOCKED: ${error.message}`);process.exitCode=2;}
}
