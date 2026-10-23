import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {patchResponsiveWatermarkSource} from '../native/patches/watermark-auto-size.mjs';
import {MDNS_WATERMARK_PATCH_SHA256} from '../scripts/win7-mdns-core.mjs';
import {createHash} from 'node:crypto';

const read = rel => readFileSync(new URL(`../${rel}`, import.meta.url),'utf8');

test('Windows internal-mDNS renderer installs one adaptive watermark CAPS probe',()=>{
  const source=`void video_renderer_init(logger_t *render_logger, const char *server_name,
    some_arguments);
    renderer = renderer_used;
    gst_element_set_state (renderer->pipeline, GST_STATE_PLAYING);`;
  const output=patchResponsiveWatermarkSource(source,{variant:'internal-mdns'});
  assert.match(output,/defined\(_WIN32\)/);
  assert.match(output,/airpimo_watermark_attach\(renderer_used->pipeline\);/);
  assert.match(output,/portrait \? 24\.0 : 14\.0/);
  assert.match(output,/portrait \? 22\.0 : 12\.0/);
  assert.equal((output.match(/airpimo_watermark_attach\(renderer_used->pipeline\);/g)??[]).length,1);
  assert.throws(()=>patchResponsiveWatermarkSource(source,{variant:'wrong'}),/Unsupported/);
  assert.throws(()=>patchResponsiveWatermarkSource(output,{variant:'internal-mdns'}),/absent or ambiguous/);
  assert.throws(()=>patchResponsiveWatermarkSource(source.replace('renderer = renderer_used;', 'renderer = renamed;'),{variant:'internal-mdns'}),/not found/);
});

test('both Windows native build tracks apply adaptive watermark and Windows mDNS receipt binds patch hash',()=>{
  const pinned=read('scripts/native-engine-core.mjs');
  const mdns=read('scripts/win7-mdns-engine.mjs');
  assert.match(pinned,/platform==='darwin' \|\| platform==='win32'/);
  assert.match(mdns,/applyResponsiveWatermarkPatch\(join\(src,'renderers','video_renderer.c'\), \{variant:'internal-mdns'\}\)/);
  assert.match(mdns,/watermarkPatchSha256:MDNS_WATERMARK_PATCH_SHA256/);
  const source=read('native/patches/watermark-auto-size.mjs');
  const expected=createHash('sha256').update(source).digest('hex');
  assert.equal(MDNS_WATERMARK_PATCH_SHA256,expected);
});

test('Windows player removes only UxPlay child taskbar entry, not its video window',()=>{
  const win=read('src-tauri/src/windows_player.rs');
  assert.match(win,/suppress_child_taskbar_button\(hwnd\)/);
  assert.match(win,/GetWindowThreadProcessId/);
  assert.match(win,/WS_EX_TOOLWINDOW/);
  assert.match(win,/old & !WS_EX_APPWINDOW/);
  assert.match(win,/ShowWindow\(hwnd, SW_HIDE\);[\s\S]*ShowWindow\(hwnd, SW_SHOWNA\);/);
  assert.match(win,/GetDoubleClickTime/);
  assert.doesNotMatch(win,/SetWindowsHookEx|CreateRemoteThread/);
});

test('macOS child helper uses Accessory activation policy without changing full-screen or safe-close logic',()=>{
  const native=read('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native,/NSApplicationActivationPolicyAccessory/);
  assert.match(native,/!self.dockPolicyApplied && NSApp/);
  assert.match(native,/AIRPIMO_PLAYER_TITLE_CHILD/);
  assert.match(native,/airpimoInstallSafeClose/);
  assert.match(native,/\[self orderOut:nil\]/);
  assert.doesNotMatch(native,/NSApplicationActivationPolicyProhibited/);
});
