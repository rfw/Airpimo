/** Verified, full native runtime archives. Node built-ins only: no Windows build SDK needed to import. */
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, statSync, chmodSync, readdirSync, cpSync, lstatSync } from 'node:fs';
import { join, resolve, dirname, sep } from 'node:path';
import { cacheRoot, targetId, engineName, LOCK, PROJECT_ROOT, RENDERER_PATCH_SHA256 } from './native-engine-core.mjs';
import {verifyMdnsManifest} from './win7-mdns-core.mjs';

const SHA = /^[a-f0-9]{64}$/;
export const MAX_COMPRESSED = 650 * 1024 * 1024;
export const MAX_EXPANDED = 1100 * 1024 * 1024;
const MAX_FILES = 7000;
const TAR_BLOCK = 512;
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const must = (ok, message) => { if (!ok) throw Error(message); };
export function safeRelative(path) {
  return typeof path === 'string' && path.length > 0 && path.length < 240 &&
    /^(?:sidecar|gstreamer)\/[a-zA-Z0-9_.+@()/-]+$/.test(path) &&
    !path.split('/').some(p => p === '..' || p === '.' || p === '') &&
    !path.includes('\\');
}
export function validateManifest(manifest, { platform = process.platform, arch = process.arch } = {}) {
  must(manifest?.schema === 1 && manifest.ready === true, 'Runtime manifest is not release-ready');
  must(manifest.os === platform && manifest.arch === arch, `Runtime target ${manifest.os}/${manifest.arch} is not ${platform}/${arch}`);
  if(manifest.discovery?.backend==='internal-mdns')verifyMdnsManifest(manifest);
  else {
    must(manifest.upstream?.commit === LOCK.commit, 'UxPlay upstream commit differs from pin');
    must(manifest.upstream?.rendererPatchSha256 === RENDERER_PATCH_SHA256, 'UxPlay renderer patch identity missing or stale');
  }
  must(/^\d+\.\d+\.\d+$/.test(manifest.gstreamerVersion ?? ''), 'GStreamer exact version missing');
  must(Array.isArray(manifest.files) && manifest.files.length >= 3 && manifest.files.length <= MAX_FILES, 'Runtime file manifest invalid');
  const seen = new Set(); let engine = false, plugin = false, library = false;
  for (const file of manifest.files) {
    must(safeRelative(file?.path) && SHA.test(file?.sha256 ?? ''), 'Invalid manifest file path or SHA');
    must(!seen.has(file.path), 'Duplicate path in native manifest'); seen.add(file.path);
    if (file.path === `sidecar/${engineName(platform)}`) engine = true;
    if (/^gstreamer\/lib\/gstreamer-1\.0\/.*\.(?:dylib|dll|so)$/.test(file.path)) plugin = true;
    if (platform === 'win32' ? /^gstreamer\/bin\/.*\.dll$/i.test(file.path)
      : /^gstreamer\/lib\/[^/]+\.(?:dylib|so)$/.test(file.path)) library = true;
  }
  must(engine && plugin && library, 'Bundle lacks UxPlay, GStreamer plugin or runtime libraries');
  return true;
}
function readDeclaredFiles(root, manifest) {
  const out = new Map();
  for (const f of manifest.files) {
    const full = join(root, ...f.path.split('/'));
    must(existsSync(full) && lstatSync(full).isFile() && !lstatSync(full).isSymbolicLink(), `Missing/unsafe native file ${f.path}`);
    const data = readFileSync(full);
    must(sha256(data) === f.sha256, `SHA-256 mismatch: ${f.path}`);
    out.set(f.path, data);
  }
  return out;
}
export function verifyNativeTree(root, options = {}) {
  const manifestFile = join(root, 'native-manifest.json');
  must(existsSync(manifestFile), 'No native-manifest.json in bundled runtime');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  validateManifest(manifest, options);
  readDeclaredFiles(root, manifest);
  return manifest;
}
function tarHeader(path, size, mode = 0o644) {
  must(Buffer.byteLength(path) < 100 && size >= 0, 'Invalid tar path or size');
  const b = Buffer.alloc(TAR_BLOCK);
  b.write(path, 0, 'ascii');
  const oct = (value, offset, width) => b.write(value.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii');
  oct(mode, 100, 8); oct(0, 108, 8); oct(0, 116, 8); oct(size, 124, 12); oct(0, 136, 12);
  b.fill(0x20, 148, 156);
  b.write('0', 156); b.write('ustar\0', 257); b.write('00', 263);
  oct([...b].reduce((a, c) => a + c, 0), 148, 8);
  return b;
}
export function encodeTar(entries) {
  must(entries.size <= MAX_FILES + 1, 'Too many native files');
  const parts = []; let total = 0;
  for (const [name, body] of entries) {
    must(name === 'native-manifest.json' || safeRelative(name), 'Unsafe archive member path');
    must(Buffer.isBuffer(body), 'Archive member must be bytes');
    total += 512 + Math.ceil(body.length / 512) * 512;
    must(total <= MAX_EXPANDED, 'Native bundle too large');
    parts.push(tarHeader(name, body.length, name.startsWith('sidecar/') ? 0o755 : 0o644));
    parts.push(body);
    const pad = (512 - body.length % 512) % 512;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(1024));
  return Buffer.concat(parts);
}
export function decodeTar(bytes) {
  must(bytes.length <= MAX_EXPANDED, 'Expanded native bundle exceeds limit');
  const entries = new Map(); let off = 0;
  while (off + 512 <= bytes.length) {
    const b = bytes.subarray(off, off + 512);
    if (b.every(byte => byte === 0)) break;
    const str = (start, len) => b.subarray(start, start + len).toString('utf8').split('\0')[0];
    const name = str(0, 100);
    must(name === 'native-manifest.json' || safeRelative(name), 'Unsafe archive path');
    must(b[156] === 48 && str(257, 5) === 'ustar', 'Only regular ustar members are permitted');
    const given = parseInt(str(148, 8).trim(), 8);
    const probe = Buffer.from(b); probe.fill(0x20, 148, 156);
    const actual = [...probe].reduce((a, c) => a + c, 0);
    must(Number.isFinite(given) && given === actual, 'Bad tar header checksum');
    const size = parseInt(str(124, 12).trim(), 8);
    must(Number.isSafeInteger(size) && size >= 0 && off + 512 + size <= bytes.length, 'Truncated or oversized tar member');
    must(!entries.has(name) && entries.size < MAX_FILES + 1, 'Duplicate/too many tar members');
    entries.set(name, Buffer.from(bytes.subarray(off + 512, off + 512 + size)));
    off += 512 + Math.ceil(size / 512) * 512;
  }
  must(entries.has('native-manifest.json'), 'Archive missing native manifest');
  return entries;
}
export function buildBundle(root, options = {}) {
  const manifest = verifyNativeTree(root, options);
  if(manifest.discovery?.backend==='internal-mdns')throw Error('The legacy 1.73.7 bundle cache/export cannot represent 1.74 experimental; use NSIS Win7 mdns packaging only.');
  const members = new Map([['native-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n')]]);
  for (const [path, bytes] of readDeclaredFiles(root, manifest)) members.set(path, bytes);
  const zipped = gzipSync(encodeTar(members), { level: 6 });
  must(zipped.length <= MAX_COMPRESSED, 'Compressed bundle too large');
  return zipped;
}
export function unpackBundle(archive, destination, options = {}) {
  must(archive.length <= MAX_COMPRESSED, 'Compressed bundle exceeds limit');
  const members = decodeTar(gunzipSync(archive, { maxOutputLength: MAX_EXPANDED }));
  const manifest = JSON.parse(members.get('native-manifest.json').toString('utf8'));
  validateManifest(manifest, options);
  if(manifest.discovery?.backend==='internal-mdns')throw Error('Cannot import mDNS runtime into legacy 1.73.7 native cache');
  must(members.size === manifest.files.length + 1, 'Unlisted files present in archive');
  const list = new Set(manifest.files.map(f => f.path));
  for (const [name, bytes] of members) {
    if (name === 'native-manifest.json') continue;
    must(list.has(name), 'Unlisted native archive member');
    must(sha256(bytes) === manifest.files.find(f => f.path === name).sha256, `Corrupt archive member ${name}`);
  }
  mkdirSync(destination, { recursive: true });
  for (const [name, bytes] of members) {
    const path = join(destination, ...name.split('/'));
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes, { flag: 'wx', mode: name.startsWith('sidecar/') ? 0o755 : 0o644 });
    if (process.platform !== 'win32' && name.startsWith('sidecar/')) chmodSync(path, 0o755);
  }
  return manifest;
}
export function bundleCacheDir({ platform = process.platform, arch = process.arch, env = process.env, home } = {}) {
  return join(cacheRoot(env, home), 'bundles', targetId(platform, arch), LOCK.commit);
}
export function verifiedBundleDir(options = {}) {
  const dir = bundleCacheDir(options), receiptPath = join(dir, 'bundle-receipt.json');
  try {
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    if (receipt.schema !== 1 || !SHA.test(receipt.archiveSha256) || receipt.commit !== LOCK.commit || receipt.target !== targetId(options.platform ?? process.platform, options.arch ?? process.arch)) return null;
    verifyNativeTree(dir, options);
    return dir;
  } catch { return null; }
}
export function importBundleBytes(data, { expectedSha, ...options } = {}) {
  if (expectedSha) must(SHA.test(expectedSha) && sha256(data) === expectedSha, 'Native bundle SHA-256 mismatch');
  const dir = bundleCacheDir(options);
  const staging = `${dir}.incoming-${process.pid}-${Math.random().toString(16).slice(2)}`;
  try {
    const manifest = unpackBundle(data, staging, options);
    verifyNativeTree(staging, options);
    writeFileSync(join(staging, 'bundle-receipt.json'), JSON.stringify({schema:1, target:targetId(options.platform ?? process.platform, options.arch ?? process.arch), commit:LOCK.commit, archiveSha256:sha256(data), gstreamerVersion:manifest.gstreamerVersion}, null, 2));
    mkdirSync(dirname(dir), {recursive:true});
    // Prior cache must not survive if it is corrupt. New complete staging is verified first.
    if (existsSync(dir)) rmSync(dir, { recursive:true, force:true });
    renameSync(staging, dir);
    return dir;
  } finally { if (existsSync(staging)) rmSync(staging, {recursive:true,force:true}); }
}
export function stageBundleToProject(options = {}) {
  const dir = verifiedBundleDir(options);
  must(dir, 'No verified full runtime cached');
  const target = join(PROJECT_ROOT, 'src-tauri', 'resources');
  // Preserve only resource metadata; update the three native assets as one logical unit.
  const stage = join(PROJECT_ROOT, 'src-tauri', `.incoming-resources-${process.pid}`);
  try {
    mkdirSync(stage, {recursive:true});
    for (const name of ['sidecar', 'gstreamer']) cpSync(join(dir,name),join(stage,name),{recursive:true,errorOnExist:true,force:false});
    cpSync(join(dir,'native-manifest.json'),join(stage,'native-manifest.json'));
    verifyNativeTree(stage,options);
    for (const name of ['sidecar','gstreamer']) {
      rmSync(join(target,name),{recursive:true,force:true});
      renameSync(join(stage,name),join(target,name));
    }
    cpSync(join(stage,'native-manifest.json'),join(target,'native-manifest.json'));
  } finally {rmSync(stage,{recursive:true,force:true});}
  return target;
}

/** Registry URL must be a reviewed HTTPS origin and exactly pinned to commit. */
export function reviewedBundleForTarget(id, registry) {
  const entry = registry?.targets?.[id];
  if (!entry) return null;
  must(entry.commit === LOCK.commit && entry.rendererPatchSha256 === RENDERER_PATCH_SHA256 && SHA.test(entry.sha256 ?? ''), 'Bundle registry missing pinned commit/renderer patch/SHA256');
  const u = new URL(entry.url);
  must(u.protocol === 'https:' && !u.username && !u.password && !!u.hostname && !u.hash, 'Bundle URL must be credential-free HTTPS');
  return entry;
}
