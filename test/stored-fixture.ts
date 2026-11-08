import { normalizeModel, generateCover, digest, canonical } from '../dist/index.js';
import type { CaseState } from '../dist/index.js';

/** Model an older schema-v1 owner with inert text newly refused by submission policy. */
export function historicalState(original: CaseState): CaseState {
  const state = structuredClone(original);
  const text = 'historical-contact' + '@' + 'example.org';
  for (const factor of state.model.factors) {
    factor.label = text;
    for (const reference of factor.source_refs) reference.field_pointer = '/' + text;
  }
  for (const constraint of state.model.forbidden_tuples) constraint.rationale = text;
  state.model = normalizeModel(state.model, true); state.model_digest = digest(state.model);
  const previous = state.selected_plan;
  if (previous) {
    state.selected_plan = generateCover(state.model, { max_cases: previous.max_cases }, true);
    for (const outcome of state.outcomes) {
      const assignment = previous.cases.find(row => row.case_id === outcome.case_id)!.assignment;
      outcome.case_id = state.selected_plan.cases.find(row => canonical(row.assignment) === canonical(assignment))!.case_id;
      outcome.reason = text;
    }
  }
  for (const receipt of state.operation_receipts) {
    const result = receipt.result;
    if (result.kind === 'create') result.digest = state.model_digest;
    else if (result.kind === 'select') { result.digest = digest(state.selected_plan); result.identity = state.selected_plan!.proposal_digest; }
    else result.digest = digest(state.outcomes.find(row => row.execution_id === result.identity));
    receipt.result_digest = digest(result);
  }
  return state;
}
