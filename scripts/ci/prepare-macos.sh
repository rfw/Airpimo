#!/usr/bin/env bash
set -euo pipefail
TARGET="${1:?Usage: prepare-macos.sh x86_64-apple-darwin|aarch64-apple-darwin}"
case "$TARGET" in
  x86_64-apple-darwin) [[ "$(uname -m)" == x86_64 ]] || { echo 'Wrong macOS host architecture'; exit 2; } ;;
  aarch64-apple-darwin) [[ "$(uname -m)" == arm64 ]] || { echo 'Wrong macOS host architecture'; exit 2; } ;;
  *) echo 'Unsupported macOS target'; exit 2 ;;
esac
if ! command -v brew >/dev/null; then echo 'Homebrew unavailable on this runner'; exit 2; fi
# Upstream-pinned UxPlay 1.73.7 macOS builds; system Bonjour remains native.
brew install cmake ninja pkg-config libplist openssl@3 glib gstreamer gst-plugins-base gst-plugins-good gst-plugins-bad gst-libav
BREW_PREFIX="$(brew --prefix)"
export HOMEBREW_PREFIX="$BREW_PREFIX"
export PATH="$BREW_PREFIX/bin:$PATH"
export PKG_CONFIG_PATH="$BREW_PREFIX/lib/pkgconfig:${PKG_CONFIG_PATH:-}"
command -v gst-inspect-1.0
for element in avdec_h264 avdec_aac level; do
  gst-inspect-1.0 "$element" > /dev/null || { echo "Missing required GStreamer element: $element" >&2; exit 2; }
done
# Homebrew may not link its private libexec tools into /opt/homebrew or
# /usr/local. Locate the scanner in the installed gstreamer formula keg.
GSTREAMER_FORMULA_PREFIX="$(brew --prefix gstreamer)"
SCANNER="$GSTREAMER_FORMULA_PREFIX/libexec/gstreamer-1.0/gst-plugin-scanner"
if [[ ! -f "$SCANNER" ]]; then
  SCANNER="$(brew list gstreamer | grep -E '(^|/)gst-plugin-scanner$' | head -n 1 || true)"
fi
if [[ ! -f "$SCANNER" || ! -x "$SCANNER" ]]; then
  echo "BLOCKED: gst-plugin-scanner not found/executable in Homebrew gstreamer formula ($GSTREAMER_FORMULA_PREFIX)" >&2
  brew list gstreamer | grep -E 'scanner|libexec' >&2 || true
  exit 2
fi
printf '[gst] Using formula scanner: %s\n' "$SCANNER"
npm run native:prepare
npm run native:bundle:from-build -- --gst "$BREW_PREFIX" --gst-scanner "$SCANNER"
# Retain only AirPlay GStreamer elements and their full Mach-O dylib closure.
# This avoids unrelated Python/Node/HTTP/etc libraries bloating or blocking DMGs.
npm run native:prune:mac -- --gst "$BREW_PREFIX" --apply
# Compile title-only helper; native macOS fullscreen stays enabled without custom overlays.
bash scripts/ci/build-macos-fullscreen.sh "$TARGET"
# Staged binaries are still checked and relocated in a separate release gate.
