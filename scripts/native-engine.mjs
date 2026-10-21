#!/usr/bin/env node
/** Prepare once per OS/CPU and pinned commit; reuse verified cache afterward. */
import {existsSync, mkdirSync, rmSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {verifiedCachedEngine,engineDir,targetId,LOCK,PROJECT_ROOT,storeEngine,prebuiltForTarget,downloadVerified,buildEngine} from './native-engine-core.mjs';
const args=process.argv.slice(2);
const command=args[0]??'prepare';
const silent=args.includes('--quiet');
const log=(s)=>{if(!silent)console.log(s)};
try {
  const id=targetId();
  if(command==='status') {
    const path=verifiedCachedEngine();
    log(path ? `PASS: ${path}`:`MISSING: no verified ${id} UxPlay engine cached (commit ${LOCK.commit})`);
    process.exitCode=path?0:2;
  } else if(command==='prepare') {
    let binary=verifiedCachedEngine();
    if(binary)log(`[native] Reusing verified ${id} engine: ${binary}`);
    else {
      const registry=JSON.parse(readFileSync(join(PROJECT_ROOT,'native/prebuilt.json'),'utf8'));
      const asset=prebuiltForTarget(id,registry);
      if(asset) {
        const dir=engineDir();mkdirSync(dir,{recursive:true});
        const temp=join(dir,`download-${process.pid}.tmp`);
        try {
          log(`[native] Fetching pinned SHA-256-verified executable for ${id}`);
          await downloadVerified(asset.url,asset.sha256,temp);
          storeEngine(temp,{origin:'verified-prebuilt'});
        } finally {rmSync(temp,{force:true});}
      } else if(!args.includes('--no-build')) {
        log(`[native] No audited prebuilt registered for ${id}; compiling pinned UxPlay commit once.`);
        buildEngine();
      } else {throw Error('No cached/prebuilt engine; run npm run native:prepare on a prepared build host or register reviewed prebuilt URL/SHA-256');}
      binary=verifiedCachedEngine();
      if(!binary)throw Error('Cache verification failed after preparing UxPlay');
      log(`[native] Ready: ${binary}`);
    }
    // Machine-readable emission is optional; never confuse diagnostic output with a filename.
    if(args.includes('--print-path'))console.log(`NATIVE_ENGINE_PATH=${binary}`);
  } else throw Error(`Unknown command '${command}' (prepare/status)`);
} catch(err){console.error(`[native] BLOCKED: ${err.message}`);process.exitCode=2;}
