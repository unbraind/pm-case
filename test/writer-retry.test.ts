import test from 'node:test';
import assert from 'node:assert/strict';
import { retryWriter } from './writer-retry.ts';

test('writers retry lock and revision conflicts and propagate all other failures', async () => {
  let attempts = 0, conflicts = 0;
  let committed: string | undefined;
  await assert.doesNotReject(async () => { committed = await retryWriter(async () => {
    attempts++;
    if (attempts <= 2) throw { code: attempts === 1 ? 'lock_conflict' : 'revision_conflict' };
    return 'committed';
  }, () => { conflicts++; }); });
  assert.equal(committed, 'committed');
  assert.equal(attempts, 3); assert.equal(conflicts, 2);
  const failure = Object.assign(new Error('refused'), { code: 'invalid_input' });
  await assert.rejects(retryWriter(async () => { throw failure; }, () => assert.fail('Unexpected retry')), error => error === failure);
});
