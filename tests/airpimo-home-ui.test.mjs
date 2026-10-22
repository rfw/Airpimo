import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

test("platform titlebar and receiver actions remain wired to real desktop backend", () => {
  const app = src("src/App.tsx");
  const home = src("src/components/AirpimoHome.tsx");
  const config = JSON.parse(src("src-tauri/tauri.conf.json"));
  assert.equal(config.app.windows[0].maximizable, false);
  assert.equal(config.app.windows[0].titleBarStyle, "Overlay");
  assert.match(home, /isMacOS\(\)/);
  assert.match(home, /data-tauri-drag-region/);
  assert.match(home, /onPrimaryAction/);
  for (const operation of ["start", "stop", "retry"]) {
    assert.ok(app.includes(`execute(desktop.${operation})`));
  }
});

test("device identity and clipboard semantics are preserved", () => {
  const home = src("src/components/AirpimoHome.tsx");
  assert.match(home, /snapshot\.applied_device_name/);
  assert.match(home, /@Airpimo\$\//);
  assert.match(home, /onCopy\(name\)/);
  assert.match(home, /aria-label="复制投屏设备名称"/);
});

test("footer remains a single source of receiver feedback and settings entry", () => {
  const home = src("src/components/AirpimoHome.tsx");
  const app = src("src/App.tsx");
  const status = src("src/domain/home-status.ts");
  assert.match(home, /aria-live=/);
  assert.match(home, /statusLabel/);
  assert.match(home, /onClearFeedback/);
  assert.match(home, /aria-label="打开设置"/);
  assert.match(home, /brand.version/);
  assert.match(status, /discovery_verified/);
  assert.match(app, /<AirpimoSettingsDialog/);
});
