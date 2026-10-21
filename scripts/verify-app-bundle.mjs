#!/usr/bin/env node
/** Post-bundle verification: audit the .app actually emitted by Tauri.
 * macOS release jobs MUST explicitly bundle both app and dmg. A DMG-only
 * build may not leave a standalone .app for this independent verification.
 */
import {existsSync, readdirSync, statSync} from 'node:fs';
import {resolve, join, isAbsolute} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const MAC_TARGETS = Object.freeze(['x86_64-apple-darwin','aarch64-apple-darwin']);

/** Find Tauri bundles in target-specific and host-native layouts, including
 * a caller-provided CARGO_TARGET_DIR. Do not recursively scan unrelated files.
 */
export function macAppCandidates(projectRoot, target, cargoTargetDir = '') {
  if (!MAC_TARGETS.includes(target)) throw new Error(`Unknown macOS bundle target: ${target}`);
  const targetDirs = [join(projectRoot,'src-tauri','target'), join(projectRoot,'target')];
  if (cargoTargetDir) {
    // Cargo normally runs with src-tauri as its working directory; absolute
    // overrides work identically regardless of current directory.
    const cargoDir = isAbsolute(cargoTargetDir)
      ? cargoTargetDir : resolve(projectRoot,'src-tauri',cargoTargetDir);
    targetDirs.unshift(cargoDir);
  }
  const dirs = [...new Set(targetDirs.flatMap(base => [
    join(base,target,'release','bundle','macos'),
    join(base,'release','bundle','macos'),
  ]))];
  const apps = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const item of readdirSync(dir,{withFileTypes:true})) {
      if (!item.name.endsWith('.app')) continue;
      const path = join(dir,item.name);
      if (statSync(path).isDirectory()) apps.push(path);
    }
  }
  return {dirs,apps};
}

export function selectMacApp({projectRoot,target,cargoTargetDir='',explicitApp} = {}) {
  const discovered = macAppCandidates(projectRoot,target,cargoTargetDir);
  if (explicitApp !== undefined) {
    if (!explicitApp || !explicitApp.endsWith('.app')) throw new Error('--app must point to a .app directory');
    const selected = resolve(explicitApp);
    if (!existsSync(selected) || !statSync(selected).isDirectory()) throw new Error(`Not a .app directory: ${selected}`);
    return selected;
  }
  if (discovered.apps.length !== 1) {
    throw new Error(`Expected exactly one .app bundle for ${target}; found ${discovered.apps.length}. ` +
      `Searched: ${discovered.dirs.join(', ')}. Found: ${discovered.apps.join(', ') || '(none)'}. ` +
      'Tauri must build with --bundles app,dmg; specify --app /path/App.app if needed.');
  }
  return discovered.apps[0];
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function main() {
  if (process.platform !== 'darwin') throw new Error('.app verification must run on macOS');
  const root = resolve(import.meta.dirname,'..');
  const target = argValue('--target') ?? (process.arch==='arm64'?'aarch64-apple-darwin':'x86_64-apple-darwin');
  const app = selectMacApp({
    projectRoot:root,
    target,
    cargoTargetDir:process.env.CARGO_TARGET_DIR ?? '',
    explicitApp:argValue('--app'),
  });
  if (!existsSync(join(app,'Contents','Info.plist')) || !existsSync(join(app,'Contents','MacOS')))
    throw new Error(`Incomplete .app bundle (Info.plist or MacOS directory missing): ${app}`);
  const resources = join(app,'Contents','Resources');
  if (!existsSync(resources) || !statSync(resources).isDirectory())
    throw new Error(`Missing .app Contents/Resources: ${resources}`);
  const checker = join(root,'scripts','check-native.mjs');
  console.log(`Auditing actual Tauri app: ${app}`);
  console.log(`Auditing bundled resources: ${resources}`);
  const result = spawnSync(process.execPath,[checker,'--resources',resources],{stdio:'inherit'});
  if (result.error || result.status !== 0) throw new Error('Bundled resources failed native manifest/Mach-O/plugin verification');
  console.log('PASS: actual .app native resource manifest and Mach-O dependency checks; human AirPlay and clean macOS install still REQUIRED');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(`BLOCKED: ${error.message}`); process.exitCode = 2; }
}
