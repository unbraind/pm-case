import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import { decode } from '@toon-format/toon';
import { CaseRefusal, readCaseModel, readState, caseCoverage, casePacket, explainCaseTuple, recoverCaseOperation, proposeCases, selectCases, recordCaseOutcome, createCaseModel, normalizeModel, enumerateFeasibleTuples, generateCover, canonical } from '../dist/index.js';
import { refusal } from '../dist/src/errors.js';
import { refusalEnvelope, renderOutput, envelope, fitEnvelope } from '../dist/src/output.js';
import { runCommand } from '../dist/src/commands.js';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import type { CaseResult } from '../dist/index.js';
import { fixture, select, request, hasCode, historyEvents } from './helpers.ts';
import { historicalState } from './stored-fixture.ts';

test('transient refusal metadata survives native conversion and every renderer', () => {
  for (const code of ['lock_conflict', 'revision_conflict', 'contention', 'stale_cursor', 'invalid_input', 'permission_denied', 'outcome_unknown', 'operation_conflict']) {
    const retryable = ['lock_conflict', 'revision_conflict', 'contention', 'stale_cursor'].includes(code);
    for (const failure of [new CaseRefusal(code, 'Safe refusal'), refusal(createPmCliExpectedError('Safe native refusal', { exitCode: 4, context: { code } }))]) {
      assert.equal(failure.retryable, retryable, code);
      for (const format of ['json', 'toon'] as const) {
        const rendered = renderOutput(refusalEnvelope(failure), format);
        const result = (format === 'json' ? JSON.parse(rendered) : decode(rendered)) as CaseResult;
        assert.equal(result.refusal!.code, code); assert.equal(result.refusal!.retryable, retryable);
      }
    }
  }
  assert.equal(refusal(createPmCliExpectedError('Stale', { exitCode: 4, context: { code: 'item_revision_conflict' } })).retryable, true);
});

test('stored owners remain readable across every SDK and CLI path without resubmission', async t => {
  await assert.doesNotReject(async () => {
  const { host, native, id, pmRoot, birth } = await fixture(t); await select(host, id);
  const legacy = historicalState((await readCaseModel(host, id)).state);
  await host.client.update(id, { field: [`case_state=${canonical(legacy)}`] });
  const events = await historyEvents(pmRoot, id);
  for (const pure of [normalizeModel, enumerateFeasibleTuples, (raw: typeof legacy.model, stored = false) => generateCover(raw, { max_cases: 32 }, stored)]) {
    assert.doesNotThrow(() => pure(legacy.model, true));
    assert.throws(() => pure(legacy.model), hasCode('invalid_input'), 'Stored cache entries must never exempt new submissions');
  }
  assert.deepEqual(readState(legacy), legacy);
  assert.throws(() => readState({ ...legacy, model: { ...legacy.model, strength: 3 } }), hasCode('invalid_record'));
  const coverage = await caseCoverage(host, { id }); const tuple = coverage.gaps[0].tuple_id;
  assert.equal((await readCaseModel(host, id)).state.model_digest, legacy.model_digest);
  assert.equal((await proposeCases(host, { id, max_cases: 32 })).model_digest, legacy.model_digest);
  assert.equal((await explainCaseTuple(host, { id, tuple })).feasible, true);
  assert.equal((await recoverCaseOperation(host, { id, op: 'birth' })).outcome, 'committed');
  for (const [command, options] of [['propose', { maxCases: '32', budget: '8192' }], ['coverage', { budget: '8192' }], ['explain', { tuple }], ['packet', { limit: '1' }]] as const) {
    const ctx = { command: `case ${command}`, args: [id], options, global: {}, pm_root: pmRoot, sdk: { client: native, readSettingsSection: async () => ({ value: undefined }) } } as unknown as CommandHandlerContext;
    const value = await runCommand(command, ctx) as CaseResult; assert.equal(value.ok, true, command);
    for (const format of ['json', 'toon'] as const) {
      const rendered = renderOutput(value, format); const decoded = format === 'json' ? JSON.parse(rendered) : decode(rendered);
      assert.deepEqual(decoded, value);
    }
  }
  assert.ok(fitEnvelope(host, envelope(await casePacket(host, { id, limit: 1 }))));
  assert.equal(await historyEvents(pmRoot, id), events, 'All reads retain native immutable history');
  await assert.rejects(createCaseModel(host, { ...birth, id: 'corpus-resubmitted', model: legacy.model }), hasCode('invalid_input'));
  const proposal = await proposeCases(host, { id, max_cases: 32 });
  await selectCases(host, { id, op: 'new-selection', revision: proposal.revision, proposal: proposal.proposal, max_cases: 32 });
  await recordCaseOutcome(host, await request(host, id, 'new-evidence'));
  assert.equal((await caseCoverage(host, { id })).case_counts.pass, 1);
  assert.equal((await recoverCaseOperation(host, { id, op: 'record-new-evidence' })).outcome, 'committed');
  });
});

test('every documented local archive install has preceding build prerequisites and provenance', async () => {
  const text = await readFile('README.md', 'utf8');
  const installs = [...text.matchAll(/npm install (\.\/[^\s`]+\.tgz)/g)]; assert.ok(installs.length > 0);
  for (const install of installs) {
    const preceding = text.slice(0, install.index);
    assert.match(preceding, /npm ci\s+npm pack/);
    assert.ok(preceding.includes('newly built review archive'));
    assert.ok(preceding.includes('maintainer-supplied copy and its matching SHA-256 receipt'));
  }
});
