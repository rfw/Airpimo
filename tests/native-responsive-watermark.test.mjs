import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {patchRendererSource} from '../native/patches/renderer-lifetime.mjs';
import {patchResponsiveWatermarkSource, applyResponsiveWatermarkPatch} from '../native/patches/watermark-auto-size.mjs';
import {RENDERER_PATCH_SHA256, engineDir, storeEngine, verifiedCachedEngine} from '../scripts/native-engine-core.mjs';

// A minimal source layout carrying the actual renderer-lifetime anchors;
// not a substitute for compiling UxPlay 1.73.7 and iPhone rotation testing.
const upstream = `static video_renderer_t *renderer = NULL;
void video_renderer_init(logger_t *render_logger, const char *server_name,
    GError *error = NULL;
    GstCaps *caps = NULL;
            if (hls_video && i == 0) {
                renderer = renderer_type[i];
            }
    renderer = NULL;
    first_packet = true;
        if (!renderer || !(renderer->appsrc)) {
            logger_log(logger, LOGGER_DEBUG, "*** no video renderer found");
            return 0;
        }
        buffer = gst_buffer_new_allocate
        gst_app_src_push_buffer (GST_APP_SRC(renderer->appsrc), buffer);
#ifdef X_DISPLAY_FIX
void video_renderer_destroy() {
    for (int i = 0; i < n_renderers; i++) {
        if (renderer_type[i]) {
            video_renderer_destroy_instance(renderer_type[i]);
        }
    }
}
    renderer = renderer_used;
    gst_element_set_state (renderer->pipeline, GST_STATE_PLAYING);`;
const source = patchRendererSource(upstream);

test('video caps changes automatically update only the named cross-platform watermark',()=>{
  const c = patchResponsiveWatermarkSource(source);
  assert.match(c, /#if defined\(__APPLE__\) \|\| defined\(_WIN32\)\s*\/\* The CAPS seen at video_sink/);
  assert.match(c, /gst_event_parse_caps\(event, &caps\)/);
  assert.match(c, /gst_pad_add_probe\(pad, GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM/);
  assert.match(c, /gst_element_get_static_pad\(overlay, "video_sink"\)/);
  assert.match(c, /gst_bin_get_by_name\(GST_BIN\(pipeline\), "airpimo_watermark"\)/);
  assert.match(c, /width \* par_n < \(gint64\)height \* par_d/);
  assert.match(c, /portrait \? 16\.0 : 14\.0/);
  assert.match(c, /portrait \? 12\.0 : 12\.0/);
  assert.match(c, /g_object_set\(overlay, "font-desc", font_desc, "xpad", margin/);
  assert.match(c, /g_weak_ref_get\(&state->overlay\)/);
  assert.match(c, /g_weak_ref_clear\(&state->overlay\)/);
  assert.match(c, /#if defined\(__APPLE__\) \|\| defined\(_WIN32\)\s*airpimo_watermark_attach\(renderer_used->pipeline\);\s*#endif/);
  assert.doesNotMatch(c, /gst_element_set_state\s*\([^;]*GST_STATE_NULL[^;]*\);\s*airpimo_watermark_attach/);
});

test('native transform rejects unrecognized or already modified renderer',()=>{
  assert.throws(()=>patchResponsiveWatermarkSource(upstream),/renderer-lifetime patch missing/);
  assert.throws(()=>patchResponsiveWatermarkSource(source.replace('renderer = renderer_used;', 'renderer = something_else;')),/anchor absent/);
  assert.throws(()=>patchResponsiveWatermarkSource(patchResponsiveWatermarkSource(source)),/already modified/);
});

test('written patch is deterministic and does not alter input if mismatch',()=>{
  const dir=mkdtempSync(join(tmpdir(),'airpimo-watermark-'));
  try {
    const p=join(dir,'video_renderer.c');
    writeFileSync(p,source);
    applyResponsiveWatermarkPatch(p);
    assert.equal(readFileSync(p,'utf8'),patchResponsiveWatermarkSource(source));
    assert.throws(()=>applyResponsiveWatermarkPatch(p),/already modified/);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('macOS and Windows both get named watermark, with no -vsync no default',()=>{
  const rust=readFileSync(new URL('../src-tauri/src/uxplay_args.rs',import.meta.url),'utf8');
  assert.match(rust, /#\[cfg\(any\(windows, target_os = "macos"\)\)\]\s*converter\.push_str\(" name=airpimo_watermark auto-resize=false"\)/);
  assert.match(rust, /xpad=12 ypad=12 font-desc=\\"Sans 14\\"/);
  assert.doesNotMatch(rust, /push_default\(&mut args, &custom, "-vsync", Some\("no"\)\)/);
});

test('all three native patches invalidate previous engine cache receipts',()=>{
  const root=new URL('../native/patches/',import.meta.url);
  const digest=createHash('sha256')
    .update(readFileSync(new URL('renderer-lifetime.mjs',root))).update('\0')
    .update(readFileSync(new URL('audio-empty-packets.mjs',root))).update('\0')
    .update(readFileSync(new URL('watermark-auto-size.mjs',root))).digest('hex');
  assert.equal(RENDERER_PATCH_SHA256,digest);
  const home=mkdtempSync(join(tmpdir(),'airpimo-watermark-cache-'));
  try {
    const path=join(home,'uxplay.exe');writeFileSync(path,Buffer.from('4d5a01020304','hex'));
    const options={platform:'win32',arch:'x64',env:{},home};
    const {binary}=storeEngine(path,options);
    assert.equal(verifiedCachedEngine(options),binary);
    const receiptPath=join(engineDir(options),'receipt.json');
    const receipt=JSON.parse(readFileSync(receiptPath));
    receipt.rendererPatchSha256='f'.repeat(64);
    writeFileSync(receiptPath,JSON.stringify(receipt));
    assert.equal(verifiedCachedEngine(options),null);
  } finally {rmSync(home,{recursive:true,force:true});}
});
