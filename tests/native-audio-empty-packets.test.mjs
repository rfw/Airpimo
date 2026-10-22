import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {patchRaopBufferSource, patchRaopRtpSource, applyAudioEmptyPacketPatch} from '../native/patches/audio-empty-packets.mjs';
import {RENDERER_PATCH_SHA256, engineDir, storeEngine, verifiedCachedEngine} from '../scripts/native-engine-core.mjs';

// These fixtures contain the exact upstream code anchors from the user's
// df67c212..4e95a9ec diff. This is NOT a real upstream compilation.
const bufferFixture = `#define RAOP_BUFFER_LENGTH 256
#include <assert.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
static unsigned char empty_packet_marker[] = {0x00,0x68,0x34,0x00};
typedef struct { unsigned short seqnum; unsigned int payload_size; int filled; unsigned char *payload_data; } entry_t;
typedef struct {entry_t entries[256]; unsigned short first_seqnum, last_seqnum; int is_empty;} raop_buffer_t;
static int raop_buffer_decrypt(raop_buffer_t *raop_buffer, unsigned char *data, unsigned char *out, int size, unsigned int *payload_size) {
    (void)raop_buffer; memcpy(out, data + 12, size); *payload_size=(unsigned int)size; return 1;
}
static int raop_buffer_enqueue(raop_buffer_t *raop_buffer, unsigned char *data, unsigned short datalen, int use_seq) {
    (void)use_seq;
    /* before time is synchronized, some empty data packets are sent */
    if (datalen == 12 || (datalen == 16 && !memcmp(&data[12], empty_packet_marker, 4))) {
        return 0;
    }
    unsigned short seqnum = (unsigned short)((data[2] << 8) | data[3]);
    int payload_size = datalen - 12;
    entry_t *entry = &raop_buffer->entries[seqnum % RAOP_BUFFER_LENGTH];
    entry->seqnum = seqnum;
    entry->filled = 1;
    entry->payload_data = malloc(payload_size);
    int decrypt_ret = raop_buffer_decrypt(raop_buffer, data, entry->payload_data, payload_size, &entry->payload_size);
    assert(decrypt_ret >= 0);
    assert((int) entry->payload_size <= payload_size);
    if (raop_buffer->is_empty) {
        raop_buffer->first_seqnum = seqnum;
        raop_buffer->is_empty = 0;
    }
    raop_buffer->last_seqnum = seqnum;
    return 1;
}
static unsigned char *raop_buffer_dequeue(raop_buffer_t *b, unsigned int *length, uint32_t *rtp, unsigned short *seq, int no_resend) {
    (void)rtp;(void)no_resend;
    if (b->is_empty) return NULL;
    entry_t *entry = &b->entries[b->first_seqnum % 256];
    if (!entry->filled || entry->seqnum != b->first_seqnum) return NULL;
    unsigned char *result=entry->payload_data;
    *length=entry->payload_size;
    *seq=entry->seqnum;
    entry->payload_data=NULL;entry->filled=0;
    b->first_seqnum++;
    if ((unsigned short)(b->last_seqnum + 1) == b->first_seqnum) b->is_empty=1;
    return result;
}
`;

const rtpFixture = `
static const unsigned char no_data_marker[] = {0x00,0x68,0x34,0x00};
typedef struct {unsigned short seqnum;} audio_decode_struct;
typedef struct {raop_buffer_t *buffer;} raop_rtp_t;
static unsigned int played = 0, dropped = 0;
static void raop_rtp_thread_udp(raop_rtp_t *raop_rtp, unsigned char *input, unsigned int length) {
    unsigned char packet[256] = {0};
    memcpy(packet,input,length);
    unsigned int packetlen = length;
    for (unsigned int iteration=0;iteration<1;iteration++) {
        if (packetlen == 12 ||(packetlen == 16 && memcmp(packet + 12, no_data_marker, 4) == 0)) {
            /* this is a "no data" packet */
            /* the first such packet could be used to provide the initial rtptime and seqnum formerly given in the RECORD request */
            continue;
        }
        raop_buffer_enqueue(raop_rtp->buffer, packet, packetlen, 1);
        unsigned int payload_size = 0;
        uint32_t rtp_timestamp = 0;
        unsigned short seqnum = 0;
        int no_resend = 0;
        unsigned char *payload;
        while ((payload = raop_buffer_dequeue(raop_rtp->buffer, &payload_size, &rtp_timestamp, &seqnum, no_resend))) {
            audio_decode_struct audio_data;
            audio_data.seqnum = seqnum;
            (void)audio_data;
            if (payload_size == 4 && memcmp(payload, no_data_marker, 4)==0) dropped++;
            else played++;
            free(payload);
        }
    }
}
`;

const driver = `
int main(void) {
    raop_buffer_t b = {.is_empty=1};
    raop_rtp_t r = {.buffer=&b};
    unsigned char marker[16]={0}; marker[3]=100;
    memcpy(marker+12, no_data_marker, 4);
    raop_rtp_thread_udp(&r,marker,16);
#ifdef __APPLE__
    assert(b.first_seqnum==101 && played==0 && dropped==0);
#else
    assert(b.is_empty==1 && played==0);
#endif
    unsigned char valid[16]={0};valid[3]=101;valid[12]=0xab;
    raop_rtp_thread_udp(&r,valid,16);
    assert(played==1 && b.first_seqnum==102);
    unsigned char bare[12]={0};bare[3]=102;
    raop_rtp_thread_udp(&r,bare,12);
#ifdef __APPLE__
    assert(b.first_seqnum==103 && dropped==0);
#else
    assert(b.first_seqnum==102);
#endif
    return 0;
}
`;

