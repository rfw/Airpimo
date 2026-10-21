#!/usr/bin/env node
// Repair an obsolete native integration assertion after expert argv composition.
// The actual Windows -avdec default and the receiver-to-UxPlay argv path remain checked.
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, join} from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const apply = process.argv.includes('--apply');
const check = process.argv.includes('--check');
if (apply === check) {
  console.error('Usage: node scripts/ci/apply-airpimo-v30-native-guard.mjs --apply|--check');
  process.exit(2);
}

const testFile = 'tests/native-engine-integration.test.mjs';
const installerFile = 'scripts/ci/apply-airpimo-uxplay-args.mjs';
const oldGuard = String.raw`assert.match(receiver,/#\[cfg\(windows\)\]\s*command\.arg\("-avdec"\)/);`;
const newGuards = [
  String.raw`assert.match(args,/#\[cfg\(any\(windows, target_os = "macos"\)\)\]\s*push_default\(&mut args, &custom, "-avdec", None\);/);`,
  String.raw`assert.match(receiver,/let effective_args = match crate::uxplay_args::effective\(&name, fps, brightness, &user_args\)/);`,
  String.raw`assert.match(receiver,/command\.args\(&effective_args\)/);`,
].join('\n  ');
const changes = [];

function prepare(file, fn) {
  const path = join(root, file);
  const before = readFileSync(path, 'utf8');
  const after = fn(before);
  if (!after || !after.includes(newGuards)) {
    if (file === testFile) throw new Error(`${file}: repair produced incomplete assertions`);
  }
  changes.push({file, path, before, after});
}

prepare(testFile, src => {
  const seenOld = src.split(oldGuard).length - 1;
  const seenNew = src.split(newGuards).length - 1;
  if (seenNew === 1 && seenOld === 0) return src;
  if (seenOld !== 1 || seenNew !== 0) {
    throw new Error(`${testFile}: expected exactly one old assertion or one repaired assertion; old=${seenOld} new=${seenNew}`);
  }
  if (!src.includes("const args = readFileSync(new URL('../src-tauri/src/uxplay_args.rs', import.meta.url),'utf8');")) {
    throw new Error(`${testFile}: brightness test does not load uxplay_args.rs`);
  }
  return src.replace(oldGuard, newGuards);
});

prepare(installerFile, src => {
  const marker = ",'brightness Win decode test');";
  const end = src.indexOf(marker);
  if (end < 0 || src.indexOf(marker, end + marker.length) >= 0) {
    throw new Error(`${installerFile}: missing or ambiguous brightness patch clause`);
  }
  const start = src.lastIndexOf('  src=replace(src,', end);
  if (start < 0) throw new Error(`${installerFile}: missing brightness patch start`);
  const afterMarker = end + marker.length;
  const existingClause = src.slice(start, afterMarker);
  if (!existingClause.includes('-avdec') || !existingClause.includes('assert.match(receiver,')) {
    throw new Error(`${installerFile}: unexpected brightness patch format`);
  }
  const newClause = `  src=replace(src,${JSON.stringify(oldGuard)},\n    ${JSON.stringify(newGuards)},'brightness Win decode test');`;
  return src.slice(0, start) + newClause + src.slice(afterMarker);
});

if (check) {
  for (const {file,before,after} of changes) {
    if (before !== after) throw new Error(`${file}: correction not yet applied`);
  }
  console.log('[airpimo-v30] PASS: Windows decoder integration test and installer template are aligned');
} else {
  const written = [];
  try {
    for (const change of changes) {
      if (change.before === change.after) continue;
      writeFileSync(change.path, change.after, 'utf8');
      written.push(change);
      console.log(`[airpimo-v30] updated ${change.file}`);
    }
  } catch (err) {
    for (const change of written.reverse()) writeFileSync(change.path, change.before, 'utf8');
    throw err;
  }
  console.log('[airpimo-v30] PASS: corrected static decoder regression assertion');
}
