import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, statSync, existsSync} from 'node:fs';
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
    const icon = join(root, 'src-tauri', 'icons', 'icon.icns');
    mkdirSync(join(root, 'cached'), {recursive:true});
    mkdirSync(join(root, 'src-tauri', 'icons'), {recursive:true});
    writeFileSync(source, 'native-uxplay-unchanged', {mode:0o755});
    writeFileSync(icon, 'mac-icon');
    return run({root, source, icon});
  } finally { rmSync(root, {recursive:true, force:true}); }
}

test('development macOS UxPlay receives a real Airpimo Player.app identity before launch', () => fixture(({root, source, icon}) => {
  const original = sha(readFileSync(source));
  const result = prepareMacDevPlayerApp(root, source, {platform:'darwin'});
  assert.match(result, /Airpimo Player\.app\/Contents\/MacOS\/Airpimo Player$/);
  assert.equal(readFileSync(result, 'utf8'), 'native-uxplay-unchanged');
  assert.equal(sha(readFileSync(source)), original);
  assert.ok((statSync(result).mode & 0o111) !== 0);
  const plist = readFileSync(join(root, 'src-tauri/target/airpimo-player-dev/Airpimo Player.app/Contents/Info.plist'),'utf8');
  for (const key of ['CFBundleExecutable','CFBundleName','CFBundleDisplayName','CFBundleIdentifier']) assert.ok(plist.includes(`<key>${key}</key>`));
  assert.equal(plist, macDevPlayerPlist());
  assert.equal(readFileSync(join(root,'src-tauri/target/airpimo-player-dev/Airpimo Player.app/Contents/Resources/icon.icns'),'utf8'), 'mac-icon');
  assert.equal(prepareMacDevPlayerApp(root, source, {platform:'darwin'}), result);
  assert.equal(readFileSync(icon,'utf8'), 'mac-icon');
}));

test('macOS dev wrapper updates for new engine bytes without changing cached UxPlay', () => fixture(({root,source})=>{
  const first=prepareMacDevPlayerApp(root,source,{platform:'darwin'});
  writeFileSync(source, 'new native UxPlay bytes', {mode:0o755});
  const second=prepareMacDevPlayerApp(root,source,{platform:'darwin'});
  assert.equal(first,second);
  assert.equal(readFileSync(first,'utf8'),'new native UxPlay bytes');
  assert.equal(readFileSync(source,'utf8'),'new native UxPlay bytes');
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
