/** Resolve Git for Windows independently of the MSYS2 toolchain.
 * Git fetch/checkout must not pick MSYS2 Git or inherit GStreamer DLL search paths.
 */
import {existsSync} from 'node:fs';
import {win32} from 'node:path';

function pathEntries(env) {
  return (env.Path ?? env.PATH ?? env.path ?? '').split(';').map(p => p.trim().replace(/^"|"$/g, '')).filter(Boolean);
}
function isMsysToolPath(file, msysRoot) {
  const relative = win32.relative(win32.resolve(msysRoot), win32.resolve(file));
  return relative !== '' && !relative.startsWith('..') && !win32.isAbsolute(relative);
}

/** Explicit --git or UXPLAY_GIT_EXE wins; otherwise use a Git for Windows found on PATH. */
export function resolveGlobalGit({override, env=process.env, msysRoot='C:\\msys64', exists=existsSync}={}) {
  const requested = override || env.UXPLAY_GIT_EXE;
  const valid = path => exists(path) && !isMsysToolPath(path,msysRoot);
  if (requested) {
    const absolute = win32.resolve(requested);
    if (!valid(absolute)) throw Error(`Global Git executable not found or points into MSYS2: ${absolute}`);
    return absolute;
  }
  for (const dir of pathEntries(env)) {
    const candidate = win32.join(dir,'git.exe');
    if (valid(candidate)) return candidate;
  }
  const programFiles = [env.ProgramFiles,env['ProgramFiles(x86)'],'C:\\Program Files'].filter(Boolean);
  for (const root of programFiles) {
    for (const sub of ['Git\\cmd\\git.exe','Git\\bin\\git.exe']) {
      const candidate = win32.join(root,sub);
      if (valid(candidate)) return candidate;
    }
  }
  throw Error('Git for Windows not found. Install Git for Windows and add it to PATH, or set UXPLAY_GIT_EXE to its git.exe path. MSYS2 Git is intentionally not used.');
}

/** Do not inject the MINGW64/GStreamer search PATH into Git for Windows helper processes. */
export function globalGitEnv({git, env=process.env, msysRoot='C:\\msys64', gstRoot}={}) {
  const protectedDirs = [msysRoot, gstRoot].filter(Boolean);
  const filtered = pathEntries(env).filter(dir => !protectedDirs.some(root => {
    const rel=win32.relative(win32.resolve(root),win32.resolve(dir));
    return rel==='' || (rel!=='' && !rel.startsWith('..') && !win32.isAbsolute(rel));
  }));
  const output = {...env,PATH:[win32.dirname(git),...filtered].join(';')};
  delete output.Path;
  delete output.path;
  delete output.GIT_EXEC_PATH;
  delete output.MSYSTEM;
  delete output.MSYSTEM_PREFIX;
  delete output.MINGW_PREFIX;
  return output;
}
