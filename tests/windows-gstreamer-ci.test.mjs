import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
const workflow = readFileSync(resolve(import.meta.dirname, '../.github/workflows/release-gate.yml'), 'utf8');

const script = readFileSync(resolve(import.meta.dirname, '../scripts/ci/install-gstreamer-win.ps1'), 'utf8');

test('GitHub Windows cloud installer pins and hashes both GStreamer 1.24.13 MinGW MSIs', () => {
  assert.match(script, /gstreamer-1\.0-mingw-x86_64-1\.24\.13\.msi/);
  assert.match(script, /gstreamer-1\.0-devel-mingw-x86_64-1\.24\.13\.msi/);
  assert.match(script, /sha256sum/);
  assert.match(script, /Get-FileHash/);
  assert.match(script, /-ne \$expected/);
  assert.doesNotMatch(script, /gstreamer-1\.0-msvc-x86_64/);
});

test('MSI installs have an explicit root, all features, and per-package failure logs', () => {
  assert.match(script, /ADDLOCAL=ALL/);
  assert.match(script, /INSTALLDIR=/);
  assert.match(script, /\/L\*v/);
  assert.match(script, /-Wait -PassThru/);
  assert.match(script, /ExitCode -notin @\(0, 3010\)/);
  assert.match(script, /Get-Content -LiteralPath \$log -Tail 120/);
  assert.match(script, /RUNNER_TEMP/);
  assert.match(script, /GetTempPath/);
});

test('SDK discovery and H264/AAC plugin checks cannot be bypassed by a successful MSI exit', () => {
  assert.match(script, /Get-ChildItem -LiteralPath \$installPrefix/);
  assert.match(script, /gst-inspect-1\.0\.exe/);
  assert.match(script, /gstreamer-1\.0\.pc/);
  assert.match(script, /gst\\gst\.h/);
  assert.match(script, /libgstlibav\.dll/);
  assert.match(script, /avdec_h264/);
  assert.match(script, /avdec_aac/);
  assert.match(script, /1\\\.24\\\.13/);
  assert.match(script, /UXPLAY_GST_RUNTIME=\$root/);
  assert.match(script, /GITHUB_ENV/);
  assert.match(script, /GITHUB_PATH/);
});

test('GStreamer 1.24 INSTALLDIR is an isolated prefix and cannot reuse runner SDKs', () => {
  assert.match(script, /\$installPrefix = "\$\{drive\}\\uxplay-gstreamer-1\.24\.13"/);
  assert.match(script, /Test-Path -LiteralPath \$installPrefix/);
  assert.match(script, /Refusing to reuse pre-existing GStreamer installation prefix/);
  assert.match(script, /-f \$file, \$installPrefix, \$log/);
  assert.match(script, /Get-ChildItem -LiteralPath \$installPrefix/);
  assert.match(script, /\.Directory\.Parent\.Name -eq 'mingw_x86_64'/);
  assert.doesNotMatch(script, /GetEnvironmentVariable\([^\n]*'Machine'/);
  assert.doesNotMatch(script, /\$prefixes\s*=/);
  assert.doesNotMatch(script, /\$requestedRoot\s*=/);
});

test('Only one complete staged SDK may pass after isolated MSI installation', () => {
  assert.match(script, /\$validRoots\.Count -ne 1/);
  assert.match(script, /libexec\\gstreamer-1\.0\\gst-plugin-scanner\.exe/);
  assert.match(script, /GST_PLUGIN_SCANNER_1_0 = \$scanner/);
  assert.match(script, /GST_PLUGIN_SYSTEM_PATH_1_0 = \$pluginDir/);
  assert.match(script, /\$env:PATH = /);
});

test('Windows hosted failure preserves MSI logs as an Actions artifact', () => {
  assert.match(workflow, /name: Upload GStreamer MSI logs if installation fails/);
  assert.match(workflow, /if: failure\(\)/);
  assert.match(workflow, /uxplay-ci-gstreamer-msi-logs/);
  assert.match(workflow, /uxplay-gst-msi\/\*\.install\.log/);
});
