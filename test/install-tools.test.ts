import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acceptanceRuntime } from './install-tools.ts';

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
