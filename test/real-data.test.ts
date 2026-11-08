import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateCover, enumerateFeasibleTuples, canonical, CaseModelSchema } from '../dist/index.js';
import { matrices, gold, passages } from './matrices.ts';
import { collectRealDataProof } from './real-data-proof.ts';
import { expectedQuestions } from './proof-contract.ts';
import { publicChecks, historicalChecks } from './harness-plan.ts';
import { harnessBindings } from './harness-bindings.ts';
import type { HarnessResult } from './harness-bindings.ts';

test('frozen public matrices independently cover every feasible pair with no excluded case',()=>{
  const receipt=JSON.parse(readFileSync('docs/real-data-receipt.json','utf8')) as {matrices:{gold_pair_sha256:string;gold_feasible_pairs:string[];pairwise_cases:number}[]};assert.ok(passages.length>=20);
  for(const [index,model] of matrices.entries()){const reference=gold(model);const plan=generateCover(model,{max_cases:256});const domain=enumerateFeasibleTuples(model);assert.equal(reference.sha256,receipt.matrices[index].gold_pair_sha256);assert.deepEqual(reference.tuples,receipt.matrices[index].gold_feasible_pairs);assert.equal(plan.cases.length,receipt.matrices[index].pairwise_cases);assert.equal(plan.covered_tuples,reference.tuples.length);assert.equal(plan.uncovered_tuples,0);assert.ok(plan.cases.length<=reference.valid.length/2);assert.ok(plan.cases.every(row=>reference.valid.some(valid=>canonical(valid)===canonical(row.assignment))));assert.ok(domain.feasible.every(tuple=>plan.cases.some(row=>Object.entries(tuple.assignment).every(([k,v])=>row.assignment[k]===v))));assert.equal(CaseModelSchema.safeParse({...model,strength:3}).success,false);}
});
test('ten pinned resume questions retain exact independent answers and at least half the delivered bytes',async()=>{
  const receipt=JSON.parse(readFileSync('docs/real-data-receipt.json','utf8')) as {questions:{actual:unknown;expected:unknown;packet_bytes:number;max_page_bytes:number;naive_bytes:number}[];totals:{packet_bytes:number;naive_bytes:number};regression:{case_counts:{fail:number}}};
  assert.equal(receipt.questions.length,expectedQuestions());for(const row of receipt.questions){assert.deepEqual(row.actual,row.expected);assert.ok(row.max_page_bytes<=6400);}assert.ok(receipt.totals.packet_bytes<=receipt.totals.naive_bytes/2);assert.equal(receipt.regression.case_counts.fail,1);
  const live = await collectRealDataProof();
  assert.equal(live.questions.length, expectedQuestions());
  for (const [index, row] of live.questions.entries()) {
    assert.deepEqual(row.actual, receipt.questions[index].expected); assert.deepEqual(row.actual, row.expected);
    assert.ok(row.max_page_bytes <= 6400); assert.ok(row.packet_bytes > 0);
    assert.equal(row.packet_bytes, receipt.questions[index].packet_bytes); assert.equal(row.naive_bytes, receipt.questions[index].naive_bytes);
  }
  assert.equal(live.totals.packet_bytes, live.questions.reduce((sum, row) => sum + row.packet_bytes, 0));
  assert.equal(live.totals.naive_bytes, live.questions.reduce((sum, row) => sum + row.naive_bytes, 0));
  assert.ok(live.totals.packet_bytes <= live.totals.naive_bytes / 2);
  const harness=JSON.parse(readFileSync('docs/public-harness-receipt.json','utf8')) as {results:{result:string;exit_code:number}[]};assert.equal(harness.results.filter(row=>row.result==='pass'&&row.exit_code===0).length,publicChecks.length);assert.equal(harness.results.filter(row=>row.result==='fail'&&row.exit_code===1).length,historicalChecks.length);
});
test('frozen harness receipts bind repository revision assignment and recorded outcomes', () => {
  const harness = JSON.parse(readFileSync('docs/public-harness-receipt.json', 'utf8')) as { results: HarnessResult[] };
  const receipt = JSON.parse(readFileSync('docs/real-data-receipt.json', 'utf8')) as Awaited<ReturnType<typeof collectRealDataProof>>;
  harnessBindings(harness.results, receipt.matrices, receipt.regression);
  for (const index of harness.results.keys()) {
    assert.throws(() => harnessBindings(harness.results.filter((_, i) => i !== index), receipt.matrices, receipt.regression), assert.AssertionError);
    assert.throws(() => harnessBindings([...harness.results, harness.results[index]], receipt.matrices, receipt.regression), assert.AssertionError);
  }
  assert.throws(() => harnessBindings(harness.results, [...receipt.matrices, receipt.matrices[0]], receipt.regression), assert.AssertionError);
  for (const field of ['repo', 'revision', 'assignment', 'oracle_digest', 'source_digest'] as const) {
    const changed = structuredClone(harness.results); const index = field === 'source_digest' ? 1 : 0;
    if (field === 'assignment') changed[index].assignment = { ...changed[index].assignment, runtime: 'bun' };
    else changed[index][field] = 'drifted';
    assert.throws(() => harnessBindings(changed, receipt.matrices, receipt.regression), assert.AssertionError);
  }
  const records = structuredClone(receipt.matrices); records[0].outcomes[0].case_id = 'f'.repeat(64);
  assert.throws(() => harnessBindings(harness.results, records, receipt.regression), assert.AssertionError);
  const shifted = structuredClone(harness.results); const matching = structuredClone(receipt.matrices);
  for (const row of shifted.filter(row => row.repo === 'pm-csv')) row.assignment.runtime = 'bun';
  matching[0].model.mandatory_cases = [shifted[0].assignment];
  matching[0].selected_cases.find(row => row.case_id === matching[0].outcomes[0].case_id)!.assignment = shifted[0].assignment;
  assert.throws(() => harnessBindings(shifted, matching, receipt.regression), assert.AssertionError, 'Paired receipt drift must not redefine the expected public corpus');
});
