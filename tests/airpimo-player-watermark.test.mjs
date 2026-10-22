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
  assert.match(rust,/xpad=16 ypad=16 font-desc=/);
  assert.match(rust,/color=0x99FFFFFF/);
  assert.match(rust,/draw-shadow=true draw-outline=false shaded-background=false/);
  assert.match(rust,/if brightness < 100/);
  assert.match(rust,/converter\.push_str\(&format!\(/);
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
