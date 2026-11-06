import { z } from 'zod';
import { insist } from './errors.ts';
import { CaseModelSchema, CaseStateSchema, canonical, digest, parse } from './schema.ts';
import type { Assignment, CaseModel, CaseState, CasePlan } from './schema.ts';

/** True exactly when a full assignment contains every value of a partial assignment. */
export function contains(full: Assignment, partial: Assignment): boolean { return Object.entries(partial).every(([key, value]) => Object.hasOwn(full, key) && full[key] === value); }
/** Expand a bounded list of factors without relying on object prototype lookups. */
function product(factors: CaseModel['factors']): Assignment[] {
  let rows: Assignment[] = [{}];
  for (const factor of factors) rows = rows.flatMap(row => factor.values.map(value => ({ ...row, [factor.factor_id]: value })));
  return rows;
}
/** Check assignments against the admitted factor universe before any generation or writes. */
function validAssignment(model: CaseModel, assignment: Assignment, full: boolean): boolean {
  const factors = new Map(model.factors.map(factor => [factor.factor_id, factor.values])); const entries = Object.entries(assignment);
  return entries.length > 0 && (!full || entries.length === factors.size) && entries.every(([key, value]) => factors.get(key)?.includes(value));
}
/** Normalize the immutable model and refuse all invalid finite domains before enumeration. */
export function normalizeModel(raw: unknown): CaseModel {
  const model = parse(CaseModelSchema, raw);
  insist(new Set(model.factors.map(factor => factor.factor_id)).size === model.factors.length, 'model_limit', 'Factor identities must be unique');
  insist(model.factors.every(factor => new Set(factor.values).size === factor.values.length), 'model_limit', 'Value identities must be unique within a factor');
  insist(model.factors.reduce((size, factor) => size * factor.values.length, 1) <= 4096, 'model_limit', 'Cartesian population exceeds 4096', 'Partition the reviewed factor model');
  insist(model.factors.every(factor => !['constructor', 'prototype', '__proto__'].includes(factor.factor_id)), 'invalid_input', 'Reserved prototype factor identities are forbidden');
  model.factors.sort((a, b) => a.factor_id < b.factor_id ? -1 : 1);
  for (const factor of model.factors) factor.values.sort();
  insist(model.forbidden_tuples.every(constraint => validAssignment(model, constraint.assignment, false)), 'invalid_constraint', 'A forbidden tuple names an unknown or empty assignment');
  model.forbidden_tuples.sort((a, b) => canonical(a) < canonical(b) ? -1 : canonical(a) > canonical(b) ? 1 : 0);
  insist(model.mandatory_cases.every(row => validAssignment(model, row, true) && !model.forbidden_tuples.some(constraint => contains(row, constraint.assignment))), 'invalid_constraint', 'A mandatory case is incomplete or forbidden');
  model.mandatory_cases = [...new Map(model.mandatory_cases.map(row => [canonical(row), row])).entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, row]) => row);
  return model;
}
/** Enumerate exact feasible obligations and excluded tuples from the entire bounded Cartesian domain. */
export function enumerateFeasibleTuples(raw: CaseModel) {
  const model = normalizeModel(raw); const modelDigest = digest(model); const all = product(model.factors);
  const assignments = all.filter(row => !model.forbidden_tuples.some(constraint => contains(row, constraint.assignment)));
  insist(assignments.length > 0, 'unsatisfiable_model', 'No valid full assignment remains', 'Review the forbidden partial assignments');
  const groups = model.strength === 1 ? model.factors.map(factor => [factor]) : model.factors.flatMap((factor, index) => model.factors.slice(index + 1).map(other => [factor, other]));
  const tuples = groups.flatMap(group => product(group)).map(assignment => ({ tuple_id: digest({ model_digest: modelDigest, assignment }), assignment }));
  return { model, model_digest: modelDigest, cartesian: all.length, assignments, feasible: tuples.filter(tuple => assignments.some(row => contains(row, tuple.assignment))), excluded: tuples.filter(tuple => !assignments.some(row => contains(row, tuple.assignment))) };
}
/** Select mandatory cases then maximal new tuple coverage, with canonical byte ordering for ties. */
export function generateCover(raw: CaseModel, bounds: { max_cases: number }): CasePlan {
  const maxCases = parse(z.number().int().min(1).max(256), bounds.max_cases); const domain = enumerateFeasibleTuples(raw);
  insist(domain.model.mandatory_cases.length <= maxCases, 'model_limit', 'Maximum cannot contain all mandatory cases', 'Increase max_cases to retain every mandatory assignment');
  const remaining = new Set(domain.feasible.map(tuple => tuple.tuple_id)); const selected: Assignment[] = [];
  const candidates = domain.assignments;
  const obligations = new Map(candidates.map(row => [canonical(row), domain.feasible.filter(tuple => contains(row, tuple.assignment)).map(tuple => tuple.tuple_id)]));
  /** Add one valid case exactly once and remove all obligations it witnesses. */
  function add(row: Assignment): void { selected.push(row); for (const id of obligations.get(canonical(row))!) remaining.delete(id); }
  for (const row of domain.model.mandatory_cases) add(row);
  while (remaining.size > 0 && selected.length < maxCases) {
    let best = candidates[0]; let score = -1;
    for (const row of candidates) { const count = obligations.get(canonical(row))!.filter(id => remaining.has(id)).length; if (count > score) { best = row; score = count; } }
    add(best);
  }
  const plan = { algorithm: 'exhaustive-greedy-v1' as const, seed: 0 as const, model_digest: domain.model_digest, max_cases: maxCases, cases: selected.map(assignment => ({ case_id: digest({ model_digest: domain.model_digest, assignment }), assignment })), feasible_assignments: domain.assignments.length, cartesian_assignments: domain.cartesian, feasible_tuples: domain.feasible.length, excluded_tuples: domain.excluded.length, covered_tuples: domain.feasible.length - remaining.size, uncovered_tuples: remaining.size, complete: remaining.size === 0 };
  return { ...plan, proposal_digest: digest(plan) };
}
/** Validate stored domain integrity without repairing or mutating native history. */
export function readState(raw: unknown): CaseState {
  const state = parse(CaseStateSchema, raw, true);
  insist(Buffer.byteLength(canonical(state)) <= 262144, 'capacity_exceeded', 'Owner state exceeds 256 KiB', 'Create a successor owner; retain original receipts');
  insist(digest(normalizeModel(state.model)) === state.model_digest, 'invalid_record', 'Stored model digest differs');
  insist(state.operation_receipts[0].result.kind === 'create' && state.operation_receipts[0].result.digest === state.model_digest && state.operation_receipts.slice(1).every(row => row.result.kind !== 'create'), 'invalid_record', 'Creation receipt does not bind this immutable model');
  const recorded = state.operation_receipts.filter(row => row.result.kind === 'record');
  insist(recorded.length === state.outcomes.length && recorded.every(row => state.outcomes.some(outcome => outcome.execution_id === row.result.identity && digest(outcome) === row.result.digest)), 'invalid_record', 'Execution content differs from its immutable receipt');
  const plan = state.selected_plan; const selected = state.operation_receipts.filter(row => row.result.kind === 'select').at(-1);
  insist(plan ? selected?.result.digest === digest(plan) && selected.result.identity === plan.proposal_digest : selected === undefined, 'invalid_record', 'Selected plan differs from its committed receipt');
  if (plan) insist(canonical(generateCover(state.model, { max_cases: plan.max_cases })) === canonical(plan), 'invalid_record', 'Stored plan is not the declared deterministic cover');
  insist(new Set(state.operation_receipts.map(row => row.operation_id)).size === state.operation_receipts.length && state.operation_receipts.every((row, index) => row.result.sequence === index + 1 && row.result_digest === digest(row.result)), 'invalid_record', 'Stored replay receipts differ or repeat');
  insist(new Set(state.outcomes.map(row => row.execution_id)).size === state.outcomes.length && state.outcomes.every(row => row.subject_digest === state.model.subject_digest && plan?.cases.some(selected => selected.case_id === row.case_id)), 'invalid_record', 'Stored outcomes do not belong to this selected model');
  return state;
}
/** Separate planned interaction coverage from comparable reported execution evidence and conflicts. */
export function evaluateCaseCoverage(state: CaseState) {
  const domain = enumerateFeasibleTuples(state.model); const cases = state.selected_plan?.cases ?? []; const oracle = state.outcomes[0]?.oracle_digest ?? null;
  const comparable = state.outcomes.filter(row => row.subject_digest === state.model.subject_digest && row.oracle_digest === oracle);
  const observed = new Set(comparable.filter(row => row.result !== 'unresolved').map(row => row.case_id));
  const executed = cases.filter(row => observed.has(row.case_id));
  const planned = domain.feasible.filter(tuple => cases.some(row => contains(row.assignment, tuple.assignment)));
  const recorded = domain.feasible.filter(tuple => executed.some(row => contains(row.assignment, tuple.assignment)));
  const conflicts = cases.filter(row => comparable.some(outcome => outcome.case_id === row.case_id && outcome.result === 'pass') && comparable.some(outcome => outcome.case_id === row.case_id && outcome.result === 'fail')).map(row => row.case_id);
  const incomparable = state.outcomes.filter(row => row.oracle_digest !== oracle || row.subject_digest !== state.model.subject_digest).map(row => row.execution_id);
  return { model_digest: state.model_digest, subject_digest: state.model.subject_digest, oracle_digest: oracle, strength: state.model.strength, population: { cartesian: domain.cartesian, feasible: domain.assignments.length, selected: cases.length }, feasible_tuples: domain.feasible.length, excluded_tuples: domain.excluded.length,
    planned_tuple_coverage: { covered: planned.length, total: domain.feasible.length }, recorded_execution_tuple_coverage: { covered: recorded.length, total: domain.feasible.length },
    case_counts: { pass: new Set(comparable.filter(row => row.result === 'pass').map(row => row.case_id)).size, fail: new Set(comparable.filter(row => row.result === 'fail').map(row => row.case_id)).size, unresolved: new Set(comparable.filter(row => row.result === 'unresolved').map(row => row.case_id)).size, unobserved: cases.filter(row => !observed.has(row.case_id)).length },
    conflicts, incomparable, evidence_grade: 'reported' as const, source_freshness: 'unknown' as const,
    gaps: domain.feasible.filter(tuple => !recorded.some(row => row.tuple_id === tuple.tuple_id)).map(tuple => ({ ...tuple, reason: planned.some(row => row.tuple_id === tuple.tuple_id) ? 'no_comparable_execution' as const : 'not_selected' as const })), excluded: domain.excluded };
}
