#!/usr/bin/env node
/** v26 brand-finalization: guarded in-place transformation of the user's latest tree.
 * --check is read-only. --apply first validates all anchors, then backs up edited files.
 * Does not overwrite Rust/GStreamer source trees, local settings or installed runtime.
 */
import {readFileSync,writeFileSync,existsSync,mkdirSync,unlinkSync,readdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../..',import.meta.url));
const release='rfw/Airpimo';
const START='<link rel="stylesheet" href="/startup.css"/>';
const SPLASH='<div id="airpimo-startup" role="status" aria-live="polite"><span class="airpimo-loading-wheel" aria-hidden="true"></span><strong>Airpimo</strong><span>启动中…</span></div>';
const CLEANUP_RE=/^(?:AIRPIMO-(?:BRAND-RENAME|CI-ARTIFACT-ASSERTIONS|DESKTOP-UI-REDESIGN|SETTINGS-UPDATES|STARTUP-TRAY-DEV-RUNTIME)-v\d+|AIRPIMO-V\d+-TEST-AND-JSX-REGRESSION)\.md$/i;
function insist(condition,reason){if(!condition) throw Error(reason);}
function once(s,from,to,label){
  if(s.includes(to))return s;
  const n=s.split(from).length-1;
  insist(n===1, `${label}: expected exactly one source anchor, found ${n}; STOP (please provide latest sources)`);
  return s.replace(from,to);
}
function update(rootDir=root){
  const map=new Map();
  function edit(path,fn){const f=join(rootDir,path);insist(existsSync(f),`Required source missing: ${path}`);
    const before=readFileSync(f,'utf8');const after=fn(before);if(after!==before)map.set(path,{before,after});}
  edit('src/App.tsx',s=>{
    s=once(s,
`          <div className="modal-actions airpimo-settings-actions">
            {settingsTab === 'config' || settingsTab === 'theme' ? <><Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button><Button type="submit" disabled={actionBusy}>保存设置</Button></> : <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>关闭</Button>}
          </div>`,
`          {(settingsTab === 'config' || settingsTab === 'theme') && <div className="modal-actions airpimo-settings-actions">
            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button><Button type="submit" disabled={actionBusy}>保存设置</Button>
          </div>}`,
      'Settings footer close button');
    s=once(s,
`  const [bootError, setBootError] = useState('');`,
`  const [bootError, setBootError] = useState('');

  // Keep the static boot screen until backend snapshot/error initialization completes.
  useEffect(() => {
    if (ready) document.getElementById('airpimo-startup')?.remove();
  }, [ready]);`,
      'Boot splash lifecycle');
    return s;
  });
  edit('src/styles/airpimo-settings-tabs.css',s=>{
    s=once(s,'overscroll-behavior: contain; padding-top: 8px;','overscroll-behavior: contain; padding: 12px 12px 16px; scroll-padding: 12px;','Scrollable tab padding');
    s=once(s,'.airpimo-settings-body > [role="tabpanel"] { min-width: 0; }','.airpimo-settings-body > [role="tabpanel"] { min-width: 0; padding: 3px 3px 7px; }','Panel focus outline inset');
    return s;
  });
  edit('index.html',s=>{
    s=once(s,'<head><script src="/theme-bootstrap.js"></script>',`<head><script src="/theme-bootstrap.js"></script>${START}`,'Pre-React loading stylesheet');
    s=once(s,'<body><div id="root"></div>',`<body>${SPLASH}<div id="root"></div>`,'Boot splash element');
    return s;
  });
  edit('vite.config.ts',s=>{
    const from='define: { __AIRPIMO_RELEASE_REPO__: JSON.stringify(getReleaseRepository()) },';
    const to=`define: { __AIRPIMO_RELEASE_REPO__: JSON.stringify('${release}') },`;
    s=once(s,from,to,'Pinned release repository');
    // Eliminate obsolete process.env / git origin discovery once release repo is pinned.
    const helper=/import \{ execFileSync \} from 'node:child_process';\n\nfunction getReleaseRepository\(\): string \{[\s\S]*?\n\}\n\n/;
    if(helper.test(s))s=s.replace(helper,'');
    insist(s.includes(to),'Missing pinned release repository');
    return s;
  });
  edit('src-tauri/src/lib.rs',s=>{
    const from='valid_component(parts[0]) && valid_component(parts[1]) &&';
    const to='parts[0] == "rfw" && parts[1] == "Airpimo" &&';
    s=once(s,from,to,'Restrict native release launcher to rfw/Airpimo');
    const unused='    let valid_component = |s:&str| !s.is_empty() && s != "." && s != ".." &&\n        s.bytes().all(|ch| ch.is_ascii_alphanumeric() || ch == b\'-\' || ch == b\'_\' || ch == b\'.\');\n';
    // Keep Rust free of the now-unused generic GitHub owner/repo validator.
    const generic=/    let valid_component = \|s:&str\| !s.is_empty\(\) && s != "\." && s != "\.\." &&\n        s.bytes\(\).all\(\|ch\| ch.is_ascii_alphanumeric\(\) \|\| ch == b'-' \|\| ch == b'_' \|\| ch == b'\.'\);\n/;
    s=s.replace(generic,'');
    return s;
  });
  edit('package.json',s=>{
    const p=JSON.parse(s);
    insist(p.name==='airpimo','Unexpected npm package name');
    p.license='GPL-3.0-or-later';
    p.repository={type:'git',url:'git+https://github.com/rfw/Airpimo.git'};
    return JSON.stringify(p,null,2)+'\n';
  });
  edit('package-lock.json',s=>{
    const p=JSON.parse(s);
    insist(p.name==='airpimo'&&p.packages?.['']?.name==='airpimo','Unexpected npm lock root');
    return JSON.stringify(p,null,2)+'\n';
  });
  edit('src-tauri/tauri.conf.json',s=>{
    const config=JSON.parse(s);
    insist(config.productName==='Airpimo'&&config.identifier==='com.airpimo.desktop','Unexpected product id');
    return JSON.stringify(config,null,2)+'\n';
  });
  edit('src-tauri/Cargo.toml',s=>{
    insist(/^name = "airpimo"$/m.test(s),'Unexpected Rust package name');
    if(!/^license = "GPL-3\.0-or-later"$/m.test(s))
      s=once(s,'description = "Airpimo desktop AirPlay receiver"',
        'description = "Airpimo desktop AirPlay receiver"\nlicense = "GPL-3.0-or-later"\nrepository = "https://github.com/rfw/Airpimo"',
        'Rust license and repository');
    return s;
  });
  // Keep only active README, AGENTS and essential native/license documentation;
  // remove only known versioned migration notes and disposable lock backup.
  edit('.gitignore',s=>s.includes('.airpimo-v26-backup/') ? s : s.trimEnd()+'\n.airpimo-v26-backup/\n');
  edit('README.md',s=>{
    const line='> 官方仓库：<https://github.com/rfw/Airpimo>。当前社区版自有代码采用 **GPL-3.0-or-later（GPLv3）**，完整条款见 [LICENSE](LICENSE)。UxPlay 等第三方组件保持其原始许可，详见 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)。\n\n';
    if(!s.includes(line)){
      const first=s.match(/^#[^\n]*\n/);
      insist(Boolean(first),'README missing heading');
      s=s.replace(first[0],first[0]+'\n'+line);
    }
    return s;
  });
  // v25 uses a guarded historical install manifest and hash-locked CSS asset.
  // Refresh its expectations to the new compatible state (not disable its checks).
  const manifest='scripts/ci/airpimo-v25-edits.json';
  const f=join(rootDir,manifest);
  if(existsSync(f)){
    edit(manifest,s=>{
      const m=JSON.parse(s);
      for(const e of m.edits){
        if(e.path==='src/App.tsx'){
          // The v25 script owns a few long App after hunks. Update only the
          // declaration+footer spans if included in any of those hunks.
          for(const h of e.hunks){
            if(h.after.includes("  const [bootError, setBootError] = useState('');")){
              h.after=h.after.replace("  const [bootError, setBootError] = useState('');", "  const [bootError, setBootError] = useState('');\n\n  // Keep the static boot screen until backend snapshot/error initialization completes.\n  useEffect(() => {\n    if (ready) document.getElementById('airpimo-startup')?.remove();\n  }, [ready]);");
            }
            h.after=h.after.replace('          <div className="modal-actions airpimo-settings-actions">\n            {settingsTab === \'config\' || settingsTab === \'theme\' ? <><Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button><Button type="submit" disabled={actionBusy}>保存设置</Button></> : <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>关闭</Button>}\n          </div>',
              '          {(settingsTab === \'config\' || settingsTab === \'theme\') && <div className="modal-actions airpimo-settings-actions">\n            <Button type="button" variant="outline" onClick={() => setSettingsOpen(false)}>取消</Button><Button type="submit" disabled={actionBusy}>保存设置</Button>\n          </div>}');
          }
        }
        if(e.path==='vite.config.ts'){
          for(const h of e.hunks){h.after=h.after.replace(/import \{ execFileSync \} from 'node:child_process';\n\nfunction getReleaseRepository\(\): string \{[\s\S]*?\n\}\n\n/, '');h.after=h.after.replace('JSON.stringify(getReleaseRepository())',"JSON.stringify('rfw/Airpimo')");}
        }
        if(e.path==='src-tauri/src/lib.rs'){
          for(const h of e.hunks){h.after=h.after.replace('valid_component(parts[0]) && valid_component(parts[1]) &&','parts[0] == "rfw" && parts[1] == "Airpimo" &&');h.after=h.after.replace(/    let valid_component = \|s:&str\| !s.is_empty\(\) && s != "\." && s != "\.\." &&\n        s.bytes\(\).all\(\|ch\| ch.is_ascii_alphanumeric\(\) \|\| ch == b'-' \|\| ch == b'_' \|\| ch == b'\.'\);\n/, '');}
        }
      }
      const cssChange=map.get('src/styles/airpimo-settings-tabs.css');
      if(cssChange){const asset=m.assets.find(a=>a.path==='src/styles/airpimo-settings-tabs.css');if(asset) asset.sha256=createHash('sha256').update(cssChange.after).digest('hex');}
      return JSON.stringify(m,null,1)+'\n';
    });
  }
  return {map,deletePaths:readdirSync(rootDir).filter(name=>CLEANUP_RE.test(name)&&existsSync(join(rootDir,name))).concat(existsSync(join(rootDir,'src-tauri/Cargo.lock.bak'))?['src-tauri/Cargo.lock.bak']:[])};
}
export function apply(rootDir=root,write=false){
  const {map,deletePaths}=update(rootDir);
  for(const f of ['LICENSE','THIRD_PARTY_NOTICES.txt','public/startup.css'])insist(existsSync(join(rootDir,f)),`ZIP missing ${f}`);
  const pending=[...map.keys(),...deletePaths.map(p=>'DELETE '+p)];
  if(write){
    for(const [path,{before}] of map){const dest=join(rootDir,'.airpimo-v26-backup',path);mkdirSync(dirname(dest),{recursive:true});if(!existsSync(dest))writeFileSync(dest,before);}
    for(const p of deletePaths){const file=join(rootDir,p);const backup=join(rootDir,'.airpimo-v26-backup',p);mkdirSync(dirname(backup),{recursive:true});if(!existsSync(backup))writeFileSync(backup,readFileSync(file));}
    for(const [path,{after}] of map)writeFileSync(join(rootDir,path),after);
    for(const path of deletePaths)unlinkSync(join(rootDir,path));
  }
  return pending;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const flag=process.argv[2]??'--check';insist(['--apply','--check'].includes(flag),'Usage: --apply | --check');
    const pending=apply(root,flag==='--apply');
    for(const p of pending)console.log(`[airpimo-v26] ${flag==='--apply'?'UPDATED':'PENDING'} ${p}`);
    if(flag==='--check'&&pending.length)throw Error(`${pending.length} changes still pending`);
    console.log(`[airpimo-v26] PASS (${pending.length} changes)`);
  }catch(e){console.error(`[airpimo-v26] BLOCKED: ${e.message}`);process.exitCode=2;}
}
