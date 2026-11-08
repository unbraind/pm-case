import assert from 'node:assert/strict';

/** Require a concrete, unskipped test result for the selected name and source file. */
export function selectedTestPassed(output: string, pattern: string, file: string): void {
  const rows = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; name?: string; file?: string; skip?: boolean | string; todo?: boolean | string; details?: { type?: string } });
  const selected = rows.filter(row => typeof row.name === 'string' && new RegExp(pattern).test(row.name) && row.file?.replaceAll('\\', '/').endsWith('/' + file) && row.details?.type === 'test');
  assert.equal(selected.length, 1, 'Exactly one selected test must execute');
  assert.ok(selected[0].type === 'test:pass' && !selected[0].skip && !selected[0].todo, 'The selected test must pass without skip or todo');
}
