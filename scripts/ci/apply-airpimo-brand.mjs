#!/usr/bin/env node
/**
 * Safely rebrand the existing checkout without copying old project files over
 * newer versions. UxPlay/GStreamer are upstream/native engine names: preserve.
 *
 * Usage: node scripts/ci/apply-airpimo-brand.mjs [--apply | --check]
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const oldName = 'UxPlay Desktop';
const newName = 'Airpimo';
const oldId = 'com.uxplaydesktop.receiver';
const newId = 'com.airpimo.desktop';

export function planAirpimoBrand(root = defaultRoot) {
  const files = new Map();
  function transform(relativePath, fn, {optional=false}={}) {
    const path = join(root, relativePath);
    if (!existsSync(path)) {
      if (optional) return;
      throw new Error(`Missing required file: ${relativePath}`);
    }
    const before = readFileSync(path, 'utf8');
    const after = fn(before, relativePath);
    if (typeof after !== 'string') throw new Error(`Expected string: ${relativePath}`);
    if (before !== after) files.set(relativePath, {path, before, after});
  }
  function replace(content, from, to) { return content.split(from).join(to); }
  function replaceScoped(relativePath, from, to, opts) {
    transform(relativePath, txt => replace(txt, from, to), opts);
  }

  const manifestPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (!['uxplay-desktop', 'airpimo'].includes(pkg.name)) {
    throw new Error(`Unexpected npm package: ${pkg.name}`);
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.\-]+)?$/.test(pkg.version)) {
    throw new Error(`Unexpected package version: ${pkg.version}`);
  }
  transform('package.json', src => {
    src = src.replace(/("name"\s*:\s*")uxplay-desktop("\s*,)/, '$1airpimo$2');
    return replace(src, 'Minimal cross-platform AirPlay mirroring receiver powered by UxPlay',
      'Airpimo — cross-platform AirPlay receiver powered by UxPlay');
  });
  transform('package-lock.json', src => {
    // Only the two root package fields, never dependency names/versions.
    const lock = JSON.parse(src);
    if (!['uxplay-desktop','airpimo'].includes(lock.name) || !['uxplay-desktop','airpimo'].includes(lock.packages?.['']?.name)) {
      throw new Error('package-lock.json root package names are unexpected');
    }
    lock.name = 'airpimo';
    lock.packages[''].name = 'airpimo';
    if (lock.version !== pkg.version || lock.packages[''].version !== pkg.version) {
      throw new Error('package-lock.json version mismatch; synchronize npm lock before rebranding');
    }
    return src.replace(/^(\s*"name"\s*:\s*")uxplay-desktop("\s*,)/gm, '$1airpimo$2');
  });

  transform('src-tauri/tauri.conf.json', src => {
    const tauri = JSON.parse(src);
    if (![oldName, newName].includes(tauri.productName)) throw new Error('Unexpected Tauri productName');
    if (![oldId, newId].includes(tauri.identifier)) throw new Error('Unexpected Tauri identifier');
    src = replace(src, `"productName": "${oldName}"`, `"productName": "${newName}"`);
    src = replace(src, `"identifier": "${oldId}"`, `"identifier": "${newId}"`);
    src = replace(src, `"title": "${oldName}"`, `"title": "${newName}"`);
    return src;
  });
  transform('src-tauri/Cargo.toml', src => {
    if (!/^name\s*=\s*"(?:uxplay-desktop|airpimo)"/m.test(src)) throw new Error('Unexpected Cargo package name');
    src = src.replace(/^(name\s*=\s*")uxplay-desktop("\s*)$/m, '$1airpimo$2');
    src = src.replace(/^(name\s*=\s*")uxplay_desktop_lib("\s*)$/m, '$1airpimo_lib$2');
    return replace(src, 'Minimal desktop AirPlay mirroring receiver', 'Airpimo desktop AirPlay receiver');
  });
  transform('src-tauri/Cargo.lock', src => {
    const count = [...src.matchAll(/^name\s*=\s*"(?:uxplay-desktop|airpimo)"\s*$/gm)].length;
    if (count !== 1) throw new Error(`Cargo.lock: expected one project entry, found ${count}`);
    return src.replace(/^(name\s*=\s*")uxplay-desktop("\s*)$/m, '$1airpimo$2');
  });
  replaceScoped('src-tauri/src/main.rs', 'uxplay_desktop_lib::run()', 'airpimo_lib::run()');
  transform('src-tauri/src/lib.rs', src => {
    src = replace(src, '.tooltip("UxPlay Desktop")', '.tooltip("Airpimo")');
    if (src.includes('fn migrate_legacy_airpimo_settings(')) return src;
    const anchor = 'fn show_main(app:&AppHandle) {';
    if (!src.includes(anchor)) throw new Error('src-tauri/src/lib.rs: main-window anchor not found; refusing unsafe migration patch');
    const migration = `// Brand migration: existing UxPlay Desktop users retain their saved receiver settings.\n// Never overwrite settings already created by Airpimo; do not move or delete the old file.\nfn migrate_legacy_airpimo_settings(current_path: &std::path::Path) {\n    if current_path.exists() { return; }\n    let Some(current_dir) = current_path.parent() else { return; };\n    if current_dir.file_name().and_then(|n| n.to_str()) != Some("${newId}") { return; }\n    let Some(config_root) = current_dir.parent() else { return; };\n    let old_path = config_root.join("${oldId}").join("settings.json");\n    if !old_path.is_file() { return; }\n    let (old_settings, valid) = settings::load(&old_path);\n    if valid {\n        if let Err(err) = settings::save(current_path, &old_settings) {\n            eprintln!("Airpimo legacy settings migration skipped: {err}");\n        }\n    }\n}\n\n`;
    src = src.replace(anchor, migration + anchor);
    const needle = 'let path:PathBuf=settings_dir.join("settings.json");';
    if (!src.includes(needle)) throw new Error('src-tauri/src/lib.rs: settings path anchor not found');
    return src.replace(needle, `${needle}\n            migrate_legacy_airpimo_settings(&path);`);
  });
  transform('src/brand.ts', src => {
    src = replace(src, `appName: '${oldName}'`, `appName: '${newName}'`);
    // Device display name is user-configurable, not part of the product rebrand.
    if (/version:\s*['"][^'"]+['"]/.test(src)) {
      src = src.replace(/version:\s*['"][^'"]+['"]/, 'version: airpimoPackage.version');
    }
    if (src.includes('airpimoPackage.version') && !src.includes("import airpimoPackage from '../package.json';")) {
      src = `import airpimoPackage from '../package.json';\n` + src;
    }
    return src;
  });
  // Brand identity and the user-configurable AirPlay name are independent.
  // In particular, re-running the migration must not reset AirPlay/Office/etc.
  transform('src/domain/state.ts', src => {
    const settingsDefault = src.match(/\bdefaultSettings\s*:\s*Settings\s*=\s*\{[^}]*\bdevice_name\s*:\s*(['"])([^'"\r\n]+)\1/);
    const snapshotDefault = src.match(/\bdefaultSnapshot\s*:\s*Snapshot\s*=\s*\{[^}]*\bdevice_name\s*:\s*(['"])([^'"\r\n]+)\1/);
    if (!settingsDefault?.[2]?.trim() || !snapshotDefault?.[2]?.trim()) {
      throw new Error('Frontend AirPlay defaults missing or invalid; inspect src/domain/state.ts');
    }
    return src;
  });
  transform('src-tauri/src/settings.rs', src => {
    const rustDefault = src.match(/\bSelf\s*\{\s*device_name\s*:\s*"([^"\r\n]+)"/);
    if (!rustDefault?.[1]?.trim()) {
      throw new Error('Rust AirPlay default missing or invalid; inspect src-tauri/src/settings.rs');
    }
    return src;
  });
  replaceScoped('index.html', `<title>${oldName}</title>`, `<title>${newName}</title>`);
  replaceScoped('src/App.tsx', 'uxplay-diagnostics-', 'airpimo-diagnostics-');
  replaceScoped('src-tauri/src/receiver.rs', 'UXPLAY DESKTOP / LOCAL DIAGNOSTICS', 'AIRPIMO / LOCAL DIAGNOSTICS');
  transform('scripts/win7-smoke.cmd', src => replace(src, oldName, newName), {optional:true});
  transform('README.md', src => replace(src, oldName, newName), {optional:true});

  // Version automation must accept the rebranded package. Keep release versions intact.
  transform('scripts/ci/sync-release-version.mjs', src => replace(src, 'uxplay-desktop', 'airpimo'), {optional:true});
  transform('tests/release-version-sync.test.mjs', src => replace(src, 'uxplay-desktop', 'airpimo'), {optional:true});
  transform('tests/windows-build-targets.test.mjs', src => replace(src, oldName, newName), {optional:true});
  transform('tests/state.test.mjs', src => replace(src, "applied_device_name:'Mac-AirPlay'", 'applied_device_name:defaultSnapshot.settings.device_name'), {optional:true});
  transform('tests/tag-release.test.mjs', src => replace(src, oldName, newName), {optional:true});

  // Rename generated CI artifact labels, not upstream UxPlay engines or project repository URLs.
  const artifactLabels = [
    ['uxplay-ci-windows-native', 'airpimo-ci-windows-native'],
    ['uxplay-win7-nsis-candidate', 'airpimo-win7-nsis-candidate'],
    ['uxplay-win10plus-nsis-candidate', 'airpimo-win10plus-nsis-candidate'],
    ['uxplay-macos-intel-dmg-candidate', 'airpimo-macos-intel-dmg-candidate'],
    ['uxplay-macos-arm64-dmg-candidate', 'airpimo-macos-arm64-dmg-candidate'],
    ['uxplay-cloud-release-', 'airpimo-cloud-release-'],
  ];
  transform('tests/actions-runtime-warnings.test.mjs', src => {
    for (const [oldLabel, newLabel] of artifactLabels) src = replace(src, oldLabel, newLabel);
    return src;
  }, {optional:true});
  transform('.github/workflows/release-gate.yml', src => {
    for (const [a,b] of artifactLabels) src = replace(src,a,b);
    src = src.replace(/^name:\s*[^\r\n]+/m, 'name: Airpimo Release (Windows + macOS)');
    src = replace(src, '--title "UxPlay Desktop $RELEASE_TAG"', '--title "Airpimo $RELEASE_TAG"');
    return src;
  }, {optional:true});
  transform('scripts/ci/prepare-release-assets.mjs', src => {
    src = replace(src, 'uxplay-desktop-', 'airpimo-');
    src = replace(src, 'UxPlay Desktop', 'Airpimo');
    src = replace(src, 'UxPlay-Desktop', 'Airpimo');
    return src;
  }, {optional:true});
  transform('.gitignore', src => src.includes('.airpimo-brand-backup/') ? src : `${src.replace(/\s*$/, '')}\n.airpimo-brand-backup/\n`, {optional:true});
  // Active release docs only; historical engineering/third-party references are preserved.
  for (const doc of ['docs/GITHUB-ACTIONS-RELEASE.md','docs/WINDOWS-BUILD-TARGETS.md','docs/GITHUB-ACTIONS-CLOUD.md']) {
    transform(doc, src => replace(src, oldName, newName), {optional:true});
  }
  return {root, files, version:pkg.version};
}

export function applyAirpimoBrand(root=defaultRoot, {apply=false}={}) {
  const plan = planAirpimoBrand(root);
  if (apply && plan.files.size) {
    const backup = join(root,'.airpimo-brand-backup');
    // Validate all files and prepare backup before any changes.
    for (const [name, change] of plan.files) {
      const target = join(backup, name);
      mkdirSync(dirname(target), {recursive:true});
      if (!existsSync(target)) writeFileSync(target, change.before, 'utf8');
    }
    for (const change of plan.files.values()) writeFileSync(change.path, change.after, 'utf8');
  }
  return {version:plan.version, changed:[...plan.files.keys()], backup:'.airpimo-brand-backup'};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2] ?? '--check';
    if (!['--check','--apply'].includes(mode)) throw new Error('Usage: node scripts/ci/apply-airpimo-brand.mjs --apply | --check');
    const result = applyAirpimoBrand(defaultRoot,{apply:mode==='--apply'});
    for (const f of result.changed) console.log(`[brand] ${mode==='--apply'?'UPDATED':'PENDING'} ${f}`);
    if (mode==='--check' && result.changed.length) throw new Error(`${result.changed.length} Airpimo files require updates; run --apply`);
    console.log(`[brand] PASS Airpimo v${result.version}; ${result.changed.length} files changed`);
  } catch (error) {
    console.error(`[brand] BLOCKED: ${error.message}`);
    process.exitCode = 2;
  }
}
