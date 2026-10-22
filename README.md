**English** | [简体中文](README.zh-CN.md)

# Airpimo

> Official repository: <https://github.com/rfw/Airpimo>. Airpimo's original code in the current community edition is licensed under **GPL-3.0-or-later (GPLv3)**. See [LICENSE](LICENSE) for the full terms. Third-party components, including UxPlay, retain their respective licenses. See [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt) for details.

Airpimo is a cross-platform desktop AirPlay receiver. It uses **Tauri + React + Rust** for its control interface and a separate native **UxPlay/GStreamer** process to receive and play video and audio.

## Features

- Receive iPhone/iPad screen mirroring with a configurable device name
- Start and stop the receiver, view its status, and see error messages
- System tray integration, themes, settings, and diagnostic logs
- Separate build configurations for Windows 7 and Windows 10/11, plus macOS builds for Intel and Apple Silicon

Actual platform support depends on testing with the target operating system and its native audio/video runtime.

## Local Development

Install Node.js/npm, the Rust toolchain, and the Tauri build prerequisites for your platform.

```sh
npm ci
npm run test:source
npm test
npm run build
npm run tauri dev
```

`npm run desktop:dev` uses the project's existing native resources or a verified development runtime. `npm run tauri dev` is another entry point for local development. A working web interface does not necessarily mean AirPlay mirroring will work if UxPlay or GStreamer is unavailable.

See the [development guide](docs/DEVELOPMENT.md) for detailed prerequisites and Windows/macOS packaging commands. See the [release guide](docs/RELEASE.md) for pre-release integrity checks and licensing obligations.

## Project Structure

| Path | Description |
| --- | --- |
| `src/` | React UI, themes, settings, and status display |
| `src-tauri/src/` | Rust backend, receiver process management, system tray, and diagnostics |
| `scripts/` | Native resource preparation, ABI checks, builds, and tests |
| `src-tauri/resources/` | Staging area for platform-specific resources such as UxPlay and GStreamer |
| `.github/workflows/` | GitHub Actions build and release checks |

## Copyright and Contributions

Airpimo does not own the upstream copyrights for UxPlay or GStreamer. Any modification, use, or distribution of these components must comply with their respective licenses and include the required copyright notices and corresponding source code. The community edition's GPLv3 license does not grant separate commercial relicensing rights to third-party code.
