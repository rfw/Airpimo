#!/usr/bin/env bash
# Run on an actual macOS build host. This is a COMPILE/TEST gate, not a substitute
# for AirPlay discovery, media or clean-machine packaging verification.
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo 'BLOCKED: verify-macos.sh must be run on macOS. This is not a macOS emulator.' >&2
  exit 2
fi
for tool in node npm cargo rustc; do
  if ! command -v "$tool" >/dev/null; then
    echo "BLOCKED: required tool not installed: $tool" >&2
    exit 2
  fi
done
printf '\n==> Environment\n'
node --version; npm --version; rustc --version; cargo --version
printf '\n==> JavaScript dependencies\n'
if [[ -f package-lock.json ]]; then npm ci; else npm install; fi
printf '\n==> Frontend tests & build\n'
npm run test
npm run test:source
npm run typecheck
npm run build
printf '\n==> Rust compile & tests\n'
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
printf '\n==> Tauri Cargo.lock graph\n'
npm run check:rust-lock
printf '\nPASS: source tests and macOS native compilation succeeded.\n'
if [[ "${1:-}" == '--native' ]]; then
  printf '\n==> Native package file gate\n'
  node scripts/check-native.mjs
  printf '\nPASS: staged binaries passed hash checks; real iPhone connection and audio/video are NOT automatically verified.\n'
else
  printf 'NOT RUN: native package gate (specify --native after staging UxPlay/GStreamer).\n'
fi
printf 'NOT RUN: iPhone AirPlay discovery, actual screen/audio, clean-machine install, and long playback.\n'
