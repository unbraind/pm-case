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

test('writers bound every conflict schedule and rethrow the final failure', async () => {
  for (const maxAttempts of [1, 2, 7, 200]) for (const code of ['lock_conflict', 'revision_conflict']) {
    let attempts = 0, conflicts = 0;
    const failure = Object.assign(new Error('Persistent contention'), { code });
    const sentinel = new Error('Retry cap was bypassed');
    await assert.rejects(retryWriter(async () => {
      attempts++;
      // A broken loop still terminates, making a revert fail instead of hanging.
      if (attempts > maxAttempts) throw sentinel;
      throw failure;
    }, () => { conflicts++; }, maxAttempts), error => error === failure);
    assert.equal(attempts, maxAttempts); assert.equal(conflicts, maxAttempts - 1);
  }
  let attempts = 0;
  await assert.rejects(retryWriter(async () => {
    if (++attempts > 200) throw new Error('Default cap bypassed');
    throw { code: 'lock_conflict' };
  }, () => {}), error => typeof error === 'object' && error !== null && 'code' in error);
  assert.equal(attempts, 200);
  for (const limit of [0, -1, Infinity, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(retryWriter(async () => assert.fail('Invalid cap must refuse before attempting'), () => {}, limit), RangeError);
  }
});
