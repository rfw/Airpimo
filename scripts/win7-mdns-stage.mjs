#!/usr/bin/env node
/** Intentionally explicit staging path; never silently publish a legacy Bonjour engine. */
import {join,resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {PROJECT_ROOT} from './native-engine-core.mjs';
import {readMdnsLock} from './win7-mdns-core.mjs';
try {
  if(process.platform!=='win32'||process.arch!=='x64')throw Error('Win7 staging requires Windows x64 build host');
  const args=process.argv.slice(2);
  function option(key){const i=args.indexOf(key);return i<0?null:args[i+1];}
  const gst=resolve(option('--gst')||process.env.UXPLAY_GST_RUNTIME||'F:\\gstreamer\\1.0\\mingw_x86_64');
  const msys=resolve(option('--msys-root')||process.env.MSYS2_ROOT||'C:\\msys64');
  const dll=resolve(option('--dll-source')||join(msys,'mingw64','bin'));
  const lock=readMdnsLock();
  const receipt=join(PROJECT_ROOT,'native-artifacts','win7-internal-mdns',lock.commit,'receipt.json');
  if(!existsSync(receipt))throw Error('Internal-mDNS 1.74 engine not built. Run npm run native:mdns:build:win7 first; legacy 1.73.7 cannot be substituted.');
  const params=['scripts/native-release-prepare.mjs','--win7','--mdns-receipt',receipt,'--gst',gst,'--dll-source',dll];
  const result=spawnSync(process.execPath,params,{cwd:PROJECT_ROOT,stdio:'inherit',windowsHide:true});
  if(result.error||result.status!==0)throw Error(`Win7 internal-mDNS candidate staging failed: ${result.error?.message??`exit ${result.status}`}`);
} catch(e){console.error(`[mdns] BLOCKED: ${e.message}`);process.exitCode=2;}
