import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseModel, selectCases, recordCaseOutcome, readCaseModel, proposeCases, caseCoverage, canonical } from '../dist/index.js';
import type { RecordCaseOutcomeInput, Outcome } from '../dist/index.js';
import { fixture, select, observation, hasCode, historyEvents } from './helpers.ts';

test('500 seeded random operation sequences agree with independent SDK read-back and replay model', async t => {
  const { host, native, id, birth, pmRoot } = await fixture(t,false); await native.create({id:'corpus-public-source',title:'Public relationship',type:'Task'}); const linkedBirth={...birth,related:['public-source']}; await createCaseModel(host,linkedBirth); await select(host, id); let seed = 0x5187a4; const expected: Outcome[] = []; const requests: RecordCaseOutcomeInput[] = []; let writes = 2;
  /** Deterministic portable random schedule; values never become test expectations themselves. */
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
  const kinds = new Set<number>();
  for (let sequence = 0; sequence < 500; sequence++) {
    const kind = random() % 7; kinds.add(kind); const before = await readCaseModel(host, id); const history = await historyEvents(pmRoot, id);
    if (kind < 2 || requests.length === 0) {
      const outcome = observation(before.state.selected_plan!.cases[random() % before.state.selected_plan!.cases.length].case_id, `run-${sequence}`, { result: (['pass','fail','unresolved'] as const)[random() % 3], reason: `  Data only: row ${sequence}\n  retain whitespace é\t${sequence % 2}  ` });
      const input = { id: 'suite', op: ` op-${sequence} `, revision: before.revision, outcome }; const result = await recordCaseOutcome(host, input); assert.equal(result.replayed, false); expected.push(outcome); requests.push(input); writes++;
      assert.equal((await recordCaseOutcome(host, input)).replayed, true);
    } else if (kind === 2) {
      const old = requests[random() % requests.length]; const result = await recordCaseOutcome(host, old); assert.equal(result.replayed, true); assert.equal(result.result.identity, old.outcome.execution_id); assert.equal(await historyEvents(pmRoot, id), history);
    } else if (kind === 3) {
      const old = requests[random() % requests.length]; await assert.rejects(recordCaseOutcome(host, { ...old, outcome: { ...old.outcome, reason: 'altered replay' } }), hasCode('operation_conflict')); assert.equal(await historyEvents(pmRoot, id), history);
    } else if (kind === 4) {
      const old = requests[0]; await assert.rejects(recordCaseOutcome(host, { ...old, op: `stale-${sequence}` }), hasCode('revision_conflict')); assert.equal(await historyEvents(pmRoot, id), history);
    } else if (kind === 5) {
      assert.equal((await createCaseModel(host, { ...linkedBirth, id: ' suite ', title: ' Public finite inputs ' })).replayed, true); const coverage = await caseCoverage(host, { id }); assert.equal(coverage.case_counts.pass, new Set(expected.filter(row => row.result === 'pass').map(row => row.case_id)).size); assert.equal(await historyEvents(pmRoot, id), history);
    } else {
      const plan = await proposeCases(host, { id, max_cases: 32 }); const input = { id, op: `selection-${sequence}`, revision: plan.revision, max_cases: 32, proposal: plan.proposal }; await selectCases(host, input); assert.equal((await selectCases(host, input)).replayed, true); writes++;
    }
    const actual = await readCaseModel(host, id); assert.equal(canonical(actual.state.outcomes), canonical(expected)); assert.equal(actual.state.operation_receipts.length, writes);
    const nativeRead = await native.get(id, { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in nativeRead); assert.equal(canonical(nativeRead.item.case_state), canonical(actual.state)); assert.deepEqual(nativeRead.item.dependencies?.map(row=>({id:row.id,kind:row.kind})),[{id:'corpus-public-source',kind:'related'}]);
  }
  assert.equal(kinds.size, 7); assert.equal(await historyEvents(pmRoot, id), writes); t.diagnostic(JSON.stringify({ seed: '0x5187a4', sequences: 500, variants: kinds.size, outcomes: expected.length, acknowledged_mutations: writes }));
});
