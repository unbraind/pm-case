import test from 'node:test';
import assert from 'node:assert/strict';
import { fitOutputEnvelope, OutputEnvelopeFitError, createPmCliExpectedError } from '@unbrained/pm-cli/sdk';
import { createCaseModel, readCaseModel, casePacket, envelope, fitEnvelope, CaseRefusal, exitCode } from '../dist/index.js';
import { persistedSchemaPort } from '../dist/src/host.js';
import { renderOutput, refusalEnvelope } from '../dist/src/output.js';
import { runCommand } from '../dist/src/commands.js';
import { refusal } from '../dist/src/errors.js';
import type { CommandHandlerContext } from '@unbrained/pm-cli/sdk/authoring';
import { fixture, hasCode } from './helpers.ts';

test('native persisted adapter preserves options and refuses incompatible peer schema', async t => {
  const { native, host, birth } = await fixture(t); const port = persistedSchemaPort(native);
  await assert.rejects(host.client.create(), error => error instanceof Error); await port.update(birth.id, { description: 'Preserved peer text' });
  for (const field of [[],['other=x']]) await assert.rejects(port.update(birth.id, { field }), hasCode('invalid_input'));
  await native.create({ id: 'corpus-peer', title: 'Peer', type: 'Task' }); await assert.rejects(readCaseModel(host, 'corpus-peer'), hasCode('invalid_record')); await assert.rejects(createCaseModel(host, { ...birth, id: 'corpus-peer' }), hasCode('invalid_record'));
  const noOptional = { ...host, normalizeId: undefined, prepareCreate: undefined, fitOutputEnvelope: undefined }; await createCaseModel(noOptional, { ...birth, id: 'corpus-plain', op: 'plain', related: ['corpus-peer'] });
  await assert.rejects(createCaseModel(host, { ...birth, id: 'corpus-invalid', related: ['corpus-missing'] }), error => error instanceof CaseRefusal);
  await native.schemaRemoveType('CaseModel'); await native.schemaAddType('CaseModel', { folder: 'peer', description: 'Peer definition' }); await assert.rejects(createCaseModel(host, { ...birth, id: 'corpus-new' }), hasCode('invalid_record'));
});
test('fresh dynamic native routes do not provision or mutate schemas on reads', async t => {
  const { native, pmRoot, id } = await fixture(t, false); const port = persistedSchemaPort(native, true); await port.create({ id: 'corpus-peer', title: 'Native route', type: 'Task' }); await port.update('corpus-peer', { description: 'Preserved native option' }); assert.equal((await native.schemaListFields()).fields.length, 0);
  const context = { command: 'case packet', args: [id], options: {}, global: {}, pm_root: pmRoot, sdk: { client: native, fitOutputEnvelope, readSettingsSection: async () => ({ value: undefined }) } } as unknown as CommandHandlerContext;
  assert.equal((await runCommand('packet', context) as { refusal: { code: string } }).refusal.code, 'not_found');
  await native.schemaAddField('case_state', { type: 'string', description: 'Peer field' }); assert.equal((await runCommand('packet', context) as { refusal: { code: string } }).refusal.code, 'invalid_record');
});
test('host capabilities and settings are validated without domain writes', async t => {
  const { native, pmRoot, birth, host } = await fixture(t);
  await assert.rejects(readCaseModel({ ...host, capabilities: { ...host.capabilities, native_item_cas: false } }, birth.id), hasCode('backend_unsupported')); await assert.rejects(createCaseModel({ ...host, capabilities: { ...host.capabilities, create_if_absent: false } }, birth), hasCode('backend_unsupported'));
  /** Inject host-owned settings around a real SDK client, retaining actual storage operations. */
  const ctx = (policy: unknown): CommandHandlerContext => ({ command: 'case packet', args: [birth.id], options: { limit: '1' }, global: {}, pm_root: pmRoot, sdk: { client: native, fitOutputEnvelope, readSettingsSection: async () => ({ value: policy }) } } as unknown as CommandHandlerContext);
  assert.equal((await runCommand('unknown', ctx(undefined)) as { refusal: { code: string } }).refusal.code, 'invalid_input');
  for (const policy of [null, [], { unsupported: true }, { output_budget: 0 }]) assert.equal((await runCommand('packet', ctx(policy)) as { ok: boolean }).ok, false);
  assert.equal((await runCommand('packet', ctx({ output_budget: 1600 })) as { ok: boolean }).ok, true); assert.equal(await host.settings!(), undefined);
});
test('fitter capability faults preserve typed refusals and usable minimum hints', async t => {
  const { host, id } = await fixture(t); const value = envelope(await casePacket(host, { id, limit: 1 }));
  /** Fault injection around the real public fitter; no simulated SDK storage. */
  const missing = ((...args: Parameters<typeof fitOutputEnvelope>) => { try { return fitOutputEnvelope(...args); } catch (error) { assert.ok(error instanceof OutputEnvelopeFitError); Object.defineProperty(error, 'minimum_tokens', { value: undefined }); throw error; } }) as typeof fitOutputEnvelope;
  assert.throws(() => fitEnvelope({ fitOutputEnvelope: missing }, value, 1), hasCode('backend_unsupported'));
  for (const mode of ['denied','stuck','increasing']) {
    let calls = 0;
    const injected: typeof fitOutputEnvelope = (...args) => { calls++; try { return fitOutputEnvelope(...args); } catch (error) { assert.ok(error instanceof OutputEnvelopeFitError); if (calls === 1 || mode === 'stuck') Object.defineProperty(error, 'minimum_tokens', { value: 1 }); else if (mode === 'denied') throw new CaseRefusal('permission_denied', 'Authorized host refused'); throw error; } };
    assert.throws(() => fitEnvelope({ fitOutputEnvelope: injected }, value, 1), hasCode(mode === 'denied' ? 'permission_denied' : mode === 'stuck' ? 'backend_unsupported' : 'output_budget'));
  }
  const denied: typeof fitOutputEnvelope = () => { throw new CaseRefusal('permission_denied', 'Host denied fitting'); }; assert.throws(() => fitEnvelope({ fitOutputEnvelope: denied }, value), hasCode('permission_denied'));
});
test('final renderer refuses host witness compaction and byte overflow', () => {
  for (const value of [null,'data',{}, { read_output: {} }]) assert.ok(renderOutput(value, 'json').endsWith('\n'));
  for (const value of [{ output_budget_exceeded: {} },{ read_output: { strings_compacted: true } },{ read_output: { rows_compacted: true } },{ read_output: { result_omitted: true } }]) assert.equal(JSON.parse(renderOutput(value, 'json')).refusal.code, 'output_budget');
  assert.equal(JSON.parse(renderOutput({ value: 'x'.repeat(40000) }, 'json')).refusal.code, 'output_budget');
  assert.equal(refusalEnvelope(new CaseRefusal('not_found','Absent')).exit_code, 3);
  for (const [code, expected] of [['invalid_input',2],['not_found',3],['operation_conflict',4],['backend_unsupported',5]] as const) assert.equal(exitCode(code), expected);
  assert.equal(exitCode('native',5),5); assert.equal(refusal(new Error('unsafe payload')).code,'outcome_unknown');
  for (const context of [{ remedy: 'Explicit remedy' },{ required: 'Required native action' },{}]) { const failure = createPmCliExpectedError('Synthetic',{ exitCode:5,context: { ...context, code: 'native_refusal' } }); assert.equal(refusal(failure).nativeExit,5); }
});
test('uncertified provider ports and unexpected native exit codes fail closed',async t=>{
  const {host,id}=await fixture(t);assert.equal(exitCode('native',1),5);
  const unsupported={...host,client:{...host.client,listAllComplete:undefined}} as unknown as typeof host;
  await assert.rejects(readCaseModel(unsupported,id),hasCode('backend_unsupported'));
  await assert.rejects(readCaseModel({...host,capabilities:undefined} as unknown as typeof host,id),hasCode('backend_unsupported'));
});
