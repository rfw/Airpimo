#!/usr/bin/env node
// Apply only scoped edits to an EXISTING working UxPlay Desktop checkout.
// Do not overwrite package versions or previously fixed Windows/macOS logic.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
const root=resolve(import.meta.dirname,'../..');
const receiver='src-tauri/src/receiver.rs';
const conf='src-tauri/tauri.conf.json';
const mac='scripts/ci/prepare-macos.sh';
const targets=[receiver,conf,mac];
const old=new Map(targets.map(name=>[name,readFileSync(join(root,name),'utf8')]));
function exactlyOne(source,needle,label){
  const count=source.split(needle).length-1;
  if(count!==1) throw Error(`${label}: expected 1 anchor, found ${count}. Refusing to alter current files.`);
}
let newReceiver=old.get(receiver);
const attach="        // The video is in the UxPlay process, not the Tauri control window.\n        #[cfg(target_os = \"macos\")]\n        if let Err(err) = setup_mac_video_controls(app, &mut command, dev_binary) {\n            self.error(app, epoch, \"missing_runtime\", &err);\n            return self.snapshot();\n        }\n";
const addition="\n#[cfg(target_os = \"macos\")]\nfn setup_mac_video_controls(app: &AppHandle, command: &mut Command, development: bool) -> Result<(), String> {\n    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;\n    let shipped = resources.join(\"fullscreen\").join(\"uxplay-fullscreen-macos.dylib\");\n    #[cfg(debug_assertions)]\n    let shipped = if shipped.is_file() { shipped } else {\n        Path::new(env!(\"CARGO_MANIFEST_DIR\")).join(\"resources\").join(\"fullscreen\")\n            .join(\"uxplay-fullscreen-macos.dylib\")\n    };\n    if !shipped.is_file() {\n        if development { return Ok(()); }\n        return Err(\"安装包缺少 macOS 播放器全屏原生扩展，请重新生成完整版安装包\".into());\n    }\n    // Do not inherit untrusted DYLD_INSERT_LIBRARIES. Only the version built\n    // into this installation is loaded, and only by this UxPlay child process.\n    command.env(\"DYLD_INSERT_LIBRARIES\", shipped);\n    command.env(\"UXPLAY_DESKTOP_FULLSCREEN_CHILD\", \"1\");\n    Ok(())\n}\n";
const anchor="        if let Err(err) = setup_gstreamer(app, &mut command, dev_binary) {\n            self.error(app,epoch,\"missing_runtime\",&err); return self.snapshot();\n        }\n";
if(!newReceiver.includes('fn setup_mac_video_controls(')) {
  exactlyOne(newReceiver,anchor,'receiver.rs / setup_gstreamer');
  newReceiver=newReceiver.replace(anchor,anchor+attach)+'\n'+addition;
} else if (!newReceiver.includes('setup_mac_video_controls(app, &mut command, dev_binary)')) {
  throw Error('Partial fullscreen install in receiver.rs; refusing to layer another implementation');
}
let newConf=old.get(conf);
const confMatch='"resources/fullscreen/"';
if(!newConf.includes(confMatch)) {
  const needle='"resources/native-manifest.json": "native-manifest.json"';
  exactlyOne(newConf,needle,'tauri.conf.json / manifest resource');
  newConf=newConf.replace(needle,needle+',\n      "resources/fullscreen/": "fullscreen/"');
  JSON.parse(newConf);
}
let newMac=old.get(mac);
if(!newMac.includes('build-macos-fullscreen.sh')) {
  const needle='npm run native:prune:mac -- --gst "$BREW_PREFIX" --apply';
  exactlyOne(newMac,needle,'prepare-macos.sh / native prune');
  newMac=newMac.replace(needle,needle+'\n# Compile in-process macOS GStreamer window controls.\nbash scripts/ci/build-macos-fullscreen.sh "$TARGET"');
}
const result=new Map([[receiver,newReceiver],[conf,newConf],[mac,newMac]]);
const changed=[...result].filter(([name,data])=>data!==old.get(name));
if(changed.length===0){console.log('PASS: macOS fullscreen overlay already installed (idempotent)');process.exit(0);}
const backup=mkdtempSync(join(tmpdir(),'uxplay-fullscreen-backup-'));
for(const [name] of changed) {
  const dst=join(backup,name);mkdirSync(dirname(dst),{recursive:true});writeFileSync(dst,old.get(name),'utf8');
}
const written=[];
try {
  for(const [name,data] of changed) {writeFileSync(join(root,name),data,'utf8');written.push(name);}
} catch(e) {
  for(const name of written.reverse())writeFileSync(join(root,name),old.get(name),'utf8');
  throw e;
}
console.log(`PASS: patched ${changed.map(([name])=>name).join(', ')}`);
console.log(`Previous files backed up to: ${backup}`);
