/** Validate the *whole* packaged GStreamer/UxPlay C++ runtime ABI, not only
 * the Win7 mandatory decoder closure. Windows plug-in scanner discovers other
 * plug-ins (D3D11, QSV, NVCodec, ...) during registry construction too.
 * Import/export checks are static: runtime smoke and Win7 API gate are separate.
 */
import {readFileSync, existsSync} from 'node:fs';
import {join,basename} from 'node:path';
import {parsePE} from './win7-pe-audit.mjs';

export const CRT_NAMES=Object.freeze(['libstdc++-6.dll','libwinpthread-1.dll']);

function binaries(root, manifest, read) {
  if(!Array.isArray(manifest?.files)) throw Error('Missing native file manifest');
  const found=[];
  for(const item of manifest.files) {
    if(!/\.(exe|dll)$/i.test(item.path)) continue;
    const path=join(root,...item.path.split('/'));
    let pe;
    try { pe=parsePE(read(path)); }
    catch(e) { throw Error(`Cannot audit PE ${item.path}: ${e.message}`); }
    if(!pe.pe64) throw Error(`Non-x64 native module: ${item.path}`);
    found.push({path:item.path,pe});
  }
  return found;
}
export function collectCrtImports(root, manifest, {read=readFileSync}={}) {
  const imports=new Map(CRT_NAMES.map(d=>[d,new Map()]));
  for(const {path,pe} of binaries(root,manifest,read)) {
    for(const dll of CRT_NAMES) {
      const symbols=pe.imports.get(dll);
      if(symbols?.size) imports.get(dll).set(path, symbols);
    }
  }
  return imports;
}
function checkExports(importers, exports, dll) {
  const problems=[];
  for(const [path,symbols] of importers) for(const symbol of symbols) {
    if(symbol.startsWith('#')) {problems.push(`${path} -> ${dll}!${symbol}: ordinal import cannot be verified`);continue;}
    if(!exports.has(symbol)) problems.push(`${path} -> ${dll}!${symbol}`);
  }
  return problems;
}
export function auditPackagedCxxAbi(root, manifest, {read=readFileSync}={}) {
  const imported=collectCrtImports(root,manifest,{read});
  const problems=[];
  for(const dll of CRT_NAMES) {
    const importers=imported.get(dll);
    if(!importers.size) continue;
    const path=join(root,'gstreamer','bin',dll);
    if(!existsSync(path)) {problems.push(`missing bundled ${dll}; imported by ${[...importers.keys()].join(', ')}`);continue;}
    try {
      const pe=parsePE(read(path));
      if(!pe.pe64) problems.push(`non-x64 bundled runtime: ${dll}`);
      problems.push(...checkExports(importers,pe.exports,dll));
    } catch(e) {problems.push(`invalid bundled ${dll}: ${e.message}`);}
  }
  // Windows may report the failing *GStreamer module* rather than libstdc++
  // as the target DLL. Check every shipped DLL-to-DLL import by name too.
  const modules=binaries(root,manifest,read);
  const byName=new Map();
  for(const mod of modules) {
    const dll=basename(mod.path).toLowerCase();
    // PATH begins with gstreamer/bin. Those DLLs win over same-named files.
    if(!byName.has(dll)||mod.path.startsWith('gstreamer/bin/')) byName.set(dll,mod);
  }
  for(const mod of modules) for(const [dll,symbols] of mod.pe.imports) {
    const provider=byName.get(dll);
    if(!provider||CRT_NAMES.includes(dll))continue;
    for(const symbol of symbols) {
      // PE parser does not expose ordinal exports; allow ordinal imports
      // to be resolved by the Windows loader during existing smoke tests.
      if(symbol.startsWith('#'))continue;
      if(!provider.pe.exports.has(symbol)) problems.push(`${mod.path} -> ${provider.path}!${symbol}`);
    }
  }
  return {ok:problems.length===0,problems:[...new Set(problems)],modulesChecked:modules.length};
}
/** Choose GStreamer SDK's own CRT when compatible with the *entire* package,
 * including MSYS2-built UxPlay. If the SDK CRT lacks a required export, use
 * MSYS2's only when it satisfies *all* importers; otherwise fail closed.
 */
export function selectCompatibleStdCxx(root,manifest,msysSource,{read=readFileSync}={}) {
  const dll='libstdc++-6.dll';
  const imports=collectCrtImports(root,manifest,{read}).get(dll);
  const paths=[['sdk',join(root,'gstreamer','bin',dll)],['msys2',msysSource]];
  const reports=[];
  for(const [kind,path] of paths) {
    if(!path||!existsSync(path)) {reports.push(`${kind}: missing DLL`);continue;}
    try {
      const pe=parsePE(read(path));
      const problems=pe.pe64?checkExports(imports,pe.exports,dll):['not x64'];
      if(!problems.length) return {kind,path,checked:imports.size};
      reports.push(`${kind}: ${problems.slice(0,8).join('; ')}${problems.length>8?` (+${problems.length-8} more)`:''}`);
    } catch(e) {reports.push(`${kind}: ${e.message}`);}
  }
  throw Error(`C++ bundled import/export mismatch: no compatible libstdc++-6.dll for all installed GStreamer plugins and UxPlay. ${reports.join(' | ')}. Rebuild the engine against the GStreamer SDK ABI or remove incompatible non-required plugins after a verified functional audit; never ship the mixed runtime.`);
}
