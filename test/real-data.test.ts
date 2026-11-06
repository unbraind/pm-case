import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { generateCover, enumerateFeasibleTuples, canonical, CaseModelSchema } from '../dist/index.js';
import { matrices, gold, passages } from './matrices.ts';

test('frozen public matrices independently cover every feasible pair with no excluded case',()=>{
  const receipt=JSON.parse(readFileSync('docs/real-data-receipt.json','utf8')) as {matrices:{gold_pair_sha256:string;gold_feasible_pairs:string[];pairwise_cases:number}[]};assert.ok(passages.length>=20);
  for(const [index,model] of matrices.entries()){const reference=gold(model);const plan=generateCover(model,{max_cases:256});const domain=enumerateFeasibleTuples(model);assert.equal(reference.sha256,receipt.matrices[index].gold_pair_sha256);assert.deepEqual(reference.tuples,receipt.matrices[index].gold_feasible_pairs);assert.equal(plan.cases.length,receipt.matrices[index].pairwise_cases);assert.equal(plan.covered_tuples,reference.tuples.length);assert.equal(plan.uncovered_tuples,0);assert.ok(plan.cases.length<=reference.valid.length/2);assert.ok(plan.cases.every(row=>reference.valid.some(valid=>canonical(valid)===canonical(row.assignment))));assert.ok(domain.feasible.every(tuple=>plan.cases.some(row=>Object.entries(tuple.assignment).every(([k,v])=>row.assignment[k]===v))));assert.equal(CaseModelSchema.safeParse({...model,strength:3}).success,false);}
});
test('ten pinned resume questions retain exact independent answers and at least half the delivered bytes',()=>{
  const receipt=JSON.parse(readFileSync('docs/real-data-receipt.json','utf8')) as {questions:{actual:unknown;expected:unknown;packet_bytes:number;max_page_bytes:number;naive_bytes:number}[];totals:{packet_bytes:number;naive_bytes:number};regression:{case_counts:{fail:number}}};
  assert.equal(receipt.questions.length,10);for(const row of receipt.questions){assert.deepEqual(row.actual,row.expected);assert.ok(row.max_page_bytes<=6400);}assert.ok(receipt.totals.packet_bytes<=receipt.totals.naive_bytes/2);assert.equal(receipt.regression.case_counts.fail,1);
  const harness=JSON.parse(readFileSync('docs/public-harness-receipt.json','utf8')) as {results:{result:string;exit_code:number}[]};assert.equal(harness.results.filter(row=>row.result==='pass'&&row.exit_code===0).length,3);assert.equal(harness.results.filter(row=>row.result==='fail'&&row.exit_code===1).length,1);
});
