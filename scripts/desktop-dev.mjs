#!/usr/bin/env node
// On development hosts we can reuse an already-working UxPlay + GStreamer installation.
// Release bundles never use this script or development override.
import { spawn } from 'node:child_process';
import { resolve, join } from 'node:path';
import { ensureMacTitleHelper, prepareDevResourceDirectories } from './dev-macos-title.mjs';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { findDevelopmentBinary } from './dev-native-paths.mjs';
import { stagedNativePaths, defaultDevPlan } from './dev-launch-plan.mjs';
import {verifiedCachedEngine} from './native-engine-core.mjs';
import {verifiedBundleDir} from './native-bundle-core.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const args = process.argv.slice(2);
const argIndex = args.indexOf('--uxplay');
if (argIndex >= 0 && (!args[argIndex + 1] || args[argIndex + 1].startsWith('--'))) {
  console.error('ERROR: --uxplay 后必须填写可执行文件的绝对路径'); process.exit(2);
}
const requested = argIndex >= 0 ? args[argIndex + 1] : process.env.UXPLAY_DEV_BINARY;
if (argIndex >= 0) args.splice(argIndex, 2);
const doctor = args.includes('--doctor');
if (doctor) args.splice(args.indexOf('--doctor'), 1);
let binary;
let bundledRuntime = null;
let injectOverride = false;
let source = 'missing';
try {
  if (requested) {
    binary = findDevelopmentBinary({root, requested});
    injectOverride = true;
    source = 'explicit';
  } else {
    // Prefer the pinned, SHA-verified native:prepare cache to unreviewed PATH
    // executables. An explicit --uxplay always takes priority.
    const verifiedEngine = ['darwin', 'win32'].includes(process.platform) ? verifiedCachedEngine() : null;
    if (verifiedEngine) {
      binary = verifiedEngine;
      injectOverride = true;
      source = 'verified-engine';
      // Windows UxPlay needs MinGW/GStreamer DLLs too. Keep the engine
      // cache choice, but reuse a complete staged/bundled runtime if present.
      if (process.platform === 'win32') {
        const staged = stagedNativePaths(root);
        const bundle = !staged ? verifiedBundleDir() : null;
        bundledRuntime = staged?.runtime ?? (bundle ? join(bundle, 'gstreamer') : null);
      }
    } else {
      const inProject = stagedNativePaths(root);
      const bundle = !inProject && ['darwin','win32'].includes(process.platform) ? verifiedBundleDir() : null;
      const plan = defaultDevPlan({root, bundle, fallback: () => findDevelopmentBinary({root})});
      ({binary, injectOverride, source} = plan);
      bundledRuntime = plan.runtime;
    }
  }
} catch(e) {console.error(`ERROR: ${e.message}`);process.exit(2);}
// Development must never download or compile native GStreamer automatically.
// native:prepare registers a separately SHA-verified UxPlay executable.
// Missing runtime is not proof that a working macOS GStreamer.framework is absent.
if (!binary) {
  console.warn('[UxPlay 开发模式] 未发现可用引擎。先运行 npm run native:prepare；或显式指定 --uxplay <绝对路径>。');
}
if (binary) {
  console.log(`[Airpimo 开发模式] 引擎：${binary}`);
  if (source === 'verified-engine') console.log('[Airpimo 开发模式] 自动复用 native:prepare 已验证的缓存引擎。');
  if (source === 'project') console.log('[Airpimo 开发模式] 使用与 npm run tauri dev 相同的项目原生资源；不注入旧版缓存。');
  else console.log(bundledRuntime?`[Airpimo 开发模式] 独立原生缓存：${bundledRuntime}`:'[Airpimo 开发模式] 使用开发机本地 GStreamer（不能作为独立发行依据）');
} else console.warn('[Airpimo 开发模式] UI 可启动，但缺少原生引擎，投屏不可用。');
if (doctor) {
  console.log(source==='project'?'[GStreamer] 项目原生资源（与 tauri dev 相同）':bundledRuntime?'[GStreamer] 已验证完整缓存':'[GStreamer] 使用外部依赖或缺少原生缓存');
  process.exit(binary?0:2);
}
// Ensure the development launcher is usable on a fresh Git checkout.
// The full GStreamer runtime is still required for *release* packaging.
try {
  prepareDevResourceDirectories(root);
  if (process.platform === 'darwin' && binary) ensureMacTitleHelper(root);
} catch (e) { console.error(`ERROR: ${e.message}`); process.exit(2); }
const cli = join(root, 'node_modules', '.bin', process.platform==='win32'?'tauri.cmd':'tauri');
if (!existsSync(cli)) {console.error('缺少 Tauri CLI，请先运行 npm install');process.exit(2);}
const child = spawn(cli, ['dev',...args], {cwd:root, stdio:'inherit', env:{...process.env, ...(binary && injectOverride?{UXPLAY_DEV_BINARY:binary}:{}), ...(bundledRuntime?{UXPLAY_DEV_GST_ROOT:bundledRuntime}:process.env.UXPLAY_DEV_GST_ROOT?{UXPLAY_DEV_GST_ROOT:process.env.UXPLAY_DEV_GST_ROOT}:{})}, shell:process.platform==='win32'});
child.on('error', e=>{console.error(`Tauri CLI 启动失败：${e.message}`);process.exitCode=1;});
child.on('exit',(code,signal)=>{process.exitCode=code ?? (signal?1:0)});
for (const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{if(child.pid)child.kill(signal);});
