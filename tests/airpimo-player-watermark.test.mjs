import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {REQUIRED_ELEMENTS} from '../scripts/prune-macos-native.mjs';
const root=resolve(import.meta.dirname,'..');
const source = p=>readFileSync(resolve(root,p),'utf8');

test('watermark uses existing UxPlay -vc pipeline, no Tauri overlay or extra window',()=>{
  const rust=source('src-tauri/src/uxplay_args.rs');
  assert.match(rust,/args\.push\("-vc"\.into\(\)\);\s*args\.push\(converter\);/);
  assert.match(rust,/textoverlay text=Airpimo halignment=right valignment=bottom/);
  assert.match(rust,/xpad=12 ypad=12 font-desc=/);
  assert.match(rust,/color=0x99FFFFFF/);
  assert.match(rust,/draw-shadow=true draw-outline=false shaded-background=false/);
  assert.doesNotMatch(rust,/videobalance|brightness/);
  assert.match(rust,/\["-n", "-fps", "-vc", "-nh"\]/);
});

test('macOS native runtime retains and smoke-checks required pango textoverlay',()=>{
  assert.ok(REQUIRED_ELEMENTS.includes('textoverlay'));
  const prep=source('scripts/ci/prepare-macos.sh');
  assert.match(prep,/for element in avdec_h264 avdec_aac level textoverlay;/);
  const smoke=source('scripts/smoke-macos-gstreamer.mjs');
  assert.match(smoke,/\.\.\.REQUIRED_ELEMENTS/);
});

test('Windows 7 and modern Windows validate watermark plugin on SDK and packaged runtime',()=>{
  const install=source('scripts/ci/install-gstreamer-win.ps1');
  assert.match(install,/foreach \(\$target in @\('avdec_h264', 'avdec_aac', 'textoverlay'\)\)/);
  const check=source('scripts/check-native.mjs');
  assert.match(check,/inspect=spawnSync\(inspector,\['textoverlay'\]/);
  assert.match(check,/gstreamer\/lib\/gstreamer-1\.0\/libgstpango\.dll/);
  assert.match(check,/Windows textoverlay plugin loaded from outside the packaged native runtime/);
  assert.match(check,/manifest\.os==='win32'/);
});


test('macOS and Windows mirroring watermark opts into native orientation-aware size',()=>{
  const rust=source('src-tauri/src/uxplay_args.rs');
  const native=source('native/patches/watermark-auto-size.mjs');
  const engine=source('scripts/native-engine-core.mjs');
  assert.match(rust, /#\[cfg\(any\(windows, target_os = "macos"\)\)\]\s*converter\.push_str\(" name=airpimo_watermark auto-resize=false"\)/);
  assert.match(native, /GST_EVENT_CAPS/);
  assert.match(native, /pixel-aspect-ratio/);
  assert.match(native, /airpimo_watermark_attach\(renderer_used->pipeline\)/);
  assert.match(engine, /if\(platform==='darwin' \|\| platform==='win32'\) applyResponsiveWatermarkPatch/);
});
