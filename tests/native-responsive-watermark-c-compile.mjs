import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {patchResponsiveWatermarkSource} from '../native/patches/watermark-auto-size.mjs';

const gcc=spawnSync('cc',['--version'],{encoding:'utf8'});
test('native macOS watermark functions parse as C11 with GLib/GStreamer API stubs',{
  skip:gcc.status!==0 ? 'C compiler unavailable' : false
},()=>{
  const fixture=`static GMutex airpimo_renderer_mutex;
void video_renderer_init(logger_t *render_logger, const char *server_name,
    arg_t trailing);
    g_mutex_lock(&airpimo_renderer_mutex);
    renderer = renderer_used;
    g_mutex_unlock(&airpimo_renderer_mutex);
    gst_element_set_state (renderer->pipeline, GST_STATE_PLAYING);`;
  const patched=patchResponsiveWatermarkSource(fixture);
  const begin=patched.indexOf('#ifdef __APPLE__');
  const end=patched.indexOf('#endif /* __APPLE__ */',begin)+'#endif /* __APPLE__ */'.length;
  const csource=patched.slice(begin,end);
  const stub=`#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdbool.h>
typedef int gint;
typedef int gboolean;
typedef char gchar;
typedef double gdouble;
typedef int64_t gint64;
typedef void *gpointer;
typedef struct { void* intern; } GWeakRef;
typedef struct { void* intern; } GMutex;
typedef struct { int mock; } GstElement;
typedef struct { int mock; } GObject;
typedef struct { int mock; } GstCaps;
typedef struct { int mock; } GstStructure;
typedef struct { int mock; } GstPad;
typedef struct { int mock; } GstEvent;
typedef struct { GstEvent *event; } GstPadProbeInfo;
typedef int GstPadProbeReturn;
#define GST_PAD_PROBE_OK 0
#define GST_PAD_PROBE_TYPE_EVENT_DOWNSTREAM 1
#define GST_EVENT_CAPS 1
#define GST_PAD_PROBE_INFO_EVENT(info) ((info)->event)
#define GST_EVENT_TYPE(event) (1)
#define GST_IS_BIN(pipeline) (1)
#define GST_BIN(pipeline) (pipeline)
#define G_OBJECT(object) ((GObject *)(object))
#define GINT_TO_POINTER(n) ((void *)(uintptr_t)(n))
#define CLAMP(v,l,h) ((v)<(l)?(l):((v)>(h)?(h):(v)))
#define g_new0(t,n) ((t*)calloc((n),sizeof(t)))
#include <stdlib.h>
void g_weak_ref_clear(GWeakRef*);
void g_mutex_clear(GMutex*);
void g_free(void*);
int gst_caps_is_empty(const GstCaps*);
int gst_caps_is_any(const GstCaps*);
const GstStructure *gst_caps_get_structure(const GstCaps*,unsigned);
int gst_structure_get_int(const GstStructure*,const char*,int*);
int gst_structure_get_fraction(const GstStructure*,const char*,int*,int*);
void g_mutex_lock(GMutex*);
void g_mutex_unlock(GMutex*);
GObject *g_weak_ref_get(GWeakRef*);
void g_object_set(GObject*,...);
void g_object_unref(void*);
void g_snprintf(char*,size_t,const char*,...);
void gst_event_parse_caps(GstEvent*,GstCaps**);
GstElement* gst_bin_get_by_name(GstElement*,const char*);
void *g_object_get_data(GObject*,const char*);
void g_object_set_data(GObject*,const char*,void*);
GstPad *gst_element_get_static_pad(GstElement*,const char*);
void g_weak_ref_init(GWeakRef*,GObject*);
void g_mutex_init(GMutex*);
unsigned long gst_pad_add_probe(GstPad*,int,GstPadProbeReturn(*)(GstPad*,GstPadProbeInfo*,void*),void*,void(*)(void*));
GstCaps* gst_pad_get_current_caps(GstPad*);
void gst_caps_unref(GstCaps*);
void gst_object_unref(void*);
${csource}\n`;
  const dir=mkdtempSync(join(tmpdir(),'airpimo-gst-c-'));
  try {
    const path=join(dir,'watermark.c');
    writeFileSync(path,stub);
    const result=spawnSync('cc',['-std=c11','-D__APPLE__','-fsyntax-only','-Wall','-Werror=implicit-function-declaration',path],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
