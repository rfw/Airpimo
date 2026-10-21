#!/usr/bin/env node
/**
 * Airpimo first prerelease: set application metadata to 0.1.0 without touching
 * dependency versions, runtime files or release candidates in the workflow.
 * Publish using the annotated Git tag v0.1.0-rc.1 (not v0.1.0).
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

export const RELEASE_VERSION = '0.1.0';
export const PRERELEASE_TAG = 'v0.1.0-rc.1';
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const ownVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function ensure(condition, message) {
  if (!condition) throw Error(`BLOCKED: ${message}`);
}
function replaceOne(text, pattern, updater, source) {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g'))];
  ensure(matches.length === 1, `${source}: expected one matching own-version field, found ${matches.length}`);
  return text.replace(pattern, updater);
}
function swapVersion(value, label) {
  ensure(typeof value === 'string' && ownVersionPattern.test(value), `${label}: unexpected existing version ${String(value)}`);
  return RELEASE_VERSION;
}
function swapJsonRootVersion(file, text, expectedName) {
  const data = JSON.parse(text);
  ensure(data.name === expectedName, `${file}: unexpected package name ${data.name}`);
  swapVersion(data.version, `${file}.version`);
  if (file === 'package-lock.json') {
    ensure(data.packages?.['']?.name === expectedName, 'package-lock.json: root lock package name mismatch');
    swapVersion(data.packages[''].version, 'package-lock.json: root package version');
    // Only the root-level package metadata may change, not any dependency version.
    const updated = JSON.parse(JSON.stringify(data));
    updated.version = RELEASE_VERSION;
    updated.packages[''].version = RELEASE_VERSION;
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    let output = JSON.stringify(updated, null, 2).replace(/\n/g, newline);
    if (text.endsWith('\n')) output += newline;
    return output;
  }
  return replaceOne(text, /^(\s*"version"\s*:\s*")([^"]+)("\s*,?\s*)$/m,
    (_all, start, _current, end) => `${start}${RELEASE_VERSION}${end}`, file);
}
function swapCargoToml(text) {
  const first = /^\[package\]\s*\r?\n/m.exec(text);
  ensure(Boolean(first), 'Cargo.toml: [package] section missing');
  const start = first.index + first[0].length;
  const nextSection = /^\[[^\]\r\n]+\]/gm;
  nextSection.lastIndex = start;
  const next = nextSection.exec(text);
  const end = next ? next.index : text.length;
  const body = text.slice(start, end);
  ensure(/^name\s*=\s*"airpimo"\s*$/m.test(body), 'Cargo.toml: [package] name is not airpimo');
  const updated = replaceOne(body, /^(version\s*=\s*")([^"]+)(".*)$/m,
    (_all, prefix, current, suffix) => `${prefix}${swapVersion(current, 'Cargo.toml [package]')}${suffix}`,
    'Cargo.toml [package]');
  return text.slice(0, start) + updated + text.slice(end);
}
function swapCargoLock(text) {
  return replaceOne(text,
    /(^\[\[package\]\]\s*\r?\nname\s*=\s*"airpimo"\s*\r?\nversion\s*=\s*")([^"]+)(")/m,
    (_all, prefix, current, suffix) => `${prefix}${swapVersion(current, 'Cargo.lock airpimo')}${suffix}`,
    'Cargo.lock airpimo');
}
function verifyTagWorkflow(root) {
  const workflow = join(root, '.github/workflows/release-gate.yml');
  ensure(existsSync(workflow), '.github/workflows/release-gate.yml not found');
  const text = readFileSync(workflow, 'utf8');
  ensure(/tags\s*:\s*\r?\n\s*-\s*['"]v\*['"]/.test(text), 'release-gate.yml: missing v* push tag trigger');
  ensure(text.includes('gh release create') && text.includes('--prerelease') && text.includes('--latest=false'),
    'release-gate.yml: must publish annotated prerelease tags as GitHub prereleases');
  ensure(/RELEASE_TAG/.test(text), 'release-gate.yml: prerelease selection must use the tag');
  return workflow;
}
export function prepareFirstPrerelease(root = defaultRoot, {apply = false} = {}) {
  const base = resolve(root);
  const sources = [
    ['package.json', text => swapJsonRootVersion('package.json', text, 'airpimo')],
    ['package-lock.json', text => swapJsonRootVersion('package-lock.json', text, 'airpimo')],
    ['src-tauri/tauri.conf.json', text => {
      const parsed = JSON.parse(text);
      ensure(parsed.productName === 'Airpimo', 'Tauri productName is not Airpimo');
      swapVersion(parsed.version, 'tauri.conf.json');
      return replaceOne(text, /^(\s{2}"version"\s*:\s*")([^"]+)("\s*,?\s*)$/m,
        (_all, prefix, _current, suffix) => `${prefix}${RELEASE_VERSION}${suffix}`, 'tauri.conf.json');
    }],
    ['src-tauri/Cargo.toml', swapCargoToml],
    ['src-tauri/Cargo.lock', swapCargoLock],
  ];
  const updates = sources.map(([relative, transformer]) => {
    const file = join(base, relative);
    ensure(existsSync(file), `${relative} not found`);
    const before = readFileSync(file, 'utf8');
    const after = transformer(before);
    return {relative, file, before, after, changed: after !== before};
  });
  verifyTagWorkflow(base);
  // Validate every planned file before any write. Only version metadata changes.
  if (apply) for (const entry of updates) {
    if (entry.changed) writeFileSync(entry.file, entry.after, 'utf8');
  }
  return {
    version: RELEASE_VERSION,
    tag: PRERELEASE_TAG,
    changed: updates.filter(x => x.changed).map(x => x.relative),
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2] ?? '--check';
  try {
    ensure(['--apply', '--check', '--plan'].includes(mode), 'use --plan, --apply or --check');
    const result = prepareFirstPrerelease(defaultRoot, {apply: mode === '--apply'});
    for (const f of result.changed) console.log(`[first-preview] ${mode === '--apply' ? 'UPDATED' : 'DIFF'} ${f}`);
    if (mode === '--check' && result.changed.length > 0)
      throw Error(`BLOCKED: ${result.changed.length} version metadata file(s) differ from ${RELEASE_VERSION}; run --apply first`);
    console.log(`[first-preview] PASS: Airpimo ${result.version}; GitHub prerelease tag ${result.tag}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
