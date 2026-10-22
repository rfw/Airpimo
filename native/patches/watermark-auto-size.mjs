/**
 * Airpimo scoped macOS backport on pinned FDH2/UxPlay 1.73.7.
 * React and window geometry are NOT involved. We track negotiated raw video
 * caps on the named textoverlay input as the iPhone changes orientation.
 * Never restart / replace the GStreamer pipeline to resize the watermark.
 * Requires renderer-lifetime.mjs to have been applied first.
 */
import {readFileSync, writeFileSync} from 'node:fs';

function replaceExactlyOnce(source, needle, replacement, label) {
  const first = source.indexOf(needle);
  if (first < 0 || source.indexOf(needle, first + 1) !== -1) {
    throw Error(`UxPlay watermark patch rejected: ${label} anchor absent or ambiguous`);
  }
  return source.slice(0, first) + replacement + source.slice(first + needle.length);
}

const nativeFunctions = String.raw`
#ifdef __APPLE__
/* The CAPS seen at video_sink are after UxPlay's videoflip/conversion stage:
 * orientation is thus based on actual rendered video, not the app window. */
typedef struct {
    GWeakRef overlay; /* pad-probe lifetime must NOT keep its parent element alive */
    GMutex mutex;
    gint last_width;
    gint last_height;
    gint last_par_n;
    gint last_par_d;
} AirpimoWatermarkProbe;

static void airpimo_watermark_probe_free(gpointer userdata) {
    AirpimoWatermarkProbe *state = (AirpimoWatermarkProbe *) userdata;
    g_weak_ref_clear(&state->overlay);
    g_mutex_clear(&state->mutex);
    g_free(state);
}

static void airpimo_watermark_apply_caps(AirpimoWatermarkProbe *state, const GstCaps *caps) {
    if (!caps || gst_caps_is_empty(caps) || gst_caps_is_any(caps)) return;
    const GstStructure *s = gst_caps_get_structure(caps, 0);
    gint width = 0, height = 0;
    if (!gst_structure_get_int(s, "width", &width) ||
        !gst_structure_get_int(s, "height", &height) ||
        width <= 0 || height <= 0) return;

    gint par_n = 1, par_d = 1;
    if (!gst_structure_get_fraction(s, "pixel-aspect-ratio", &par_n, &par_d) ||
        par_n <= 0 || par_d <= 0) {
        par_n = 1;
        par_d = 1;
    }

    g_mutex_lock(&state->mutex);
    const gboolean changed = width != state->last_width || height != state->last_height ||
                             par_n != state->last_par_n || par_d != state->last_par_d;
    if (changed) {
        state->last_width = width;
        state->last_height = height;
        state->last_par_n = par_n;
        state->last_par_d = par_d;
    }
    g_mutex_unlock(&state->mutex);
    if (!changed) return;

    /* Account for pixel aspect ratio and video rotation already applied by
     * videoflip. Bound the resulting font on unusually small/large streams. */
    const gboolean portrait = ((gint64)width * par_n < (gint64)height * par_d);
    const gdouble relative_height = (gdouble)height / (portrait ? 1920.0 : 1080.0);
    const gint font = CLAMP((gint)((portrait ? 26.0 : 12.0) * relative_height + 0.5),
                            portrait ? 18 : 10, portrait ? 32 : 16);
    const gint margin = CLAMP((gint)((portrait ? 22.0 : 12.0) * relative_height + 0.5),
                              portrait ? 14 : 8, portrait ? 28 : 16);
    gchar font_desc[32];
    g_snprintf(font_desc, sizeof(font_desc), "Sans %d", font);

    GObject *overlay = g_weak_ref_get(&state->overlay);
    if (overlay) {
        g_object_set(overlay, "font-desc", font_desc, "xpad", margin,
                     "ypad", margin, NULL);
        g_object_unref(overlay);
    }
}

static GstPadProbeReturn airpimo_watermark_on_caps(GstPad *pad,
                                                   GstPadProbeInfo *info,
                                                   gpointer userdata) {
    (void)pad;
    GstEvent *event = GST_PAD_PROBE_INFO_EVENT(info);
    if (event && GST_EVENT_TYPE(event) == GST_EVENT_CAPS) {
        GstCaps *caps = NULL;
        gst_event_parse_caps(event, &caps);
        airpimo_watermark_apply_caps((AirpimoWatermarkProbe *)userdata, caps);
    }
    return GST_PAD_PROBE_OK;
}

static void airpimo_watermark_attach(GstElement *pipeline) {
    if (!pipeline || !GST_IS_BIN(pipeline)) return;
    GstElement *overlay = gst_bin_get_by_name(GST_BIN(pipeline), "airpimo_watermark");
    if (!overlay) return; /* e.g. HLS playback without our mirror watermark */

    /* GstBaseTextOverlay names its incoming video pad video_sink. */
    if (g_object_get_data(G_OBJECT(overlay), "airpimo-watermark-probe")) {
        gst_object_unref(overlay);
        return;
    }
    GstPad *pad = gst_element_get_static_pad(overlay, "video_sink");
    if (pad) {
        g_object_set_data(G_OBJECT(overlay), "airpimo-watermark-probe", GINT_TO_POINTER(1));
        AirpimoWatermarkProbe *state = g_new0(AirpimoWatermarkProbe, 1);
        g_weak_ref_init(&state->overlay, G_OBJECT(overlay));
        g_mutex_init(&state->mutex);
        gst_pad_add_probe(pad, GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM,
                          airpimo_watermark_on_caps, state,
                          airpimo_watermark_probe_free);
        /* Handle any negotiated caps already present during PAUSED. */
        GstCaps *caps = gst_pad_get_current_caps(pad);
        if (caps) {
            airpimo_watermark_apply_caps(state, caps);
            gst_caps_unref(caps);
        }
        gst_object_unref(pad);
    }
    gst_object_unref(overlay);
}
#endif /* __APPLE__ */

`;

export function patchResponsiveWatermarkSource(source) {
  // These are reviewed exact anchors in our pinned renderer-lifetime transform.
  // Refuse alternate layouts instead of risking another renderer lifetime crash.
  if (!source.includes('static GMutex airpimo_renderer_mutex;')) {
    throw Error('UxPlay watermark patch rejected: renderer-lifetime patch missing');
  }
  let next = replaceExactlyOnce(source,
    'void video_renderer_init(logger_t *render_logger, const char *server_name,',
    nativeFunctions + 'void video_renderer_init(logger_t *render_logger, const char *server_name,',
    'native helper insertion');
  next = replaceExactlyOnce(next,
    `    g_mutex_lock(&airpimo_renderer_mutex);
    renderer = renderer_used;
    g_mutex_unlock(&airpimo_renderer_mutex);
    gst_element_set_state (renderer->pipeline, GST_STATE_PLAYING);`,
    `    g_mutex_lock(&airpimo_renderer_mutex);
    renderer = renderer_used;
    g_mutex_unlock(&airpimo_renderer_mutex);
#ifdef __APPLE__
    airpimo_watermark_attach(renderer_used->pipeline);
#endif
    gst_element_set_state (renderer->pipeline, GST_STATE_PLAYING);`,
    'active video pipeline activation');
  return next;
}

export function applyResponsiveWatermarkPatch(file) {
  const original = readFileSync(file, 'utf8');
  const patched = patchResponsiveWatermarkSource(original);
  if (patched === original) throw Error('UxPlay watermark patch produced no modifications');
  writeFileSync(file, patched);
}
