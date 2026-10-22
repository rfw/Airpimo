/**
 * Airpimo-specific, fail-closed source transform for the pinned UxPlay 1.73.7
 * renderers/video_renderer.c. The UxPlay copyright/license is unchanged.
 *
 * Do not apply to a different upstream commit. Each anchor must occur exactly
 * once; changing upstream code requires a new review of every transformation.
 */
import {readFileSync, writeFileSync} from 'node:fs';

function replaceOnce(source, before, after, label) {
  const index = source.indexOf(before);
  if (index < 0 || source.indexOf(before, index + 1) >= 0) {
    throw Error(`UxPlay renderer patch rejected: ${label} anchor absent or ambiguous`);
  }
  return source.slice(0, index) + after + source.slice(index + before.length);
}

export function patchRendererSource(source) {
  let next = source;
  next = replaceOnce(next,
    'static video_renderer_t *renderer = NULL;\n',
    `/* Protect publication and retirement of the active renderer, and acquisition
     * of an independent appsrc reference by the RTP producer thread. Never
     * hold this mutex while pushing buffers or changing GStreamer state. */
    static GMutex airpimo_renderer_mutex;
    static video_renderer_t *renderer = NULL;
`, 'active renderer declaration');
  next = replaceOnce(next,
    'void video_renderer_init(logger_t *render_logger, const char *server_name,',
    `void video_renderer_init(logger_t *render_logger, const char *server_name,`, 'init function'); // assert upstream identity
  next = replaceOnce(next,
    '    GError *error = NULL;\n    GstCaps *caps = NULL;',
    `    /* Do not expose an old session's renderer while the new pipelines are
     * being constructed. New frames are ignored until a codec is selected. */
    g_mutex_lock(&airpimo_renderer_mutex);
    renderer = NULL;
    g_mutex_unlock(&airpimo_renderer_mutex);
    GError *error = NULL;
    GstCaps *caps = NULL;`, 'init stale renderer');
  next = replaceOnce(next,
    `            if (hls_video && i == 0) {
                renderer = renderer_type[i];
            }`,
    `            if (hls_video && i == 0) {
                g_mutex_lock(&airpimo_renderer_mutex);
                renderer = renderer_type[i];
                g_mutex_unlock(&airpimo_renderer_mutex);
            }`, 'hls renderer publication');
  next = replaceOnce(next,
    `    renderer = NULL;
    first_packet = true;`,
    `    g_mutex_lock(&airpimo_renderer_mutex);
    renderer = NULL;
    g_mutex_unlock(&airpimo_renderer_mutex);
    first_packet = true;`, 'renderer start reset');
  next = replaceOnce(next,
    `        if (!renderer || !(renderer->appsrc)) {
            logger_log(logger, LOGGER_DEBUG, "*** no video renderer found");
            return 0;
        }
        buffer = gst_buffer_new_allocate`,
    `        /* The renderer may be retired by the control/GStreamer thread.
         * Checking renderer->appsrc then using it unlocked is a UAF race.
         * Take a strong appsrc reference BEFORE releasing the pointer lock. */
        GstElement *airpimo_appsrc = NULL;
        g_mutex_lock(&airpimo_renderer_mutex);
        if (renderer && renderer->appsrc) {
            airpimo_appsrc = (GstElement *) gst_object_ref(renderer->appsrc);
        }
        g_mutex_unlock(&airpimo_renderer_mutex);
        if (!airpimo_appsrc) {
            logger_log(logger, LOGGER_DEBUG, "*** no video renderer found");
            return 0;
        }
        buffer = gst_buffer_new_allocate`, 'producer strong reference');
  next = replaceOnce(next,
    `        gst_app_src_push_buffer (GST_APP_SRC(renderer->appsrc), buffer);
#ifdef X_DISPLAY_FIX`,
    `        gst_app_src_push_buffer (GST_APP_SRC(airpimo_appsrc), buffer);
        gst_object_unref(airpimo_appsrc);
#ifdef X_DISPLAY_FIX`, 'producer release reference');
  next = replaceOnce(next,
    `void video_renderer_destroy() {
    for (int i = 0; i < n_renderers; i++) {
        if (renderer_type[i]) {
            video_renderer_destroy_instance(renderer_type[i]);
        }
    }
}`,
    `void video_renderer_destroy() {
    video_renderer_t *retired[NCODECS] = {0};
    /* Detach published pointers before any pipeline transitions/unrefs.
     * The streaming thread either holds its own appsrc ref or skips a frame. */
    g_mutex_lock(&airpimo_renderer_mutex);
    renderer = NULL;
    for (int i = 0; i < NCODECS; i++) {
        retired[i] = renderer_type[i];
        renderer_type[i] = NULL;
    }
    g_mutex_unlock(&airpimo_renderer_mutex);
    for (int i = 0; i < NCODECS; i++) {
        if (retired[i]) video_renderer_destroy_instance(retired[i]);
    }
}`, 'renderer retirement');
  next = replaceOnce(next,
    `    renderer = renderer_used;
    gst_element_set_state (renderer->pipeline, GST_STATE_PLAYING);`,
    `    g_mutex_lock(&airpimo_renderer_mutex);
    renderer = renderer_used;
    g_mutex_unlock(&airpimo_renderer_mutex);
    gst_element_set_state (renderer->pipeline, GST_STATE_PLAYING);`, 'codec publication');
  return next;
}

export function applyRendererPatch(file) {
  const before = readFileSync(file, 'utf8');
  const patched = patchRendererSource(before);
  if (patched === before) throw Error('Renderer patch produced no modifications');
  writeFileSync(file, patched);
}
