import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

test("advanced arguments remain validated, saved and wired through Rust", () => {
  assert.match(src("src/App.tsx"), /validateUxplayArgs\(draft\.uxplay_args\)/);
  assert.match(src("src/App.tsx"), /desktop\.save/);
  assert.match(src("src/components/AirpimoSettingsDialog.tsx"), /id="uxplayArgs"/);
  assert.match(src("src-tauri/src/uxplay_args.rs"), /pub fn effective\(/);
});
