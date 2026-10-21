#!/usr/bin/env node
// Incremental patch for Airpimo. Does not rewrite package versions or engine files.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
const project = resolve(import.meta.dirname, '../..');
const apply = process.argv.includes('--apply');
const check = process.argv.includes('--check');
if (apply === check) {
  console.error('Usage: node scripts/ci/apply-airpimo-uxplay-args.mjs --apply|--check');
  process.exit(2);
}
const updates = new Map();
function read(name) { return readFileSync(join(project,name),'utf8'); }
function patch(name, fn) {
  const old = read(name);
  const next = fn(old);
  if (!next) {
    throw new Error(`${name}: 未能识别现有项目结构；没有修改任何文件`);
  }
  updates.set(name,{old,next});
}
function insert(source, find, added, label) {
  if (source.includes(added)) return source;
  const count = source.split(find).length - 1;
  if (count !== 1) throw new Error(`${label}: 找不到唯一锚点（${count}）`);
  return source.replace(find, find+added);
}
function replace(source, a, b, label) {
  if (source.includes(b)) return source;
  const count = source.split(a).length - 1;
  if (count !== 1) throw new Error(`${label}: 找不到唯一锚点（${count}）`);
  return source.replace(a,b);
}
function replaceAll(source, a, b, expected, label) {
  if (source.split(b).length - 1 === expected) return source;
  const count = source.split(a).length - 1;
  if (count !== expected) throw new Error(`${label}: 需要 ${expected} 处，实际 ${count} 处`);
  return source.split(a).join(b);
}
patch('src-tauri/src/settings.rs', src=> {
  src = insert(src, '    pub brightness: u8,\n', '    #[serde(default)]\n    pub uxplay_args: String,\n', 'Rust Settings field');
  src = replace(src,'brightness: default_brightness() }', 'brightness: default_brightness(), uxplay_args: String::new() }', 'Rust default');
  src = replace(src,'validate_brightness(value.brightness).is_ok() => (value, true)', 'validate_brightness(value.brightness).is_ok() && crate::uxplay_args::validate(&value.uxplay_args).is_ok() => (value, true)', 'Rust load validation');
  src = insert(src, '    validate_brightness(settings.brightness)?;\n', '    crate::uxplay_args::validate(&settings.uxplay_args)?;\n', 'Rust save validation');
  src = replace(src, 'fps:120,brightness:65};', 'fps:120,brightness:65,uxplay_args:"-vol 0.75".into()};', 'Rust roundtrip fixture');
  src = insert(src, '        assert_eq!(settings.brightness, 80);\n', '        assert_eq!(settings.uxplay_args, "");\n', 'Rust migration fixture');
  return src;
});
patch('src-tauri/src/lib.rs', src=>replace(src,'mod settings;','mod settings;\nmod uxplay_args;','Rust module'));
patch('src-tauri/src/receiver.rs', src=>{
  src=replaceAll(src,'    applied_brightness: Option<u8>,\n','    applied_brightness: Option<u8>,\n    applied_uxplay_args: Option<String>,\n',2,'Rust snapshot and inner');
  src=insert(src,'            applied_brightness: self.applied_brightness,\n','            applied_uxplay_args: self.applied_uxplay_args.clone(),\n','Rust snapshot field');
  src=replace(src,'applied_brightness:None,\n','applied_brightness:None, applied_uxplay_args:None,\n','Rust initial field');
  src=insert(src,'        settings::validate_brightness(next.brightness)?;\n','        crate::uxplay_args::validate(&next.uxplay_args)?;\n','Rust validate at save');
  src=replaceAll(src,'i.applied_brightness=None;','i.applied_brightness=None; i.applied_uxplay_args=None;',3,'Rust reset on stop/start/exit');
  src=replace(src,'let (epoch, name, fps, brightness) = {','let (epoch, name, fps, brightness, user_args) = {','Rust spawn capture');
  src=replace(src,'(i.epoch, i.settings.device_name.clone(), i.settings.fps, i.settings.brightness)','(i.epoch, i.settings.device_name.clone(), i.settings.fps, i.settings.brightness, i.settings.uxplay_args.clone())','Rust spawn setting');
  const begin = '        let mut command = Command::new(&binary);';
  const end = '        // Runtime lookup limited to the packaged GStreamer directory; no inherited global plugins.';
  if (!src.includes('let effective_args = match crate::uxplay_args::effective(')) {
    const a=src.indexOf(begin), b=src.indexOf(end);
    if (a<0 || b<=a) throw new Error('Rust command builder: expected existing native spawn block');
    src=src.slice(0,a)+`        // GUI settings always win, then expert parameters, then built-in defaults.\n        let effective_args = match crate::uxplay_args::effective(&name, fps, brightness, &user_args) {\n            Ok(args) => args,\n            Err(err) => { self.error(app, epoch, "unknown", &err); return self.snapshot(); }\n        };\n        let mut command = Command::new(&binary);\n        command.args(&effective_args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());\n`+src.slice(b);
  }
  src=replace(src,'i.applied_brightness=Some(brightness);','i.applied_brightness=Some(brightness); i.applied_uxplay_args=Some(user_args);','Rust spawn applied snapshot');
  return src;
});
patch('src/domain/state.ts', src=>{
  src=replace(src,'fps: number; brightness: number; }','fps: number; brightness: number; uxplay_args: string; }','TS Settings type');
  src=insert(src,'  applied_brightness: number | null;\n','  applied_uxplay_args: string | null;\n','TS snapshot type');
  src=replace(src,"brightness:80};","brightness:80, uxplay_args:''};",'TS Settings default');
  src=replace(src,'applied_brightness:null, process_running:', 'applied_brightness:null, applied_uxplay_args:null, process_running:','TS snapshot default');
  src=insert(src,'export function showRestartPrompt(s: Snapshot) {\n', '', 'TS restart marker');
  src=replace(src,'(s.applied_brightness !== null && s.settings.brightness !== s.applied_brightness)', '(s.applied_brightness !== null && s.settings.brightness !== s.applied_brightness) ||\n    (s.applied_uxplay_args !== null && s.settings.uxplay_args !== s.applied_uxplay_args)','TS restart condition');
  src=insert(src,'export function showRestartPrompt(s: Snapshot) {','', 'TS restart check');
  const at='export function showRestartPrompt(s: Snapshot) {';
  if (!src.includes('export function validateUxplayArgs(')) {
    const added=`export function validateUxplayArgs(value: string): string | null {\n  if (new TextEncoder().encode(value).length > 2048) return 'UxPlay 参数最多 2048 字节';\n  if (/[\\x00-\\x08\\x0b-\\x0c\\x0e-\\x1f\\x7f]/.test(value)) return 'UxPlay 参数不能包含不支持的控制字符';\n  return null;\n}\n`;
    src=src.replace(at,added+at);
  }
  return src;
});
patch('src/App.tsx', src=>{
  src=replace(src,'validateBrightness, validateFps, type Settings','validateBrightness, validateFps, validateUxplayArgs, type Settings','UI import validation');
  src=insert(src,'    const brightnessError = validateBrightness(draft.brightness);\n    if (brightnessError) { setFormError(brightnessError); return; }\n',`    const argsError = validateUxplayArgs(draft.uxplay_args);\n    if (argsError) { setFormError(argsError); return; }\n`,'UI save validation');
  const hook='            <div className="setting-row"><div><strong>关闭后驻留托盘</strong>';
  if (!src.includes('id="uxplayArgs"')) {
    const start=src.indexOf(hook);
    const end=src.indexOf('</div>\n          </section>',start);
    if (start < 0 || end < 0) throw new Error('UI config pane: missing tray switch anchor');
    const position=end+'</div>'.length;
    src=src.slice(0,position)+`\n            <div className="airpimo-expert-args">\n              <label className="form-label" htmlFor="uxplayArgs">UxPlay 自定义启动参数（高级）</label>\n              <textarea id="uxplayArgs" className="airpimo-expert-input" rows={3} value={draft.uxplay_args}\n                maxLength={2048} placeholder="例如：-vol 0.7 -vsync no" spellCheck={false} autoCapitalize="off" autoComplete="off"\n                onChange={e => setDraft(x=>({...x,uxplay_args:e.target.value}))} />\n              <p className="airpimo-expert-warning" role="note">非专业人员请勿修改。参数配置不正确可能导致投屏无法启动。保存后需重启接收服务才会生效，不会自动断开当前投屏。</p>\n              <p className="form-hint">优先级：上方设备名称、帧率与亮度设置 ＞ 此处自定义参数 ＞ 程序默认参数。可按空格或换行分隔，使用引号包裹含空格的参数；-vol 可覆盖默认音量。</p>\n            </div>`+src.slice(position);
  }
  return src;
});
patch('src/styles/airpimo-settings-tabs.css', src=>{
  if (src.includes('.airpimo-expert-args {')) return src;
  return src+`\n/* Expert receiver parameters: readable and keyboard-friendly in both themes. */\n.airpimo-expert-args { margin-top: 14px; padding-top: 12px; border-top: 1px solid hsl(var(--border)); min-width: 0; }\n.airpimo-expert-input { box-sizing: border-box; display: block; width: 100%; resize: vertical; min-height: 66px; margin-top: 7px; padding: 9px 10px; border: 1px solid hsl(var(--input)); border-radius: 7px; background: hsl(var(--background)); color: hsl(var(--foreground)); font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; outline-offset: 2px; }\n.airpimo-expert-input:focus-visible { outline: 2px solid hsl(var(--ring)); }\n.airpimo-expert-warning { margin: 8px 0 5px; color: hsl(var(--destructive)); font-size: 11px; line-height: 1.6; }\n`;
});
// Existing structural tests must follow the new single argv-composition boundary.
patch('scripts/source-check.mjs', src=>replace(src,
  'assert.match(rust,/command\\.args\\(\\["-n", &name, "-d", "1"\\]\\)/);',
  'assert.match(rust,/command\\.args\\(&effective_args\\)/);', 'Source guard effective argv'));
