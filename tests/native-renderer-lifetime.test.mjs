import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync, mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {patchRendererSource,applyRendererPatch} from '../native/patches/renderer-lifetime.mjs';
import {engineDir,RENDERER_PATCH_SHA256,storeEngine,verifiedCachedEngine} from '../scripts/native-engine-core.mjs';

// Only the exact upstream anchors are simulated; successful source rewrite is
// distinct from a native compilation or macOS/Win7 physical-device test.
const source = `static video_renderer_t *renderer = NULL;
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

test('pin-matched video producer takes a strong GObject reference under lock and releases it after push',()=>{
  const patched=patchRendererSource(source);
  assert.match(patched,/g_mutex_lock\(&airpimo_renderer_mutex\);\s*if \(renderer && renderer->appsrc\) \{\s*airpimo_appsrc = \(GstElement \*\) gst_object_ref\(renderer->appsrc\);/);
  assert.match(patched,/gst_app_src_push_buffer \(GST_APP_SRC\(airpimo_appsrc\), buffer\);\s*gst_object_unref\(airpimo_appsrc\);/);
  assert.doesNotMatch(patched,/gst_app_src_push_buffer \(GST_APP_SRC\(renderer->appsrc\), buffer\)/);
  assert.match(patched,/renderer = NULL;\s*for \(int i = 0; i < NCODECS; i\+\+\) \{\s*retired\[i\] = renderer_type\[i\];\s*renderer_type\[i\] = NULL;/);
  assert.match(patched,/g_mutex_unlock\(&airpimo_renderer_mutex\);\s*for \(int i = 0; i < NCODECS; i\+\+\) \{\s*if \(retired\[i\]\) video_renderer_destroy_instance/);
  assert.equal((patched.match(/static GMutex airpimo_renderer_mutex;/g)||[]).length,1);
});

test('source transform fails closed on unknown, duplicate, or already-patched UxPlay',()=>{
  assert.throws(()=>patchRendererSource(source.replace('static video_renderer_t *renderer = NULL;', 'static int other;')),/anchor absent/);
  assert.throws(()=>patchRendererSource(source+source),/ambiguous/);
  assert.throws(()=>patchRendererSource(patchRendererSource(source)),/anchor absent/);
});

test('source patch is identified by content digest and older valid binary receipts are invalidated',()=>{
  const actual=createHash('sha256')
    .update(readFileSync(new URL('../native/patches/renderer-lifetime.mjs',import.meta.url)))
    .update('\0')
    .update(readFileSync(new URL('../native/patches/audio-empty-packets.mjs',import.meta.url)))
    .digest('hex');
  assert.equal(RENDERER_PATCH_SHA256,actual);
  const dir=mkdtempSync(join(tmpdir(),'airpimo-renderer-patch-'));
  try {
    const opts={platform:'win32',arch:'x64',home:dir,env:{}};
    const exe=join(dir,'uxplay.exe');writeFileSync(exe,Buffer.from('4d5a01020304','hex'));
    const {binary}=storeEngine(exe,opts);
    assert.equal(verifiedCachedEngine(opts),binary);
    const receiptPath=join(engineDir(opts),'receipt.json');
    const receipt=JSON.parse(readFileSync(receiptPath));
    delete receipt.rendererPatchSha256;
    writeFileSync(receiptPath,JSON.stringify(receipt));
    assert.equal(verifiedCachedEngine(opts),null);
    receipt.rendererPatchSha256='0'.repeat(64);
    writeFileSync(receiptPath,JSON.stringify(receipt));
    assert.equal(verifiedCachedEngine(opts),null);
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('patch writes a deterministic result and never silently patches incompatible source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'airpimo-renderer-apply-'));
  try {
    const path=join(dir,'video_renderer.c');writeFileSync(path,source);
    applyRendererPatch(path);
    assert.equal(readFileSync(path,'utf8'),patchRendererSource(source));
    assert.throws(()=>applyRendererPatch(path),/anchor absent/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
