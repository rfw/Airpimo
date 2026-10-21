import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {planMacPrune,applyMacPrune,REQUIRED_ELEMENTS} from '../scripts/prune-macos-native.mjs';

const REQUIRED_BINARY=Buffer.from('cffaedfe00000000','hex');
function fixture(callback) {
  const folder=mkdtempSync(join(tmpdir(),'uxplay-mac-prune-'));
  const resources=join(folder,'resources'),gst=join(folder,'homebrew');
  const names=[
    'sidecar/uxplay','gstreamer/bin/gst-inspect-1.0',
    'gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner',
    'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dylib',
    'gstreamer/lib/gstreamer-1.0/libgstlibav.dylib',
    'gstreamer/lib/gstreamer-1.0/libgstlevel.dylib',
    'gstreamer/lib/gstreamer-1.0/libgstgl.dylib',
    'gstreamer/lib/libgstreamer-1.0.0.dylib',
    'gstreamer/lib/libgstcodec.dylib',
    'gstreamer/lib/gstreamer-1.0/libgstpython.dylib',
    'gstreamer/lib/libharfbuzz-icu.0.dylib',
    'gstreamer/lib/libnode.127.dylib',
    'gstreamer/lib/libsoup-3.0.0.dylib',
  ];
  for(const name of names){
    const dest=join(resources,name);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,REQUIRED_BINARY);
  }
  const inspector=join(gst,'bin','gst-inspect-1.0');
  mkdirSync(dirname(inspector),{recursive:true});writeFileSync(inspector,'test-inspector');
  const manifest={schema:1,ready:true,os:'darwin',arch:'arm64',files:names.map(path=>({path,sha256:'test'}))};
  const manifestPath=join(resources,'native-manifest.json');
  writeFileSync(manifestPath,JSON.stringify(manifest));
  const calls=[];
  function run(tool,args){
    calls.push([tool,args]);
    if(tool===inspector) {
      const element=args[0];
      const filename=element==='level'?'libgstlevel.dylib':element==='glimagesink'?'libgstgl.dylib':element.startsWith('avdec_')?'libgstlibav.dylib':'libgstcoreelements.dylib';
      if(!REQUIRED_ELEMENTS.includes(element)&&element!=='glimagesink')return {status:1,stdout:'',stderr:'missing optional'};
      return {status:0,stdout:`Factory Details:\n  Filename                ${join(gst,'lib/gstreamer-1.0',filename)}\n`};
    }
    assert.equal(tool,'otool');
    const path=args.at(-1).replaceAll('\\','/');
    let deps=[];
    if(path.endsWith('/sidecar/uxplay'))deps=['@rpath/libgstreamer-1.0.0.dylib'];
    else if(path.endsWith('/libgstcoreelements.dylib'))deps=['@rpath/libgstcodec.dylib'];
    else if(path.endsWith('/libgstcodec.dylib'))deps=['/usr/lib/libSystem.B.dylib'];
    else if(path.endsWith('.dylib'))deps=['/usr/lib/libSystem.B.dylib'];
    return {status:0,stdout:`${path}:\n${deps.map(v=>`\t${v} (compatibility version 1.0.0, current version 1.0.0)`).join('\n')}\n`};
  }
  try{return callback({resources,gst,run,calls,manifestPath,names});}
  finally{rmSync(folder,{recursive:true,force:true});}
}

test('macOS runtime pruning retains required GStreamer elements and transitive Mach-O dependencies',()=>fixture(({resources,gst,run,names})=>{
  const result=planMacPrune(resources,{gst,run});
  assert.equal(result.ok,true,result.problems.join('\n'));
  assert.ok(result.kept.includes('gstreamer/lib/libgstcodec.dylib'));
  assert.ok(result.selectedPlugins.includes('gstreamer/lib/gstreamer-1.0/libgstlibav.dylib'));
  assert.ok(result.selectedPlugins.includes('gstreamer/lib/gstreamer-1.0/libgstlevel.dylib'), 'UxPlay audio pipeline needs level');
  assert.ok(result.provided.includes('level'));
  for(const optional of ['libgstpython.dylib','libharfbuzz-icu.0.dylib','libnode.127.dylib','libsoup-3.0.0.dylib'])
    assert.ok(result.removed.some(name=>name.endsWith(optional)),optional);
  assert.equal(result.kept.length+result.removed.length,names.length);
}));

