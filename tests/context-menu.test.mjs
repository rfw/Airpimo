import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { disableContextMenu } from "../src/lib/context-menu.ts";

const source = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

test("WebView entry registers the capture-phase context-menu blocker before React renders", () => {
  const entry = source("src/main.tsx");
  assert.match(entry, /disableContextMenu\(document\)/);
  assert.ok(entry.indexOf("disableContextMenu(document)") < entry.indexOf("createRoot("));
});

test("all contextmenu events are canceled without affecting other interactions", () => {
  const handlers = new Map();
  const target = {
    addEventListener(type, handler, capture) {
      assert.equal(capture, true);
      handlers.set(type, handler);
    },
    removeEventListener(type, handler, capture) {
      assert.equal(capture, true);
      assert.equal(handlers.get(type), handler);
      handlers.delete(type);
    },
  };
  const uninstall = disableContextMenu(target);
  assert.deepEqual([...handlers.keys()], ["contextmenu"]);
  for (const source of ["background", "input", "textarea", "dialog", "selection"]) {
    const event = new Event("contextmenu", { cancelable: true, bubbles: true });
    handlers.get("contextmenu")(event);
    assert.equal(event.defaultPrevented, true, `${source}: context menu should be prevented`);
  }
  for (const type of ["click", "keydown", "copy", "paste", "selectstart"]) {
    assert.equal(handlers.has(type), false, `${type}: must be left untouched`);
  }
  uninstall();
  assert.equal(handlers.size, 0);
});

test("does not remove the native tray context menu required to exit when staying in the tray", () => {
  const tray = source("src-tauri/src/lib.rs");
  assert.match(tray, /\.menu\(&menu\)/);
  assert.match(tray, /"quit"/);
});
