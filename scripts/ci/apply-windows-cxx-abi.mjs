#!/usr/bin/env node
/** Idempotent, anchor-based overlay; preserves all unrelated project changes. */
import {readFileSync,writeFileSync,renameSync,existsSync,mkdirSync,copyFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2), root=resolve(args.includes('--root')?args[args.indexOf('--root')+1]||'.':fileURLToPath(new URL('../..',import.meta.url)));
const win7='scripts/win7-runtime-align.mjs',checker='scripts/check-native.mjs';
const patchSpecs=[
  {file:win7,replacements:[
    ["import {auditWin7Runtime, parsePE} from './win7-pe-audit.mjs';", "import {auditWin7Runtime, parsePE} from './win7-pe-audit.mjs';\nimport {selectCompatibleStdCxx, auditPackagedCxxAbi} from './win7-cxx-abi.mjs';"],
    ["  const changed=[];\n  for(const dll of ENGINE_CRT) {\n    if(checkedCopy(dll,sourceIndex,destination,{replace:true})) changed.push(`paired CRT: ${dll}`);\n  }\n  let manifest=refreshNativeManifest(root);", `  const changed=[];
  let manifest=refreshNativeManifest(root);
  // Never overwrite the SDK's libstdc++ with MSYS2's before checking all
  // optional GStreamer plug-ins (D3D11, QSV, NVCodec, etc.).
  const selected=selectCompatibleStdCxx(root,manifest,sourceIndex.get('libstdc++-6.dll'));
  if(selected.kind==='msys2') {
    checkedCopy('libstdc++-6.dll',sourceIndex,destination,{replace:true});
    changed.push('compatible engine CRT: libstdc++-6.dll (MSYS2)');
  } else changed.push('compatible SDK CRT: libstdc++-6.dll (preserved)');
  if(checkedCopy('libwinpthread-1.dll',sourceIndex,destination,{replace:true})) changed.push('paired CRT: libwinpthread-1.dll');
  manifest=refreshNativeManifest(root);`],
    ["    if(result.ok) return {manifest,changed,inspected:result.inspected};", `    if(result.ok) {
      const cxx=auditPackagedCxxAbi(root,manifest);
      if(!cxx.ok) throw Error(\`Windows GStreamer C++ import/export mismatch (\${cxx.modulesChecked} modules):\\n\${cxx.problems.slice(0,24).join('\\n')}\`);
      return {manifest,changed,inspected:result.inspected};
    }`],
  ]},
  {file:checker,replacements:[
    ["import {auditWin7Runtime} from './win7-pe-audit.mjs';", "import {auditWin7Runtime} from './win7-pe-audit.mjs';\nimport {auditPackagedCxxAbi} from './win7-cxx-abi.mjs';"],
    ["if(process.argv.includes('--win7')) {", `if(manifest.os==='win32') {
  const cxx=auditPackagedCxxAbi(root,manifest);
  if(!cxx.ok) fail(\`GStreamer C++ DLL export mismatch (\${cxx.modulesChecked} packaged native modules):\\n\`+cxx.problems.slice(0,24).join('\\n'));
  console.log(\`PASS: GStreamer C++ DLL ABI checked across \${cxx.modulesChecked} packaged executables and DLLs\`);
}
if(process.argv.includes('--win7')) {`],
  ]}
];
function replaceOnce(text,oldText,newText,file) {
  const count=text.split(oldText).length-1;
  if(count!==1) throw Error(`Refusing ambiguous patch: ${file} matched ${count} occurrences. No files changed.`);
  return text.replace(oldText,newText);
}
const next=[];
try {
  for(const spec of patchSpecs) {
    const path=join(root,spec.file);let original=readFileSync(path,'utf8');
    if(!original.includes('auditPackagedCxxAbi')) {
      let updated=original.replaceAll('\r\n','\n');
      for(const [oldText,newText] of spec.replacements) updated=replaceOnce(updated,oldText,newText,spec.file);
      next.push({path,original,updated:original.includes('\r\n')?updated.replaceAll('\n','\r\n'):updated});
    } else {
      // A prior application is safe only if every expected insertion exists.
      const required=spec.file===win7?["selected=selectCompatibleStdCxx", "auditPackagedCxxAbi(root,manifest)"]:["auditPackagedCxxAbi(root,manifest)","import {auditPackagedCxxAbi}"];
      if(required.some(x=>!original.includes(x))) throw Error(`${spec.file} is partially patched; inspect manually.`);
      next.push({path,original,updated:original});
    }
  }
  const checked=join(root,'scripts','win7-cxx-abi.mjs');
  if(!existsSync(checked)) throw Error('Missing scripts/win7-cxx-abi.mjs from ZIP; cannot patch');
  const backup=join(root,'.win-cxx-abi-backup');
  if(next.every(f=>f.original===f.updated)) {console.log('PASS: Windows CRT overlay already applied (idempotent).');process.exit(0);}
  if(existsSync(backup)) throw Error(`Backup folder already exists: ${backup}; do not overwrite your previous backups`);
  mkdirSync(backup,{recursive:true});
  for(const f of next) {
    const name=f.path===join(root,win7)?'win7-runtime-align.mjs':'check-native.mjs';
    copyFileSync(f.path,join(backup,name));
  }
  try {
    for(const f of next) {
      if(f.original===f.updated)continue;
      writeFileSync(f.path+'.cxx-tmp',f.updated,'utf8');
      renameSync(f.path+'.cxx-tmp',f.path);
    }
  } catch(e) {
    for(const f of next) {
      const name=f.path===join(root,win7)?'win7-runtime-align.mjs':'check-native.mjs';
      copyFileSync(join(backup,name),f.path);
      rmSync(f.path+'.cxx-tmp',{force:true});
    }
    throw e;
  }
  console.log(`PASS: applied Windows C++ ABI fix. Original files backed up in ${backup}`);
} catch(e) {console.error('BLOCKED: '+e.message);process.exitCode=2;}
