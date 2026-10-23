#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:?Usage: build-macos-fullscreen.sh x86_64-apple-darwin|aarch64-apple-darwin}"
case "$TARGET" in
  x86_64-apple-darwin) ARCH=x86_64;;
  aarch64-apple-darwin) ARCH=arm64;;
  *) echo "BLOCKED: Unsupported macOS fullscreen target: $TARGET" >&2; exit 2;;
esac
[[ "$(uname -s)" == Darwin && "$(uname -m)" == "$ARCH" ]] || {
  echo "BLOCKED: macOS native fullscreen must build on a matching $ARCH Mac" >&2; exit 2;
}
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE="$ROOT/native/fullscreen/uxplay-fullscreen-macos.m"
OUT_DIR="$ROOT/src-tauri/resources/fullscreen"
mkdir -p "$OUT_DIR"
OUT="$OUT_DIR/uxplay-fullscreen-macos.dylib"
# Force Ventura as the minimum for our OWN helper; dependent UxPlay/GStreamer
# libraries still need their independent compatibility audit.
clang -fobjc-arc -fblocks -dynamiclib -O2 \
  -arch "$ARCH" -mmacosx-version-min=13.0 \
  -framework Cocoa -framework ApplicationServices "$SOURCE" -o "$OUT"
file "$OUT"
lipo -archs "$OUT" | grep -qx "$ARCH" || { echo 'BLOCKED: incorrect helper architecture' >&2; exit 2; }
if command -v vtool >/dev/null; then
  vtool -show-build "$OUT" | grep -A 2 'platform MACOS' || true
fi
printf 'PASS: compiled child-process Airpimo Player title helper (%s): %s\n' "$ARCH" "$OUT"
