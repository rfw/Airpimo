# Airpimo 开发说明

本文仅描述当前使用的项目架构、环境与操作，不包含历史变更或补丁升级记录。执行前以 `package.json` 中实际存在的 scripts 为准。

## 开发环境

- Node.js 与 npm：`npm ci` 安装锁定依赖。
- Rust：安装对应 Windows MSVC 或 macOS target，以及 Tauri 需要的编译工具。
- Windows 7：保留独立兼容配置，包括固定版 WebView2 109、Win7 PE/API 与 C++ ABI 校验。
- UxPlay/GStreamer：须使用已审核的原生引擎和完整运行库；不可混用不兼容的 SDK/MSYS2 DLL。

```sh
npm ci
npm run test:source
npm test
npm run build
npm run tauri dev
```

可以使用 `npm run desktop:dev` 启动会选择本地原生运行资源的开发入口。如果接收引擎无法运行，请先检查选用的 Sidecar、GStreamer DLL/插件及其依赖，而不是关闭运行库校验。

## Windows 构建

在 PowerShell 中，根据目标选择：

```powershell
# Windows 7：先准备并检验经审计的 internal-mDNS Runtime
npm run native:verify:win7:mdns
npm run desktop:build:win7:mdns

# Windows 10/11：验证当前平台 Runtime
npm run native:verify:release
npm run desktop:build:win10
```

若未暂存真实 Runtime，或 ABI/PE/依赖检查失败，不应继续生成发布包。Windows 7 使用的 Rust/NSIS/WebView2 等应与对应构建配置一致。

## macOS 构建

在目标 Mac 上准备并验证 UxPlay/GStreamer 原生运行库，再执行：

```sh
npm run native:verify:release
npx tauri build --target x86_64-apple-darwin --bundles app,dmg
```

Apple Silicon 使用对应 `aarch64-apple-darwin` target。实际命令与资源暂存方式以当前 CI 工作流及相关 scripts 为准。验证安装后的应用能够在目标最低系统版本中独立启动并正常投屏。

## 调试与测试

- `npm run test:source`：源码校验。
- `npm test`：Node 自动测试。
- `npm run check:rust-lock`：Rust 依赖锁相关校验。
- `npm run native:verify:release`：当前平台原生发行门禁。
- Windows 原生错误码 `0xC0000135` 通常需要检查 Sidecar 和插件搜索路径及缺失 DLL。

开发者必须区分静态测试、平台构建测试和真实 AirPlay 连接测试。
