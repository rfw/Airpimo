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

### macOS 开发模式的 Airpimo Player 名称

当 `npm run desktop:dev` 使用显式 `--uxplay` 或已验证的原生引擎缓存时，
会在 `src-tauri/target/airpimo-player-dev/Airpimo Player.app` 生成**仅用于开发的应用副本**，
以 `CFBundleName` / `CFBundleDisplayName` 和 `Airpimo Player` 可执行文件名供 macOS
在创建窗口之前识别菜单栏及 Dock 身份。
它不会修改或重新编译原始 `uxplay`，也不参与正式发布包构建。
副本在原始引擎或图标变更后自动更新；使用新行为需完全退出原播放器再重启 `desktop:dev`。
开发模式下如果使用特殊的 `@executable_path` 相对依赖，应在 Mac 实机确认复制后的加载路径。

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


## 本地模拟投屏（仅开发模式）

使用 `npm run desktop:dev` 启动，在「设置 → 诊断」底部点击「开始模拟投屏」。
开发构建会启动 `gst-launch-1.0` 的 `videotestsrc` 动态画面，并使用 Airpimo Player
已有的 Windows 窗口标题/全屏管理或 macOS 原生窗口辅助库。**这不是 AirPlay 协议测试**。

- 开发电脑需安装 GStreamer，且 `gst-launch-1.0` 可从 PATH 启动；可用环境变量
  `AIRPIMO_DEV_GST_LAUNCH` 指定其绝对路径，或沿用 `UXPLAY_DEV_GST_ROOT`。
- 如果项目已经暂存完整 GStreamer Runtime，会优先使用该 Runtime 的 `bin/gst-launch-1.0`。
- 模拟前若当前正在真实镜像/握手，入口会拒绝开始。其他情况下暂时停止真实接收服务，
  模拟结束、关闭播放器窗口或播放器异常退出后恢复原先是否开启接收的状态。
- 进入模拟时真实 AirPlay 网络端口不再监听；它不写入任何用户配置。
- 验证电源请求：Windows 使用 `powercfg /requests`，macOS 使用 `pmset -g assertions`；
  在模拟时请求应存在，停止时应释放。
- Release 构建不会注册模拟 IPC；前端模拟按钮不在生产界面显示。

需要测试 AirPlay 网络协议或真实 H.264/音频协商时仍应使用实际发送端。
