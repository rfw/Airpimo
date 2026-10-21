#!/usr/bin/env node
/** Export reviewed engine bytes + SHA for a private artifact repository.
 * GStreamer runtime is separate: shipping the engine alone is NOT an installer.
 */
import {mkdirSync,copyFileSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {LOCK,targetId,verifiedCachedEngine,digest,engineName,PROJECT_ROOT} from './native-engine-core.mjs';
const args=process.argv.slice(2);
const index=args.indexOf('--out');
const directory=resolve(index>=0?args[index+1]??'':join(PROJECT_ROOT,'native-artifacts',targetId()));
if(index>=0&&!args[index+1]){console.error('--out requires a directory');process.exit(2)}
const binary=verifiedCachedEngine();
if(!binary){console.error('BLOCKED: no verified cached engine; run npm run native:prepare first');process.exit(2)}
mkdirSync(directory,{recursive:true});
const out=join(directory,engineName());copyFileSync(binary,out);
const sha=digest(out);
const published={target:targetId(),commit:LOCK.commit,sha256:sha,upstream:LOCK.upstream,downloadUrl:'SET_REAL_HTTPS_URL_AFTER_UPLOADING'};
writeFileSync(join(directory,'prebuilt-entry.template.json'),JSON.stringify(published,null,2)+'\n');
writeFileSync(join(directory,'SHA256SUMS'),`${sha}  ${engineName()}\n`);
console.log(`Exported ${out}\nSHA-256 ${sha}\nUpload reviewed binary and enter actual HTTPS URL plus SHA in native/prebuilt.json. GPL source/license obligations apply.`);
