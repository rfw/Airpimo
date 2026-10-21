#!/usr/bin/env node
/** Audited, platform-scoped UxPlay/GStreamer archive for GitHub Actions.
 * Unlike the legacy bundle cache, this supports pinned 1.74 internal-mDNS.
 * Never downloads an unpinned runtime or silently compiles native dependencies.
 */
import {createHash} from 'node:crypto';
import {existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, renameSync, copyFileSync, chmodSync, statSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {gzipSync, gunzipSync} from 'node:zlib';
import {encodeTar, decodeTar, validateManifest, verifyNativeTree, sha256, MAX_COMPRESSED, MAX_EXPANDED} from './native-bundle-core.mjs';

const root = resolve(import.meta.dirname,'..');
const SHA256 = /^[0-9a-f]{64}$/i;
const fields = (argv) => Object.fromEntries(argv.filter((v,i) => v.startsWith('--') && i+1<argv.length).map(v => [v.slice(2),argv[argv.indexOf(v)+1]]));

export function exportReleaseArchive(resources, dest, {platform=process.platform, arch=process.arch}={}) {
  const manifest = verifyNativeTree(resolve(resources), {platform,arch});
  const members = new Map([['native-manifest.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n')]]);
  for (const file of manifest.files) {
    const binary=readFileSync(join(resources,...file.path.split('/')));
    if (sha256(binary)!==file.sha256) throw Error(`SHA-256 mismatch: ${file.path}`);
    members.set(file.path,binary);
  }
  const compressed=gzipSync(encodeTar(members),{level:6});
  if(compressed.length>MAX_COMPRESSED) throw Error('Reviewed archive exceeds maximum size');
  mkdirSync(dirname(resolve(dest)),{recursive:true});
  writeFileSync(dest,compressed,{flag:'wx'});
  return {sha256:sha256(compressed),target:`${manifest.os}-${manifest.arch}`,files:manifest.files.length};
}

export function stageReleaseArchive(archive,expectedSha,resources,{platform=process.platform,arch=process.arch}={}) {
  if(!SHA256.test(expectedSha??'')) throw Error('Required expected SHA-256 is missing/invalid; no unpinned native asset permitted');
  const input=readFileSync(archive);
  if(input.length>MAX_COMPRESSED || sha256(input)!==expectedSha.toLowerCase()) throw Error('Reviewed archive SHA-256 mismatch or exceeds limit');
  const members=decodeTar(gunzipSync(input,{maxOutputLength:MAX_EXPANDED}));
  const manifest=JSON.parse(members.get('native-manifest.json').toString('utf8'));
  validateManifest(manifest,{platform,arch});
  if(members.size !== manifest.files.length+1) throw Error('Unexpected archive entries');
  const names=new Set(manifest.files.map(f=>f.path));
  const temp=resolve(dirname(resources),`.ci-native-${process.pid}`);
  if(existsSync(temp))throw Error('Temporary runtime staging path already exists');
  try {
    mkdirSync(temp,{recursive:true});
    for(const [name,data] of members){
      if(name!=='native-manifest.json' && (!names.has(name) || sha256(data)!==manifest.files.find(f=>f.path===name)?.sha256))
        throw Error(`Unlisted or corrupted member: ${name}`);
      const path=join(temp,...name.split('/'));
      mkdirSync(dirname(path),{recursive:true});
      writeFileSync(path,data,{flag:'wx',mode:name.startsWith('sidecar/')?0o755:0o644});
      if(platform!=='win32' && name.startsWith('sidecar/')) chmodSync(path,0o755);
    }
    verifyNativeTree(temp,{platform,arch});
    mkdirSync(resources,{recursive:true});
    // CI checkout is disposable. Never mix stale platform assets into a new bundle.
    for(const name of ['sidecar','gstreamer','native-manifest.json']) {
      const dst=join(resources,name);rmSync(dst,{recursive:true,force:true});
      renameSync(join(temp,name),dst);
    }
    return {files:manifest.files.length,platform:manifest.os,arch:manifest.arch,backend:manifest.discovery?.backend??'external-dnssd'};
  } finally {rmSync(temp,{recursive:true,force:true});}
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.dirname,'ci-native-release.mjs')) {
  const [,,mode,...argv]=process.argv;
  const opts=fields(argv);
  try {
    if (mode==='export') {
      if (!opts.out) throw Error('export --out <absolute tar.gz path> [--resources <staged resource directory>]');
      const result=exportReleaseArchive(opts.resources??join(root,'src-tauri','resources'),resolve(opts.out));
      console.log(`PASS: reviewed runtime archive ${opts.out}\nSHA-256: ${result.sha256}\nTarget: ${result.target}; files: ${result.files}`);
      console.log('Before publication: check licenses, target OS compatibility, and real AirPlay playback.');
    } else if(mode==='stage') {
      if(!opts.file || !opts.sha256)throw Error('stage --file <archive> --sha256 <expected 64 hex chars>');
      const result=stageReleaseArchive(resolve(opts.file),opts.sha256,resolve(opts.resources??join(root,'src-tauri','resources')));
      console.log(`PASS: staged ${result.files} checked ${result.platform}/${result.arch} native assets; discovery=${result.backend}`);
    } else throw Error('Usage: ci-native-release.mjs export|stage');
  } catch(error) {console.error(`[ci-native] BLOCKED: ${error.message}`);process.exitCode=2;}
}
