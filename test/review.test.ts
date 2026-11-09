import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createPmCliExpectedError, writeSettingsSection } from '@unbrained/pm-cli/sdk';
import { decode } from '@toon-format/toon';
import { CaseRefusal, createDirectoryHost, readCaseModel, readState, caseCoverage, casePacket, explainCaseTuple, recoverCaseOperation, proposeCases, selectCases, recordCaseOutcome, createCaseModel, normalizeModel, enumerateFeasibleTuples, generateCover, canonical } from '../dist/index.js';
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
  const installs = [...text.matchAll(/npm install (?:\.{1,2}\/[^\s`]+\.tgz|"\$archive")/g)]; assert.ok(installs.length > 0);
  for (const install of installs) {
    const preceding = text.slice(0, install.index);
    assert.match(preceding, /npm ci\s+npm pack/);
    assert.ok(preceding.includes('newly built review archive'));
    assert.ok(preceding.includes('maintainer-supplied copy and its matching SHA-256 receipt'));
  }
});

test('directory hosts pin relative operator roots across every SDK lifecycle and cwd change', async t => {
  await assert.doesNotReject(async () => {
    const { root, native, birth, pmRoot } = await fixture(t, false); const previous = process.cwd();
    const elsewhere = join(root, 'elsewhere'); await mkdir(elsewhere);
    await writeSettingsSection(pmRoot, 'case', { output_budget: 2048 }, { author: 'fixture', expectedRevision: null });
    try {
      process.chdir(root);
      const host = createDirectoryHost('.agents/pm', 'fixture');
      process.chdir(elsewhere);
      assert.equal(typeof host.settings, 'function'); assert.deepEqual(await host.settings!(), { output_budget: 2048 });
      assert.equal(await host.normalizeId!('suite'), birth.id);
      await createCaseModel(host, birth); const plan = await select(host, birth.id);
      await recordCaseOutcome(host, await request(host, birth.id, 'relative-root'));
      const coverage = await caseCoverage(host, { id: birth.id });
      await explainCaseTuple(host, { id: birth.id, tuple: coverage.gaps[0].tuple_id });
      assert.equal((await recoverCaseOperation(host, { id: birth.id, op: 'birth' })).outcome, 'committed');
      for (const format of ['json', 'toon'] as const) {
        const value = fitEnvelope(host, envelope(await casePacket(host, { id: birth.id, limit: 1 })));
        assert.deepEqual(format === 'json' ? JSON.parse(renderOutput(value, format)) : decode(renderOutput(value, format)), value);
      }
      assert.equal((await readCaseModel(host, birth.id)).state.outcomes.length, 1);
      assert.equal((await native.readItemRevision(birth.id)).item_hash, (await readCaseModel(host, birth.id)).revision);
      assert.equal(plan.complete, true); assert.equal(await historyEvents(pmRoot, birth.id), 3);
    } finally { process.chdir(previous); }
  });
});
