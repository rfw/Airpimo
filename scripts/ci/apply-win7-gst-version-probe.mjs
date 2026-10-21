#!/usr/bin/env node
/** Anchored patch: change ONLY the pre-staging Windows GStreamer version probe.
 * No ABI checks, plugin smoke or staging/promotion logic are relaxed.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const project=resolve(fileURLToPath(new URL('../..',import.meta.url)));
const file=join(project,'scripts','native-release-prepare.mjs');
const importAnchor="import {readMdnsLock,verifyMdnsReceipt} from './win7-mdns-core.mjs';";
const importAddition="import {readWin7GstSdkVersion} from './ci/gst-sdk-version.mjs';";
const previous=`  const env={...process.env,PATH:[join(gst,'bin'),process.env.PATH??''].join(process.platform==='win32'?';':':')};
  const probe=spawnSync(inspector,['--version'],{encoding:'utf8',timeout:10000,env});
  if(probe.error||probe.status!==0)throw Error(\`GStreamer version probe failed: \${probe.error?.message??probe.stderr??probe.status}\`);
  const match=probe.stdout.match(/\\b([1-9]\\d*\\.\\d+\\.\\d+)\\b/);
  if(!match)throw Error('Could not extract GStreamer version');
  if(win7 && !match[1].startsWith('1.24.'))throw Error(\`Windows 7 build candidate expects audited GStreamer 1.24.x; found \${match[1]}\`);
`;
const replacement=`  // The unaligned SDK process may hang before the transactional Win7 stage.
  // Validate BOTH installed SDK metadata sources, then let the staged plugin
  // smoke and full ABI checks prove the actual selected DLL set works.
  let gstVersion;
  if(win7) {
    gstVersion=readWin7GstSdkVersion(gst);
    console.log(\`[win7] Cross-checked GStreamer SDK pkg-config/header: \${gstVersion} (no pre-staging SDK executable launched)\`);
  } else {
    const env={...process.env,PATH:[join(gst,'bin'),process.env.PATH??''].join(process.platform==='win32'?';':':')};
    const probe=spawnSync(inspector,['--version'],{encoding:'utf8',timeout:10000,env});
    if(probe.error||probe.status!==0)throw Error(\`GStreamer version probe failed: \${probe.error?.message??probe.stderr??probe.status}\`);
    const match=probe.stdout.match(/\\b([1-9]\\d*\\.\\d+\\.\\d+)\\b/);
    if(!match)throw Error('Could not extract GStreamer version');
    gstVersion=match[1];
  }
`;
try {
  let source=readFileSync(file,'utf8');
  if(source.includes('gstVersion=readWin7GstSdkVersion(gst)')) {
    if(!source.includes(importAddition)||!source.includes("'--gst-version',gstVersion")) throw Error('Partial v18 patch found; inspect native-release-prepare.mjs');
    console.log('[v18] Already applied; no file changed.');
    process.exit(0);
  }
  if(!source.includes(importAnchor))throw Error('Expected import anchor not found; current source differs');
  if(source.split(previous).length!==2)throw Error('Expected exact version-probe block not found (or duplicated); current source differs');
  const commandAnchor="'--gst-version',match[1]";
  if(source.split(commandAnchor).length!==2)throw Error('Expected exact GStreamer version argument not found (or duplicated)');
  source=source.replace(importAnchor,importAnchor+'\n'+importAddition)
               .replace(previous,replacement)
               .replace(commandAnchor,"'--gst-version',gstVersion");
  // This patch deliberately leaves alignWin7Runtime, smokeWin7Plugins,
  // promoteNativeCandidate, and their release checks unchanged.
  writeFileSync(file,source);
  console.log('[v18] Applied Windows Win7 GStreamer SDK metadata probe.');
} catch(e) {console.error(`[v18] BLOCKED: ${e.message}`);process.exitCode=2;}
