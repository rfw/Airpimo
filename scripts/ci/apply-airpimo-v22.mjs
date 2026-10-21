#!/usr/bin/env node
/** Apply narrowly scoped fixes on top of an Airpimo v21 source checkout.
 * Refuses unexpected source variants; validates all modifications before writing.
 */
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const project = fileURLToPath(new URL('../..', import.meta.url));
const marker = "import { stagedNativePaths, defaultDevPlan } from './dev-launch-plan.mjs';";
const appEffectBefore = `  useEffect(() => {
    document.documentElement.classList.toggle('dark', snapshot.settings.theme === 'dark' || (snapshot.settings.theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches));
    if (snapshot.settings.theme !== 'system') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => document.documentElement.classList.toggle('dark', query.matches);
    if (query.addEventListener) { query.addEventListener('change', sync); return () => query.removeEventListener('change', sync); }
    query.addListener(sync); return () => query.removeListener(sync);
  }, [snapshot.settings.theme]);`;
const appEffectAfter = `  useEffect(() => {
    // Keep the bootstrapped color until the real persisted Tauri settings arrive.
    if (!ready) return;
    const theme = snapshot.settings.theme;
    try { localStorage.setItem('airpimo.theme', theme); } catch { /* storage may be unavailable */ }
    const query = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => {
      const dark = theme === 'dark' || (theme === 'system' && query.matches);
      document.documentElement.classList.toggle('dark', dark);
      document.documentElement.style.backgroundColor = dark ? '#1b1e23' : '#ffffff';
      document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    };
    sync();
    if (theme !== 'system') return;
    if (query.addEventListener) { query.addEventListener('change', sync); return () => query.removeEventListener('change', sync); }
    query.addListener(sync); return () => query.removeListener(sync);
  }, [ready, snapshot.settings.theme]);`;

function replaceExactly(src, before, after, label) {
  if (src.includes(after)) return src;
  const i = src.indexOf(before);
  if (i === -1 || src.indexOf(before, i + before.length) !== -1) throw Error(`${label}: anchor missing or ambiguous`);
  return src.slice(0,i) + after + src.slice(i+before.length);
}

