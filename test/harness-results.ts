import assert from 'node:assert/strict';

/** Locate one concrete named event, excluding wrapper files and unrelated tests. */
function namedTest(output: string, pattern: string, file: string) {
  const rows = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; name?: string; file?: string; skip?: boolean | string; todo?: boolean | string; details?: { type?: string; error?: { code?: string; failureType?: string; cause?: { code?: string } } } });
  const selected = rows.filter(row => typeof row.name === 'string' && new RegExp(pattern).test(row.name) && row.file?.replaceAll('\\', '/').endsWith('/' + file) && row.details?.type === 'test');
  assert.equal(selected.length, 1, 'Exactly one selected test must execute');
  return selected[0];
}

/** Require a concrete, unskipped test result for the selected name and source file. */
export function selectedTestPassed(output: string, pattern: string, file: string): void {
  const row = namedTest(output, pattern, file);
  assert.ok(row.type === 'test:pass' && !row.skip && !row.todo, 'The selected test must pass without skip or todo');
}

/** Require the named regression to fail by assertion, excluding startup and unrelated failures. */
export function selectedTestFailed(output: string, pattern: string, file: string): void {
  const row = namedTest(output, pattern, file);
  assert.ok(row.type === 'test:fail' && !row.skip && !row.todo, 'The named regression must fail without skip or todo');
  const error = row.details!.error;
  const assertion = error?.code === 'ERR_TEST_FAILURE' && error.failureType === 'testCodeFailure' ? error.cause : error;
  assert.equal(assertion?.code, 'ERR_ASSERTION', 'The named failure must be a regression assertion');
}
