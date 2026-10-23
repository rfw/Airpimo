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
  assert.match(output,/portrait \? 16\.0 : 14\.0/);
  assert.match(output,/portrait \? 12\.0 : 12\.0/);
  assert.equal((output.match(/airpimo_watermark_attach\(renderer_used->pipeline\);/g)??[]).length,1);
  assert.throws(()=>patchResponsiveWatermarkSource(source,{variant:'wrong'}),/Unsupported/);
  assert.throws(()=>patchResponsiveWatermarkSource(output,{variant:'internal-mdns'}),/already modified/);
  assert.throws(()=>patchResponsiveWatermarkSource(source.replace('renderer = renderer_used;', 'renderer = renamed;'),{variant:'internal-mdns'}),/publication must be unique/);
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
  assert.match(win,/ITaskbarList/);
  assert.match(win,/CoCreateInstance/);
  assert.match(win,/CoUninitialize/);
  assert.match(win,/ITaskbarListVtbl/);
  assert.match(win,/delete_tab/);
  assert.match(win,/WS_CAPTION \| WS_SYSMENU \| WS_MAXIMIZEBOX/);
  assert.doesNotMatch(win,/^const WS_EX_TOOLWINDOW/m);
  assert.match(win,/WS_MAXIMIZEBOX/);
  assert.match(win,/GetDoubleClickTime/);
  assert.doesNotMatch(win,/SetWindowsHookEx|CreateRemoteThread/);
});

test('macOS child helper uses Accessory activation policy without changing full-screen or safe-close logic',()=>{
  const native=read('native/fullscreen/uxplay-fullscreen-macos.m');
  assert.match(native,/NSApplicationActivationPolicyAccessory/);
  assert.match(native,/\[NSApp activationPolicy\] != NSApplicationActivationPolicyAccessory/);
  assert.match(native,/AIRPIMO_PLAYER_TITLE_CHILD/);
  assert.match(native,/airpimoInstallSafeClose/);
  assert.match(native,/\[self orderOut:nil\]/);
  assert.doesNotMatch(native,/NSApplicationActivationPolicyProhibited/);
});

// Win7 internal-mDNS uses a different renderer activation sequence from 1.73.7:
// the published renderer may have a comment/conditional/other statements
// between assignment and PLAYING. The probe belongs to the publication
// block, not to an exact gst_element_set_state formatting pattern.
test('Windows mDNS 1.74 activation is not required to match macOS 1.73.7 adjacency',()=>{
  const sources = [
    `void video_renderer_init(logger_t *render_logger, const char *server_name,
      const char *other) {}
void video_renderer_select(void) {
  renderer = renderer_used;
  /* UxPlay 1.74 may schedule the state change later. */
  GST_DEBUG_OBJECT(renderer->pipeline, "new renderer");
  gst_element_set_state(renderer->pipeline,GST_STATE_PLAYING);
}`,
    `void video_renderer_init(logger_t *render_logger, const char *server_name,
      const char *other) {}
void video_renderer_select(void) {
  if (has_video)
      renderer = renderer_used; // publish the new video stream
  gst_element_set_state (renderer_used->pipeline, GST_STATE_PLAYING);
}`,
    `void video_renderer_init(logger_t *render_logger, const char *server_name,
      const char *other) {}
void video_renderer_select(void) {
  gst_element_set_state(renderer_used->pipeline, GST_STATE_PLAYING);
  renderer = renderer_used;
}`,
  ];
  for (const input of sources) {
    const output = patchResponsiveWatermarkSource(input,{variant:'internal-mdns'});
    assert.equal((output.match(/airpimo_watermark_attach\(renderer_used->pipeline\);/g)??[]).length,1);
    assert.match(output,/renderer = renderer_used;[^}]*airpimo_watermark_attach\(renderer_used->pipeline\)/s);
    assert.match(output,/#if defined\(__APPLE__\) \|\| defined\(_WIN32\)/);
    assert.throws(()=>patchResponsiveWatermarkSource(output,{variant:'internal-mdns'}),/already modified/);
  }
});

test('Windows watermark rejects missing/ambiguous renderer publication and unknown pipeline contract',()=>{
  const source=`void video_renderer_init(logger_t *render_logger, const char *server_name,
      int flags);
void select_video(void) {
  renderer = renderer_used;
  gst_element_set_state(renderer->pipeline, GST_STATE_PLAYING);
}`;
  const options={variant:'internal-mdns'};
  assert.throws(()=>patchResponsiveWatermarkSource(source.replace('renderer = renderer_used;', 'renderer = another;'), options),/publication must be unique/);
  assert.throws(()=>patchResponsiveWatermarkSource(source.replace('renderer = renderer_used;', 'renderer = renderer_used;\n  renderer = renderer_used;'), options),/publication must be unique/);
  assert.throws(()=>patchResponsiveWatermarkSource(source.replace('gst_element_set_state', 'not_a_state_change'), options),/state contract changed/);
  assert.throws(()=>patchResponsiveWatermarkSource(source.replace('renderer->pipeline', 'some_other_object'), options),/state contract changed/);
});