test('macOS prune deletes only staged unused files and updates ready manifest',()=>fixture(({resources,gst,run,manifestPath})=>{
  const result=applyMacPrune(resources,{gst,run});
  assert.equal(result.ok,true);
  assert.equal(existsSync(join(resources,'gstreamer/lib/libnode.127.dylib')),false);
  assert.equal(existsSync(join(resources,'gstreamer/lib/libgstcodec.dylib')),true);
  assert.equal(existsSync(join(resources,'gstreamer/lib/gstreamer-1.0/libgstlevel.dylib')),true);
  const saved=JSON.parse(readFileSync(manifestPath,'utf8'));
  assert.equal(saved.ready,true);
  assert.equal(saved.files.length,result.kept.length);
  assert.equal(saved.macRuntimeSelection.strategy,'element-and-macho-closure');
}));

test('macOS prune blocks missing reachable dependency without deleting any assets',()=>fixture(({resources,gst,run,manifestPath})=>{
  const failing=(tool,args)=>{
    if(tool==='otool' && args.at(-1).replaceAll('\\','/').endsWith('/sidecar/uxplay'))
      return {status:0,stdout:`${args.at(-1)}:\n  /usr/local/opt/icu4c@78/lib/libicuuc.78.dylib (compatibility version 1.0.0)\n`};
    return run(tool,args);
  };
  const before=readFileSync(manifestPath,'utf8');
  const result=planMacPrune(resources,{gst,run:failing});
  assert.equal(result.ok,false);
  assert.match(result.problems.join('\n'),/missing staged dependency.*icuuc/);
  assert.throws(()=>applyMacPrune(resources,{gst,run:failing}),/missing staged dependency/);
  assert.equal(readFileSync(manifestPath,'utf8'),before);
  assert.equal(existsSync(join(resources,'gstreamer/lib/libnode.127.dylib')),true);
}));

test('macOS prune blocks missing essential AirPlay decoder before mutating staging',()=>fixture(({resources,gst,run,manifestPath})=>{
  const missing=(tool,args)=>tool.endsWith('gst-inspect-1.0')&&args[0]==='avdec_aac'
    ?{status:1,stdout:''}:run(tool,args);
  const result=planMacPrune(resources,{gst,run:missing});
  assert.equal(result.ok,false);
  assert.match(result.problems.join('\n'),/Missing required GStreamer element\/plugin: avdec_aac/);
  assert.equal(JSON.parse(readFileSync(manifestPath,'utf8')).ready,true);
}));

test('macOS cloud preparation prunes only staged native files before relocation',()=>{
  const src=readFileSync(new URL('../scripts/ci/prepare-macos.sh',import.meta.url),'utf8');
  assert.match(src,/npm run native:bundle:from-build[\s\S]*npm run native:prune:mac/);
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['native:prune:mac'],'node scripts/prune-macos-native.mjs');
  assert.match(src,/--gst "\$BREW_PREFIX" --apply/);
  assert.match(src,/for element in avdec_h264 avdec_aac level;/);
});

