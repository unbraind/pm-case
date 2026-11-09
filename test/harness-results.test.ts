import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { selectedTestPassed, selectedTestFailed } from './harness-results.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';

test('public harness requires the named concrete test to run and pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'case-selected-test-'));
  try {
    const file = join(root, 'selected.cjs');
    writeFileSync(file, "const test=require('node:test');test('selected',()=>{});test('skipped',{skip:true},()=>{});test('todo',{todo:true},()=>{});test('failed',()=>{throw new Error('expected');});\n");
    for (const [name, accepted] of [['selected', true], ['absent', false], ['skipped', false], ['todo', false], ['failed', false]] as const) {
      const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', '--test-reporter', resolve('test/harness-reporter.ts'), '--test-name-pattern', `^${name}$`, file], { encoding: 'utf8', env: testEnvironment(npmEnvironment(process.env)) });
      const check = () => selectedTestPassed(result.stdout, `^${name}$`, 'selected.cjs');
      if (accepted) { assert.equal(result.status, 0, result.stderr); assert.doesNotThrow(check); }
      else assert.throws(check, assert.AssertionError);
    }
    assert.throws(() => selectedTestPassed(JSON.stringify({ type: 'test:pass', name: 'selected', file, details: { type: 'suite' } }), '^selected$', 'selected.cjs'), assert.AssertionError);
    assert.throws(() => selectedTestPassed(JSON.stringify({ type: 'test:pass', name: 'selected', file, details: { type: 'test' } }), '^selected$', 'other.cjs'), assert.AssertionError);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('revert harness accepts only the named assertion failure after a passing baseline', () => {
  const named = { type: 'test:fail', name: 'named regression', file: 'test/proof.ts', details: { type: 'test', error: { code: 'ERR_ASSERTION' } } };
  const check = (row: unknown) => selectedTestFailed(JSON.stringify(row), '^named regression$', 'proof.ts');
  assert.doesNotThrow(() => check(named));
  assert.doesNotThrow(() => check({ ...named, details: { type: 'test', error: { code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure', cause: { code: 'ERR_ASSERTION' } } } }));
  assert.throws(() => check({ ...named, details: { type: 'test', error: { code: 'ERR_TEST_FAILURE', failureType: 'testCodeFailure', cause: { code: 'io_failure' } } } }), assert.AssertionError);
  for (const row of [{ ...named, name: 'other failure' }, { ...named, type: 'test:pass' }, { ...named, skip: true }, { ...named, todo: true }, { ...named, details: { type: 'suite' } }, { ...named, details: { type: 'test', error: { code: 'ERR_MODULE_NOT_FOUND' } } }, { ...named, details: { type: 'test', error: { code: 'SyntaxError' } } }]) assert.throws(() => check(row), assert.AssertionError);
  assert.throws(() => selectedTestPassed(JSON.stringify(named), '^named regression$', 'proof.ts'), assert.AssertionError);
});
