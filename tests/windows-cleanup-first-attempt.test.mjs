import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const script = readFileSync(resolve(root, 'src-tauri/windows/process-cleanup.ps1'), 'utf8');
const hooks = readFileSync(resolve(root, 'src-tauri/windows/installer-hooks.nsh'), 'utf8');

test('first maintenance-page attempt waits for process exit instead of rejecting a stale first snapshot', () => {
  assert.match(script, /\$deadline = \[DateTime\]::UtcNow\.AddSeconds\(12\)/);
  assert.match(script, /while \(\$true\) \{[\s\S]*?\$remaining = @\(Get-ScopedProcesses\)/);
  assert.match(script, /\$process\.WaitForExit\(\$milliseconds\)/);
  assert.match(script, /Start-Sleep -Milliseconds 250/);
  assert.match(script, /try \{ \$null = \$process\.WaitForExit\(\$milliseconds\) \} catch \{ \} finally \{ \$process\.Close\(\) \}/);
  assert.ok(script.indexOf('if ($remaining.Count -eq 0) { exit 0 }') < script.indexOf('throw "Timed out waiting'));
  assert.doesNotMatch(script, /WaitForExit\(2000\)/);
});

test('failed termination return code is not mistaken for a running process, but final scope check remains fail-closed', () => {
  assert.match(script, /\$terminationFailures = @\(\)/);
  assert.match(script, /\$terminationFailures \+=/);
  assert.match(script, /\$remaining = @\(Get-ScopedProcesses\)[\s\S]*?if \(\$remaining\.Count -eq 0\) \{ exit 0 \}/);
  assert.match(script, /Timed out waiting for scoped Airpimo\/UxPlay processes to exit/);
  assert.match(script, /\[string\]::Equals\(\$item\.ExecutablePath, \$target, \[StringComparison\]::OrdinalIgnoreCase\)/);
  assert.doesNotMatch(script, /taskkill|Stop-Process -Force/);
});

test('NSIS writes the exact source payload and preserves error details in installer log', () => {
  const embedded = hooks.split('\n').filter(line => line.trim().startsWith('FileWriteUTF16LE $R9 '))
    .map(line => line.match(/^\s*FileWriteUTF16LE \$R9 "(.*)"$/)?.[1])
    .map(encoded => encoded.replace(/\$\\r\$\\n$/, '').replace(/\$\\"/g, '"').replace(/\$\$/g, '$'))
    .join('\n') + '\n';
  assert.equal(embedded, script);
  assert.match(script, /AIRPIMO_CLEANUP_ERROR:/);
  assert.match(script, /Airpimo-installer-cleanup\.log/);
  assert.match(hooks, /Airpimo scoped cleanup failed: exit=\$0; output=\$1/);
  assert.match(hooks, /\$0 != "0"[\s\S]*?Abort/);
});
