#!/usr/bin/env node
/**
 * Airpimo maintenance cleanup. Explicit dry-run by default; --apply mutates.
 * Only root-level recognized backup names and a finite legacy-document allowlist
 * are removed. Never descends into source, dependencies, bundled runtimes or .git.
 * No migration/upgrade log is copied into the concise docs.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync } from 'node:fs';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const ROOT_OBSOLETE = new Set([
  'BRIGHTNESS80-PATCH-README.md',
  'CLOUD-ACTIONS-PATCH-README.md',
  'CROSS-PLATFORM-TESTS-README.md',
  'FPS-AVDEC-VOLUME-PATCH-README.md',
  'GITHUB-ACTIONS-PATCH-README.md',
  'SELFHOSTED-ACTIONS-PATCH-README.md',
  'WIN7-CONSOLE-HIDE-PATCH.md',
  'WIN7-EPERM-PATCH-NOTES.md',
  'WIN7-MDNS-COMBINED-PATCH-README.md',
  'WIN7-READ-ME-FIRST.md',
]);
const DOCS_OBSOLETE = new Set([
  'GITHUB-ACTIONS-CLOUD.md','GITHUB-ACTIONS-RELEASE.md','GITHUB-ACTIONS-SELFHOSTED.md',
  'RELEASE_CHECKLIST.md','TEST_REPORT.md','WIN7-INTERNAL-MDNS-CANDIDATE.md',
  'WIN7-RUNTIME-ALIGNMENT.md','WINDOWS-BUILD-TARGETS.md','WINDOWS7-COMPATIBILITY-STATUS.md',
]);

const README = `# Airpimo

> 官方仓库：<https://github.com/rfw/Airpimo>。当前社区版自有代码采用 **GPL-3.0-or-later（GPLv3）**，完整条款见 [LICENSE](LICENSE)。UxPlay 等第三方组件保持其原始许可，详见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。

Airpimo 是跨平台桌面 AirPlay 接收应用，使用 **Tauri + React + Rust** 提供控制界面，并通过独立的 **UxPlay/GStreamer** 原生进程接收和播放音视频。

## 功能

- iPhone/iPad 屏幕镜像接收，设备名称可配置
- 启动/停止接收、运行状态和错误提示
- 系统托盘、主题、设置及诊断日志
- Windows 7 与 Windows 10/11 的独立构建配置、macOS Intel/Apple Silicon 构建配置

实际支持范围以相应目标系统和原生音视频运行库的实机测试为准。

## 本地开发

需安装 Node.js/npm、Rust 工具链，以及对应平台的 Tauri 编译依赖。

\`\`\`sh
npm ci
npm run test:source
npm test
npm run build
npm run tauri dev
\`\`\`

\`npm run desktop:dev\` 使用项目已有的原生资源或经过校验的开发 Runtime；\`npm run tauri dev\` 是另一种本地启动入口。若缺少 UxPlay/GStreamer，网页界面能够启动不代表投屏可用。

详细的开发依赖、Windows/macOS 打包命令见 [开发说明](docs/DEVELOPMENT.md)；发行前的完整性校验与授权义务见 [发布说明](docs/RELEASE.md)。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| \`src/\` | React UI、主题、设置及状态展示 |
| \`src-tauri/src/\` | Rust 后端、接收进程管理、托盘与诊断 |
| \`scripts/\` | 原生资源准备、ABI 检查、构建与测试 |
| \`src-tauri/resources/\` | 分发时暂存的 UxPlay、GStreamer 等平台资源 |
| \`.github/workflows/\` | GitHub Actions 构建与发布门禁 |

## 版权与贡献

Airpimo 不拥有 UxPlay/GStreamer 的上游版权。修改、使用或分发相应组件时，必须分别遵守其许可证并提供必要的版权声明及对应源码。社区版采用 GPLv3，并不表示第三方代码获得了另行商业重授权。
`;
const AGENTS = `# Airpimo 开发约束

本文件记录持续有效的工程约束，不保存历史补丁、版本流水账或发行测试结果。

## 产品与技术边界

- 正式品牌：**Airpimo**；UxPlay 是原生接收引擎名称，不得擅自改动其上游版权和许可证。
- 桌面架构：Tauri + React/TypeScript + Rust；由 Rust 管理独立 UxPlay/GStreamer 进程，React 不直接解码或渲染投屏数据。
- 保留真实 AirPlay 服务发现、接收、音视频与故障恢复；UI 状态必须由真实后端状态驱动，不得将“进程存活”等同于“设备可发现”。
- 设备名、主题、关闭后驻留托盘等设置应使用唯一事实来源；避免重复状态及无效 IPC。
- 保留 Windows 7 SP1 (WebView2 109) 专门构建兼容门禁；不得仅凭当前开发系统运行成功宣称兼容。
- macOS 必须验证真实安装包内的 GStreamer 动态依赖闭包与目标系统最低版本；不依赖用户预装 Homebrew。
- 任何平台发布之前都必须完成原生 Runtime 的版本、哈希、导出符号、依赖与许可审查；不得跳过失败的门禁或伪造构建通过。

## 开发与测试

1. 修改前先阅读当前源码、对应脚本、测试与真实构建配置。
2. 尽量复用现有组件、IPC 和原生引擎；避免引入第二套状态管理或视频播放器。
3. 新增行为时补充测试；改变界面结构时同步旧测试断言，不得单纯删除安全校验。
4. 至少执行 \`npm run test:source\`、\`npm test\`、\`npm run build\`；Rust/原生构建与实际安装需在相应平台验证。
5. 未经过真机验证的功能、兼容性和发布门禁，应明确写成“未验证”。

## 许可

社区版自有代码采用 GPL-3.0-or-later。外部依赖按各自许可分发；商业重授权只能覆盖有合法授权权利的代码。详见 \`LICENSE\` 与 \`THIRD_PARTY_NOTICES.txt\`。
`;
const DEVELOPMENT = `# Airpimo 开发说明

本文仅描述当前使用的项目架构、环境与操作，不包含历史变更或补丁升级记录。执行前以 \`package.json\` 中实际存在的 scripts 为准。

## 开发环境

- Node.js 与 npm：\`npm ci\` 安装锁定依赖。
- Rust：安装对应 Windows MSVC 或 macOS target，以及 Tauri 需要的编译工具。
- Windows 7：保留独立兼容配置，包括固定版 WebView2 109、Win7 PE/API 与 C++ ABI 校验。
- UxPlay/GStreamer：须使用已审核的原生引擎和完整运行库；不可混用不兼容的 SDK/MSYS2 DLL。

\`\`\`sh
npm ci
npm run test:source
npm test
npm run build
npm run tauri dev
\`\`\`

可以使用 \`npm run desktop:dev\` 启动会选择本地原生运行资源的开发入口。如果接收引擎无法运行，请先检查选用的 Sidecar、GStreamer DLL/插件及其依赖，而不是关闭运行库校验。

## Windows 构建

在 PowerShell 中，根据目标选择：

\`\`\`powershell
# Windows 7：先准备并检验经审计的 internal-mDNS Runtime
npm run native:verify:win7:mdns
npm run desktop:build:win7:mdns

# Windows 10/11：验证当前平台 Runtime
npm run native:verify:release
npm run desktop:build:win10
\`\`\`

若未暂存真实 Runtime，或 ABI/PE/依赖检查失败，不应继续生成发布包。Windows 7 使用的 Rust/NSIS/WebView2 等应与对应构建配置一致。

## macOS 构建

在目标 Mac 上准备并验证 UxPlay/GStreamer 原生运行库，再执行：

\`\`\`sh
npm run native:verify:release
npx tauri build --target x86_64-apple-darwin --bundles app,dmg
\`\`\`

Apple Silicon 使用对应 \`aarch64-apple-darwin\` target。实际命令与资源暂存方式以当前 CI 工作流及相关 scripts 为准。验证安装后的应用能够在目标最低系统版本中独立启动并正常投屏。

## 调试与测试

- \`npm run test:source\`：源码校验。
- \`npm test\`：Node 自动测试。
- \`npm run check:rust-lock\`：Rust 依赖锁相关校验。
- \`npm run native:verify:release\`：当前平台原生发行门禁。
- Windows 原生错误码 \`0xC0000135\` 通常需要检查 Sidecar 和插件搜索路径及缺失 DLL。

开发者必须区分静态测试、平台构建测试和真实 AirPlay 连接测试。
`;
const RELEASE = `# Airpimo 发布与许可证检查

## 发行目标

- Windows 7 x64：单独构建与验证；需完整 WebView2 109 Fixed Runtime 和目标 OS 兼容的原生 DLL。
- Windows 10/11 x64：独立 NSIS 发行包。
- macOS Intel / Apple Silicon：分别构建、校验目标系统版本与 .app/.dmg 原生依赖。

当前自动化构建以 \`.github/workflows/\` 下实际工作流为准；仅当对应构建和安全门禁成功，才允许发布目标平台安装包。

## 必需验收

1. npm/TypeScript、Rust 与相关专项测试通过；记录准确的测试范围。
2. 原生 Sidecar、GStreamer DLL/dylib、插件、扫描器与依赖闭包匹配，完整性/ABI/最低 OS 校验通过。
3. 在干净目标系统验证启动、设备发现、连接、声音、横竖屏、停止和重复启动。
4. 校验托盘、设置持久化、诊断导出、应用关闭及子进程回收。
5. 检查安装包名称、实际版本和 GitHub 发布产物对应关系；不得将未验证的构建标为可用。

## 许可证合规

- Airpimo 社区版自有代码：\`GPL-3.0-or-later\`，详见根目录 \`LICENSE\`。
- UxPlay：保留上游 GPL 许可与版权声明；分发修改版时按适用许可提供相应源码、修改与构建信息。
- GStreamer、插件及其他第三方依赖：逐个记录相应许可证，保留必要声明，遵守 LGPL/GPL 或其他适用义务。
- 社区版许可不自动赋予第三方依赖的闭源商业重授权。商业发行前必须单独审查代码版权和各组件许可。

见 \`THIRD_PARTY_NOTICES.txt\` 及 \`third_party/UPSTREAM.md\`（如果存在）。
`;
const NATIVE_README = `# Airpimo 原生运行库说明

原生接收引擎为 UxPlay，音视频依赖 GStreamer；Tauri 应用只负责调用和管理。正式安装包必须携带目标平台所需的原生库与插件，不依赖用户手动安装构建工具。

## 基本命令

\`\`\`sh
npm run native:prepare
npm run native:bundle:from-build
npm run native:bundle:status
npm run native:verify:release
\`\`\`

Windows 7 的 internal-mDNS 目标需另外执行 \`npm run native:verify:win7:mdns\`。任何原生暂存、SHA-256、依赖闭包、C++ DLL 导出符号或 Win7 PE/API 门禁失败，都不应继续打包。

如需配置 SDK 或 MSYS2 MINGW64，请参照当前 \`scripts/\` 构建脚本。务必保持同一平台的 DLL ABI 一致；不要用本机系统 PATH 中另一版本 DLL 代替分发包自带 DLL。

最终构建与验收说明见 [开发说明](../docs/DEVELOPMENT.md) 和 [发布说明](../docs/RELEASE.md)。
`;

function rootDocOld(name) {
  return ROOT_OBSOLETE.has(name)
    || /^AIRPIMO-.*(?:-v\d+|V\d+).*\.md$/i.test(name)
    || /^UXPLAY-.*(?:-v\d+|PATCH|HOTFIX).*\.md$/i.test(name)
    || /^MACOS-.*HOTFIX.*\.md$/i.test(name)
    || /^WINDOWS-.*(?:HOTFIX|TEST-ISOLATION).*\.md$/i.test(name)
    || /^WIN7-.*(?:PATCH|HOTFIX|NOTES|READ-ME|README).*\.md$/i.test(name);
}
function docsOld(name) {
  return DOCS_OBSOLETE.has(name)
    || /^V\d+_TEST_REPORT\.md$/i.test(name)
    || /^AIRPIMO-.*-v\d+\.md$/i.test(name);
}
function backup(name) {
  return /^\.airpimo-(?:v\d+|ui-v\d+|brand)-backup$/i.test(name)
    || /^\.win-cxx-abi-backup$/i.test(name);
}
function onlyRegularFile(root, path) {
  const full = join(root,path);
  if (!existsSync(full)) return false;
  const stat=lstatSync(full);
  if (stat.isSymbolicLink()) throw Error(`拒绝操作符号链接: ${path}`);
  if (!stat.isFile()) throw Error(`预期为普通文件: ${path}`);
  return true;
}
function plan(rootDir=DEFAULT_ROOT) {
  const root=resolve(rootDir);
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  if (pkg.name!=='airpimo' || !existsSync(join(root,'src-tauri','tauri.conf.json')) || !existsSync(join(root,'src','App.tsx'))) {
    throw Error('不是预期的 Airpimo 项目目录，操作已阻止');
  }
  // Protect license essentials. Never recreate, rename or remove these files.
  for(const p of ['LICENSE','THIRD_PARTY_NOTICES.txt']) {
    if(!onlyRegularFile(root,p)) throw Error(`缺少必需的许可文件: ${p}`);
  }
  const removals=[];const docsToWrite=new Map([
    ['README.md',README], ['AGENTS.md',AGENTS],
    ['docs/DEVELOPMENT.md',DEVELOPMENT], ['docs/RELEASE.md',RELEASE]
  ]);
  if(existsSync(join(root,'native','README.md')))docsToWrite.set('native/README.md',NATIVE_README);
  const ignores=['/.airpimo-*-backup/','/.win-cxx-abi-backup/'];
  const ignorePath=join(root,'.gitignore');
  const existingIgnore=existsSync(ignorePath)?readFileSync(ignorePath,'utf8'):'';
  let ignored=existingIgnore.trimEnd()+'\n';
  for(const line of ignores)if(!ignored.split(/\r?\n/).includes(line))ignored+=line+'\n';
  docsToWrite.set('.gitignore',ignored);
  const roots=readdirSync(root);
  for(const name of roots){
    if(backup(name)){
      const full=join(root,name);const s=lstatSync(full);
      if(s.isSymbolicLink()||!s.isDirectory())throw Error(`不安全的备份目录: ${name}`);
      removals.push({path:name,kind:'dir'});
    } else if(rootDocOld(name)){
      if(onlyRegularFile(root,name))removals.push({path:name,kind:'file'});
    }
  }
  for(const p of ['src-tauri/Cargo.lock.bak','package-lock.json.bak']){
    if(onlyRegularFile(root,p))removals.push({path:p,kind:'file'});
  }
  if(existsSync(join(root,'docs'))) {
    for(const name of readdirSync(join(root,'docs')))if(docsOld(name)){
      const path=`docs/${name}`;
      if(onlyRegularFile(root,path))removals.push({path,kind:'file'});
    }
  }
  const writes=[...docsToWrite].filter(([p,content])=>!existsSync(join(root,p)) || readFileSync(join(root,p),'utf8')!==content).map(([path,content])=>({path,content}));
  return {root,removals,writes,unknownDocs:[...roots.filter(s=>s.endsWith('.md')&&!rootDocOld(s)&&!['README.md','AGENTS.md'].includes(s)),...(existsSync(join(root,'docs'))?readdirSync(join(root,'docs')).filter(x=>x.toLowerCase().endsWith('.md')&&!docsOld(x)&&!['DEVELOPMENT.md','RELEASE.md'].includes(x)).map(x=>'docs/'+x):[])]};
}
export {plan};
export function clean(rootDir=DEFAULT_ROOT, apply=false){
  const p=plan(rootDir);
  if(apply){
    // Write concise source docs first, then remove recognized legacy docs/backups.
    for(const w of p.writes){const path=join(p.root,w.path);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,w.content,'utf8');}
    for(const x of p.removals){const path=join(p.root,x.path);if(x.kind==='dir')rmSync(path,{force:true,recursive:true});else unlinkSync(path);}
  }
  return p;
}
const isMain=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isMain){
  try{
    const mode=process.argv[2]??'--plan';
    if(!['--plan','--apply','--check'].includes(mode))throw Error('使用方法: node scripts/ci/clean-airpimo-project.mjs [--plan | --apply | --check]');
    const p=clean(DEFAULT_ROOT,mode==='--apply');
    for(const w of p.writes)console.log(`${mode==='--apply'?'UPDATED':'WRITE '} ${w.path}`);
    for(const x of p.removals)console.log(`${mode==='--apply'?'DELETED':'DELETE'} ${x.path}${x.kind==='dir'?'/':''}`);
    if(p.unknownDocs.length)console.log('REVIEW（未识别，不自动删除）: '+p.unknownDocs.join(', '));
    if(mode==='--check'&&(p.removals.length||p.writes.length)){
      console.error(`BLOCKED: 尚有 ${p.removals.length} 个待清理项和 ${p.writes.length} 个待整理文档`);process.exitCode=2;
    } else console.log(`PASS: ${mode==='--apply'?'整理完成':mode==='--check'?'状态已符合规则':'预览完成'}；只操作白名单目录与文档`);
  }catch(e){console.error('BLOCKED:',e.message);process.exitCode=2;}
}
