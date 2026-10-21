import {existsSync, statSync} from 'node:fs';
import {join} from 'node:path';

// The in-repo native runtime is the one used by `npm run tauri dev`.
// It must take priority over a stale, but hash-valid, previously imported cache.
export function stagedNativePaths(root, platform = process.platform, exists = existsSync) {
  const resources = join(root, 'src-tauri', 'resources');
  const binary = join(resources, 'sidecar', platform === 'win32' ? 'uxplay.exe' : 'uxplay');
  const runtime = join(resources, 'gstreamer');
  if (!exists(binary) || !exists(join(runtime, 'bin')) || !exists(join(runtime, 'lib', 'gstreamer-1.0'))) return null;
  try { if (!statSync(binary).isFile()) return null; } catch { return null; }
  return {binary, runtime};
}

export function defaultDevPlan({root, platform = process.platform, bundle = null, exists = existsSync, fallback = () => null} = {}) {
  const staged = stagedNativePaths(root, platform, exists);
  if (staged) return {binary: staged.binary, runtime: null, injectOverride: false, source: 'project'};
  if (bundle) return {binary: join(bundle, 'sidecar', platform === 'win32' ? 'uxplay.exe' : 'uxplay'), runtime: join(bundle, 'gstreamer'), injectOverride: true, source: 'cache'};
  const binary = fallback();
  return {binary, runtime: null, injectOverride: Boolean(binary), source: binary ? 'system' : 'missing'};
}