test('backport tracks no-data sequence and rejects marked payload before decoder (macOS-only)', () => {
  const b = patchRaopBufferSource(bufferFixture);
  const r = patchRaopRtpSource(rtpFixture);
  assert.match(b, /#ifdef __APPLE__\s*if \(datalen == 12\)/);
  assert.match(b, /memcpy\(entry->payload_data, &data\[12\], payload_size\)/);
  assert.match(r, /#ifdef __APPLE__\s*\/\* Preserve sequence numbers/);
  assert.match(r, /free\(payload\);\s*continue;/);
  assert.match(r, /#else\s*if \(packetlen == 12 \|\|/);
  assert.doesNotMatch(b+r, /airpimo_gap_start_us|airpimo_last_resend_us/);
});

test('refuses changed, duplicated and previously patched source', () => {
  assert.throws(()=>patchRaopBufferSource(bufferFixture.replace('datalen == 16','datalen == 8')), /expected once/);
  assert.throws(()=>patchRaopBufferSource(bufferFixture+bufferFixture), /expected once/);
  assert.throws(()=>patchRaopRtpSource(rtpFixture.replaceAll('no_data_marker','empty_marker')), /unexpected|expected/);
  assert.throws(()=>patchRaopRtpSource(rtpFixture+rtpFixture), /expected once/);
  assert.throws(()=>patchRaopBufferSource(patchRaopBufferSource(bufferFixture)), /expected once/);
  assert.throws(()=>patchRaopRtpSource(patchRaopRtpSource(rtpFixture)), /expected once/);
});

test('two-file source transform validates both before writing either',()=>{
  const dir=mkdtempSync(join(tmpdir(),'airpimo-empty-apply-'));
  try {
    const b=join(dir,'buffer.c'),r=join(dir,'rtp.c');
    writeFileSync(b,bufferFixture);writeFileSync(r,rtpFixture);
    writeFileSync(r,'bad source');
    assert.throws(()=>applyAudioEmptyPacketPatch(b,r),/unexpected raop_rtp/);
    assert.equal(readFileSync(b,'utf8'),bufferFixture);
    writeFileSync(r,rtpFixture);
    applyAudioEmptyPacketPatch(b,r);
    assert.equal(readFileSync(b,'utf8'),patchRaopBufferSource(bufferFixture));
    assert.equal(readFileSync(r,'utf8'),patchRaopRtpSource(rtpFixture));
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('patched C branches compile and run with both macOS and Windows-like flags',t=>{
  const cc=spawnSync('cc',['--version'],{encoding:'utf8'});
  if (cc.error || cc.status !== 0) return t.skip('C compiler unavailable');
  const dir=mkdtempSync(join(tmpdir(),'airpimo-empty-cc-'));
  try {
    const path=join(dir,'test.c');
    writeFileSync(path,patchRaopBufferSource(bufferFixture)+patchRaopRtpSource(rtpFixture)+driver);
    for (const [name, flags] of [['mac',['-D__APPLE__']],['win',[]]]) {
      const exe=join(dir,name);
      const build=spawnSync('cc',['-std=c11','-Wall','-Wextra','-Werror',...flags,path,'-o',exe],{encoding:'utf8'});
      assert.equal(build.status,0,`${name} compilation failed: ${build.stderr}`);
      const run=spawnSync(exe,[],{encoding:'utf8'});
      assert.equal(run.status,0,`${name} execution failed: ${run.stderr}`);
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});

test('cache digest includes renderer and the new no-data transform, invalidates old cache receipts',()=>{
  const actual=createHash('sha256')
    .update(readFileSync(new URL('../native/patches/renderer-lifetime.mjs', import.meta.url)))
    .update('\0')
    .update(readFileSync(new URL('../native/patches/audio-empty-packets.mjs', import.meta.url)))
    .digest('hex');
  assert.equal(RENDERER_PATCH_SHA256,actual);
  const dir=mkdtempSync(join(tmpdir(),'airpimo-empty-receipt-'));
  try {
    const opts={platform:'win32',arch:'x64',home:dir,env:{}};
    const exe=join(dir,'uxplay.exe');writeFileSync(exe,Buffer.from('4d5a01020304','hex'));
    const result=storeEngine(exe,opts);
    assert.equal(verifiedCachedEngine(opts),result.binary);
    const receiptPath=join(engineDir(opts),'receipt.json');
    const receipt=JSON.parse(readFileSync(receiptPath,'utf8'));
    receipt.rendererPatchSha256=createHash('sha256').update(readFileSync(new URL('../native/patches/renderer-lifetime.mjs', import.meta.url))).digest('hex');
    writeFileSync(receiptPath,JSON.stringify(receipt));
    assert.equal(verifiedCachedEngine(opts),null);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
