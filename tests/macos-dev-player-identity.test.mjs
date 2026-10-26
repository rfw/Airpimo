import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync, chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {prepareMacDevPlayerApp, macDevPlayerPlist} from '../scripts/dev-macos-player-app.mjs';

const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(run) {
  const root = mkdtempSync(join(tmpdir(), 'airpimo-dev-mac-app-'));
  try {
    const source = join(root, 'cached', 'uxplay');
      mkdirSync(join(root, 'cached'), {recursive:true});
    writeFileSync(source, 'native-uxplay-unchanged', {mode:0o755});
    return run({root, source});
  } finally { rmSync(root, {recursive:true, force:true}); }
}

test('development macOS UxPlay receives a named app bundle with default Dock icon', () => fixture(({root, source}) => {
  const original = sha(readFileSync(source));
  const result = prepareMacDevPlayerApp(root, source, {platform:'darwin'});
  assert.equal(result, join(root, 'src-tauri', 'target', 'airpimo-player-dev', 'Airpimo Player.app', 'Contents', 'MacOS', 'Airpimo Player'));
  assert.equal(readFileSync(result, 'utf8'), 'native-uxplay-unchanged');
  assert.equal(sha(readFileSync(source)), original);
  // Windows cannot assert POSIX execute bits on a simulated macOS bundle.
  assert.ok(statSync(result).isFile());
  if (process.platform !== 'win32') assert.ok((statSync(result).mode & 0o111) !== 0);
  const plist = readFileSync(join(root, 'src-tauri/target/airpimo-player-dev/Airpimo Player.app/Contents/Info.plist'),'utf8');
  for (const key of ['CFBundleExecutable','CFBundleName','CFBundleDisplayName','CFBundleIdentifier']) assert.ok(plist.includes(`<key>${key}</key>`));
  assert.equal(plist, macDevPlayerPlist());
  assert.doesNotMatch(plist, /CFBundleIconFile|CFBundleIconName/);
  assert.equal(existsSync(join(root,'src-tauri/target/airpimo-player-dev/Airpimo Player.app/Contents/Resources/icon.icns')),false);
  assert.equal(prepareMacDevPlayerApp(root, source, {platform:'darwin'}), result);
}));

test('macOS dev wrapper updates for new engine bytes without changing cached UxPlay', () => fixture(({root,source})=>{
  const first=prepareMacDevPlayerApp(root,source,{platform:'darwin'});
  writeFileSync(source, 'new native UxPlay bytes', {mode:0o755});
  const second=prepareMacDevPlayerApp(root,source,{platform:'darwin'});
  assert.equal(first,second);
  assert.equal(readFileSync(first,'utf8'),'new native UxPlay bytes');
  assert.equal(readFileSync(source,'utf8'),'new native UxPlay bytes');
}));

test('POSIX app wrapper still rejects UxPlay without executable permission', {
  skip: process.platform === 'win32' ? 'Windows lacks Unix execute-bit semantics' : false,
}, () => fixture(({root,source})=>{
  chmodSync(source, 0o644);
  assert.throws(()=>prepareMacDevPlayerApp(root,source,{platform:'darwin'}), /不可执行/);
  assert.equal(existsSync(join(root,'src-tauri/target/airpimo-player-dev')), false);
}));

test('macOS app wrapper is never created on Windows and invalid engines fail closed', () => fixture(({root, source})=>{
  assert.equal(prepareMacDevPlayerApp(root,source,{platform:'win32'}),source);
  assert.throws(()=>prepareMacDevPlayerApp(root,join(root,'missing'),{platform:'darwin'}),/不可执行/);
  assert.equal(existsSync(join(root,'src-tauri/target/airpimo-player-dev')),false);
}));

test('desktop:dev uses branded macOS application only for development engine overrides',()=>{
  const source=read('scripts/desktop-dev.mjs');
  assert.match(source,/if \(process\.platform === 'darwin' && binary\)/);
  assert.match(source,/if \(injectOverride\) \{\s*binary = prepareMacDevPlayerApp\(root, binary\)/);
  assert.match(source,/UXPLAY_DEV_BINARY:binary/);
  assert.match(read('src-tauri/src/receiver.rs'),/command\.env\("AIRPIMO_PLAYER_TITLE_CHILD", "1"\)/);
});

test('macOS development wrapper rebuilds when an old custom player icon remains', () => fixture(({root,source})=>{
  const executable = prepareMacDevPlayerApp(root,source,{platform:'darwin'});
  const resources = join(root,'src-tauri/target/airpimo-player-dev/Airpimo Player.app/Contents/Resources');
  writeFileSync(join(resources,'icon.icns'), 'old duplicate dock icon');
  assert.ok(existsSync(join(resources,'icon.icns')));
  assert.equal(prepareMacDevPlayerApp(root,source,{platform:'darwin'}), executable);
  assert.equal(existsSync(join(resources,'icon.icns')), false);
}));

test('main macOS debug display name is initialized before Tauri and isolated from release and Windows',()=>{
  const rust = read('src-tauri/src/lib.rs');
  assert.match(rust, /#\[cfg\(all\(target_os = "macos", debug_assertions\)\)\]\s*fn configure_macos_dev_dock_name\(/);
  assert.match(rust, /pub fn run\(\) \{\s*#\[cfg\(all\(target_os = "macos", debug_assertions\)\)\]\s*configure_macos_dev_dock_name\(\);\s*#\[cfg\(windows\)\]/);
  assert.match(rust, /setProcessName:/);
  assert.match(rust, /Airpimo\\0/);
  assert.doesNotMatch(read('src-tauri/tauri.conf.json'), /"mainBinaryName"/);
});
