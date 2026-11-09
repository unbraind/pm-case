import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';

test('package gate refuses each missing linked proof document from the real packed file list', () => {
  const root = mkdtempSync(join(tmpdir(), 'case-pack-policy-'));
  try {
    for (const path of ['scripts', 'src', 'index.ts', 'dist', 'package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'ARCHITECTURE.md', 'docs']) cpSync(path, join(root, path), { recursive: true });
    const run = () => spawnSync(process.execPath, ['scripts/pack-gate.ts'], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 30000 });
    const baseline = run(); assert.equal(baseline.status, 0, baseline.stdout + baseline.stderr);
    for (const file of ['docs/real-data.md', 'docs/real-data-receipt.json', 'docs/public-harness-receipt.json']) {
      rmSync(join(root, file));
      try { const rejected = run(); assert.equal(rejected.status, 1); assert.ok(rejected.stderr.includes(`Package document is missing: ${file}`)); }
      finally { cpSync(file, join(root, file)); }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
