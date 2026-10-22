import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

test("update notice requires confirmed release and opens official page on user request", () => {
  const app = src("src/App.tsx"), view = src("src/components/AirpimoSettingsDialog.tsx");
  assert.match(app, /if \(result\.kind === 'available'\)/);
  assert.match(app, /await desktop\.openReleasePage\(updateResult\.pageUrl\)/);
  assert.match(view, /<AirpimoUpdateNotice|function AirpimoUpdateNotice/);
  assert.match(view, /releaseOpening/);
  assert.match(view, /点击「下载」/);
});

test("settings preserve tab access, save/cancel, diagnostics actions and privacy", () => {
  const view = src("src/components/AirpimoSettingsDialog.tsx");
  for (const word of ["配置", "主题", "升级", "诊断", "保存设置", "取消", "刷新", "导出日志", "只记录脱敏状态", "关闭后驻留托盘"]) {
    assert.ok(view.includes(word), word);
  }
  assert.match(view, /aria-selected=\{settingsTab === value\}/);
  assert.match(view, /disabled=\{actionBusy\}/);
  assert.match(view, /role="tabpanel"/);
  assert.match(view, /aria-label="诊断日志"/);
});