patch('tests/receiver-stream-regression.test.mjs', src=>replace(src,
  'assert.match(receiver, /command\\.args\\(\\["-n", &name, "-d", "1"\\]\\)\\.stdin\\(Stdio::null\\(\\)\\)\\.stdout\\(Stdio::piped\\(\\)\\)\\.stderr\\(Stdio::piped\\(\\)\\)/);',
  'assert.match(receiver, /command\\.args\\(&effective_args\\)\\.stdin\\(Stdio::null\\(\\)\\)\\.stdout\\(Stdio::piped\\(\\)\\)\\.stderr\\(Stdio::piped\\(\\)\\)/);','Stream guard effective argv'));
patch('tests/native-engine-integration.test.mjs', src=>{
  src=replace(src,'assert.match(fs,/#\\[cfg\\(target_os = "macos"\\)\\]\\s*command\\.args\\(\\["-avdec", "-vsync", "no"\\]\\)/);',
    `const args = readFileSync(new URL('../src-tauri/src/uxplay_args.rs',import.meta.url),'utf8');\n  assert.match(args,/cfg\\(target_os = "macos"\\)/);\n  assert.match(args,/push_default\\(&mut args, &custom, "-vsync", Some\\("no"\\)\\)/);`,'mac test');
  src=replace(src,'assert.match(fs,/command\\.args\\(\\["-fps", fps_arg\\.as_str\\(\\), "-vol", "0\\.5"\\]\\)/);',
    `const args = readFileSync(new URL('../src-tauri/src/uxplay_args.rs',import.meta.url),'utf8');\n  assert.match(args,/push_default\\(&mut args, &custom, "-vol", Some\\("0\\.5"\\)\\)/);\n  assert.match(args,/"-fps"\\.into\\(\\), fps\\.to_string\\(\\)/);`,'FPS test');
  src=replaceAll(src,'assert.match(fs,/#\\[cfg\\(windows\\)\\]\\s*command\\.arg\\("-avdec"\\)/);',
    'assert.match(args,/cfg\\(any\\(windows, target_os = "macos"\\)\\)/);',1,'Win decoder test');
  src=replace(src,'assert.match(receiver,/if brightness < 100/);',
    `const args = readFileSync(new URL('../src-tauri/src/uxplay_args.rs', import.meta.url),'utf8');\n  assert.match(args,/if brightness < 100/);`,'brightness test');
  src=replace(src,'assert.match(receiver,/let converter = format!\\("videoconvert ! videobalance brightness=\\{balance\\}"\\)/);',
    'assert.match(args,/videoconvert ! videobalance brightness=/);','brightness pipeline test');
  src=replace(src,'assert.match(receiver,/command\\.args\\(\\["-vc", converter\\.as_str\\(\\)\\]\\)/);',
    'assert.match(args,/args\\.push\\("-vc"\\.into\\(\\)\\)/);','brightness vc test');
  src=replace(src,'assert.match(receiver,/#\\[cfg\\(windows\\)\\]\\s*command\\.arg\\("-avdec"\\)/);',
    'assert.match(args,/cfg\\(any\\(windows, target_os = "macos"\\)\\)/);','brightness Win decode test');
  return src;
});
// v25's historical ZIP checksum is not valid after a deliberate CSS extension.
// Preserve its negative safety test while moving current idempotence to v28.
patch('tests/airpimo-v25-patch.test.mjs', src=>{
  src=replace(src,"import {tmpdir} from 'node:os';", "import {tmpdir} from 'node:os';\nimport {spawnSync} from 'node:child_process';", 'v25 test import');
  src=replace(src,
    "  assert.equal(plan(root).size,0);\n  assert.deepEqual(apply(root),[]);",
    "  const installed = readFileSync(join(root,'src/App.tsx'),'utf8');\n  assert.match(installed,/airpimo-panel-updates/);\n  assert.match(installed,/id=\"uxplayArgs\"/);\n  const done=spawnSync(process.execPath,['scripts/ci/apply-airpimo-uxplay-args.mjs','--check'],{cwd:root,encoding:'utf8'});\n  assert.equal(done.status,0,done.stderr);", 'v25 updated idempotence');
  src=insert(src,"    const app=join(tmp,'src/App.tsx');\n",
    "    const css=join(tmp,'src/styles/airpimo-settings-tabs.css');\n    const text=readFileSync(css,'utf8');\n    const expert=text.indexOf('\\n/* Expert receiver parameters:');\n    if(expert>=0)writeFileSync(css,text.slice(0,expert));\n", 'v25 unknown app fixture');
  return src;
});
// Fail closed before touching original sources. Partial source states are never overwritten.
for (const [name,{next}] of updates) {
  if (next.length < 100) throw new Error(`Patch validation failed: ${name}`);
}
if (check) {
  for (const [name,{old,next}] of updates) if (old !== next) throw new Error(`${name}: 尚未应用补丁`);
  const rustModule=join(project,'src-tauri/src/uxplay_args.rs');
  if (!existsSync(rustModule)) throw new Error('Missing src-tauri/src/uxplay_args.rs');
  console.log('[airpimo-uxplay-args] PASS: patch and native module installed');
} else {
  // Changes were preflighted as a whole. Roll back in-memory if a write fails;
  // do not leave persistent .airpimo-*-backup folders in the working tree.
  const written=[];
  try {
    for (const [name,{old,next}] of updates) {
      if (old === next) continue;
      writeFileSync(join(project,name),next);
      written.push(name);
      console.log(`[airpimo-uxplay-args] Updated ${name}`);
    }
  } catch (error) {
    for (const name of written.reverse()) {
      try { writeFileSync(join(project,name),updates.get(name).old); } catch { /* restored by Git if needed */ }
    }
    throw error;
  }
  console.log('[airpimo-uxplay-args] APPLIED: run --check and tests before building');
}
