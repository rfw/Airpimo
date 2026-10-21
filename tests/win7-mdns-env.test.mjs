import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {win7MdnsEnvironments} from '../scripts/win7-mdns-env.mjs';

test('Win7 CMake/GCC prioritizes MSYS2 runtime, GStreamer inspection prioritizes its own runtime',()=>{
  const mingw='C:/msys64/mingw64/bin',usr='C:/msys64/usr/bin',gst='F:/gstreamer/1.0/mingw_x86_64',msys='C:/msys64';
  const {toolEnv,gstEnv}=win7MdnsEnvironments({gst,mingw,usr,msys,inheritedEnv:{Path:'C:/Windows/System32',CUSTOM:'yes'}});
  const toolPaths=toolEnv.PATH.split(';'),gstPaths=gstEnv.PATH.split(';');
  assert.equal(toolPaths[0],mingw);
  assert.equal(toolPaths[1],usr);
  assert.match(toolPaths[2],/gstreamer.*bin/);
  assert.match(gstPaths[0],/gstreamer.*bin/);
  assert.equal(gstPaths[1],mingw);
  assert.equal(gstPaths[2],usr);
  assert.match(toolEnv.PKG_CONFIG_PATH,/gstreamer.*pkgconfig/);
  assert.equal(toolEnv.CUSTOM,'yes');
  assert.equal(Object.keys(toolEnv).filter(key=>key.toLowerCase()==='path').length,1);
});

test('Win7 engine uses isolated toolchain environment and streams CMake/Ninja output',()=>{
  const source=readFileSync(new URL('../scripts/win7-mdns-engine.mjs',import.meta.url),'utf8');
  assert.match(source,/run\(inspector,\['--version'\],\{env:gstEnv\}\)/);
  assert.match(source,/run\(pkgconf,\['--modversion','gstreamer-1\.0'\],\{env:toolEnv\}\)/);
  assert.match(source,/\.\.\.MDNS_FLAGS\],\{env:toolEnv,live:true\}\)/);
  assert.match(source,/\['--build',buildDir,'--config','Release','--parallel','2'\],\{env:toolEnv,live:true\}\)/);
  assert.match(source,/stdio:'inherit'/);
});
