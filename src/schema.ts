import { createHash } from 'node:crypto';
import { z } from 'zod';
import { scanMutationSecrets } from '@unbrained/pm-cli/sdk';
import { insist, CaseRefusal } from './errors.ts';
/** Stable bounded identifier, normalized identically on write and replay. */
export const KeySchema = z.string().trim().min(1).max(96).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
/** Canonical SHA-256 content identity. */
export const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
/** Independently captured source snapshot; no freshness or truth claim. */
export const SourceRefSchema = z.strictObject({ item_id: KeySchema, item_hash: DigestSchema, field_pointer: z.string().min(1).max(256), content_digest: DigestSchema, citation_id: KeySchema.optional() });
/** Factor IDs map to explicitly admitted value IDs. */
export const AssignmentSchema = z.record(KeySchema, KeySchema);
/** Immutable finite factor with a human-reviewed definition. */
export const FactorSchema = z.strictObject({ factor_id: KeySchema, values: z.array(KeySchema).min(2).max(8), label: z.string().min(1).max(256), source_refs: z.array(SourceRefSchema).min(1).max(16) });
/** Forbidden partial assignment; constraints never execute expressions. */
export const ConstraintSchema = z.strictObject({ assignment: AssignmentSchema, rationale: z.string().min(1).max(512), source_refs: z.array(SourceRefSchema).min(1).max(16) });
/** Bounded first-release model; higher strengths are explicitly unsupported. */
export const CaseModelSchema = z.strictObject({ model_key: KeySchema, factors: z.array(FactorSchema).min(2).max(12), strength: z.union([z.literal(1), z.literal(2)]), forbidden_tuples: z.array(ConstraintSchema).max(64).default([]), mandatory_cases: z.array(AssignmentSchema).max(32).default([]), subject_digest: DigestSchema, predecessor: SourceRefSchema.optional() });
/** One complete assignment with an identity bound to the immutable model. */
export const CaseSchema = z.strictObject({ case_id: DigestSchema, assignment: AssignmentSchema });
/** Exact tuple obligation, including an exclusion witness when impossible. */
export const TupleSchema = z.strictObject({ tuple_id: DigestSchema, assignment: AssignmentSchema });
/** Deterministic bounded covering-set result; no optimality claim. */
export const PlanSchema = z.strictObject({ algorithm: z.literal('exhaustive-greedy-v1'), seed: z.literal(0), model_digest: DigestSchema, max_cases: z.number().int().min(1).max(256), cases: z.array(CaseSchema).max(256), feasible_assignments: z.number().int(), cartesian_assignments: z.number().int(), feasible_tuples: z.number().int(), excluded_tuples: z.number().int(), covered_tuples: z.number().int(), uncovered_tuples: z.number().int(), complete: z.boolean(), proposal_digest: DigestSchema });
/** Reported execution evidence retains every contradictory or unavailable observation. */
export const OutcomeSchema = z.strictObject({ execution_id: KeySchema, case_id: DigestSchema, subject_digest: DigestSchema, oracle_digest: DigestSchema, result: z.enum(['pass','fail','unresolved']), reason: z.string().min(1).max(512), source_refs: z.array(SourceRefSchema).min(1).max(16), observed_at: z.iso.datetime(), recorder: KeySchema, evidence_grade: z.literal('reported').default('reported') });
/** Immutable result of a single native owner mutation. */
export const CommittedResultSchema = z.strictObject({ kind: z.enum(['create','select','record']), identity: z.string().min(1).max(96), sequence: z.number().int().min(1).max(512), digest: DigestSchema });
/** Durable operation keys are never evicted or reused for different requests. */
export const ReplaySchema = z.strictObject({ operation_id: KeySchema, request_digest: DigestSchema, result: CommittedResultSchema, result_digest: DigestSchema });
/** All domain data resides in one registered native case_state field. */
export const CaseStateSchema = z.strictObject({ schema_version: z.literal(1), package: z.literal('pm-case'), model: CaseModelSchema, model_digest: DigestSchema, selected_plan: PlanSchema.optional(), outcomes: z.array(OutcomeSchema).max(256), operation_receipts: z.array(ReplaySchema).min(1).max(512) });
const common = { id: KeySchema };
const write = { ...common, op: KeySchema, budget: z.number().int().min(1).default(1600) };
/** Explicit create-if-absent owner identity and reviewed source model. */
export const CreateCaseModelInputSchema = z.strictObject({ ...write, title: z.string().trim().min(1).max(256), model: CaseModelSchema, related: z.array(KeySchema).max(16).default([]) });
/** Read-only proposal, bound to this exact owner revision and maximum. */
export const ProposeCasesInputSchema = z.strictObject({ ...common, max_cases: z.number().int().min(1).max(256) });
/** Persist only an exactly recomputed proposal at the caller's revision. */
export const SelectCasesInputSchema = z.strictObject({ ...write, revision: DigestSchema, proposal: DigestSchema, max_cases: z.number().int().min(1).max(256) });
/** Append one observed outcome without replacing historical evidence. */
export const RecordCaseOutcomeInputSchema = z.strictObject({ ...write, revision: DigestSchema, outcome: OutcomeSchema });
/** Reconcile a possibly interrupted operation by its retained identity. */
export const RecoveryInputSchema = z.strictObject({ ...common, op: KeySchema });
/** Exact selected-owner coverage query. */
export const CoverageInputSchema = z.strictObject(common);
/** Explain a feasible or excluded tuple by its immutable identity. */
export const ExplainTupleInputSchema = z.strictObject({ ...common, tuple: DigestSchema });
/** Revision- and query-bound bounded resume page. */
export const PacketInputSchema = z.strictObject({ ...common, limit: z.number().int().min(1).max(100).default(20), cursor: z.string().max(1024).optional() });
/** Immutable admitted input model. */
export type CaseModel = z.infer<typeof CaseModelSchema>;
/** Assignment maps admitted factor IDs to admitted values. */
export type Assignment = z.infer<typeof AssignmentSchema>;
/** Versioned authoritative native owner aggregate. */
export type CaseState = z.infer<typeof CaseStateSchema>;
/** Complete deterministic generated case plan. */
export type CasePlan = z.infer<typeof PlanSchema>;
/** Submitted observation, explicitly reported evidence. */
export type Outcome = z.infer<typeof OutcomeSchema>;
/** Public in-process creation request. */
export type CreateCaseModelInput = z.input<typeof CreateCaseModelInputSchema>;
/** Public in-process proposal request. */
export type ProposeCasesInput = z.input<typeof ProposeCasesInputSchema>;
/** Public in-process selection request. */
export type SelectCasesInput = z.input<typeof SelectCasesInputSchema>;
/** Public in-process observation request. */
export type RecordCaseOutcomeInput = z.input<typeof RecordCaseOutcomeInputSchema>;
/** Public operation-key recovery query. */
export type RecoveryInput = z.input<typeof RecoveryInputSchema>;
/** Public in-process coverage request. */
export type CoverageInput = z.input<typeof CoverageInputSchema>;
/** Public in-process tuple query. */
export type ExplainTupleInput = z.input<typeof ExplainTupleInputSchema>;
/** Public in-process resume request. */
export type PacketInput = z.input<typeof PacketInputSchema>;
/** Stable JSON identity ignores object key order, but preserves array order and exact text. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
/** SHA-256 content identity for source, requests and results. */
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
/** Absolute home-directory paths, anchored to path-token starts so public URLs and relative paths remain usable. */
const privatePathPattern = /(?:^|(?<=[\s"'`([{<~=;,~:\\/]))(?:[\\/](?:home|Users)[\\/]|[\\/]root(?:[\\/]|\b))/iu;
/** Email-shaped contact text in any submitted string. */
const emailAddressPattern = /(?<![\w.+-])[\w.+-]+@[\w.-]+\.[a-z]{2,}/iu;
/** Aggregate submitted-input traversal budget; over twenty times the largest schema-bounded valid request. */
const submittedNodeBudget = 200000;
/** Refuse unsafe data before it can enter immutable native history. */
export function guardSubmitted(value: unknown, seen = new Set<object>(), depth = 0, visits = { count: 0 }): void {
  insist(depth <= 16, 'invalid_input', 'Input nesting exceeds sixteen levels');
  insist(++visits.count <= submittedNodeBudget, 'invalid_input', 'Submitted input exceeds the traversal budget');
  if (typeof value === 'string') {
    insist(value.length <= 8000 && value.isWellFormed(), 'invalid_input', 'Text is oversized or malformed Unicode');
    insist(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value), 'invalid_input', 'Control sequences are forbidden');
    insist(!privatePathPattern.test(value) && !emailAddressPattern.test(value), 'invalid_input', 'Private paths and email addresses are forbidden');
    insist(scanMutationSecrets(value).length === 0, 'invalid_input', 'SDK privacy guard detected credential-shaped content');
  } else if (value !== null && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    insist(Array.isArray(value) || prototype === Object.prototype || prototype === null, 'invalid_input', 'Only plain JSON data is supported');
    insist(!seen.has(value), 'invalid_input', 'Cyclic input is forbidden'); seen.add(value);
    for (const name of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, name)!;
      insist(typeof name === 'string' && 'value' in descriptor && (descriptor.enumerable || (Array.isArray(value) && name === 'length')), 'invalid_input', 'Only enumerable JSON data properties are supported');
    }
    for (const [name, child] of Object.entries(value)) {
      insist(!['__proto__', 'prototype', 'constructor'].includes(name), 'invalid_input', 'Prototype keys are forbidden'); guardSubmitted(child, seen, depth + 1, visits);
    }
    seen.delete(value);
  }
}
/** Strict JSON schema validation with inert, payload-free errors. */
export function parse<T>(schema: z.ZodType<T>, value: unknown, stored = false): T {
  if (!stored) guardSubmitted(value);
  const result = schema.safeParse(value);
  if (!result.success) throw new CaseRefusal(stored ? 'invalid_record' : (schema as z.ZodType<unknown>) === RecordCaseOutcomeInputSchema && result.error.issues.some(issue => issue.path[0] === 'outcome') ? 'invalid_outcome' : 'invalid_input', 'Strict case contract failed', 'Use the documented finite model and input schema');
  return result.data;
}
