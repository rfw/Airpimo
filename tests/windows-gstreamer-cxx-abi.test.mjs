import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {auditPackagedCxxAbi,selectCompatibleStdCxx} from '../scripts/win7-cxx-abi.mjs';

function pe({dll=null, imported='_ZSt14__once_functor', exported=null}={}) {
  const b=Buffer.alloc(4096);b.write('MZ',0);b.writeUInt32LE(0x80,0x3c);b.write('PE\0\0',0x80);
  const co=0x84,opt=co+20;
  b.writeUInt16LE(0x8664,co);b.writeUInt16LE(1,co+2);b.writeUInt16LE(0xf0,co+16);
  b.writeUInt16LE(0x20b,opt);b.writeUInt32LE(0x200,opt+60);
  const sh=opt+0xf0;b.write('.rdata',sh);b.writeUInt32LE(0x1000,sh+8);b.writeUInt32LE(0x1000,sh+12);
  b.writeUInt32LE(0xe00,sh+16);b.writeUInt32LE(0x200,sh+20);
  const at=r=>r-0x1000+0x200;
  if(dll) {
    b.writeUInt32LE(0x1180,opt+112+8);b.writeUInt32LE(40,opt+112+12);
    b.writeUInt32LE(0x11c0,at(0x1180));b.writeUInt32LE(0x1240,at(0x1180)+12);b.writeUInt32LE(0x11c0,at(0x1180)+16);
    b.write(dll+'\0',at(0x1240));b.writeBigUInt64LE(0x1200n,at(0x11c0));b.write(imported+'\0',at(0x1202));
  }
  if(exported) {
    b.writeUInt32LE(0x1300,opt+112);b.writeUInt32LE(128,opt+116);
    b.writeUInt32LE(1,at(0x1300)+20);b.writeUInt32LE(1,at(0x1300)+24);
    b.writeUInt32LE(0x1450,at(0x1300)+32);b.writeUInt32LE(0x1400,at(0x1450));b.write(exported+'\0',at(0x1400));
  }
  return b;
}
const withRoot=fn=>{const root=mkdtempSync(join(tmpdir(),'uxplay-cxx-'));try{return fn(root)}finally{rmSync(root,{recursive:true,force:true})}};
function install(root, files) {
  for(const [path,b] of Object.entries(files)) {
    const p=join(root,...path.split('/'));mkdirSync(dirname(p),{recursive:true});writeFileSync(p,b);
  }
  return {files:Object.keys(files).map(path=>({path}))};
}
test('detect exact missing _ZSt14__once_functor in optional GStreamer d3d11 plugin',()=>withRoot(root=>{
  const manifest=install(root,{
    'sidecar/uxplay.exe':pe(),
    'gstreamer/bin/libstdc++-6.dll':pe({exported:'different_symbol'}),
    'gstreamer/lib/gstreamer-1.0/libgstd3d11.dll':pe({dll:'libstdc++-6.dll'}),
  });
  const r=auditPackagedCxxAbi(root,manifest);
  assert.equal(r.ok,false);
  assert.match(r.problems.join('\n'),/libgstd3d11.dll -> libstdc\+\+-6.dll!_ZSt14__once_functor/);
}));
test('compatible SDK libstdc++ wins over incompatible MSYS2 CRT',()=>withRoot(root=>{
  const manifest=install(root,{
    'sidecar/uxplay.exe':pe(),
    'gstreamer/bin/libstdc++-6.dll':pe({exported:'_ZSt14__once_functor'}),
    'gstreamer/lib/gstreamer-1.0/libgstd3d11.dll':pe({dll:'libstdc++-6.dll'}),
  });
  const msys=join(root,'msys2.dll');writeFileSync(msys,pe({exported:'different_symbol'}));
  assert.equal(selectCompatibleStdCxx(root,manifest,msys).kind,'sdk');
  assert.equal(auditPackagedCxxAbi(root,manifest).ok,true);
}));
test('fallback to MSYS2 CRT only when compatible with every bundled plugin',()=>withRoot(root=>{
  const manifest=install(root,{
    'sidecar/uxplay.exe':pe(),
    'gstreamer/bin/libstdc++-6.dll':pe({exported:'different_symbol'}),
    'gstreamer/lib/gstreamer-1.0/libgstqsv.dll':pe({dll:'libstdc++-6.dll'}),
  });
  const msys=join(root,'msys2.dll');writeFileSync(msys,pe({exported:'_ZSt14__once_functor'}));
  assert.equal(selectCompatibleStdCxx(root,manifest,msys).kind,'msys2');
}));
test('fail closed when SDK and MSYS2 runtimes satisfy disjoint symbol sets',()=>withRoot(root=>{
  const manifest=install(root,{
    'sidecar/uxplay.exe':pe({dll:'libstdc++-6.dll',imported:'engine_only_export'}),
    'gstreamer/bin/libstdc++-6.dll':pe({exported:'_ZSt14__once_functor'}),
    'gstreamer/lib/gstreamer-1.0/libgstd3d11.dll':pe({dll:'libstdc++-6.dll'}),
  });
  const msys=join(root,'msys2.dll');writeFileSync(msys,pe({exported:'engine_only_export'}));
  assert.throws(()=>selectCompatibleStdCxx(root,manifest,msys),/import\/export mismatch.*libgstd3d11.dll/);
}));
test('check all packaged C++ importers, not only libav smoke-tested closure',()=>withRoot(root=>{
  const manifest=install(root,{
    'sidecar/uxplay.exe':pe(),
    'gstreamer/bin/libstdc++-6.dll':pe({exported:'_ZSt14__once_functor'}),
    'gstreamer/lib/gstreamer-1.0/libgstnvcodec.dll':pe({dll:'libstdc++-6.dll'}),
    'gstreamer/lib/gstreamer-1.0/libgstqsv.dll':pe({dll:'libstdc++-6.dll'}),
  });
  assert.equal(auditPackagedCxxAbi(root,manifest).ok,true);
  writeFileSync(join(root,'gstreamer','bin','libstdc++-6.dll'),pe({exported:'other'}));
  const r=auditPackagedCxxAbi(root,manifest);
  assert.equal(r.problems.length,2);
}));
test('detect missing symbol from libgstd3d11-1.0-0.dll itself, not only libstdc++',()=>withRoot(root=>{
  const manifest=install(root,{
    'sidecar/uxplay.exe':pe(),
    'gstreamer/bin/libgstd3d11-1.0-0.dll':pe({exported:'GStreamer_D3D_Export'}),
    'gstreamer/lib/gstreamer-1.0/libgstd3d11.dll':pe({dll:'libgstd3d11-1.0-0.dll',imported:'_ZSt14__once_functor'}),
  });
  const r=auditPackagedCxxAbi(root,manifest);
  assert.equal(r.ok,false);
  assert.match(r.problems.join('\n'),/libgstd3d11.dll -> gstreamer\/bin\/libgstd3d11-1.0-0.dll!_ZSt14__once_functor/);
}));
test('all local module imports pass when their providers export required symbols',()=>withRoot(root=>{
  const manifest=install(root,{
    'sidecar/uxplay.exe':pe(),
    'gstreamer/bin/libgstd3d11-1.0-0.dll':pe({exported:'provider_export'}),
    'gstreamer/lib/gstreamer-1.0/libgstd3d11.dll':pe({dll:'libgstd3d11-1.0-0.dll',imported:'provider_export'}),
  });
  assert.equal(auditPackagedCxxAbi(root,manifest).ok,true);
}));
