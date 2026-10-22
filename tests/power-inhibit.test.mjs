import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = (path) => readFileSync(resolve(import.meta.dirname, "..", path), "utf8");

test("native per-mirror power requests use Windows 7 and macOS APIs without new dependencies", () => {
  const power = source("src-tauri/src/power_inhibit.rs");
  const lib = source("src-tauri/src/lib.rs");
  assert.match(lib, /mod power_inhibit;/);
  assert.match(power, /#\[cfg\(windows\)\]/);
  assert.match(power, /PowerCreateRequest/);
  assert.match(power, /PowerSetRequest\(request\.handle\(\), POWER_REQUEST_DISPLAY_REQUIRED\)/);
  assert.match(power, /PowerSetRequest\(request\.handle\(\), POWER_REQUEST_SYSTEM_REQUIRED\)/);
  assert.match(power, /PowerClearRequest\(self\.handle\(\), POWER_REQUEST_DISPLAY_REQUIRED\)/);
  assert.match(power, /PowerClearRequest\(self\.handle\(\), POWER_REQUEST_SYSTEM_REQUIRED\)/);
  assert.match(power, /CloseHandle\(self\.handle\(\)\)/);
  assert.match(power, /#\[cfg\(target_os = "macos"\)\]/);
  assert.match(power, /IOPMAssertionCreateWithName/);
  assert.match(power, /PreventUserIdleDisplaySleep/);
  assert.match(power, /IOPMAssertionRelease\(self\.assertion_id\)/);
  assert.doesNotMatch(power, /(?:fn|Command::new|extern).*?(?:SetThreadExecutionState|caffeinate|osascript|SendInput)/);
});

test("power inhibitor is acquired only on active mirroring and is released on lifecycle changes", () => {
  const receiver = source("src-tauri/src/receiver.rs");
  assert.match(receiver, /power_inhibitor: Option<PowerInhibitor>/);
  assert.match(receiver, /stage == "connected" && process_running && !stopping/);
  assert.match(receiver, /else if self\.power_inhibitor\.is_none\(\)/);
  assert.match(receiver, /PowerInhibitor::acquire\(\)/);
  assert.match(receiver, /self\.power_inhibitor = None/);
  assert.match(receiver, /fn publish\(&self, app: &AppHandle\) \{[\s\S]*?sync_display_awake\(\)/);
  assert.match(receiver, /stopped_by_user"\); i\.power_inhibitor = None/);
  assert.match(receiver, /i\.power_inhibitor = None; i\.child\.take\(\)/);
  assert.match(receiver, /fn display_awake_requires_real_mirroring_and_live_child\(\)/);
  assert.match(receiver, /i\.stage="connected";[\s\S]*?i\.log\("mirror_started"\)/);
  assert.match(receiver, /i\.stage="waiting";[\s\S]*?i\.log\("mirror_ended"\)/);
  assert.match(receiver, /fn diagnostics\(&self\) -> String/);
});


test("PowerInhibitor intentionally holds a Drop guard and Win32 HANDLE FFI agrees with other modules", () => {
  const power = source("src-tauri/src/power_inhibit.rs");
  const player = source("src-tauri/src/windows_player.rs");
  assert.match(power, /struct PowerInhibitor\s*\{\s*_request:\s*platform::PowerRequest,/);
  assert.match(power, /\.map\(\|request\| Self \{ _request: request \}\)/);
  assert.match(power, /type Handle = isize;/);
  assert.match(player, /type Handle = isize;/);
  assert.match(power, /fn CloseHandle\(handle: Handle\) -> i32;/);
  assert.match(player, /fn CloseHandle\(handle: Handle\) -> i32;/);
  assert.doesNotMatch(power, /type Handle = \*mut c_void;/);
});
