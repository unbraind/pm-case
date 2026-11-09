import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createDirectoryHost, createCaseModel, readCaseModel, proposeCases, selectCases, digest } from '../dist/index.js';
import type { Host, CaseModel, Outcome, RecordCaseOutcomeInput } from '../dist/index.js';
import type { TestContext } from 'node:test';
/** Public synthetic reference pins independent snapshot and content identities. */
export function source() { return { item_id: 'corpus-source', item_hash: digest('public source revision'), field_pointer: '/description', content_digest: digest('public source passage') }; }
/** Small non-software finite model used by every isolated lifecycle journey. */
export function model(patch: Partial<CaseModel> = {}): CaseModel { return { model_key: 'growing', factors: ['light','water','soil'].map(factor_id => ({ factor_id, values: ['low','high'], label: factor_id, source_refs: [source()] })), strength: 2, forbidden_tuples: [], mandatory_cases: [], subject_digest: digest('seed-batch'), ...patch }; }
/** Real SDK tracker outside Git; cleanup is registered before initialization. */
export async function fixture(t: TestContext, provision = true) {
  const root = await mkdtemp(join(tmpdir(), 'pm-case-')); t.after(() => rm(root, { recursive: true, force: true }));
  const pmRoot = join(root, '.agents/pm'); const native = new PmClient({ cwd: root, pmRoot, author: 'fixture', noExtensions: true });
  await native.init('corpus', { defaults: true, agentGuidance: 'skip', mergeFence: false });
  const host = createDirectoryHost(pmRoot, 'fixture'); const birth = { id: 'corpus-suite', op: 'birth', title: 'Public finite inputs', model: model() };
  if (provision) await createCaseModel(host, birth); return { root, pmRoot, native, host, birth, id: birth.id };
}
/** Explicitly select a deterministic bounded plan at the current native revision. */
export async function select(host: Host, id: string, max_cases = 32, op = 'selection') { const plan = await proposeCases(host, { id, max_cases }); await selectCases(host, { id, op, revision: plan.revision, proposal: plan.proposal, max_cases }); return plan; }
/** Deterministic reported observation with a valid full provenance receipt. */
export function observation(case_id: string, execution_id: string, patch: Partial<Outcome> = {}): Outcome { return { execution_id, case_id, subject_digest: model().subject_digest, oracle_digest: digest('measured growth'), result: 'pass', reason: 'Public fixture outcome', source_refs: [source()], observed_at: '2026-11-05T00:00:00Z', recorder: 'fixture', evidence_grade: 'reported', ...patch }; }
/** Freshly reviewed append uses native selected-case identity. */
export async function request(host: Host, id: string, key: string, patch: Partial<Outcome> = {}): Promise<RecordCaseOutcomeInput> { const owner = await readCaseModel(host, id); return { id, op: `record-${key}`, revision: owner.revision, outcome: observation(owner.state.selected_plan!.cases[0].case_id, key, patch) }; }
/** Match a stable refusal category without depending on display text. */
export function hasCode(code: string): (error: unknown) => boolean { return error => typeof error === 'object' && error !== null && 'code' in error && error.code === code; }
/** Native audit size verifies that replay never produces a second mutation. */
export async function historyEvents(pmRoot: string, id: string): Promise<number> { return (await readFile(join(pmRoot, 'history', `${id}.jsonl`), 'utf8')).trim().split('\n').length; }
