# Airpimo 原生运行库说明

原生接收引擎为 UxPlay，音视频依赖 GStreamer；Tauri 应用只负责调用和管理。正式安装包必须携带目标平台所需的原生库与插件，不依赖用户手动安装构建工具。

## 基本命令

```sh
npm run native:prepare
npm run native:bundle:from-build
npm run native:bundle:status
npm run native:verify:release
```

Windows 7 的 internal-mDNS 目标需另外执行 `npm run native:verify:win7:mdns`。任何原生暂存、SHA-256、依赖闭包、C++ DLL 导出符号或 Win7 PE/API 门禁失败，都不应继续打包。

如需配置 SDK 或 MSYS2 MINGW64，请参照当前 `scripts/` 构建脚本。务必保持同一平台的 DLL ABI 一致；不要用本机系统 PATH 中另一版本 DLL 代替分发包自带 DLL。

最终构建与验收说明见 [开发说明](../docs/DEVELOPMENT.md) 和 [发布说明](../docs/RELEASE.md)。
