import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';

test('revert acceptance reports all missing and ambiguous seams before running proofs', t => {
  const root = mkdtempSync(join(tmpdir(), 'revert-seam-diagnostics-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const file of ['dist', 'test', 'scripts', 'src', 'index.ts', 'tsconfig.json', 'tsconfig.test.json', 'package.json', 'manifest.json', 'README.md', 'LICENSE', 'CHANGELOG.md', 'ARCHITECTURE.md', 'docs', '.github']) cpSync(file, join(root, file), { recursive: true });
  symlinkSync(resolve('node_modules'), join(root, 'node_modules'), 'dir');

  const failures = [
    { file: 'README.md', before: 'npm install "$archive"', after: 'npm install "$archive"\nnpm install "$archive"', label: '^documented archive installs', count: 2 },
    { file: 'test/install-tools.ts', before: "['bun', 'npm', 'npx', 'sha256sum'] as const", after: "['bun', 'npm', 'npx'] as const", label: '^packed acceptance requires', count: 0 },
    { file: 'test/corpus.ts', before: '// Both archives use the same frozen revision, so provenance is identical.', after: '// Removed provenance note.', label: '^harness archives share', count: 0 },
  ];
  for (const failure of failures) {
    const file = join(root, failure.file); const source = readFileSync(file, 'utf8');
    assert.equal(source.split(failure.before).length, 2);
    writeFileSync(file, source.replace(failure.before, failure.after));
  }
  const result = spawnSync(process.execPath, ['test/revert.acceptance.ts'], { cwd: root, env: testEnvironment(npmEnvironment(process.env)), encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const output = result.stdout + result.stderr;
  assert.ok(output.includes('Stale revert seams (expected exactly one match):'), 'proof:seam_diagnostics');
  for (const failure of failures) {
    assert.ok(output.includes(`${failure.file}: ${failure.label}: ${failure.count} matches`), 'proof:seam_diagnostics');
    assert.ok(readFileSync(join(root, failure.file), 'utf8').includes(failure.after));
  }
  assert.doesNotMatch(result.stdout, /"proved"/);
});
