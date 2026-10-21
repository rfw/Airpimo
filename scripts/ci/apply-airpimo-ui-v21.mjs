#!/usr/bin/env node
/**
 * Incremental Airpimo home UI patch.
 * Applies narrow edits to the existing v0.1.8 App/entry/Tauri config, retaining
 * actual AirPlay events, settings, diagnostics, native engines and version.
 * Usage: node scripts/ci/apply-airpimo-ui-v21.mjs --apply|--check
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const rootDefault = fileURLToPath(new URL('../..', import.meta.url));
const marker = "import { AirpimoHome } from './components/AirpimoHome';";

export function planAirpimoUI(root = rootDefault) {
  const files = new Map();
  for (const required of ['src/components/AirpimoHome.tsx','src/domain/home-status.ts','src/styles/airpimo-home.css']) {
    if (!existsSync(join(root, required))) throw new Error(`补丁缺少新文件: ${required}`);
  }
  function transform(relative, fn) {
    const file = join(root, relative);
    if (!existsSync(file)) throw new Error(`文件不存在: ${relative}`);
    const before = readFileSync(file, 'utf8');
    const after = fn(before);
    if (after !== before) files.set(relative, {before, after, file});
  }
  transform('src/App.tsx', (original) => {
    if (original.includes(marker)) {
      const homePresent = /<AirpimoHome(?:\s|\/>)/.test(original);
      // v19/v21 generated a Blob filename in React. v23 moves the filename and
      // actual file write into Rust, leaving a native export call in React.
      const legacyExport = /link\.download\s*=\s*`airpimo-diagnostics-/.test(original);
      const nativeExport = /await desktop\.exportDiagnostics\(\)/.test(original) &&
        /setDiagnosticsExportStatus\(/.test(original) &&
        original.includes('diagnosticsExporting');
      if (!homePresent || !(legacyExport || nativeExport)) throw new Error('App.tsx: UI 处于不完整状态');
      return original;
    }
    let source = original;
    if (!source.includes('  const isActive = snapshot.process_running;') ||
        !source.includes('    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>') ||
        !source.includes("import { brand } from './brand';") ||
        !source.includes("import { desktop, isDesktop } from './lib/desktop';")) {
      throw new Error('src/App.tsx 与受支持的旧 UI 结构不匹配；未修改，需使用最新源码适配');
    }
    const home = `  return <>\n    <AirpimoHome\n      snapshot={snapshot} ready={ready} busy={actionBusy} now={now} bootError={bootError} feedback={feedback}\n      onStart={() => void execute(desktop.start)} onStop={() => void execute(desktop.stop)}\n      onRetry={() => void execute(desktop.retry)} onCopy={(value) => void copy(value)}\n      onSettings={openSettings} onDiagnostics={() => void openDiagnostics()} onClearFeedback={() => setFeedback('')}\n    />\n\n    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>`;
    const block = /  const isActive = snapshot\.process_running;[\s\S]*?    <Dialog open=\{settingsOpen\} onOpenChange=\{setSettingsOpen\}>/;
    if (!block.test(source)) throw new Error('src/App.tsx 主界面边界不存在');
    source = source.replace(block, home);
    if (!source.includes('\n  </div>;\n}\nexport default App;')) throw new Error('src/App.tsx 末尾结构与旧版不一致');
    source = source.replace('\n  </div>;\n}\nexport default App;', '\n  </>;\n}\nexport default App;');
    source = source.replace(/^import \{[^\n]*\} from 'lucide-react';$/m, "import { X } from 'lucide-react';");
    source = source.replace("import { brand } from './brand';\n", '');
    source = source.replace(/^import \{ defaultSnapshot, [^\n]* \} from '\.\/domain\/state';$/m,
      "import { defaultSnapshot, validateDeviceName, validateBrightness, validateFps, type Settings, type Snapshot, type ThemeChoice } from './domain/state';");
    const anchor = "import { desktop, isDesktop } from './lib/desktop';";
    source = source.replace(anchor, `${anchor}\n${marker}`);
    if (!source.includes(marker)) throw new Error('src/App.tsx 无法添加新组件引用');
    return source;
  });
  transform('src/main.tsx', (source) => {
    if (source.includes("import './styles/airpimo-home.css';")) return source;
    const match = "import './styles.css';";
    if (!source.includes(match)) throw new Error('src/main.tsx 样式入口不存在');
    return source.replace(match, `${match}\nimport './styles/airpimo-home.css';`);
  });
  transform('src-tauri/capabilities/default.json', (source) => {
    const cap = JSON.parse(source);
    if (!Array.isArray(cap.windows) || !cap.windows.includes('main') || !Array.isArray(cap.permissions)) {
      throw new Error('Tauri 主窗口 capability 结构不符合预期');
    }
    if (cap.permissions.includes('core:window:allow-start-dragging')) return source;
    const match = /("permissions":\s*\[\s*"core:default")/;
    if (!match.test(source)) throw new Error('Tauri 主窗口 capability permission 锚点不存在');
    return source.replace(match, '$1,"core:window:allow-start-dragging"');
  });
  transform('.gitignore', (source) => {
    return source.includes('.airpimo-ui-v21-backup/') ? source : `${source.replace(/\s*$/, '')}\n.airpimo-ui-v21-backup/\n`;
  });
  transform('src-tauri/tauri.conf.json', (source) => {
    const config = JSON.parse(source);
    const window = config?.app?.windows?.find(w => w.label === 'main');
    if (!window || window.title !== 'Airpimo') throw new Error('Tauri 主窗口不存在或品牌尚未更新为 Airpimo');
    if (window.titleBarStyle === 'Overlay' && window.hiddenTitle === true) return source;
    if (window.titleBarStyle && window.titleBarStyle !== 'Overlay') throw new Error('Tauri macOS titleBarStyle 已定制，拒绝覆盖');
    if (window.hiddenTitle === false) throw new Error('Tauri macOS hiddenTitle 显式关闭，拒绝覆盖');
    const search = /("title": "Airpimo",\r?\n)(\s*"width":)/;
    if (!search.test(source)) throw new Error('tauri.conf.json 窗口配置布局不是预期格式');
    return source.replace(search, '$1        "titleBarStyle": "Overlay",\n        "hiddenTitle": true,\n$2');
  });
  return files;
}

export function applyAirpimoUI(root = rootDefault, write = false) {
  const changes = planAirpimoUI(root);
  if (write && changes.size) {
    // Atomic at planning level: validate every anchor before writing anything.
    for (const [relative, change] of changes) {
      const backup = join(root, '.airpimo-ui-v21-backup', relative);
      mkdirSync(dirname(backup), {recursive:true});
      if (!existsSync(backup)) writeFileSync(backup, change.before, 'utf8');
    }
    for (const {file, after} of changes.values()) writeFileSync(file, after, 'utf8');
  }
  return [...changes.keys()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2] ?? '--check';
    if (!['--apply', '--check'].includes(action)) throw new Error('用法: node scripts/ci/apply-airpimo-ui-v21.mjs --apply|--check');
    const changed = applyAirpimoUI(rootDefault, action === '--apply');
    for (const file of changed) console.log(`[ui-v21] ${action === '--apply' ? 'UPDATED' : 'PENDING'} ${file}`);
    if (action === '--check' && changed.length) throw new Error('文件尚未应用；先执行 --apply');
    console.log(`[ui-v21] PASS (${changed.length} modified files)`);
  } catch (error) {
    console.error(`[ui-v21] BLOCKED: ${error.message}`);
    process.exitCode = 2;
  }
}
