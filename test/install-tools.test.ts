import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceRuntime, packedRequirement } from './install-tools.ts';

test('exact runtime acceptance refuses missing CI provisioning and permits local absence', () => {
  const root = mkdtempSync(join(tmpdir(), 'case-runtimes-'));
  try {
    for (const version of ['v22.19.0', 'v26.13.0'] as const) {
      const executable = join(root, 'versions', 'v24', 'bin', 'node');
      assert.throws(() => acceptanceRuntime(version, executable, { GITHUB_ACTIONS: 'true' }), assert.AssertionError);
      assert.equal(acceptanceRuntime(version, executable, {}), null);
      assert.equal(acceptanceRuntime(version, executable, { GITHUB_ACTIONS: 'true', PM_CASE_NODE_22: process.execPath, PM_CASE_NODE_26: process.execPath }), process.execPath);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test('packed acceptance requires every probed tool before starting the journey', () => {
  const tools = ['bun', 'npm', 'npx', 'sha256sum'];
  for (const platform of ['linux', 'darwin'] as const) {
    assert.equal(packedRequirement(platform, tools), null);
    for (const missing of tools) assert.match(packedRequirement(platform, tools.filter(tool => tool !== missing)) ?? '', new RegExp(`requires ${missing} on PATH`));
  }
  assert.match(packedRequirement('win32', tools) ?? '', /requires POSIX/);
});
