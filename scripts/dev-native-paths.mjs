/** Development-only discovery of an existing UxPlay executable.
 * This module never copies or packages third-party binaries. */
import { existsSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

export function usableBinary(candidate, platform = process.platform) {
  if (!candidate || !isAbsolute(candidate)) return false;
  try {
    if (!existsSync(candidate) || !statSync(candidate).isFile()) return false;
    if (platform !== 'win32' && !(statSync(candidate).mode & 0o111)) return false;
    return true;
  } catch { return false; }
}
export function candidatePaths({root, home = homedir(), platform = process.platform, fromPath = ''}) {
  const name = platform === 'win32' ? 'uxplay.exe' : 'uxplay';
  return [
    fromPath,
    join(root, '..', 'UxPlay', 'build', name),
    join(root, '..', 'uxplay', 'build', name),
    join(root, '..', '..', 'UxPlay', 'build', name),
    join(home, 'UxPlay', 'build', name),
    join(home, 'uxplay', 'build', name),
    join(home, '.local', 'bin', name),
    join(root, 'src-tauri', 'resources', 'sidecar', name),
  ];
}
export function findDevelopmentBinary({root, requested, home = homedir(), platform = process.platform, pathLookup} = {}) {
  if (requested !== undefined && requested !== '') {
    // An explicitly requested binary is authoritative: never silently use a different executable.
    if (!usableBinary(requested, platform)) throw new Error(`指定的 UxPlay 不可执行或不存在：${requested}。请使用绝对路径并确认执行权限。`);
    return realpathSync(requested);
  }
  let fromPath = pathLookup;
  if (fromPath === undefined) {
    const cmd = platform === 'win32' ? 'where' : 'which';
    const result = spawnSync(cmd, [platform === 'win32' ? 'uxplay.exe' : 'uxplay'], {encoding:'utf8', timeout: 2500});
    fromPath = result.status === 0 ? result.stdout.trim().split(/\r?\n/)[0] : '';
  }
  for (const candidate of candidatePaths({root,home,platform,fromPath})) {
    if (usableBinary(candidate, platform)) return realpathSync(candidate);
  }
  return null;
}
