/**
 * Airpimo: scoped backport of the no-data RTP sequence handling observed in
 * FDH2/UxPlay 4e95a9ec onto pinned FDH2/UxPlay 1.73.7 (df67c212).
 *
 * Some AirPlay clients send 16-byte RTP packets with the 4-byte no-data marker
 * 00 68 34 00. Dropping these BEFORE buffering leaves a sequence hole; the
 * normal dequeue/resend logic may wait for a packet which was already received.
 * Instead, on macOS only: enqueue the marker as a non-encrypted placeholder,
 * allow its RTP sequence number to advance, then free/skip it before AAC/ALAC
 * decoding. A legacy 12-byte empty RTP packet is normalized to that marker.
 *
 * No timeout-based packet skipping, no NTP changes, no change to Windows logic.
 * Reject unreviewed source layouts; never apply to an arbitrary UxPlay HEAD.
 */
import {readFileSync, writeFileSync} from 'node:fs';

function replaceOnce(input, expression, replacement, label) {
  const regex = new RegExp(expression.source, expression.flags.includes('g') ? expression.flags : expression.flags + 'g');
  const count = [...input.matchAll(regex)].length;
  if (count !== 1) throw Error(`UxPlay no-data audio patch rejected: ${label} expected once, found ${count}`);
  return input.replace(expression, replacement);
}

export function patchRaopBufferSource(source) {
  if (!source.includes('raop_buffer_enqueue(') || !source.includes('empty_packet_marker') ||
      !source.includes('raop_buffer_dequeue(') || !source.includes('RAOP_BUFFER_LENGTH')) {
    throw Error('UxPlay no-data audio patch rejected: unexpected raop_buffer.c layout');
  }
  let next = replaceOnce(source,
    /if\s*\(datalen\s*==\s*12\s*\|\|\s*\(datalen\s*==\s*16\s*&&\s*!memcmp\(&data\[12\],\s*empty_packet_marker,\s*4\)\)\)\s*\{\s*return 0;\s*\}/,
    `#ifdef __APPLE__
    if (datalen == 12) {
#else
    if (datalen == 12 || (datalen == 16 && !memcmp(&data[12], empty_packet_marker, 4))) {
#endif
        return 0;
    }`,
    'ignore-empty-packet guard');

  next = replaceOnce(next,
    /entry->payload_data\s*=\s*malloc\(payload_size\);\s*int decrypt_ret\s*=\s*raop_buffer_decrypt\(raop_buffer,\s*data,\s*entry->payload_data,\s*payload_size,\s*&entry->payload_size\);\s*assert\(decrypt_ret\s*>=\s*0\);\s*assert\(\(int\) entry->payload_size\s*<=\s*payload_size\);/,
    `entry->payload_data = malloc(payload_size);
#ifdef __APPLE__
    /* This is a sequence-bearing placeholder, never encrypted AAC/ALAC. */
    if (datalen == 16 && !memcmp(&data[12], empty_packet_marker, 4)) {
        memcpy(entry->payload_data, &data[12], payload_size);
        entry->payload_size = payload_size;
    } else {
#endif
        int decrypt_ret = raop_buffer_decrypt(raop_buffer, data, entry->payload_data, payload_size, &entry->payload_size);
        assert(decrypt_ret >= 0);
        assert((int) entry->payload_size <= payload_size);
#ifdef __APPLE__
    }
#endif`,
    'decrypt-or-marker payload storage');
  return next;
}

export function patchRaopRtpSource(source) {
  if (!source.includes('raop_rtp_thread_udp(') || !source.includes('no_data_marker') ||
      !source.includes('raop_buffer_enqueue(') || !source.includes('raop_buffer_dequeue(')) {
    throw Error('UxPlay no-data audio patch rejected: unexpected raop_rtp.c layout');
  }
  let next = replaceOnce(source,
    /if\s*\(packetlen\s*==\s*12\s*\|\|\s*\(packetlen\s*==\s*16\s*&&\s*memcmp\(packet\s*\+\s*12,\s*no_data_marker,\s*4\)\s*==\s*0\)\)\s*\{\s*\/\* this is a "no data" packet \*\/\s*\/\* the first such packet could be used to provide the initial rtptime and seqnum formerly given in the RECORD request \*\/\s*continue;\s*\}/,
    `#ifdef __APPLE__
            /* Preserve sequence numbers for empty audio packets. A bare
             * 12-byte RTP header is normalized to the 4-byte marker. */
            if (packetlen == 12) {
                memcpy(packet + 12, no_data_marker, 4);
                packetlen = 16;
            }
#else
            if (packetlen == 12 || (packetlen == 16 && memcmp(packet + 12, no_data_marker, 4) == 0)) {
                /* this is a "no data" packet */
                /* the first such packet could be used to provide the initial rtptime and seqnum formerly given in the RECORD request */
                continue;
            }
#endif`,
    'drop-empty-packet pre-enqueue guard');

  next = replaceOnce(next,
    /while\s*\(\(payload\s*=\s*raop_buffer_dequeue\(raop_rtp->buffer,\s*&payload_size,\s*&rtp_timestamp,\s*&seqnum,\s*no_resend\)\)\)\s*\{\s*audio_decode_struct audio_data\s*;/,
    `while ((payload = raop_buffer_dequeue(raop_rtp->buffer, &payload_size, &rtp_timestamp, &seqnum, no_resend))) {
#ifdef __APPLE__
                    /* A placeholder advances RTP ordering but must not be
                     * passed to AAC-ELD / ALAC decoding. */
                    if (payload_size == 4 && memcmp(payload, no_data_marker, 4) == 0) {
                        free(payload);
                        continue;
                    }
#endif
                    audio_decode_struct audio_data;`,
    'drop-empty-decoder-payload guard');
  return next;
}

export function applyAudioEmptyPacketPatch(bufferPath, rtpPath) {
  // Fail atomically on unrecognized source layouts: transform BOTH in memory
  // before writing either file. buildEngine() first checks out the pinned SHA.
  const bufferOriginal = readFileSync(bufferPath, 'utf8');
  const rtpOriginal = readFileSync(rtpPath, 'utf8');
  const bufferPatched = patchRaopBufferSource(bufferOriginal);
  const rtpPatched = patchRaopRtpSource(rtpOriginal);
  if (bufferOriginal === bufferPatched || rtpOriginal === rtpPatched) {
    throw Error('UxPlay no-data audio patch rejected: no changes');
  }
  writeFileSync(bufferPath, bufferPatched);
  writeFileSync(rtpPath, rtpPatched);
}
