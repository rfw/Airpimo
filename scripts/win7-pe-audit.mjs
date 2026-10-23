/** Static Win7 PE import-graph release gate. Node only; no MinGW SDK required.
 * This is a fail-closed gate for known unsupported *hard imports*, not a Win7 runtime certification.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const LOW_OS_API = new Map([
  ['waitonaddress','Windows 8+'],
  ['wakebyaddressall','Windows 8+'],
  ['wakebyaddresssingle','Windows 8+'],
  ['processprng','Windows 8+'],
  ['setthreaddescription','Windows 10 1607+'],
  ['getthreaddescription','Windows 10 1607+'],
  ['getsystemtimepreciseasfiletime','Windows 8+'],
  ['createfile2','Windows 8+'],
  ['getoverlappedresultex','Windows 8+'],
]);
const SYSTEM = new Set(`advapi32.dll apphelp.dll avicap32.dll avrt.dll bcrypt.dll bcryptprimitives.dll cfgmgr32.dll comctl32.dll comdlg32.dll crypt32.dll cryptbase.dll cryptnet.dll cryptui.dll d2d1.dll d3d9.dll d3d11.dll d3dcompiler_47.dll dbghelp.dll dhcpcsvc.dll dnsapi.dll dsound.dll dwmapi.dll dwrite.dll dxgi.dll gdi32.dll gdiplus.dll hid.dll imm32.dll iphlpapi.dll kernel32.dll kernelbase.dll lz32.dll mpr.dll msacm32.dll mscoree.dll msvcrt.dll netapi32.dll normaliz.dll ntdll.dll ole32.dll oleaut32.dll powrprof.dll psapi.dll rasapi32.dll rpcrt4.dll secur32.dll setupapi.dll shell32.dll shlwapi.dll shcore.dll strmiids.dll ucrtbase.dll urlmon.dll user32.dll userenv.dll usp10.dll uxtheme.dll version.dll winhttp.dll wininet.dll winmm.dll winspool.drv wlanapi.dll ws2_32.dll wtsapi32.dll wldap32.dll mf.dll mfplat.dll mfreadwrite.dll mfuuid.dll mswsock.dll msimg32.dll ncrypt.dll wsock32.dll`.split(' '));
export const isSystemDll = name => SYSTEM.has(name) || name.startsWith('api-ms-win-') || name.startsWith('ext-ms-win-');
const isSystem = isSystemDll;

export function parsePE(buffer) {
  const fail = message => { throw Error(`invalid PE: ${message}`); };
  const range = (p, len) => { if (!Number.isSafeInteger(p) || p < 0 || p + len > buffer.length) fail(`out-of-bounds @${p}+${len}`); return p; };
  const u16 = p => buffer.readUInt16LE(range(p,2));
  const u32 = p => buffer.readUInt32LE(range(p,4));
  const str = (p,max=1024) => {
    range(p,1); const end = buffer.indexOf(0,p);
    if (end < 0 || end - p > max) fail(`unterminated string @${p}`);
    return buffer.toString('ascii',p,end);
  };
  if (buffer.length < 256 || buffer.toString('ascii',0,2) !== 'MZ') fail('missing MZ signature');
  const nt = u32(0x3c);
  if (u32(nt) !== 0x4550) fail('missing PE signature');
  const coff = nt+4, nsec=u16(coff+2), opt=coff+20, optSize=u16(coff+16);
  if (nsec > 96 || !nsec || optSize < 96) fail('unrecognized section or optional header count');
  const magic=u16(opt), pe64=magic === 0x20b;
  if (!pe64 && magic !== 0x10b) fail('unrecognized PE optional header');
  const dir=opt+(pe64?112:96), headersEnd=opt+optSize;
  if (headersEnd > buffer.length || dir+14*8 > headersEnd) fail('truncated PE data directories');
  const headersSize=u32(opt+60);
  const sections=[];
  for (let i=0;i<nsec;i++) {
    const p=headersEnd+i*40;range(p,40);
    sections.push({va:u32(p+12), vsize:u32(p+8), size:u32(p+16), raw:u32(p+20)});
  }
  const offset = rva => {
    for (const s of sections) if (rva >= s.va && rva < s.va+Math.max(s.vsize,s.size)) {
      const delta=rva-s.va;
      if (delta >= s.size) fail(`RVA ${rva} points into non-file-backed section`);
      return range(s.raw+delta,1);
    }
    if(rva < headersSize) return range(rva,1);
    fail(`RVA ${rva} not mapped`);
  };
  const directories = idx => ({rva:u32(dir+idx*8),size:u32(dir+idx*8+4)});
  const imports=new Map();
  const add=(name,symbol)=>{
    const dll=name.toLowerCase(); if(!imports.has(dll)) imports.set(dll,new Set());
    imports.get(dll).add(symbol);
  };
  const readThunk=(dll,rva)=>{
    for(let i=0;i<50000;i++) {
      const p=offset(rva+i*(pe64?8:4));range(p,pe64?8:4);
      const raw=pe64?buffer.readBigUInt64LE(p):BigInt(u32(p));
      if(raw===0n) return;
      if((raw & (pe64?0x8000000000000000n:0x80000000n))!==0n) add(dll,`#${raw & 0xffffn}`);
      else add(dll,str(offset(Number(raw)+2)));
    }
    fail('import thunk count exceeded');
  };
  const imp=directories(1);
  if(imp.rva) for(let i=0;i<10000;i++) {
    const p=offset(imp.rva+i*20);range(p,20);
    const original=u32(p), nameRva=u32(p+12), first=u32(p+16);
    if(original===0&&nameRva===0&&first===0) break;
    if(!nameRva||!(original||first)) fail('invalid import descriptor');
    readThunk(str(offset(nameRva)),original||first);
    if(i===9999) fail('import descriptors exceeded');
  }
  // Also inspect delay-load imports; they can fail later when the codec is exercised.
  const delay=directories(13);
  if(delay.rva) for(let i=0;i<10000;i++) {
    const p=offset(delay.rva+i*32);range(p,32);
    const attributes=u32(p), nameRva=u32(p+4), thunk=u32(p+16);
    if (!nameRva && !thunk) break;
    if(!(attributes & 1)) fail('unsupported VA-based delay imports');
    if(!nameRva || !thunk) fail('invalid delay-import descriptor');
    readThunk(str(offset(nameRva)),thunk);
    if(i===9999) fail('delay-import descriptors exceeded');
  }
  const exports=new Set(), exp=directories(0);
  if(exp.rva) {
    const p=offset(exp.rva);range(p,40);
    const n=u32(p+24), names=u32(p+32);
    if(n>200000) fail('unreasonable export name count');
    for(let i=0;i<n;i++) exports.add(str(offset(u32(offset(names+i*4)))));
  }
  return {imports, exports, pe64};
}

/** audit packaged .exe/.dll files in dependency closure; inspect BOTH bundled exports and OS APIs */
export function auditWin7Runtime(root, manifest, {read=readFileSync}={}) {
  const problems=[], seen=new Set(), parsed=new Map(), byName=new Map();
  for(const item of manifest.files) {
    if (!/\.(?:dll|exe)$/i.test(item.path)) continue;
    const name=basename(item.path).toLowerCase();
    // Prioritize gstreamer/bin as the Windows DLL search path configured for the child.
    if(!byName.has(name) || item.path.startsWith('gstreamer/bin/')) byName.set(name,item.path);
  }
  const roots=['sidecar/uxplay.exe','gstreamer/bin/gst-inspect-1.0.exe','gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner.exe',
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dll','gstreamer/lib/gstreamer-1.0/libgstcoreelements.dll',
    'gstreamer/lib/gstreamer-1.0/libgstaudioconvert.dll','gstreamer/lib/gstreamer-1.0/libgstaudioresample.dll',
    'gstreamer/lib/gstreamer-1.0/libgstvideoconvertscale.dll'];
  function parsedAt(path) {
    if(!parsed.has(path)) {
      try { parsed.set(path, parsePE(read(join(root,...path.split('/'))))); }
      catch(e) {problems.push(`${path}: ${e.message}`);parsed.set(path,null);}
    }
    return parsed.get(path);
  }
  const queue=[];
  for (const rootName of roots) {
    if (!manifest.files.some(x=>x.path===rootName)) {
      // videoconvertscale plugin filename differs across GStreamer release families; treat as optional.
      if (!rootName.endsWith('libgstvideoconvertscale.dll')) problems.push(`missing required Win7 runtime: ${rootName}`);
      continue;
    }
    queue.push(rootName);
  }
  while(queue.length) {
    const path=queue.pop(); if(seen.has(path))continue;seen.add(path);
    const item=parsedAt(path); if(!item)continue;
    if(!item.pe64) problems.push(`Win7 x64 requires 64-bit native module: ${path}`);
    for(const [dll, symbols] of item.imports) {
      for(const sym of symbols) if(LOW_OS_API.has(sym.toLowerCase())) {
        problems.push(`Win7 unsupported hard import: ${path} -> ${dll}!${sym} (${LOW_OS_API.get(sym.toLowerCase())})`);
      }
      const target=byName.get(dll);
      if(target) {
        const local=parsedAt(target);
        if(local) for(const sym of symbols) if(!sym.startsWith('#') && !local.exports.has(sym)) {
          problems.push(`bundled import/export mismatch: ${path} -> ${target}!${sym}`);
        }
        queue.push(target);
      } else if (!isSystem(dll)) problems.push(`unbundled dependency: ${path} -> ${dll}`);
    }
  }
  // ABI scan must include every PE in required closure; extra optional plugins are not certified.
  return {ok:!problems.length, problems:[...new Set(problems)].sort(), inspected:seen.size, scannedRoots:roots.filter(x=>seen.has(x))};
}
