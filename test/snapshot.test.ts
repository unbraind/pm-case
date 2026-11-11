import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { readSettingsSection, writeSettingsSection } from '@unbrained/pm-cli/sdk';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { readCaseModel, recordCaseOutcome, RecordCaseOutcomeInputSchema } from '../dist/index.js';
import type { CaseResult } from '../dist/index.js';
import { parse, guardSubmitted } from '../dist/src/schema.js';
import { runCommand } from '../dist/src/commands.js';
import { fixture, select, request, source, hasCode, historyEvents } from './helpers.ts';

test('file replacement cannot change admitted source references before outcome parsing', async t => {
  const { root, pmRoot, host, id } = await fixture(t); await select(host, id);
  const file = join(root, 'submitted-reference.json'); const admitted = source();
  const replacement = { ...admitted, field_pointer: ['', 'home', 'example', 'private'].join('/') };
  writeFileSync(file, JSON.stringify(admitted));
  const input = await request(host, id, 'snapshot');
  input.outcome.source_refs = new Proxy([admitted], {
    /** A second property read would observe the replacement on the real filesystem. */
    get(target, key, receiver) { return key === '0' ? JSON.parse(readFileSync(file, 'utf8')) as typeof admitted : Reflect.get(target, key, receiver); },
  });
  const safeParse = RecordCaseOutcomeInputSchema.safeParse.bind(RecordCaseOutcomeInputSchema);
  RecordCaseOutcomeInputSchema.safeParse = (...args) => { writeFileSync(file, JSON.stringify(replacement)); return safeParse(...args); };
  let pending: ReturnType<typeof recordCaseOutcome>;
  try { pending = recordCaseOutcome(host, input); }
  finally { RecordCaseOutcomeInputSchema.safeParse = safeParse; }
  await pending;
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), replacement);
  assert.deepEqual((await readCaseModel(host, id)).state.outcomes[0].source_refs[0], admitted, 'proof:snapshot_file');
  const events = await historyEvents(pmRoot, id);
  const refused = await request(host, id, 'private-control'); refused.outcome.source_refs = [replacement];
  await assert.rejects(recordCaseOutcome(host, refused), hasCode('invalid_input'));
  assert.equal(await historyEvents(pmRoot, id), events);
});

test('array snapshots retain only own values when an index becomes an inherited private value', () => {
  const inherited = Object.create(Array.prototype) as unknown[];
  Object.defineProperty(inherited, '0', { value: ['', 'home', 'example'].join('/'), configurable: true });
  const input = ['public']; Object.setPrototypeOf(input, inherited);
  const schema = z.array(z.string()); const safeParse = schema.safeParse.bind(schema);
  schema.safeParse = (...args) => { delete input[0]; return safeParse(...args); };
  assert.deepEqual(parse(schema, new Proxy(input, {})), ['public'], 'proof:snapshot_array');
  assert.equal(Object.hasOwn(input, 0), false);
  assert.throws(() => parse(schema, input), hasCode('invalid_input'));
});

test('object snapshots do not reread mutable Proxy properties after privacy checks', () => {
  const input = { reason: 'public' }; const schema = z.strictObject({ reason: z.string() }); const safeParse = schema.safeParse.bind(schema);
  schema.safeParse = (...args) => { input.reason = ['', 'home', 'example'].join('/'); return safeParse(...args); };
  assert.deepEqual(parse(schema, new Proxy(input, {})), { reason: 'public' }, 'proof:snapshot_object');
  assert.throws(() => parse(schema, input), hasCode('invalid_input'));
  for (const length of [-1, 1.5, NaN]) {
    const array = new Proxy([], {
      /** An adversarial descriptor cannot turn allocation bounds into a native exception. */
      getOwnPropertyDescriptor(target, key) { const descriptor = Reflect.getOwnPropertyDescriptor(target, key); return key === 'length' ? { ...descriptor, value: length } : descriptor; },
    });
    assert.throws(() => guardSubmitted(array), hasCode('invalid_input'));
  }
  const vanishing = new Proxy(['public'], {
    /** A property that disappears during capture is refused before schema parsing. */
    getOwnPropertyDescriptor(target, key) { if (key === '0') { delete target[0]; return undefined; } return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  assert.throws(() => guardSubmitted(vanishing), hasCode('invalid_input'));
});

test('stored settings are read once and keep their snapshot across a native second write', async t => {
  const { pmRoot, native, id } = await fixture(t); await writeSettingsSection(pmRoot, 'case', { output_budget: 1600 }, { author: 'fixture' });
  let reads = 0;
  const ctx = { command: 'case packet', args: [id], options: { limit: '1' }, global: {}, pm_root: pmRoot, sdk: { client: native,
    /** Replace the actual settings file after the one authorized section snapshot was read. */
    readSettingsSection: async (section: string) => { reads++; const snapshot = await readSettingsSection(pmRoot, section); await writeSettingsSection(pmRoot, section, { output_budget: 1 }, { author: 'fixture' }); return snapshot; },
  } } as unknown as CommandHandlerContext;
  assert.equal((await runCommand('packet', ctx) as CaseResult).ok, true, 'proof:settings_snapshot');
  assert.equal(reads, 1); assert.deepEqual((await readSettingsSection(pmRoot, 'case')).value, { output_budget: 1 });
});

test('tracker replacement after one native read cannot substitute an unvalidated state', async t => {
  const { host, id } = await fixture(t); const before = await readCaseModel(host, id); const get = host.client.get; let reads = 0;
  host.client.get = async (...args) => {
    const snapshot = await get(...args); reads++;
    if (reads === 1) await host.client.update(id, { field: ['case_state={"schema_version":999}'] });
    return snapshot;
  };
  const captured = await readCaseModel(host, id); assert.equal(reads, 1);
  assert.deepEqual(captured, before, 'proof:tracker_snapshot');
  await assert.rejects(readCaseModel(host, id), hasCode('invalid_record'));
});
