/** Preserve separate NSIS binaries for Win7 and modern Windows builds.
 * The standard Tauri bundle output path is shared; copying to distinct
 * release folders avoids losing the first installer after the second build.
 */
import {copyFileSync, mkdirSync, readdirSync, statSync} from 'node:fs';
import {join, resolve} from 'node:path';

export function preserveNsisInstaller(root, target, startedAtMs = 0) {
  if (!['win7', 'win10plus'].includes(target)) throw Error('Unknown Windows installer target');
  const input = resolve(root, 'src-tauri', 'target', 'release', 'bundle', 'nsis');
  const matches = readdirSync(input)
    .filter(name => /\.exe$/i.test(name) && /setup/i.test(name))
    .map(name => ({name, path: join(input, name), mtime: statSync(join(input, name)).mtimeMs}))
    .filter(item => item.mtime + 1500 >= startedAtMs)
    .sort((a, b) => b.mtime - a.mtime);
  if (!matches.length) throw Error(`Tauri did not produce a fresh NSIS installer in ${input}`);
  const dst = resolve(root, 'release-installers', target);
  mkdirSync(dst, {recursive: true});
  const source = matches[0];
  const stem = source.name.replace(/\.exe$/i, '');
  const result = join(dst, `${stem}-${target}.exe`);
  copyFileSync(source.path, result);
  return result;
}
