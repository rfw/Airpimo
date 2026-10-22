import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const src = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

test("diagnostics export preserves native-only file write and error feedback", () => {
  assert.match(src("src/App.tsx"), /await desktop\.exportDiagnostics\(\)/);
  assert.match(src("src/App.tsx"), /导出失败/);
  assert.match(src("src-tauri/src/lib.rs"), /fn export_diagnostics/);
  assert.match(src("src/components/AirpimoSettingsDialog.tsx"), /diagnosticsExportStatus/);
});
