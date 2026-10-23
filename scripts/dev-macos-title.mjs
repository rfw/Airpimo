// Development-only preparation for the Airpimo UxPlay child-window helper.
// Release builds use scripts/ci/prepare-macos.sh and its native verification.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export function macTarget(arch = process.arch) {
  if (arch === 'x64') return 'x86_64-apple-darwin';
  if (arch === 'arm64') return 'aarch64-apple-darwin';
  throw new Error(`不支持的 macOS 处理器架构：${arch}`);
}

export function needsMacTitleBuild(root, exists = existsSync, stat = statSync) {
  const source = join(root, 'native', 'fullscreen', 'uxplay-fullscreen-macos.m');
  const output = join(root, 'src-tauri', 'resources', 'fullscreen', 'uxplay-fullscreen-macos.dylib');
  if (!exists(source)) throw new Error('缺少 macOS 播放窗口原生扩展源码');
  if (!exists(output)) return true;
  return stat(output).mtimeMs < stat(source).mtimeMs;
}

// Tauri may retain a stale dylib in target/debug/fullscreen even after its
// source in resources/fullscreen is rebuilt. The child resolves the runtime
// copy, so keep it byte-identical before launching the development app.
export function syncDevMacTitleHelper(root) {
  const name = 'uxplay-fullscreen-macos.dylib';
  const source = join(root, 'src-tauri', 'resources', 'fullscreen', name);
  const destination = join(root, 'src-tauri', 'target', 'debug', 'fullscreen', name);
  if (!existsSync(source)) return false;
  const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  if (existsSync(destination) && digest(source) === digest(destination)) return false;
  const destDir = join(root, 'src-tauri', 'target', 'debug', 'fullscreen');
  mkdirSync(destDir, {recursive: true});
  const temporary = join(destDir, `.${name}.${process.pid}.tmp`);
  try {
    copyFileSync(source, temporary);
    renameSync(temporary, destination);
  } finally {
    rmSync(temporary, {force: true});
  }
  return true;
}

export function ensureMacTitleHelper(root, {arch = process.arch, platform = process.platform, run = spawnSync} = {}) {
  if (platform !== 'darwin') return false;
  const rebuild = needsMacTitleBuild(root);
  if (rebuild) {
    mkdirSync(join(root, 'src-tauri', 'resources', 'fullscreen'), {recursive: true});
    const result = run('bash', ['scripts/ci/build-macos-fullscreen.sh', macTarget(arch)], {
      cwd: root, stdio: 'inherit', timeout: 120000, shell: false,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`macOS 播放器扩展编译失败，请确认已安装 Xcode Command Line Tools：${result.error?.message ?? `退出码 ${result.status}`}`);
    }
    if (!existsSync(join(root, 'src-tauri', 'resources', 'fullscreen', 'uxplay-fullscreen-macos.dylib'))) {
      throw new Error('macOS 播放器扩展构建结束但未生成 .dylib');
    }
  }
  syncDevMacTitleHelper(root);
  return rebuild;
}

// Tauri's resource paths are mandatory even when a developer uses external
// GStreamer and the project hasn't staged distribution assets yet. Creating
// empty directories only satisfies Tauri config validation; these are never
// accepted as a release-ready runtime by native verification.
export function prepareDevResourceDirectories(root, mkdir = mkdirSync) {
  for (const name of ['sidecar', 'gstreamer']) {
    mkdir(join(root, 'src-tauri', 'resources', name), {recursive: true});
  }
}
