// Development-only macOS app identity for the UxPlay child process.
// The original engine and native cache are never renamed or modified.
// A genuine .app bundle gives AppKit/LaunchServices the name BEFORE creating
// the first video window; setProcessName and NSWindow.title alone are too late
// to reliably change the app menu and Dock tooltip.
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync,
  statSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const PLAYER_NAME = 'Airpimo Player';
const APP_REL = join('src-tauri', 'target', 'airpimo-player-dev', `${PLAYER_NAME}.app`);

export function macDevPlayerPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleIdentifier</key><string>com.airpimo.desktop.player.dev</string>
<key>CFBundleExecutable</key><string>Airpimo Player</string>
<key>CFBundleName</key><string>Airpimo Player</string>
<key>CFBundleDisplayName</key><string>Airpimo Player</string>
<key>CFBundleIconFile</key><string>icon.icns</string>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`;
}

const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');

export function prepareMacDevPlayerApp(root, enginePath, {platform = process.platform} = {}) {
  if (platform !== 'darwin') return enginePath;
  const engine = resolve(enginePath);
  if (!existsSync(engine) || !statSync(engine).isFile() || !(statSync(engine).mode & 0o111)) {
    throw new Error(`macOS 开发播放器源文件不可执行：${engine}`);
  }
  const icon = join(root, 'src-tauri', 'icons', 'icon.icns');
  if (!existsSync(icon)) throw new Error('macOS 开发播放器缺少 icon.icns');
  const app = join(root, APP_REL);
  const binary = join(app, 'Contents', 'MacOS', PLAYER_NAME);
  const plist = join(app, 'Contents', 'Info.plist');
  const iconDest = join(app, 'Contents', 'Resources', 'icon.icns');
  const identity = join(app, 'Contents', 'Resources', '.airpimo-dev-source.json');
  const receipt = JSON.stringify({source:engine, binarySha256:digest(engine), iconSha256:digest(icon)});
  if (existsSync(binary) && existsSync(plist) && existsSync(iconDest) && existsSync(identity) &&
      readFileSync(identity, 'utf8') === receipt &&
      readFileSync(plist, 'utf8') === macDevPlayerPlist() &&
      digest(binary) === digest(engine) && digest(iconDest) === digest(icon)) {
    return binary;
  }

  const parent = join(root, 'src-tauri', 'target', 'airpimo-player-dev');
  mkdirSync(parent, {recursive:true});
  const tmp = join(parent, `.Airpimo-Player-${process.pid}.tmp.app`);
  const backup = join(parent, `.Airpimo-Player-${process.pid}.backup.app`);
  rmSync(tmp, {recursive:true, force:true});
  rmSync(backup, {recursive:true, force:true});
  try {
    mkdirSync(join(tmp, 'Contents', 'MacOS'), {recursive:true});
    mkdirSync(join(tmp, 'Contents', 'Resources'), {recursive:true});
    copyFileSync(engine, join(tmp, 'Contents', 'MacOS', PLAYER_NAME));
    copyFileSync(icon, join(tmp, 'Contents', 'Resources', 'icon.icns'));
    writeFileSync(join(tmp, 'Contents', 'Info.plist'), macDevPlayerPlist());
    writeFileSync(join(tmp, 'Contents', 'Resources', '.airpimo-dev-source.json'), receipt);
    if (digest(join(tmp, 'Contents', 'MacOS', PLAYER_NAME)) !== digest(engine)) {
      throw new Error('macOS 开发播放器源文件复制校验失败');
    }
    const previous = existsSync(app);
    if (previous) renameSync(app, backup);
    try { renameSync(tmp, app); }
    catch (e) { if (previous) renameSync(backup, app); throw e; }
    rmSync(backup, {recursive:true, force:true});
  } finally {
    rmSync(tmp, {recursive:true, force:true});
  }
  return binary;
}
