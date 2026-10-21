// Test-only Node preload. Windows file systems do not expose POSIX execute
// permissions through fs.statSync(). Model the requested scanner fixture's
// mode bits without weakening the production macOS staging verification.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {syncBuiltinESMExports} = require('node:module');

const requested = process.env.UXPLAY_TEST_SCANNER_PATH;
const modeString = process.env.UXPLAY_TEST_SCANNER_EXEC_MODE;
if (!requested || !/^(0755|0644)$/.test(modeString || '')) {
  throw new Error('Test scanner fixture path or permission mode missing');
}
const target = path.resolve(requested).toLowerCase();
const simulatedMode = parseInt(modeString,8);
const originalStatSync = fs.statSync;
fs.statSync = function scannerFixtureStatSync(p, ...options) {
  const result = originalStatSync.call(fs,p,...options);
  if (path.resolve(String(p)).toLowerCase() === target && result?.isFile?.()) {
    // A Stats instance's mode field is writable; keep all non-execute bits.
    result.mode = (result.mode & ~0o111) | (simulatedMode & 0o111);
  }
  return result;
};
// The staging ESM imports statSync as a named builtin export.
syncBuiltinESMExports();
