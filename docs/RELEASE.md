# Airpimo 发布与许可证检查

## 发行目标

- Windows 7 x64：单独构建与验证；需完整 WebView2 109 Fixed Runtime 和目标 OS 兼容的原生 DLL。
- Windows 10/11 x64：独立 NSIS 发行包。
- macOS Intel / Apple Silicon：分别构建、校验目标系统版本与 .app/.dmg 原生依赖。

当前自动化构建以 `.github/workflows/` 下实际工作流为准；仅当对应构建和安全门禁成功，才允许发布目标平台安装包。

## 必需验收

1. npm/TypeScript、Rust 与相关专项测试通过；记录准确的测试范围。
2. 原生 Sidecar、GStreamer DLL/dylib、插件、扫描器与依赖闭包匹配，完整性/ABI/最低 OS 校验通过。
3. 在干净目标系统验证启动、设备发现、连接、声音、横竖屏、停止和重复启动。
4. 校验托盘、设置持久化、诊断导出、应用关闭及子进程回收。
5. 检查安装包名称、实际版本和 GitHub 发布产物对应关系；不得将未验证的构建标为可用。

## 许可证合规

- Airpimo 社区版自有代码：`GPL-3.0-or-later`，详见根目录 `LICENSE`。
- UxPlay：保留上游 GPL 许可与版权声明；分发修改版时按适用许可提供相应源码、修改与构建信息。
- GStreamer、插件及其他第三方依赖：逐个记录相应许可证，保留必要声明，遵守 LGPL/GPL 或其他适用义务。
- 社区版许可不自动赋予第三方依赖的闭源商业重授权。商业发行前必须单独审查代码版权和各组件许可。

见 `THIRD_PARTY_NOTICES.txt` 及 `third_party/UPSTREAM.md`（如果存在）。

## macOS 网络防火墙授权（正式安装包）

Airpimo 启动的 `Contents/Resources/sidecar/uxplay` 是独立接收 TCP 连接的进程；macOS 防火墙对它单独授权。**当前 GitHub Actions 仍生成 unsigned DMG**，因此不能保证第一次点击“允许”后不再弹出。

准备稳定公开发行时，必须为嵌套的 `uxplay`、随包 GStreamer dylib、标题辅助 dylib 与整个 `.app` 使用同一有效 Developer ID 进行签名，完成公证和 stapling，并在干净的 macOS 13/14/15 上实测启动/重启权限持久性。不要通过关闭系统防火墙、放宽系统全局权限或静默修改用户防火墙规则来消除提示。当前无开发者证书的预发布不得声称该问题已解决。
