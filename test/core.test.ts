import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseModel, proposeCases, selectCases, recordCaseOutcome, readCaseModel, caseCoverage, explainCaseTuple, casePacket, generateCover, enumerateFeasibleTuples, normalizeModel, canonical, digest, readState } from '../dist/index.js';
import type { Assignment, CaseModel, CaseState } from '../dist/index.js';
import { contains } from '../dist/src/kernel.js';
import { fixture, model, source, select, request, hasCode, historyEvents } from './helpers.ts';

/** Independent mixed-radix full population oracle, without production combinators. */
function oracle(m: CaseModel) {
  const all: Assignment[] = []; const size = m.factors.reduce((n, f) => n * f.values.length, 1);
  for (let value = 0; value < size; value++) { let remainder = value; const row: Assignment = {}; for (const f of m.factors) { row[f.factor_id] = f.values[remainder % f.values.length]; remainder = Math.floor(remainder / f.values.length); } if (!m.forbidden_tuples.some(c => Object.entries(c.assignment).every(([k, v]) => row[k] === v))) all.push(row); }
  const tuples = new Set<string>();
  for (const row of all) for (let a = 0; a < m.factors.length; a++) for (let b = a + 1; b < m.factors.length; b++) { const keys = [m.factors[a].factor_id,m.factors[b].factor_id].sort(); tuples.add(JSON.stringify(keys.map(key => [key,row[key]]))); }
  return { all, tuples };
}
test('independent brute-force oracle verifies all small constrained binary matrices', () => {
  for (let mask = 0; mask < 32; mask++) {
    const forbidden: Assignment[] = [{ light: 'low' }, { soil: 'high', water: 'high' }, { soil: 'low', light: 'high' }, { water: 'low', light: 'low' }, { water: 'high', light: 'high' }];
    const m = model({ forbidden_tuples: forbidden.filter((_, index) => mask & (1 << index)).map(assignment => ({ assignment, rationale: 'Reviewed biological constraint', source_refs: [source()] })) });
    const expected = oracle(m);
    if (expected.all.length === 0) { assert.throws(() => generateCover(m, { max_cases: 32 }), hasCode('unsatisfiable_model')); continue; }
    const actual = enumerateFeasibleTuples(m); const plan = generateCover(m, { max_cases: 32 });
    assert.equal(actual.assignments.length, expected.all.length); assert.equal(plan.feasible_tuples, expected.tuples.size); assert.equal(plan.uncovered_tuples, 0); assert.equal(plan.complete, true);
    assert.deepEqual(new Set(actual.feasible.map(row => JSON.stringify(Object.keys(row.assignment).sort().map(key => [key,row.assignment[key]])))), expected.tuples);
    assert.ok(plan.cases.every(row => expected.all.some(valid => canonical(valid) === canonical(row.assignment))));
    assert.ok(actual.feasible.every(tuple => plan.cases.some(row => contains(row.assignment, tuple.assignment))));
    assert.deepEqual(generateCover({ ...m, factors: [...m.factors].reverse().map(f => ({ ...f, values: [...f.values].reverse() })) }, { max_cases: 32 }), plan);
  }
});
test('mandatory cases and explicitly partial proposals retain complete tuple denominators', () => {
  const m = model({ mandatory_cases: [{ light: 'low', soil: 'low', water: 'low' }, { water: 'low', soil: 'low', light: 'low' }] });
  const partial = generateCover(m, { max_cases: 1 }); assert.equal(partial.cases.length, 1); assert.equal(partial.complete, false); assert.equal(partial.feasible_tuples, 12); assert.equal(partial.covered_tuples, 3); assert.equal(partial.uncovered_tuples, 9);
  const singles = generateCover(model({ strength: 1 }), { max_cases: 32 }); assert.equal(singles.feasible_tuples, 6); assert.equal(singles.cases.length, 2);
  const forced = model({ mandatory_cases: [{ light: 'low', soil: 'low', water: 'low' }, { light: 'high', soil: 'high', water: 'high' }] });
  assert.throws(() => generateCover(forced, { max_cases: 1 }), hasCode('model_limit'));
  assert.throws(() => generateCover(m, { max_cases: 0 }), hasCode('invalid_input'));
});
test('model and constraint limitations refuse before population expansion', () => {
  const base = model();
  for (const [m, code] of [
    [{ ...base, factors: [base.factors[0],base.factors[0]] }, 'model_limit'],
    [{ ...base, factors: [{ ...base.factors[0], values: ['low',' low '] },base.factors[1]] }, 'model_limit'],
    [{ ...base, factors: Array.from({ length: 12 }, (_, i) => ({ ...base.factors[0], factor_id: `f${i}`, values: ['one','two','three'] })) }, 'model_limit'],
    [{ ...base, forbidden_tuples: [{ assignment: {}, rationale: 'empty', source_refs: [source()] }] }, 'invalid_constraint'],
    [{ ...base, forbidden_tuples: [{ assignment: { unknown: 'low' }, rationale: 'bad', source_refs: [source()] }] }, 'invalid_constraint'],
    [{ ...base, mandatory_cases: [{ light: 'low' }] }, 'invalid_constraint'],
    [{ ...base, mandatory_cases: [{ light: 'unknown', soil: 'low', water: 'low' }] }, 'invalid_constraint'],
    [{ ...base, forbidden_tuples: [{ assignment: { light: 'low' }, rationale: 'bad', source_refs: [source()] }], mandatory_cases: [{ light: 'low', soil: 'low', water: 'low' }] }, 'invalid_constraint'],
    [{ ...base, strength: 3 }, 'invalid_input'],
  ] as const) assert.throws(() => normalizeModel(m), hasCode(code));
  assert.equal(contains({ x: 'yes' }, { constructor: 'yes' }), false);
});
test('real SDK owner retains links comments immutable outcomes and old request replays', async t => {
  const { host, id, pmRoot, birth, native } = await fixture(t);
  const initial = await readCaseModel(host, id); assert.equal((await createCaseModel(host, birth)).replayed, true);
  await native.create({ id: 'corpus-source', type: 'Task', title: 'Public source' });
  await createCaseModel(host, { ...birth, id: 'linked', op: 'linked', related: ['source','corpus-source'] });
  const linked = await native.get('linked', { outputInclude: 'full', outputBudget: 'unbounded' }); assert.ok('item' in linked); assert.equal(linked.item.dependencies?.length, 1);
  const plan = await select(host, id); assert.equal(plan.complete, true);
  const input = await request(host, id, 'first'); const first = await recordCaseOutcome(host, input); assert.equal(first.replayed, false);
  const before = await historyEvents(pmRoot, id); const repeated = await recordCaseOutcome(host, input); assert.equal(repeated.replayed, true); assert.equal(repeated.result_digest, first.result_digest); assert.equal(await historyEvents(pmRoot, id), before);
  await assert.rejects(recordCaseOutcome(host, { ...input, outcome: { ...input.outcome, reason: 'changed' } }), hasCode('operation_conflict'));
  await assert.rejects(recordCaseOutcome(host, { ...input, op: 'different' }), hasCode('revision_conflict'));
  await assert.rejects(recordCaseOutcome(host, await request(host, id, 'missing', { case_id: digest('missing') })), hasCode('unknown_case'));
  await assert.rejects(recordCaseOutcome(host, await request(host, id, 'subject', { subject_digest: digest('other') })), hasCode('subject_mismatch'));
  await assert.rejects(recordCaseOutcome(host, { ...await request(host, id, 'first'), op: 'different-key' }), hasCode('operation_conflict'));
  await assert.rejects(createCaseModel(host, { ...birth, title: 'Changed' }), hasCode('operation_conflict'));
  await assert.rejects(createCaseModel(host, { ...birth, op: 'other' }), hasCode('operation_conflict'));
  await assert.rejects(selectCases(host, { id, op: 'mismatch', revision: first.revision, proposal: plan.proposal, max_cases: 1 }), hasCode('operation_conflict'));
  assert.equal((await createCaseModel(host, birth)).result.sequence, 1); assert.notEqual(repeated.revision, initial.revision);
});
test('pass fail unknown and changed oracle never become one false passing claim', async t => {
  const { host, id } = await fixture(t); const empty = await caseCoverage(host, { id }); assert.equal(empty.population.selected, 0); assert.ok(empty.gaps.every(row => row.reason === 'not_selected'));
  await select(host, id);
  for (const [key, result] of [['pass','pass'],['fail','fail'],['unknown','unresolved']] as const) await recordCaseOutcome(host, await request(host, id, key, { result }));
  await recordCaseOutcome(host, await request(host, id, 'other-oracle', { oracle_digest: digest('other') }));
  const coverage = await caseCoverage(host, { id }); assert.equal(coverage.planned_tuple_coverage.covered, 12); assert.equal(coverage.recorded_execution_tuple_coverage.covered, 3); assert.equal(coverage.conflicts.length, 1); assert.deepEqual(coverage.case_counts, { pass: 1, fail: 1, unresolved: 1, unobserved: 3 }); assert.deepEqual(coverage.incomparable, ['other-oracle']);
  const tuple = enumerateFeasibleTuples(model()).feasible[0]; const explained = await explainCaseTuple(host, { id, tuple: tuple.tuple_id }); assert.equal(explained.feasible, true); assert.ok(explained.witness);
  await assert.rejects(explainCaseTuple(host, { id, tuple: digest('unknown') }), hasCode('invalid_input'));
  const secondCase = (await readCaseModel(host, id)).state.selected_plan!.cases[1]; await recordCaseOutcome(host, await request(host, id, 'second', { case_id: secondCase.case_id }));
  const small = await proposeCases(host, { id, max_cases: 1 }); await assert.rejects(selectCases(host, { id, op: 'shrink', revision: small.revision, proposal: small.proposal, max_cases: 1 }), hasCode('operation_conflict'));
});
test('excluded tuples retain no-valid-completion witnesses and partial selection stays partial', async t => {
  const { host, birth } = await fixture(t, false); const m = model({ forbidden_tuples: [{ assignment: { light: 'low' }, rationale: 'Seed batch requires high light', source_refs: [source()] }] });
  await createCaseModel(host, { ...birth, model: m }); const plan = await select(host, birth.id, 1); assert.equal(plan.complete, false);
  const coverage = await caseCoverage(host, { id: birth.id }); assert.equal(coverage.excluded.length, 4); assert.ok(coverage.gaps.some(row => row.reason === 'not_selected')); const result = await explainCaseTuple(host, { id: birth.id, tuple: coverage.excluded[0].tuple_id }); assert.equal(result.feasible, false); assert.equal(result.witness, null); assert.equal(result.constraints.length, 1);
  const packet = await casePacket(host, { id: birth.id, limit: 100 }); assert.equal(packet.omitted, 0); assert.equal(packet.rows.filter(row => row.kind === 'excluded').length, 4);
});
test('native read-back refuses corrupt plans digests and repeated execution receipts', async t => {
  const { host, id } = await fixture(t); await select(host, id); await recordCaseOutcome(host, await request(host, id, 'first')); const state = (await readCaseModel(host, id)).state;
  const corruptions: ((s: CaseState) => void)[] = [s => { s.model_digest = digest('changed'); },s => { s.selected_plan!.covered_tuples = 0; },s => { s.selected_plan = generateCover(s.model,{max_cases:64}); },s => { delete s.selected_plan; },s => { s.outcomes = []; s.operation_receipts = [s.operation_receipts[0]]; },s => { const selected=s.operation_receipts[1]; selected.result.identity=digest('wrong-plan'); selected.result_digest=digest(selected.result); },s => { s.operation_receipts.push(s.operation_receipts[0]); },s => { s.operation_receipts[0].result_digest = digest('bad'); },s => { s.outcomes.push(s.outcomes[0]); },s => { s.outcomes[0].subject_digest = digest('other'); },s => { s.outcomes[0].case_id = digest('unknown'); }];
  for (const change of corruptions) { const copy = structuredClone(state); change(copy); assert.throws(() => readState(copy), hasCode('invalid_record')); }
  for (const raw of [null, {}, { schema_version: 2 }]) assert.throws(() => readState(raw), hasCode('invalid_record'));
});
test('constraint and mandatory ordering is canonical for reversed and duplicated declarations', () => {
  const constraints: CaseModel['forbidden_tuples'] = [{ assignment: { water: 'high', soil: 'high' }, rationale: 'Second', source_refs: [source()] },{ assignment: { light: 'low', soil: 'low' }, rationale: 'First', source_refs: [source()] }];
  const m = model({forbidden_tuples:[...constraints,constraints[0]]}); const a=normalizeModel(m);const b=normalizeModel({...m,forbidden_tuples:[...m.forbidden_tuples].reverse()});assert.equal(canonical(a),canonical(b));
  const mandatory = [{ light: 'high',soil:'high',water:'high' },{light:'low',soil:'low',water:'low'}]; assert.equal(canonical(normalizeModel(model({mandatory_cases:mandatory}))),canonical(normalizeModel(model({mandatory_cases:[...mandatory].reverse()}))));
  assert.throws(()=>normalizeModel(model({factors:[{...model().factors[0],factor_id:'constructor'},model().factors[1]]})),hasCode('invalid_input'));
});
test('tuple explanations work before selection without inventing selected-case witnesses',async t=>{const {host,id}=await fixture(t);const tuple=enumerateFeasibleTuples(model()).feasible[0];const value=await explainCaseTuple(host,{id,tuple:tuple.tuple_id});assert.equal(value.feasible,true);assert.deepEqual(value.selected_case_ids,[]);});
test('malformed outcomes and unusable revision guards have separate typed refusals',async t=>{
  const {host,id}=await fixture(t);await select(host,id);const input=await request(host,id,'invalid');
  await assert.rejects(recordCaseOutcome(host,{...input,outcome:{...input.outcome,result:'unknown'}} as unknown as typeof input),hasCode('invalid_outcome'));
  await assert.rejects(recordCaseOutcome(host,{...input,revision:'broken'}),hasCode('invalid_input'));
});