test('macOS packaged smoke rejects a Homebrew plugin escape even if gst-inspect reports success',async()=>{
  const {smokeMacPackagedGstreamer}=await import('../scripts/smoke-macos-gstreamer.mjs');
  const folder=mkdtempSync(join(tmpdir(),'uxplay-mac-smoke-'));
  try {
    const resources=join(folder,'resources');
    const files=['gstreamer/bin/gst-inspect-1.0','gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner',
      'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dylib'];
    for(const name of files){const path=join(resources,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'fake');}
    writeFileSync(join(resources,'native-manifest.json'),JSON.stringify({os:'darwin',ready:true,relocated:true,files:files.map(path=>({path}))}));
    const run=(_tool,_args)=>({status:0,stdout:`Plugin Details:\n    Filename                  /opt/homebrew/lib/gstreamer-1.0/libgstcoreelements.dylib\n`});
    assert.throws(()=>smokeMacPackagedGstreamer(resources,{run}),/outside packaged plugins/);
    const loaded=join(resources,'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dylib');
    const good=(_tool,_args)=>({status:0,stdout:`Plugin Details:\n    Filename                  ${loaded}\n`});
    const result=smokeMacPackagedGstreamer(resources,{run:good});
    assert.ok(result.elementsChecked>=REQUIRED_ELEMENTS.length);
  }finally{rmSync(folder,{recursive:true,force:true});}
});


test('macOS release pruning refuses missing level audio plugin even with AAC/H.264 available',()=>fixture(({resources,gst,run,manifestPath})=>{
  const missing=(tool,args)=>tool.endsWith('gst-inspect-1.0')&&args[0]==='level'
    ?{status:1,stdout:'',stderr:'No such element or plugin'}:run(tool,args);
  const before=readFileSync(manifestPath,'utf8');
  const result=planMacPrune(resources,{gst,run:missing});
  assert.equal(result.ok,false);
  assert.match(result.problems.join('\n'),/Missing required GStreamer element\/plugin: level/);
  assert.throws(()=>applyMacPrune(resources,{gst,run:missing}),/Missing required GStreamer element\/plugin: level/);
  assert.equal(readFileSync(manifestPath,'utf8'),before);
}));

test('macOS release pruning refuses missing staged level plugin even when host reports it',()=>fixture(({resources,gst,run,manifestPath})=>{
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  manifest.files=manifest.files.filter(item=>!item.path.endsWith('/libgstlevel.dylib'));
  writeFileSync(manifestPath,JSON.stringify(manifest));
  const result=planMacPrune(resources,{gst,run});
  assert.equal(result.ok,false);
  assert.match(result.problems.join('\n'),/Missing required GStreamer element\/plugin: level/);
}));

test('macOS bundled plugin smoke fails closed when level cannot be loaded',async()=>{
  const {smokeMacPackagedGstreamer}=await import('../scripts/smoke-macos-gstreamer.mjs');
  const folder=mkdtempSync(join(tmpdir(),'uxplay-mac-level-smoke-'));
  try{
    const resources=join(folder,'resources');
    const files=['gstreamer/bin/gst-inspect-1.0','gstreamer/libexec/gstreamer-1.0/gst-plugin-scanner',
      'gstreamer/lib/gstreamer-1.0/libgstcoreelements.dylib',
      'gstreamer/lib/gstreamer-1.0/libgstlevel.dylib'];
    for(const name of files){const full=join(resources,name);mkdirSync(dirname(full),{recursive:true});writeFileSync(full,'fake');}
    writeFileSync(join(resources,'native-manifest.json'),JSON.stringify({os:'darwin',ready:true,relocated:true,files:files.map(path=>({path}))}));
    const pluginRoot=join(resources,'gstreamer/lib/gstreamer-1.0');
    const run=(_tool,args)=>args[0]==='level'
      ?{status:1,stdout:'',stderr:'No such element or plugin level'}
      :{status:0,stdout:`Filename ${join(pluginRoot,'libgstcoreelements.dylib')}\n`};
    assert.throws(()=>smokeMacPackagedGstreamer(resources,{run}),/element level failed to load/);
    const runLoaded=(_tool,args)=>({status:0,stdout:`Filename ${join(pluginRoot,args[0]==='level'?'libgstlevel.dylib':'libgstcoreelements.dylib')}\n`});
    const result=smokeMacPackagedGstreamer(resources,{run:runLoaded});
    assert.ok(result.elementsChecked>=REQUIRED_ELEMENTS.length);
  }finally{rmSync(folder,{recursive:true,force:true});}
});