export function planAirpimoV22(root = project) {
  const changes = new Map();
  for (const req of ['public/theme-bootstrap.js','scripts/dev-launch-plan.mjs']) {
    if (!existsSync(join(root,req))) throw Error(`Required new source missing: ${req}`);
  }
  function edit(relative, convert) {
    const f=join(root,relative);
    if (!existsSync(f)) throw Error(`Missing ${relative}`);
    const before=readFileSync(f,'utf8');
    const after=convert(before);
    if (before !== after) changes.set(relative,{before,after,filename:f});
  }
  edit('index.html',s=>{
    if (!s.includes('<head>') || !s.includes('<script type="module" src="/src/main.tsx"></script>')) throw Error('index.html: unexpected HTML template');
    return s.replace(/(<head>)(?!<script src="\/theme-bootstrap\.js"><\/script>)/, '$1<script src="/theme-bootstrap.js"></script>')
    .replace('content="#ffffff"','content="#1b1e23"');
  });
  edit('src-tauri/tauri.conf.json',s=>{
    const cfg=JSON.parse(s), win=cfg?.app?.windows?.find(w=>w.label==='main');
    if (!win || win.title!=='Airpimo') throw Error('tauri.conf: Airpimo main window not found');
    if (win.backgroundColor==='#20232A') return s;
    return replaceExactly(s,'"backgroundColor": "#FFFFFF"','"backgroundColor": "#20232A"','tauri.conf');
  });
  edit('src/styles.css',s=>{
    s=replaceExactly(s,'--background: 220 14% 11%; --foreground: 220 10% 93%; --card: 220 14% 14%;',
      '--background: 220 13% 12%; --foreground: 220 9% 82%; --card: 220 13% 15%;','dark foreground');
    s=replaceExactly(s,'--border: 220 11% 28%; --muted: 220 11% 18%; --muted-foreground: 220 9% 65%;',
      '--border: 220 10% 27%; --muted: 220 10% 19%; --muted-foreground: 220 8% 60%;','dark muted');
    s=replaceExactly(s,'--primary: 220 10% 88%; --primary-foreground: 220 20% 12%; --destructive: 0 70% 56%;',
      '--primary: 220 10% 80%; --primary-foreground: 220 20% 12%; --destructive: 0 70% 58%;','dark primary');
    return s;
  });
  edit('src/App.tsx',s=>{
    if (s.includes("type SettingsTab = 'config' | 'theme' | 'updates' | 'diagnostics';")) {
      if (!s.includes('checked={draft.stay_in_tray}') || !s.includes("localStorage.setItem('airpimo.theme', theme)")) throw Error('App v25: anchor missing');
      return s;
    }
    s=replaceExactly(s,appEffectBefore,appEffectAfter,'App initial theme');
    s=replaceExactly(s,'<small>默认关闭窗口即退出并停止投屏</small>',
      '<small>默认开启：关闭窗口后继续在托盘接收；从托盘菜单可彻底退出</small>','tray help');
    return s;
  });
  edit('src/domain/state.ts',s=>replaceExactly(s,'stay_in_tray:false, theme:\'system\'','stay_in_tray:true, theme:\'system\'','frontend tray default'));
  edit('src-tauri/src/settings.rs',s=>replaceExactly(s,'stay_in_tray: false, theme: Theme::System',
    'stay_in_tray: true, theme: Theme::System','backend tray default'));
  edit('src-tauri/src/receiver.rs',s=>replaceExactly(s,
    `            if i.issue.is_none() {
                i.issue=Some("crash");
                i.detail=format!("UxPlay 意外退出（退出码 {}）",exit_code.map(|n|n.to_string()).unwrap_or_else(||"unknown".into()));
            }`,
    `            if i.issue.is_none() {
                #[cfg(windows)]
                if exit_code == Some(-1073741515) { // NTSTATUS 0xC0000135: STATUS_DLL_NOT_FOUND
                    i.issue = Some("missing_runtime");
                    i.detail = "UxPlay 启动失败（0xC0000135）：缺少 DLL 或 DLL 依赖版本不兼容，请检查 GStreamer Runtime 与诊断信息".into();
                } else {
                    i.issue = Some("crash");
                    i.detail = format!("UxPlay 意外退出（退出码 {}）",exit_code.map(|n|n.to_string()).unwrap_or_else(||"unknown".into()));
                }
                #[cfg(not(windows))]
                { i.issue=Some("crash"); i.detail=format!("UxPlay 意外退出（退出码 {}）",exit_code.map(|n|n.to_string()).unwrap_or_else(||"unknown".into())); }
            }`, 'receiver missing DLL diagnostics'));
  edit('scripts/desktop-dev.mjs',s=>{
    s=replaceExactly(s,
      "import { findDevelopmentBinary } from './dev-native-paths.mjs';",
      "import { findDevelopmentBinary } from './dev-native-paths.mjs';\n"+marker,
      'desktop-dev import');
    const from=`let binary;
let bundledRuntime = null;
try {
  const bundle = ['darwin','win32'].includes(process.platform) ? verifiedBundleDir() : null;
  bundledRuntime = !requested && bundle ? join(bundle,'gstreamer') : null;
  binary = requested ? findDevelopmentBinary({root,requested})
    : bundle ? join(bundle,'sidecar',process.platform==='win32'?'uxplay.exe':'uxplay')
    : findDevelopmentBinary({root});
} catch(e) {console.error(\`ERROR: \${e.message}\`);process.exit(2);}`;
    const to=`let binary;
let bundledRuntime = null;
let injectOverride = false;
let source = 'missing';
try {
  if (requested) {
    binary = findDevelopmentBinary({root, requested});
    injectOverride = true;
    source = 'explicit';
  } else {
    const inProject = stagedNativePaths(root);
    const bundle = !inProject && ['darwin','win32'].includes(process.platform) ? verifiedBundleDir() : null;
    const plan = defaultDevPlan({root, bundle, fallback: () => findDevelopmentBinary({root})});
    ({binary, injectOverride, source} = plan);
    bundledRuntime = plan.runtime;
  }
} catch(e) {console.error(\`ERROR: \${e.message}\`);process.exit(2);}`;
    s=replaceExactly(s,from,to,'desktop-dev resolver');
    s=replaceExactly(s,`      bundledRuntime=join(bundle,'gstreamer');
      console.log(\`[UxPlay 开发模式] 使用完整预编译缓存：\${bundle}\`);`,
      `      bundledRuntime=join(bundle,'gstreamer');
      injectOverride=true;
      source='cache';
      console.log(\`[UxPlay 开发模式] 使用完整预编译缓存：\${bundle}\`);`,'desktop-dev cache fallback');
    s=replaceExactly(s,`if (binary) {
  console.log(\`[UxPlay 开发模式] 引擎：\${binary}\`);
  console.log(bundledRuntime?\`[UxPlay 开发模式] 内置 GStreamer 缓存：\${bundledRuntime}\`:'[UxPlay 开发模式] 正在使用开发机本地 GStreamer（不能作为独立发行依据）');
} else console.warn('[UxPlay 开发模式] UI 可启动，但缺少原生引擎，投屏不可用。');`,
      `if (binary) {
  console.log(\`[Airpimo 开发模式] 引擎：\${binary}\`);
  if (source === 'project') console.log('[Airpimo 开发模式] 使用与 npm run tauri dev 相同的项目原生资源；不注入旧版缓存。');
  else console.log(bundledRuntime?\`[Airpimo 开发模式] 独立原生缓存：\${bundledRuntime}\`:'[Airpimo 开发模式] 使用开发机本地 GStreamer（不能作为独立发行依据）');
} else console.warn('[Airpimo 开发模式] UI 可启动，但缺少原生引擎，投屏不可用。');`, 'desktop-dev source diagnostic');
    s=replaceExactly(s,
      "...(binary?{UXPLAY_DEV_BINARY:binary}:{})",
      "...(binary && injectOverride?{UXPLAY_DEV_BINARY:binary}:{})",
      'desktop-dev override precedence');
    s=replaceExactly(s,"  console.log(bundledRuntime?'[GStreamer] 已验证完整缓存': '[GStreamer] 尚无完整原生缓存；检查本机原生安装和 --uxplay 设置');",
      "  console.log(source==='project'?'[GStreamer] 项目原生资源（与 tauri dev 相同）':bundledRuntime?'[GStreamer] 已验证完整缓存':'[GStreamer] 使用外部依赖或缺少原生缓存');",'desktop-dev doctor');
    return s;
  });
  edit('.gitignore',s=>s.includes('.airpimo-v22-backup/') ? s : `${s.replace(/\s*$/,'')}\n.airpimo-v22-backup/\n`);
  return changes;
}
export function applyAirpimoV22(root = project, write = false) {
  const changes=planAirpimoV22(root);
  if(write && changes.size) {
    for (const [relative, entry] of changes) {
      const backup=join(root,'.airpimo-v22-backup',relative);
      mkdirSync(dirname(backup),{recursive:true});
      if(!existsSync(backup)) writeFileSync(backup,entry.before,'utf8');
    }
    for(const entry of changes.values()) writeFileSync(entry.filename,entry.after,'utf8');
  }
  return [...changes.keys()];
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const mode=process.argv[2]??'--check';
    if(!['--apply','--check'].includes(mode)) throw Error('Usage: --apply or --check');
    const files=applyAirpimoV22(project, mode==='--apply');
    for(const file of files) console.log(`[airpimo-v22] ${mode==='--apply'?'UPDATED':'PENDING'} ${file}`);
    if(mode==='--check' && files.length) throw Error('Patch not applied. Run --apply first.');
    console.log(`[airpimo-v22] PASS (${files.length} pending)`);
  } catch(err) {console.error(`[airpimo-v22] BLOCKED: ${err.message}`); process.exitCode=2;}
}
