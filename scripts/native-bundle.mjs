#!/usr/bin/env node
/** Full UxPlay+GStreamer runtime. Review once on build host; cache and embed on other machines. */
import {readFileSync, writeFileSync, mkdirSync, rmSync, openSync, closeSync, writeSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {LOCK, PROJECT_ROOT, targetId} from './native-engine-core.mjs';
import {buildBundle, importBundleBytes, verifiedBundleDir, stageBundleToProject, reviewedBundleForTarget, MAX_COMPRESSED, sha256} from './native-bundle-core.mjs';
const args = process.argv.slice(2); const mode = args[0] ?? 'status';
function opt(name) { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; }
const id=targetId();
async function download(url, sha, dest) {
  const result=await fetch(url, {redirect:'error',signal:AbortSignal.timeout(180000)});
  if (!result.ok || !result.body) throw Error(`Native runtime download failed (${result.status})`);
  const announced=Number(result.headers.get('content-length') ?? 0);
  if (announced > MAX_COMPRESSED) throw Error('Runtime exceeds maximum archive size');
  let count=0;const digest=createHash('sha256');
  const fd=openSync(dest,'wx',0o600);
  try {
    for await (const chunk of result.body) {
      count+=chunk.length;
      if (count>MAX_COMPRESSED) throw Error('Runtime exceeds maximum archive size');
      digest.update(chunk);writeSync(fd,chunk);
    }
  } finally {closeSync(fd);}
  if (digest.digest('hex')!==sha) throw Error('Downloaded runtime checksum mismatch; refusing to unpack');
}
try {
  if (mode==='status') {
    const cached=verifiedBundleDir();
    console.log(cached?`PASS: verified native bundle ${id} -> ${cached}`:`MISSING: full native runtime ${id} is not cached`);
    if(!cached)process.exitCode=2;
  } else if (mode==='import') {
    const file=opt('--file');
    if(!file)throw Error('Usage: npm run native:bundle:import -- --file /absolute/path/uxplay-runtime.tar.gz');
    const path=resolve(file);
    const data=readFileSync(path);
    const dir=importBundleBytes(data);
    console.log(`PASS: imported and verified ${id} native runtime to ${dir}`);
  } else if (mode==='export') {
    const src=resolve(opt('--resources') ?? join(PROJECT_ROOT,'src-tauri','resources'));
    const out=resolve(opt('--out') ?? join(PROJECT_ROOT,'native-artifacts',id,`uxplay-runtime-${id}.tar.gz`));
    const archive=buildBundle(src);
    mkdirSync(dirname(out),{recursive:true});writeFileSync(out,archive,{flag:'w'});
    const digest=sha256(archive);
    writeFileSync(join(dirname(out),'SHA256SUMS'),`${digest}  ${out.split(/[\\/]/).pop()}\n`);
    writeFileSync(join(dirname(out),'bundle-registry-entry.template.json'),JSON.stringify({commit:LOCK.commit,url:'REPLACE_WITH_REVIEWED_HTTPS_URL',sha256:digest},null,2)+'\n');
    console.log(`PASS: ${out}\nSHA-256: ${digest}\nReview binary dependencies, Win7 ABI, GPL, and licenses before publishing.`);
  } else if (mode==='stage') {
    const where=stageBundleToProject();console.log(`PASS: staged cached native bundle for packaging: ${where}`);
  } else if (mode==='prepare') {
    let cached=verifiedBundleDir();
    if(!cached) {
      const registry=JSON.parse(readFileSync(join(PROJECT_ROOT,'native','bundles.json'),'utf8'));
      const prebuilt=reviewedBundleForTarget(id,registry);
      if (!prebuilt) throw Error(`No audited full ${id} runtime registered. On one Windows build host: native:prepare, native:bundle:prepare, native:bundle:export. Then register the verified URL/SHA in native/bundles.json or import a local tar.gz. No automatic MSYS2 compilation.`);
      const dest=join(PROJECT_ROOT,`native-download-${process.pid}.tar.gz`);
      try {
        await download(prebuilt.url,prebuilt.sha256,dest);
        cached=importBundleBytes(readFileSync(dest),{expectedSha:prebuilt.sha256});
      } finally {rmSync(dest,{force:true});}
    }
    console.log(`PASS: verified runtime ready (${cached})`);
  } else throw Error(`Unknown native bundle command ${mode}`);
} catch(err) {console.error(`[native-bundle] BLOCKED: ${err.message}`);process.exitCode=2;}
