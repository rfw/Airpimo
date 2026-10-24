/** Pinned experimental UxPlay 1.74 internal-mDNS build provenance.
 * Intentionally separate from the working 1.73.7/Bonjour cache and macOS lock.
 */
import {readFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {PROJECT_ROOT} from './native-engine-core.mjs';

export const MDNS_UPSTREAM='https://github.com/FDH2/UxPlay.git';
export const MDNS_LOCK_FILE=join(PROJECT_ROOT,'native','win7-mdns-lock.json');
const SHA=/^[a-f0-9]{40}$/i;
const HASH=/^[a-f0-9]{64}$/i;
export const MDNS_WATERMARK_PATCH_SHA256=createHash('sha256').update(readFileSync(join(PROJECT_ROOT,'native','patches','watermark-auto-size.mjs'))).digest('hex');
export const MDNS_FLAGS=Object.freeze(['-DNO_MARCH_NATIVE=ON','-DUSE_DNS_SD=OFF','-DUSE_MDNS=ON']);
export function checkMdnsLock(lock) {
  if(lock?.schema!==1 ||lock.upstream!==MDNS_UPSTREAM || !SHA.test(lock.commit||'') || lock.track!=='1.74-experimental' || lock.target!=='win32-x64' || JSON.stringify(lock.buildFlags)!==JSON.stringify([...MDNS_FLAGS]))
    throw Error('Invalid Win7 internal-mDNS pin. Run npm run native:mdns:pin:win7; never use an unpinned moving upstream branch in a release.');
  return lock;
}
export function readMdnsLock(file=MDNS_LOCK_FILE) {
  if(!existsSync(file))throw Error(`Win7 internal-mDNS source commit is not pinned (${file}). Run npm run native:mdns:pin:win7 on the build host first.`);
  return checkMdnsLock(JSON.parse(readFileSync(file,'utf8')));
}
export function fileSha256(path) {return createHash('sha256').update(readFileSync(path)).digest('hex');}
export function verifyMdnsReceipt(receipt,{lock=readMdnsLock(),binary}={}) {
  if(receipt?.schema!==1 || receipt.discoveryBackend!=='internal-mdns' || receipt.sourceCommit!==lock.commit || receipt.watermarkPatchSha256!==MDNS_WATERMARK_PATCH_SHA256 || !HASH.test(receipt.sha256||'') || !binary || !existsSync(binary) || fileSha256(binary)!==receipt.sha256)
    throw Error('Internal-mDNS build receipt does not match pinned commit + local uxplay.exe SHA-256. Old 1.73.7 Bonjour engine is not accepted.');
  if(JSON.stringify(receipt.buildFlags)!==JSON.stringify([...MDNS_FLAGS])) throw Error('Internal-mDNS receipt does not prove USE_DNS_SD=OFF and USE_MDNS=ON');
  return true;
}
export function verifyMdnsManifest(manifest,{lock=readMdnsLock()}={}) {
  if(manifest.os!=='win32' ||manifest.arch!=='x64' || manifest.discovery?.backend!=='internal-mdns' || manifest.discovery?.watermarkPatchSha256!==MDNS_WATERMARK_PATCH_SHA256 || manifest.upstream?.commit!==lock.commit || manifest.upstream?.tag!=='1.74-experimental-pinned' || !HASH.test(manifest.discovery?.engineSha256||''))
    throw Error('Win7 self-contained mDNS requires an audited 1.74 experimental engine manifest, not the legacy Bonjour runtime.');
  const exe=manifest.files?.find(x=>x.path==='sidecar/AirpimoPlayer.exe' || x.path==='sidecar/uxplay.exe');
  if(!exe || exe.sha256!==manifest.discovery.engineSha256) throw Error('mDNS provenance SHA-256 differs from packaged sidecar');
  return true;
}
