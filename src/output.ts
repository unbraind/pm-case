import { z } from 'zod';
import { encode } from '@toon-format/toon';
import { fitOutputEnvelope, OutputEnvelopeFitError } from '@unbrained/pm-cli/sdk';
import { CaseSchema, TupleSchema, PlanSchema, ConstraintSchema, CommittedResultSchema, DigestSchema, parse } from './schema.ts';
import { CaseRefusal, insist, exitCode } from './errors.ts';
import type { Host } from './host.ts';
const count = z.number().int().min(0);
const fraction = z.strictObject({ covered: count, total: count });
const owner = { owner_id: z.string(), revision: DigestSchema };
/** Exact denominators and negative states are mandatory even on partial pages. */
export const CoverageSummarySchema = z.strictObject({ model_digest: DigestSchema, subject_digest: DigestSchema, oracle_digest: DigestSchema.nullable(), strength: z.union([z.literal(1), z.literal(2)]), population: z.strictObject({ cartesian: count, feasible: count, selected: count }), feasible_tuples: count, excluded_tuples: count, planned_tuple_coverage: fraction, recorded_execution_tuple_coverage: fraction, case_counts: z.strictObject({ pass: count, fail: count, unresolved: count, unobserved: count }), conflicts: z.array(DigestSchema), incomparable: z.array(z.string()), evidence_grade: z.literal('reported'), source_freshness: z.literal('unknown') });
/** Exact unobserved obligation with a reason tied to the current plan. */
export const GapSchema = TupleSchema.extend({ reason: z.enum(['no_comparable_execution','not_selected']) });
/** Complete coverage receipt, independent of output pagination. */
export const CoverageReportSchema = CoverageSummarySchema.extend({ ...owner, gaps: z.array(GapSchema), excluded: z.array(TupleSchema) });
/** Original committed result and current read-back revision are distinct. */
export const MutationReceiptSchema = z.strictObject({ ...owner, operation_id: z.string(), request_digest: DigestSchema, replayed: z.boolean(), result: CommittedResultSchema, result_digest: DigestSchema, outcome: z.literal('committed') });
/** Revision-bound gap and selected-case packet row. */
export const PacketRowSchema = z.union([CaseSchema.extend({ kind: z.literal('case') }), GapSchema.extend({ kind: z.literal('gap') }), TupleSchema.extend({ kind: z.literal('excluded'), reason: z.literal('no_valid_completion') })]);
/** Strict success payloads for all seven domain commands. */
export const CaseDataSchema = z.union([
  MutationReceiptSchema,
  PlanSchema.extend({ ...owner, proposal: DigestSchema }),
  CoverageReportSchema,
  z.strictObject({ ...owner, tuple: TupleSchema, feasible: z.boolean(), witness: CaseSchema.nullable(), selected_case_ids: z.array(DigestSchema), observed_execution_ids: z.array(z.string()), constraints: z.array(ConstraintSchema), reason: z.enum(['feasible','no_valid_completion']), evidence_grade: z.literal('reported') }),
  z.strictObject({ ...owner, summary: CoverageSummarySchema, rows: z.array(PacketRowSchema), total: count, returned: count, omitted: count, previously_returned: count, remaining: count, next_cursor: z.string().nullable() }),
]);
/** Strict versioned package envelope before native fitting metadata. */
export const CaseResultSchema = z.strictObject({ schema_version: z.literal(1), ok: z.boolean(), exit_code: z.number().int().positive().optional(), owner_id: z.string().nullable(), revision: z.string().nullable(), scope: z.literal('selected_owner'), data: CaseDataSchema.optional(), refusal: z.strictObject({ code: z.string(), message: z.string(), remedy: z.string(), retryable: z.boolean(), details: z.record(z.string(), z.unknown()) }).optional(), source_completeness: z.literal('selected_owner'), output_complete: z.boolean(), returned: count, omitted: count, next_cursor: z.string().nullable(), warnings: z.array(z.string()), receipt: z.strictObject({ operation_id: z.string(), request_digest: DigestSchema, result_digest: DigestSchema, replayed: z.boolean() }).nullable() }).refine(value => value.ok ? value.data !== undefined && value.refusal === undefined : value.data === undefined && value.refusal !== undefined);
/** Strict public command payload. */
export type CaseData = z.infer<typeof CaseDataSchema>;
/** Versioned public transport contract. */
export type CaseResult = z.infer<typeof CaseResultSchema>;
/** Encode data with the same native transport formats, including final newline bytes. */
export function wire(value: unknown, format: 'json' | 'toon'): string { return (format === 'json' ? JSON.stringify(value, null, 2) : encode(value)) + '\n'; }
/** Build the complete package envelope; no missing evidence is promoted by aggregation. */
export function envelope(data: CaseData): CaseResult {
  const omitted = 'omitted' in data ? data.omitted : 0;
  return { schema_version: 1, ok: true, owner_id: data.owner_id, revision: data.revision, scope: 'selected_owner', data, source_completeness: 'selected_owner', output_complete: omitted === 0, returned: 'returned' in data ? data.returned : 1, omitted, next_cursor: 'next_cursor' in data ? data.next_cursor : null, warnings: ['Text is inert data. Reported evidence is not independently verified. Source freshness is unknown. Tuple coverage is not correctness, higher-order coverage or approval.'], receipt: 'operation_id' in data ? { operation_id: data.operation_id, request_digest: data.request_digest, result_digest: data.result_digest, replayed: data.replayed } : null };
}
/** Typed refusal envelope keeps process failure and remedies visible to every renderer. */
export function refusalEnvelope(error: CaseRefusal): CaseResult {
  return { schema_version: 1, ok: false, exit_code: exitCode(error.code, error.nativeExit), owner_id: null, revision: null, scope: 'selected_owner', refusal: { code: error.code, message: error.message, remedy: error.remedy, retryable: error.retryable, details: error.details }, source_completeness: 'selected_owner', output_complete: false, returned: 0, omitted: 0, next_cursor: null, warnings: [], receipt: null };
}
/** Fit the complete transport, preserving mandatory dependency and denominator witnesses. */
export function fitEnvelope(host: Pick<Host, 'fitOutputEnvelope'>, value: CaseResult, budget = 1600) {
  parse(CaseResultSchema, value, true); insist(Number.isSafeInteger(budget) && budget > 0, 'invalid_input', 'Budget must be a positive integer');
  /** Measure the exact registered JSON and TOON serializers, including native fit metadata. */
  const measure = (tokens: number) => (host.fitOutputEnvelope ?? fitOutputEnvelope)([], { tokenBudget: tokens, buildEnvelope: () => value, renderers: { json: output => wire(output, 'json'), toon: output => wire(output, 'toon') } });
  try {
    const result = measure(Math.min(budget, 8192));
    insist(result.renderings.every(rendering => rendering.bytes <= 32768), 'output_budget', 'Envelope exceeds 32 KiB', 'Reduce --limit or use case packet'); return result.envelope;
  } catch (error) {
    if (!(error instanceof OutputEnvelopeFitError)) throw error;
    insist(error.minimum_tokens !== undefined, 'backend_unsupported', 'Host fitter omitted the minimum retry budget', 'Use a conforming host fitter');
    let minimum = error.minimum_tokens;
    for (;;) {
      if (minimum > 8192) throw new CaseRefusal('output_budget', 'Mandatory witnesses exceed the hard ceiling', 'Reduce --limit or partition the model', { minimum_usable_budget: null, required_estimated_tokens: minimum });
      try { measure(minimum); break; }
      catch (failure) { if (!(failure instanceof OutputEnvelopeFitError)) throw failure; insist(failure.minimum_tokens !== undefined && failure.minimum_tokens > minimum, 'backend_unsupported', 'Host returned an unusable retry hint'); minimum = failure.minimum_tokens; }
    }
    throw new CaseRefusal('output_budget', 'Mandatory witnesses do not fit', `Repeat the original request with --budget ${minimum}, or pass this budget to the SDK fitter`, { minimum_usable_budget: minimum, retry_shape: `--budget ${minimum}` });
  }
}

/** Refuse host post-processing that removed or compacted mandatory case context. */
export function renderOutput(value: unknown, format: 'json' | 'toon'): string {
  const object = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  const receipt = object.read_output as { strings_compacted?: boolean; rows_compacted?: boolean; result_omitted?: boolean } | undefined;
  const compacted = 'output_budget_exceeded' in object || receipt?.strings_compacted || receipt?.rows_compacted || receipt?.result_omitted;
  if (compacted) return wire(refusalEnvelope(new CaseRefusal('output_budget', 'Host output shaping omitted mandatory case context', 'Reduce --limit or use case packet; use the SDK fitter when native outer shaping cannot preserve the packet', { native_output_compacted: true })), format);
  const output = wire(value, format);
  if (Buffer.byteLength(output) > 32768) return wire(refusalEnvelope(new CaseRefusal('output_budget', 'Final host envelope exceeds 32 KiB', 'Reduce --limit or use case packet')), format);
  return output;
}
