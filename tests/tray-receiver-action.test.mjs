import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (name) =>
  readFileSync(resolve(import.meta.dirname, "..", name), "utf8");

test("native tray provides exactly one receiver action, plus Show and Quit", () => {
  const rust = source("src-tauri/src/lib.rs");
  assert.match(rust, /MenuItem::with_id\(app,"receiver","启动接收"/);
  assert.match(rust, /Menu::with_items\(app,&\[&show,&receiver,&quit\]\)/);
  assert.doesNotMatch(rust, /MenuItem::with_id\(app,"start"/);
  assert.doesNotMatch(rust, /MenuItem::with_id\(app,"stop"/);
  assert.match(rust, /"quit"=>\{controller\(app\)\.stop\(app\);app\.exit\(0\);\}/);
});

test("tray activation uses controller state, never old display text", () => {
  const rust = source("src-tauri/src/lib.rs");
  assert.match(rust, /"receiver"=>\{\s*let core=controller\(app\);\s*if core\.tray_should_stop\(\) \{ core\.stop\(app\); \}\s*else \{ core\.start\(app,true\); \}/);
  assert.match(rust, /\.on_menu_event\(/);
});

test("tray text reacts to process lifecycle and distinguishes spawn/recovery", () => {
  const rust = source("src-tauri/src/lib.rs");
  const receiver = source("src-tauri/src/receiver.rs");
  assert.match(rust, /fn sync_tray_receiver_item\(app: &AppHandle\)/);
  assert.match(rust, /if controller\(app\)\.tray_should_stop\(\) \{ "停止接收" \} else \{ "启动接收" \}/);
  assert.match(rust, /item\.0\.set_text\(label\)/);
  assert.match(rust, /app\.manage\(TrayReceiverItem\(receiver\)\)/);
  assert.match(receiver, /process_running \|\| stage == "starting"/);
  assert.match(receiver, /crate::sync_tray_receiver_item\(app\)/);
  assert.match(receiver, /self\.publish\(app\);/);
  assert.match(receiver, /fn tray_receiver_action_covers_all_lifecycle_states\(\)/);
  assert.match(receiver, /assert!\(!tray_should_stop\("error", false\)\)/);
});
