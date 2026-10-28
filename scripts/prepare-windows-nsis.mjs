#!/usr/bin/env node
// A tightly pinned customization of Tauri 2.11.1's official NSIS template.
// The template is cached after the first Windows build. Use the offline source
// override for air-gapped CI; fail if upstream layout changes unexpectedly.
import {readFileSync, writeFileSync, existsSync, mkdirSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import https from 'node:https';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export const UPSTREAM = 'https://raw.githubusercontent.com/tauri-apps/tauri/tauri-v2.11.1/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi';
export const TARGET = resolve(import.meta.dirname, '../src-tauri/windows/airpimo-installer.nsi');
export const SIGNATURE = '; AIRPIMO_CUSTOM_TAURI_2_11_1_INSTALLER_V10';
function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if(count !== 1) throw Error(`Pinned Tauri NSIS template drift: ${label} (${count} matches)`);
  return source.replace(before, after);
}
export function customizeNsis(upstream) {
  if(upstream.length < 25000 || !upstream.includes('!include "utils.nsh"') ||
    !upstream.includes('!insertmacro CheckIfAppIsRunning')) throw Error('Not the expected Tauri 2.11.1 NSIS source');
  // Normalize upstream line endings before anchored, fail-closed replacements.
  let s = upstream.replace(/\r\n/g, '\n');
  // Tauri's maintenance page is registry-driven, even after manual removal.
  // When only its stale registration remains (no files at the recorded path),
  // skip the maintenance page and perform a normal installation. Never delete
  // registration data blindly or bypass a still-existing uninstaller.
  s = replaceOnce(s,
`  ; Compare this installar version with the existing installation`,
`  ; A registry-only install cannot run its missing uninstaller.
  \${If} $WixMode <> 1
    ReadRegStr $R8 SHCTX "\${MANUPRODUCTKEY}" ""
    \${If} $R8 != ""
    \${AndIfNot} \${FileExists} "$R8\\uninstall.exe"
    \${AndIfNot} \${FileExists} "$R8\\\${MAINBINARYNAME}.exe"
    \${AndIfNot} \${FileExists} "$R8\\*.*"
      DetailPrint "Airpimo: previous install record exists, but directory is empty; continuing with a fresh install."
      Abort
    \${EndIf}
  \${EndIf}
  ; Compare this installar version with the existing installation`, 'stale-registration bypass');
  s = replaceOnce(s,
`  ; Reinstalling the same version
  \${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(addOrReinstall)"
    StrCpy $R3 "$(uninstallApp)"`,
`  ; Same version: only offer uninstall-before-reinstall.
  \${If} $R0 = 0
    StrCpy $R1 "$(alreadyInstalledLong)"
    StrCpy $R2 "$(uninstallBeforeInstalling)"
    StrCpy $R3 ""`, 'same-version labels');
  s = replaceOnce(s,
`  \${If} $R0 = 0 ; Same version, proceed
    \${If} $R1 = 1              ; User chose to add/reinstall
      Goto reinst_done
    \${Else}                    ; User chose to uninstall
      Goto reinst_uninstall
    \${EndIf}`, 
`  \${If} $R0 = 0 ; Same version: always uninstall before reinstall
    Goto reinst_uninstall`, 'same-version action');
  // Only same-version installs hide the in-place reinstall radio option.
  // Upgrade/downgrade retain the second choice and its original safety gates.
  s = replaceOnce(s,
`    \${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
    Pop $R3
    ; Disable this radio button if downgrading and downgrades are disabled
    !if "\${ALLOWDOWNGRADES}" == "false"
      \${IfThen} $R0 = -1 \${|} EnableWindow $R3 0 \${|}
    !endif
    \${NSD_OnClick} $R3 PageReinstallUpdateSelection`,
`    \${If} $R0 <> 0
      \${NSD_CreateRadioButton} 30u 70u -30u 8u $R3
      Pop $R3
      ; Disable this radio button if downgrading and downgrades are disabled
      !if "\${ALLOWDOWNGRADES}" == "false"
        \${IfThen} $R0 = -1 \${|} EnableWindow $R3 0 \${|}
      !endif
      \${NSD_OnClick} $R3 PageReinstallUpdateSelection
    \${EndIf}`, 'maintenance second option');
  s = replaceOnce(s,
`    \${If} $ReinstallPageCheck <> 2
      SendMessage $R2 \${BM_SETCHECK} \${BST_CHECKED} 0
    \${Else}
      SendMessage $R3 \${BM_SETCHECK} \${BST_CHECKED} 0
    \${EndIf}`,
`    ; Force clean reinstall for same version, including when navigating Back.
    \${If} $R0 = 0
      SendMessage $R2 \${BM_SETCHECK} \${BST_CHECKED} 0
    \${ElseIf} $ReinstallPageCheck <> 2
      SendMessage $R2 \${BM_SETCHECK} \${BST_CHECKED} 0
    \${Else}
      SendMessage $R3 \${BM_SETCHECK} \${BST_CHECKED} 0
    \${EndIf}`, 'maintenance default selection');
  // Tauri emits MUI_LANGUAGE and its own language files here. Declare our
  // hook messages AFTER MUI_LANGUAGE, not in the early-included hooks file.
  // The locked template must contain the precise anchor or packaging fails.
  s = replaceOnce(s,
`{{#each language_files}}
  !include "{{this}}"
{{/each}}`,
`{{#each language_files}}
  !include "{{this}}"
{{/each}}
; Airpimo custom installer/uninstaller messages (both architectures).
LangString airpimoCleanupCreateError \${LANG_ENGLISH} "Airpimo cannot create the installer cleanup helper."
LangString airpimoCleanupCreateError \${LANG_SIMPCHINESE} "无法创建 Airpimo 安装程序的清理辅助脚本。"
LangString airpimoCleanupCreateError \${LANG_TRADCHINESE} "無法建立 Airpimo 安裝程式的清理輔助腳本。"
LangString airpimoCleanupCreateError \${LANG_JAPANESE} "Airpimo インストーラーのクリーンアップ補助スクリプトを作成できません。"
LangString airpimoCleanupCreateError \${LANG_KOREAN} "Airpimo 설치 프로그램의 정리 스크립트를 만들 수 없습니다."
LangString airpimoCleanupWriteError \${LANG_ENGLISH} "Airpimo cannot write the installer cleanup helper."
LangString airpimoCleanupWriteError \${LANG_SIMPCHINESE} "无法写入 Airpimo 安装程序的清理辅助脚本。"
LangString airpimoCleanupWriteError \${LANG_TRADCHINESE} "無法寫入 Airpimo 安裝程式的清理輔助腳本。"
LangString airpimoCleanupWriteError \${LANG_JAPANESE} "Airpimo インストーラーのクリーンアップ補助スクリプトを書き込めません。"
LangString airpimoCleanupWriteError \${LANG_KOREAN} "Airpimo 설치 프로그램의 정리 스크립트를 기록할 수 없습니다."
LangString airpimoCleanupLocationError \${LANG_ENGLISH} "Airpimo could not verify the install location. Close the installer."
LangString airpimoCleanupLocationError \${LANG_SIMPCHINESE} "无法验证 Airpimo 的安装位置，请关闭安装程序。"
LangString airpimoCleanupLocationError \${LANG_TRADCHINESE} "無法確認 Airpimo 安裝位置。請關閉安裝程式。"
LangString airpimoCleanupLocationError \${LANG_JAPANESE} "Airpimo のインストール先を確認できません。インストーラーを終了してください。"
LangString airpimoCleanupLocationError \${LANG_KOREAN} "Airpimo 설치 위치를 확인할 수 없습니다. 설치 프로그램을 종료하세요."
LangString airpimoCleanupProcessError \${LANG_ENGLISH} "Unable to stop Airpimo processes in $INSTDIR. Close Airpimo and Airpimo Player and retry."
LangString airpimoCleanupProcessError \${LANG_SIMPCHINESE} "无法停止 $INSTDIR 中的 Airpimo 进程。请关闭 Airpimo 和 Airpimo Player 后重试。"
LangString airpimoCleanupProcessError \${LANG_TRADCHINESE} "無法停止 $INSTDIR 中的 Airpimo 處理程序。請關閉 Airpimo 和 Airpimo Player 後重試。"
LangString airpimoCleanupProcessError \${LANG_JAPANESE} "$INSTDIR の Airpimo プロセスを停止できません。Airpimo と Airpimo Player を終了してから再試行してください。"
LangString airpimoCleanupProcessError \${LANG_KOREAN} "$INSTDIR의 Airpimo 프로세스를 종료할 수 없습니다. Airpimo 및 Airpimo Player를 닫고 다시 시도하세요."
LangString airpimoPreparingUninstall \${LANG_ENGLISH} "Stopping Airpimo and preparing the previous version for removal..."
LangString airpimoPreparingUninstall \${LANG_SIMPCHINESE} "正在关闭 Airpimo 并准备卸载旧版本，请稍候…"
LangString airpimoPreparingUninstall \${LANG_TRADCHINESE} "正在關閉 Airpimo 並準備移除舊版本，請稍候…"
LangString airpimoPreparingUninstall \${LANG_JAPANESE} "Airpimo を終了し、旧バージョンのアンインストールを準備しています…"
LangString airpimoPreparingUninstall \${LANG_KOREAN} "Airpimo를 종료하고 이전 버전 제거를 준비하는 중입니다…"
`,
    'localized cleanup messages');
  // Tauri's first radio is checked by default; on upgrade it already means
  // uninstall-before-install. The above aligns same-version repairs with it.
  s = replaceOnce(s,
`  reinst_uninstall:
    HideWindow`,
`  reinst_uninstall:
    ; A synchronous PowerShell/WMI check is slow on Win7 and formerly froze
    ; the maintenance page after Next was clicked. Show NSIS' built-in banner
    ; BEFORE the check, then remove it before the old uninstaller opens.
    \${If} $PassiveMode != 1
      Banner::show "$(airpimoPreparingUninstall)"
      StrCpy $AirpimoPreparationBanner 1
    \${EndIf}
    ; This is BEFORE running an older uninstaller without our safety hooks.
    !insertmacro AIRPIMO_STOP_INSTALLED_PROCESSES
    \${If} $PassiveMode != 1
      !insertmacro AIRPIMO_DISMISS_PREPARATION_BANNER
    \${EndIf}
    HideWindow`, 'old-uninstaller cleanup');
  // Preserve Tauri 2.11.1 finish-page and silent /R launch behavior unchanged.
  // Validate both code paths to guard against upstream template drift.
  const unique = (pattern, label) => {
    const found = [...s.matchAll(pattern)];
    if (found.length !== 1) {
      throw Error(`Pinned Tauri NSIS template drift: finish-page auto-launch removal (${label}=${found.length}; expected 1)`);
    }
    return found[0];
  };
  const runOption = unique(/^[ \t]*!define[ \t]+MUI_FINISHPAGE_RUN[ \t]*(?:;[^\n]*)?$/gm, 'run option');
  const runCallback = unique(/^[ \t]*!define[ \t]+MUI_FINISHPAGE_RUN_FUNCTION[ \t]+RunMainBinary[ \t]*(?:;[^\n]*)?$/gm, 'run callback');
  const finishPage = unique(/^[ \t]*!insertmacro[ \t]+MUI_PAGE_FINISH[ \t]*(?:;[^\n]*)?$/gm, 'finish page');
  const shortcutCallback = unique(/^[ \t]*!define[ \t]+MUI_FINISHPAGE_SHOWREADME_FUNCTION[ \t]+CreateOrUpdateDesktopShortcut[ \t]*(?:;[^\n]*)?$/gm, 'shortcut callback');
  const runHandler = unique(/^[ \t]*Function[ \t]+RunMainBinary[ \t]*(?:;[^\n]*)?\n([\s\S]*?)^[ \t]*FunctionEnd[ \t]*(?:;[^\n]*)?$/gm, 'run handler');
  const uninstallPages = unique(/^[ \t]*; Uninstaller Pages[ \t]*$/gm, 'uninstaller boundary');
  // Tauri 2.11.1 has a SECOND launch path: .onInstSuccess handles /R for
  // silent/passive installations. Removing the finish-page checkbox alone
  // leaves RunAsUser in the template, which correctly trips the drift guard.
  // Validate the entire callback before removing it; do not silently remove
  // any new upstream post-install behavior if Tauri changes in the future.
  const onInstSuccess = unique(/^[ \t]*Function[ \t]+\.onInstSuccess[ \t]*(?:;[^\n]*)?\n([\s\S]*?)^[ \t]*FunctionEnd[ \t]*(?:;[^\n]*)?$/gm, 'silent/passive run handler');
  if (!(shortcutCallback.index < runOption.index &&
        runOption.index < runCallback.index &&
        runCallback.index < finishPage.index &&
        finishPage.index < runHandler.index &&
        runHandler.index < uninstallPages.index &&
        uninstallPages.index < onInstSuccess.index)) {
    throw Error('Pinned Tauri NSIS template drift: auto-launch removal (invalid page/function order)');
  }
  const strippedSuccess = onInstSuccess[1].split('\n').map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith(';'));
  const expectedSuccess = [
    '${If} $PassiveMode = 1',
    '${OrIf} ${Silent}',
    '${GetOptions} $CMDLINE "/R" $R0',
    '${IfNot} ${Errors}',
    '${GetOptions} $CMDLINE "/ARGS" $R0',
    'nsis_tauri_utils::RunAsUser "$INSTDIR\\${MAINBINARYNAME}.exe" "$R0"',
    '${EndIf}',
    '${EndIf}'
  ];
  if (JSON.stringify(strippedSuccess) !== JSON.stringify(expectedSuccess)) {
    throw Error('Pinned Tauri NSIS template drift: auto-launch removal (unexpected .onInstSuccess body)');
  }
  const handlerLines = runHandler[1].split('\n').map(line => line.trim()).filter(Boolean);
  if (handlerLines.length !== 1 ||
      !/^nsis_tauri_utils::RunAsUser[ \t]+"\$INSTDIR\\\$\{MAINBINARYNAME\}\.exe"[ \t]+""(?:[ \t]*;[^\n]*)?$/.test(handlerLines[0])) {
    throw Error('Pinned Tauri NSIS template drift: finish-page auto-launch removal (unexpected RunMainBinary body)');
  }
  // Leave the verified RunMainBinary and .onInstSuccess functions intact.
  // No Win7-specific launch handling or error popups.
  return SIGNATURE + '\n; Derived from tauri-v2.11.1, preserving original handlebars placeholders.\n' + s;
}
function download(url, redirect = 0) {
  if (redirect > 2) return Promise.reject(Error('Too many NSIS template redirects'));
  return new Promise((res,rej) => {
    const request=https.get(url,{timeout:25000,headers:{'User-Agent':'Airpimo-nsis-source/1'}},r=>{
      if(r.statusCode===301||r.statusCode===302){const next=new URL(r.headers.location,url);r.resume();return next.protocol==='https:'?res(download(next.href,redirect+1)):rej(Error('Insecure NSIS template redirect'));}
      if(r.statusCode!==200){r.resume();return rej(Error(`Pinned NSIS source HTTP ${r.statusCode}`));}
      const chunks=[];let length=0;r.on('data',b=>{length+=b.length;if(length>300000){r.destroy(Error('NSIS template too large'));return;}chunks.push(b)});
      r.on('end',()=>res(Buffer.concat(chunks).toString('utf8')));r.on('error',rej);
    }); request.on('timeout',()=>request.destroy(Error('NSIS template request timed out')));request.on('error',rej);
  });
}
export async function prepareWindowsNsis({platform=process.platform,target=TARGET,sourcePath=process.env.AIRPIMO_TAURI_NSIS_TEMPLATE_SOURCE}={}) {
  if(platform!=='win32') return false;
  if(existsSync(target) && readFileSync(target,'utf8').startsWith(SIGNATURE)) {
    const cached = readFileSync(target,'utf8');
    if (!cached.includes('AIRPIMO_STOP_INSTALLED_PROCESSES') || !cached.includes('!insertmacro MUI_PAGE_FINISH') || !cached.includes('!define MUI_FINISHPAGE_RUN') || !cached.includes('Function RunMainBinary') || !cached.includes('Function .onInstSuccess') || !cached.includes('Same version: always uninstall before reinstall') || !cached.includes('\${If} $R0 <> 0')) throw Error('Generated NSIS template is incomplete');
    return false;
  }
  const source=sourcePath?readFileSync(sourcePath,'utf8'):await download(UPSTREAM);
  if (/^; AIRPIMO_CUSTOM_TAURI_2_11_1_INSTALLER_V\d+/m.test(source)) {
    throw Error('NSIS template source is already customized; AIRPIMO_TAURI_NSIS_TEMPLATE_SOURCE must point to the original pinned Tauri installer.nsi');
  }
  const digest=createHash('sha256').update(source).digest('hex');
  console.log(`[nsis] Template input: ${sourcePath ?? UPSTREAM}; SHA-256=${digest}`);
  let generated;
  try { generated=customizeNsis(source); }
  catch (error) { throw Error(`${error.message}; source SHA-256=${digest}; ${sourcePath ? `offline source=${sourcePath}` : 'pinned upstream source'}`); }
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,generated);
  console.log(`[nsis] Tauri 2.11.1 template prepared: ${target}`);
  return true;
}
if(import.meta.url===pathToFileURL(process.argv[1]??'').href) {
  prepareWindowsNsis().catch(e=>{console.error(`[nsis] BLOCKED: ${e.message}`);process.exitCode=2;});
}
