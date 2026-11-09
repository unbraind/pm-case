import test from 'node:test';
import assert from 'node:assert/strict';
import { createExtensionTestHarness, decodeToon } from '@unbrained/pm-cli/sdk/testing';
import { fitOutputEnvelope } from '@unbrained/pm-cli/sdk';
import extension, { createCaseModel, recordCaseOutcome, readCaseModel, casePacket, envelope, fitEnvelope, CaseRefusal, digest } from '../dist/index.js';
import { runCommand, inputJson } from '../dist/src/commands.js';
import { wire } from '../dist/src/output.js';
import type { CaseResult } from '../dist/index.js';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { fixture, model, select, observation, request, hasCode, historyEvents } from './helpers.ts';

test('native harness exercises all seven commands with equivalent scoped JSON and TOON', async t => {
  const { host, pmRoot, native } = await fixture(t); const ext = await createExtensionTestHarness(extension, { capabilities: ['commands','schema','renderers'] }); t.after(() => ext.deactivate());
  for (const name of ['create','propose','select','record','coverage','explain','packet']) ext.assertCommandContract({ command: `case ${name}` }); ext.assertItemField({ name: 'case_state', type: 'object' }); ext.assertItemType({ name: 'CaseModel', folder: 'case-models' });
  /** Real native extension harness invocation using the shared authorized tracker. */
  const run = async (command: string, options: Record<string, unknown> = {}, global: Record<string, unknown> = {}) => { const value = await ext.runCommand({ command: `case ${command}`, args: ['corpus-cli'], options, global, pmRoot }); if (value.cause) throw value.cause; assert.equal(value.handled, true); return value.result as CaseResult; };
  const birth = await run('create', { id: 'corpus-cli', op: 'birth', input: JSON.stringify({ title: 'CLI suite', model: model() }) }); assert.equal(birth.ok, true);
  const plan = await run('propose', { maxCases: '32' }); assert.ok(plan.data && 'proposal' in plan.data);
  const selected = await run('select', { op: 'plan', proposal: plan.data.proposal, revision: plan.revision, maxCases: '32' }); assert.equal(selected.ok, true);
  const outcome = observation(plan.data.cases[0].case_id, 'first'); const first = await run('record', { op: 'first', revision: selected.revision, input: JSON.stringify({ outcome }) }); assert.equal(first.ok, true);
  assert.equal((await run('coverage', {}, { outputBudget: 'unbounded' })).ok, true);
  const tuple = (await casePacket(host, { id: 'corpus-cli', limit: 100 })).rows.find(row => row.kind === 'gap'); assert.ok(tuple && 'tuple_id' in tuple);
  assert.equal((await run('explain', { tuple: tuple.tuple_id })).ok, true);
  const page = await run('packet', { limit: '1' }); assert.ok(page.next_cursor);
  for (const format of ['json','toon'] as const) { const rendered = await ext.runRendererOverride({ format, command: 'case packet', result: page }); const decoded = format === 'json' ? JSON.parse(String(rendered.rendered)) : decodeToon(String(rendered.rendered)); assert.deepEqual(decoded, page); assert.ok(Buffer.byteLength(String(rendered.rendered)) <= 6400); }
  assert.equal((await run('packet', { limit: '1', cursor: page.next_cursor })).ok, true);
  assert.equal((await run('packet', { limit: '1' }, { outputCursor: page.next_cursor })).ok, true);
  assert.equal((await run('packet', {}, { outputLimit: '1', outputBudget: '1600' })).ok, true);
  assert.equal((await run('packet', { limit: '1', budget: '1600' })).ok, true);
  for (const [command, options, global, code] of [
    ['record', { op: 'stale', revision: birth.revision, input: JSON.stringify({ outcome }) }, {}, 'revision_conflict'],
    ['record', { op: 'bad', revision: '', input: '{}' }, {}, 'invalid_input'],
    ['create', { id: 'corpus-refused', op: 'bad', input: '{"id":"other"}' }, {}, 'invalid_input'],
    ['create', { id: 'corpus-refused', op: 'small', input: JSON.stringify({ title: 'Small', model: model() }) }, { outputBudget: '1' }, 'output_budget'],
    ['packet', { limit: '1.5' }, {}, 'invalid_input'], ['packet', { limit: '101' }, {}, 'invalid_input'], ['packet', {}, { outputBudget: 0 }, 'invalid_input'], ['packet', {}, { outputBudget: [] }, 'invalid_input'], ['packet', {}, { outputBudget: '99999999999999999' }, 'invalid_input'],
    ['explain', { tuple: [] }, {}, 'invalid_input'], ['packet', {}, { outputInclude: 'id' }, 'invalid_input'], ['packet', {}, { outputSession: 'x' }, 'invalid_input'], ['packet', {}, { outputRowContract: 'x' }, 'invalid_input'],
    ['coverage', {}, { outputCursor: 'bad' }, 'invalid_input'], ['coverage', {}, { outputLimit: 1 }, 'invalid_input'],
    ['packet', { cursor: page.next_cursor }, { outputCursor: page.next_cursor }, 'invalid_input'], ['packet', { limit: '1' }, { outputLimit: '2' }, 'invalid_input'], ['packet', { budget: '1600' }, { outputBudget: '1600' }, 'invalid_input'],
  ] as const) assert.equal((await run(command, options, global)).refusal?.code, code);
  await assert.rejects(native.get('corpus-refused'), hasCode('item_not_found'));
  assert.equal((await runCommand('packet', { command: 'case packet', args: [], options: {}, global: {}, pm_root: pmRoot } as CommandHandlerContext) as CaseResult).refusal?.code, 'backend_unsupported');
});
test('stdin is bounded fatal UTF-8 JSON without executable expressions or side-file reads', async () => {
  /** A deterministic byte stream for malformed encoding boundary cases. */
  async function* stream(bytes: Uint8Array) { yield bytes; }
  assert.deepEqual(await inputJson('-', stream(Buffer.from('{"safe":"é"}'))), { safe: 'é' });
  for (const value of ['{','[]','null','"text"','x'.repeat(262145)]) await assert.rejects(inputJson(value), hasCode('invalid_input'));
  await assert.rejects(inputJson('-', stream(Buffer.from([0xff]))), hasCode('invalid_input')); await assert.rejects(inputJson('-', stream(Buffer.alloc(262145))), hasCode('invalid_input'));
});
test('opaque packet cursors bind exact owner revision query ordering and range', async t => {
  const { host, id, pmRoot } = await fixture(t); await select(host, id); const before = await historyEvents(pmRoot, id); const first = await casePacket(host, { id, limit: 1 }); assert.ok(first.next_cursor); assert.equal(first.returned, 1); assert.equal(first.omitted, first.total - 1);
  let cursor: string | undefined = first.next_cursor; let count = 1;
  while (cursor) { const page = await casePacket(host, { id, limit: 1, cursor }); count += page.returned; assert.ok(page.returned > 0 && count <= first.total, 'Pagination must terminate within the declared population'); assert.equal(page.returned + page.omitted, page.total); assert.equal(page.previously_returned + page.returned + page.remaining, page.total); assert.equal(envelope(page).output_complete, page.returned === page.total); cursor = page.next_cursor ?? undefined; }
  assert.equal(count, first.total); assert.equal(await historyEvents(pmRoot, id), before);
  for (const cursor of ['bad', Buffer.from('null').toString('base64url'),Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify({ offset: -1, query: 'x', revision: first.revision })).toString('base64url')]) await assert.rejects(casePacket(host, { id, limit: 1, cursor }), hasCode('stale_cursor'));
  await assert.rejects(casePacket(host, { id, limit: 2, cursor: first.next_cursor }), hasCode('stale_cursor'));
  const changed = JSON.parse(Buffer.from(first.next_cursor, 'base64url').toString()); changed.offset = 1000; await assert.rejects(casePacket(host, { id, limit: 1, cursor: Buffer.from(JSON.stringify(changed)).toString('base64url') }), hasCode('stale_cursor'));
  await recordCaseOutcome(host, await request(host, id, 'new')); await assert.rejects(casePacket(host, { id, limit: 1, cursor: first.next_cursor }), hasCode('stale_cursor'));
});
test('whole-envelope token estimates count framing and provide an actually usable retry', async t => {
  const { host, id } = await fixture(t); const value = envelope(await casePacket(host, { id, limit: 1 })); const fitted = fitEnvelope(host, value); assert.ok(fitted.output_fit.estimated_tokens <= 1600); assert.deepEqual(JSON.parse(wire(fitted, 'json')), decodeToon(wire(fitted, 'toon')));
  assert.throws(() => fitEnvelope(host, value, 0), hasCode('invalid_input')); let minimum = 0;
  try { fitEnvelope({}, value, 1); } catch (error) { assert.ok(error instanceof CaseRefusal && error.code === 'output_budget', 'Budget fitting must refuse with the typed output budget refusal'); minimum = (error as CaseRefusal).details.minimum_usable_budget as number; }
  assert.ok(minimum > 1); assert.ok(fitEnvelope({}, value, minimum).output_fit.estimated_tokens <= minimum);
  assert.throws(() => fitEnvelope(host, { ...value, warnings: ['x'.repeat(40000)] }, 8192), hasCode('output_budget'));
  const calls: number[] = []; const observe: typeof fitOutputEnvelope = (rows, options) => { calls.push(options.tokenBudget!); return fitOutputEnvelope(rows, options); }; fitEnvelope({ fitOutputEnvelope: observe }, value); assert.ok(calls.length > 0);
});
test('all write budgets refuse before native item schema or history side effects', async t => {
  const { host, native, birth, id } = await fixture(t, false); const fields = await native.schemaListFields(); await assert.rejects(createCaseModel(host, { ...birth, budget: 1 }), hasCode('output_budget')); assert.deepEqual((await native.schemaListFields()).fields, fields.fields); await assert.rejects(readCaseModel(host, id), hasCode('not_found'));
  await createCaseModel(host, birth); await select(host, id); const before = await readCaseModel(host, id); await assert.rejects(recordCaseOutcome(host, { ...await request(host, id, 'small'), budget: 1 }), hasCode('output_budget')); assert.equal((await readCaseModel(host, id)).revision, before.revision);
  await assert.rejects(recordCaseOutcome(host, { id, op: 'missing', revision: digest('revision'), outcome: observation(digest('missing'), 'missing') }), hasCode('revision_conflict'));
});
