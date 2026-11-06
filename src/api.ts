import { isItemAlreadyExistsError } from '@unbrained/pm-cli/sdk';
import { capable } from './host.ts';
import type { Host, Snapshot } from './host.ts';
import { insist, CaseRefusal, refusal } from './errors.ts';
import { parse, digest, canonical, CreateCaseModelInputSchema, ProposeCasesInputSchema, SelectCasesInputSchema, RecordCaseOutcomeInputSchema, CoverageInputSchema, RecoveryInputSchema, ExplainTupleInputSchema, PacketInputSchema } from './schema.ts';
import type { CaseState, CreateCaseModelInput, ProposeCasesInput, SelectCasesInput, RecordCaseOutcomeInput, CoverageInput, RecoveryInput, ExplainTupleInput, PacketInput } from './schema.ts';
import { readState, normalizeModel, generateCover, evaluateCaseCoverage, enumerateFeasibleTuples, contains } from './kernel.ts';
import { envelope, fitEnvelope } from './output.ts';
import type { CaseData } from './output.ts';

/** Full authorized selected-owner read; schema activation never mutates during reads. */
export async function readCaseModel(host: Host, id: string): Promise<Snapshot> {
  capable(host);
  try {
    const got = await host.client.get(id, { outputInclude: 'full', outputBudget: 'unbounded', outputLimit: 'unbounded' });
    insist('item' in got && 'item_hash' in got && typeof got.item_hash === 'string', 'incomplete_read', 'The host omitted the selected owner revision');
    insist(got.item.type === 'CaseModel', 'invalid_record', 'Selected item is not a CaseModel');
    const state = readState(got.item.case_state); insist(state.operation_receipts[0].result.identity === got.item.id, 'invalid_record', 'Stored creation receipt belongs to another owner');
    return { id: got.item.id, revision: got.item_hash, state };
  } catch (error) { if (refusal(error).code === 'item_not_found') throw new CaseRefusal('not_found', 'Case model was not found', 'Select an existing authorized owner'); throw refusal(error); }
}
/** Optional observable process boundary; never an alternative storage mechanism. */
async function boundary(host: Host, step: string): Promise<void> { await host.boundary?.(step); }
/** Check original request identity before considering a stale revision. */
function replay(state: CaseState, op: string, request: unknown) {
  const found = state.operation_receipts.find(row => row.operation_id === op);
  if (found) insist(found.request_digest === digest(request), 'operation_conflict', 'Operation key belongs to another request', 'Replay the original request or choose a new key for a separately reviewed operation');
  return found;
}
/** Persist replay identity and bound every owner resource before native writes. */
function remember(state: CaseState, op: string, request: unknown, kind: 'create' | 'select' | 'record', identity: string, content: unknown) {
  insist(state.operation_receipts.length < 512 && state.outcomes.length <= 256, 'capacity_exceeded', 'Owner count capacity reached', 'Create a successor owner; operation keys are never evicted');
  const result = { kind, identity, sequence: state.operation_receipts.length + 1, digest: digest(content) };
  const operation = { operation_id: op, request_digest: digest(request), result, result_digest: digest(result) }; state.operation_receipts.push(operation); readState(state); return operation;
}
/** Form the same committed payload before and after the atomic host mutation. */
function committed(id: string, revision: string, operation: CaseState['operation_receipts'][number], replayed: boolean) {
  return { owner_id: id, revision, ...operation, replayed, outcome: 'committed' as const };
}
/** Current read-back revision is distinct from the immutable original operation result. */
async function receipt(host: Host, id: string, operation: CaseState['operation_receipts'][number], replayed: boolean) {
  await boundary(host, 'before_receipt'); const current = await host.client.readItemRevision(id);
  return committed(id, current.item_hash, operation, replayed);
}
/** Refuse a too-small write result before any item, schema or history change. */
function preflight(host: Host, id: string, operation: CaseState['operation_receipts'][number], budget: number): void { fitEnvelope(host, envelope(committed(id, 'f'.repeat(64), operation, false)), budget); }
/** Create once at an explicit native identity; duplicate recovery cannot adopt another owner's state. */
export async function createCaseModel(host: Host, raw: CreateCaseModelInput) {
  try {
    const submitted = parse(CreateCaseModelInputSchema, raw); capable(host);
    const related = [...new Set(await Promise.all(submitted.related.map(async id => await host.normalizeId?.(id) ?? id)))].sort();
    const { budget, ...input } = { ...submitted, id: await host.normalizeId?.(submitted.id) ?? submitted.id, related, model: normalizeModel(submitted.model) };
    enumerateFeasibleTuples(input.model);
    const state: CaseState = { schema_version: 1, package: 'pm-case', model: input.model, model_digest: digest(input.model), outcomes: [], operation_receipts: [] };
    const operation = remember(state, input.op, input, 'create', input.id, input.model); preflight(host, input.id, operation, budget);
    await host.prepareCreate?.(); await boundary(host, 'before_create');
    try {
      const result = await host.client.create({ id: input.id, title: input.title, type: 'CaseModel', field: [`case_state=${canonical(state)}`], comment: ['case:create explicit finite model; submitted text is data'], dep: input.related.map(id => `id=${id},kind=related`) });
      await boundary(host, 'after_create'); return await receipt(host, result.item.id, operation, false);
    } catch (error) {
      if (!isItemAlreadyExistsError(error)) throw error;
      const current = await readCaseModel(host, input.id); const original = replay(current.state, input.op, input);
      insist(original?.result.kind === 'create' && original.result.sequence === 1 && original.result.identity === input.id, 'operation_conflict', 'Existing identity belongs to another creation request', 'Choose a new explicit owner identity');
      return await receipt(host, current.id, original, true);
    }
  } catch (error) { throw refusal(error); }
}
/** Bind the deterministic plan to the exact current native revision and declared bound. */
function proposal(owner: Snapshot, maxCases: number) { const plan = generateCover(owner.state.model, { max_cases: maxCases }); return { owner_id: owner.id, revision: owner.revision, ...plan, proposal: digest({ owner_id: owner.id, revision: owner.revision, plan: plan.proposal_digest }) }; }
/** Propose without persisting or claiming any execution evidence. */
export async function proposeCases(host: Host, raw: ProposeCasesInput) { const input = parse(ProposeCasesInputSchema, raw); return proposal(await readCaseModel(host, input.id), input.max_cases); }
/** Native compare-and-set of the single authoritative owner; stale requests never silently rebase. */
async function mutate(host: Host, parsed: ReturnType<typeof SelectCasesInputSchema.parse> | ReturnType<typeof RecordCaseOutcomeInputSchema.parse>) {
  try {
    const { budget, ...submitted } = parsed; const owner = await readCaseModel(host, submitted.id); await boundary(host, 'after_read'); const input = { ...submitted, id: owner.id };
    const original = replay(owner.state, input.op, input);
    if (original) { preflight(host, owner.id, original, budget); return await receipt(host, owner.id, original, true); }
    insist(owner.revision === input.revision, 'revision_conflict', 'Caller revision is stale', 'Reread the owner and consciously retry with its current revision');
    const state = structuredClone(owner.state); let operation: CaseState['operation_receipts'][number];
    if ('proposal' in input) {
      const proposed = proposal(owner, input.max_cases);
      insist(proposed.proposal === input.proposal, 'operation_conflict', 'Recomputed proposal digest differs', 'Propose again at the current revision with the same max_cases');
      const plan = generateCover(state.model, { max_cases: input.max_cases });
      insist(state.outcomes.every(row => plan.cases.some(selected => selected.case_id === row.case_id)), 'operation_conflict', 'Selection would discard an observed case', 'Extend the maximum or create a successor model');
      state.selected_plan = plan; operation = remember(state, input.op, input, 'select', plan.proposal_digest, plan);
    } else {
      const outcome = input.outcome;
      insist(outcome.subject_digest === state.model.subject_digest, 'subject_mismatch', 'Execution subject differs from this model', 'Create a successor model for the changed subject');
      insist(state.selected_plan?.cases.some(row => row.case_id === outcome.case_id), 'unknown_case', 'Execution does not name a selected case', 'Select a valid proposal first');
      insist(!state.outcomes.some(row => row.execution_id === outcome.execution_id), 'operation_conflict', 'Execution identity already exists', 'Use the original operation key or a new execution identity');
      state.outcomes.push(outcome); operation = remember(state, input.op, input, 'record', outcome.execution_id, outcome);
    }
    preflight(host, owner.id, operation, budget); await boundary(host, 'before_guard'); await boundary(host, 'before_update');
    try {
      const checked = await host.client.withExpectedItemRevisions([{ id: owner.id, itemHash: owner.revision }], () => host.client.update(owner.id, { field: [`case_state=${canonical(state)}`], comment: [`case:${operation.result.kind} reviewed operation; evidence remains reported`] }));
      await boundary(host, 'after_update'); insist(checked.checked.includes(owner.id) && checked.unchecked.length === 0, 'backend_unsupported', 'Host did not prove the native owner guard', 'Reconcile the original operation key using a conforming host');
      await boundary(host, 'after_guard'); return await receipt(host, owner.id, operation, false);
    } catch (error) {
      if (refusal(error).code !== 'revision_conflict') throw error;
      const current = await readCaseModel(host, owner.id); const concurrentReplay = replay(current.state, input.op, input);
      if (concurrentReplay) return await receipt(host, owner.id, concurrentReplay, true);
      throw error;
    }
  } catch (error) { throw refusal(error); }
}
/** Persist an exactly recomputed complete or explicitly partial proposal. */
export async function selectCases(host: Host, raw: SelectCasesInput) { return mutate(host, parse(SelectCasesInputSchema, raw)); }
/** Append reported evidence exactly once; never execute a case or collapse conflicting observations. */
export async function recordCaseOutcome(host: Host, raw: RecordCaseOutcomeInput) { return mutate(host, parse(RecordCaseOutcomeInputSchema, raw)); }
/** Return all planned, observed, excluded and still-unobserved tuple obligations. */
export async function caseCoverage(host: Host, raw: CoverageInput) { const input = parse(CoverageInputSchema, raw); const owner = await readCaseModel(host, input.id); return { owner_id: owner.id, revision: owner.revision, ...evaluateCaseCoverage(owner.state) }; }
/** Explain feasibility using a full assignment witness, or retain every declared exclusion rationale. */
export async function explainCaseTuple(host: Host, raw: ExplainTupleInput) {
  const input = parse(ExplainTupleInputSchema, raw); const owner = await readCaseModel(host, input.id); const domain = enumerateFeasibleTuples(owner.state.model);
  const tuple = [...domain.feasible, ...domain.excluded].find(row => row.tuple_id === input.tuple); insist(tuple, 'invalid_input', 'Tuple does not belong to this model', 'Choose a tuple from coverage or packet');
  const full = domain.assignments.find(row => contains(row, tuple.assignment)); const selected = (owner.state.selected_plan?.cases ?? []).filter(row => contains(row.assignment, tuple.assignment)).map(row => row.case_id);
  return { owner_id: owner.id, revision: owner.revision, tuple, feasible: full !== undefined, witness: full ? { case_id: digest({ model_digest: owner.state.model_digest, assignment: full }), assignment: full } : null, selected_case_ids: selected, observed_execution_ids: owner.state.outcomes.filter(row => selected.includes(row.case_id)).map(row => row.execution_id), constraints: full ? [] : owner.state.model.forbidden_tuples, reason: full ? 'feasible' as const : 'no_valid_completion' as const, evidence_grade: 'reported' as const };
}
/** Bounded revision-bound page retains complete denominators, gaps, unknowns and conflict summary. */
export async function casePacket(host: Host, raw: PacketInput) {
  const input = parse(PacketInputSchema, raw); const owner = await readCaseModel(host, input.id); const query = digest({ owner_id: owner.id, limit: input.limit, ordering: 'cases-gaps-excluded-v1' }); let offset = 0;
  if (input.cursor !== undefined) {
    let decoded: unknown; try { decoded = JSON.parse(Buffer.from(input.cursor, 'base64url').toString('utf8')) as unknown; } catch { throw new CaseRefusal('stale_cursor', 'Cursor is malformed', 'Restart case packet without a cursor'); }
    insist(typeof decoded === 'object' && decoded !== null && canonical(Object.keys(decoded).sort()) === canonical(['offset','query','revision']), 'stale_cursor', 'Cursor contract differs', 'Restart case packet');
    const cursor = decoded as { offset: number; query: string; revision: string };
    insist(cursor.revision === owner.revision && cursor.query === query && Number.isSafeInteger(cursor.offset) && cursor.offset >= 0, 'stale_cursor', 'Cursor owner revision or query changed', 'Restart case packet'); offset = cursor.offset;
  }
  const { gaps, excluded, ...summary } = evaluateCaseCoverage(owner.state);
  const all = [...(owner.state.selected_plan?.cases ?? []).map(row => ({ ...row, kind: 'case' as const })), ...gaps.map(row => ({ ...row, kind: 'gap' as const })), ...excluded.map(row => ({ ...row, kind: 'excluded' as const, reason: 'no_valid_completion' as const }))];
  insist(offset <= all.length, 'stale_cursor', 'Cursor offset exceeds the complete scope', 'Restart case packet'); const rows = all.slice(offset, offset + input.limit); const next = offset + rows.length;
  return { owner_id: owner.id, revision: owner.revision, summary, rows, total: all.length, returned: rows.length, omitted: all.length - rows.length, previously_returned: offset, remaining: all.length - next, next_cursor: next < all.length ? Buffer.from(canonical({ revision: owner.revision, query, offset: next })).toString('base64url') : null };
}
/** Immutable committed identity plus current owner revision. */
export type MutationReceipt = Awaited<ReturnType<typeof createCaseModel>>;
/** Complete deterministic proposal at a captured owner revision. */
export type CaseProposal = Awaited<ReturnType<typeof proposeCases>>;
/** Exact full-population coverage receipt. */
export type CoverageReport = Awaited<ReturnType<typeof caseCoverage>>;
/** Feasibility and selected-case explanation. */
export type TupleExplanation = Awaited<ReturnType<typeof explainCaseTuple>>;
/** Bounded resume packet with an opaque continuation. */
export type CasePacket = Awaited<ReturnType<typeof casePacket>>;
/** Shared command result contract usable by injected applications. */
export type CaseOperationResult = CaseData;

/** Reconcile one retained operation key without writing or assuming that a missing receipt means failure. */
export async function recoverCaseOperation(host: Host, raw: RecoveryInput) {
  const input = parse(RecoveryInputSchema, raw);
  try {
    const owner = await readCaseModel(host, input.id); const operation = owner.state.operation_receipts.find(row => row.operation_id === input.op);
    return operation ? { outcome: 'committed' as const, receipt: committed(owner.id, owner.revision, operation, true) } : { outcome: 'not_committed' as const, owner_id: owner.id, operation_id: input.op, revision: owner.revision, remedy: 'Retry only the original key and reviewed request; do not substitute a fresh key' };
  } catch (error) {
    const failure = refusal(error);
    return { outcome: failure.code === 'not_found' ? 'not_committed' as const : 'outcome_unknown' as const, owner_id: input.id, operation_id: input.op, revision: null, remedy: failure.remedy };
  }
}
