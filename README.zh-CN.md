[English](README.md) | **简体中文**

# Airpimo

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

```sh
npm ci
npm run test:source
npm test
npm run build
npm run tauri dev
```

`npm run desktop:dev` 使用项目已有的原生资源或经过校验的开发 Runtime；`npm run tauri dev` 是另一种本地启动入口。若缺少 UxPlay/GStreamer，网页界面能够启动不代表投屏可用。

详细的开发依赖、Windows/macOS 打包命令见 [开发说明](docs/DEVELOPMENT.md)；发行前的完整性校验与授权义务见 [发布说明](docs/RELEASE.md)。

## 项目结构

| 路径 | 内容 |
| --- | --- |
| `src/` | React UI、主题、设置及状态展示 |
| `src-tauri/src/` | Rust 后端、接收进程管理、托盘与诊断 |
| `scripts/` | 原生资源准备、ABI 检查、构建与测试 |
| `src-tauri/resources/` | 分发时暂存的 UxPlay、GStreamer 等平台资源 |
| `.github/workflows/` | GitHub Actions 构建与发布门禁 |

## 版权与贡献

Airpimo 不拥有 UxPlay/GStreamer 的上游版权。修改、使用或分发相应组件时，必须分别遵守其许可证并提供必要的版权声明及对应源码。社区版采用 GPLv3，并不表示第三方代码获得了另行商业重授权。
