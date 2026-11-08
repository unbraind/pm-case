import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { recordCaseOutcome, createCaseModel, createDirectoryHost, readCaseModel, recoverCaseOperation } from '../dist/index.js';
import { fixture, select, request, hasCode, historyEvents } from './helpers.ts';
import { npmEnvironment } from '../scripts/environment.ts';

const mutationSteps = ['after_read','before_guard','before_update','after_update','after_guard','before_receipt'];
for (const step of mutationSteps) test(`competing write at ${step} survives once with explicit stale refusal`, async t => {
  const { host, id, pmRoot } = await fixture(t); await select(host, id); const peer = createDirectoryHost(pmRoot, 'peer'); const input = await request(host, id, 'owner'); let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await recordCaseOutcome(peer, await request(peer, id, 'peer')); } };
  if (['after_read','before_guard','before_update'].includes(step)) { await assert.rejects(recordCaseOutcome(host, input), hasCode('revision_conflict')); delete host.boundary; assert.equal(await historyEvents(pmRoot, id), 3); await recordCaseOutcome(host, { ...input, revision: (await readCaseModel(host, id)).revision }); }
  else await recordCaseOutcome(host, input);
  assert.equal(injected, true); const state = (await readCaseModel(host, id)).state; assert.deepEqual(state.outcomes.map(row => row.execution_id).sort(), ['owner','peer']); assert.equal(state.operation_receipts.length, 4); assert.equal(await historyEvents(pmRoot, id), 4);
});
for (const step of mutationSteps) test(`identical request at ${step} converges on one receipt`, async t => {
  const { host, id, pmRoot } = await fixture(t); await select(host, id); const peer = createDirectoryHost(pmRoot, 'peer'); const input = await request(host, id, 'shared'); let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await recordCaseOutcome(peer, input); } };
  await recordCaseOutcome(host, input); assert.equal(injected, true); assert.equal((await recordCaseOutcome(peer, input)).replayed, true); assert.equal((await readCaseModel(host, id)).state.outcomes.length, 1); assert.equal(await historyEvents(pmRoot, id), 3);
});
for (const step of mutationSteps) test(`interruption at ${step} recovers by the original operation key`, async t => {
  const { host, id, pmRoot } = await fixture(t); await select(host, id); const input = await request(host, id, 'recovery');
  host.boundary = async point => { if (point === step) throw new Error('Interrupted caller'); };
  await assert.rejects(recordCaseOutcome(host, input), hasCode('outcome_unknown')); delete host.boundary;
  const result = await recordCaseOutcome(host, input); assert.equal(result.replayed, ['after_update','after_guard','before_receipt'].includes(step)); assert.equal((await readCaseModel(host, id)).state.outcomes.length, 1); assert.equal(await historyEvents(pmRoot, id), 3);
});
for (const step of ['before_create','after_create','before_receipt']) test(`creation collision and interrupted caller at ${step} converge`, async t => {
  const { host, birth, pmRoot } = await fixture(t); const peer = createDirectoryHost(pmRoot, 'peer'); const input = { ...birth, id: 'corpus-next', op: 'next' }; let injected = false;
  host.boundary = async point => { if (point === step && !injected) { injected = true; await createCaseModel(peer, input); throw new Error('Lost receipt'); } };
  await assert.rejects(createCaseModel(host, input), hasCode('outcome_unknown')); delete host.boundary;
  assert.equal((await createCaseModel(peer, input)).replayed, true); assert.equal(await historyEvents(pmRoot, input.id), 1);
});
/** Run a real independent process and retain bounded stdout or a diagnostic. */
function execute(worker: string, args: string[], expected = 0): Promise<string> {
  return new Promise((resolve, reject) => { const child = spawn(process.execPath, [worker, ...args], { env: npmEnvironment(process.env), timeout: 120000 }); let out = '', err = ''; child.stdout.on('data', chunk => out += String(chunk)); child.stderr.on('data', chunk => err += String(chunk)); child.on('error', reject); child.on('close', code => code === expected ? resolve(out) : reject(new Error(`Worker exit ${code}: ${err}`))); });
}
test('two independent OS writers retain all acknowledged operations and explicit retries converge', async t => {
  const { root, pmRoot, host, id } = await fixture(t); await select(host, id); const template = (await request(host, id, 'template')).outcome; const worker = join(root, 'writer.mjs');
  await writeFile(worker, `import {createDirectoryHost,readCaseModel,recordCaseOutcome} from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};import {retryWriter} from ${JSON.stringify(new URL('writer-retry.ts', import.meta.url).href)};const host=createDirectoryHost(process.argv[2],process.argv[3]), id=process.argv[4], template=JSON.parse(process.argv[5]), acknowledged=[],conflicts=[];for(let i=0;i<6;i++){const op=process.argv[3]+'-'+i;await retryWriter(async()=>{const revision=(await readCaseModel(host,id)).revision;await recordCaseOutcome(host,{id,op,revision,outcome:{...template,execution_id:op}});},()=>conflicts.push(op));acknowledged.push(op);}console.log(JSON.stringify({acknowledged,conflicts}));`);
  const results = await Promise.all(['writer-a','writer-b'].map(author => execute(worker, [pmRoot,author,id,JSON.stringify(template)]).then(text => JSON.parse(text) as { acknowledged: string[]; conflicts: string[] })));
  const expected = results.flatMap(row => row.acknowledged).sort(); const state = (await readCaseModel(host, id)).state; assert.equal(expected.length, 12); assert.equal(new Set(expected).size, 12); assert.deepEqual(state.outcomes.map(row => row.execution_id).sort(), expected); assert.equal(await historyEvents(pmRoot, id), 14); t.diagnostic(JSON.stringify({ acknowledged: 12, conflicts: results.flatMap(row => row.conflicts).length, retained: 12 }));
});
for (const step of ['before_update','after_update','before_receipt']) test(`hard process exit at ${step} survives rerun`, async t => {
  const { root, pmRoot, host, id } = await fixture(t); await select(host, id); const input = await request(host, id, 'crash'); const worker = join(root, 'crash.mjs');
  await writeFile(worker, `import {createDirectoryHost,recordCaseOutcome} from ${JSON.stringify(new URL('../dist/index.js', import.meta.url).href)};const host=createDirectoryHost(process.argv[2],'crash');host.boundary=async step=>{if(step===process.argv[3])process.exit(73);};await recordCaseOutcome(host,JSON.parse(process.argv[4]));`);
  await execute(worker, [pmRoot,step,JSON.stringify(input)], 73); assert.equal((await recordCaseOutcome(host, input)).replayed, step !== 'before_update'); assert.equal(await historyEvents(pmRoot, id), 3);
});

test('operation recovery distinguishes committed absent and unavailable evidence without writes',async t=>{
  const {host,id,pmRoot}=await fixture(t);const before=await historyEvents(pmRoot,id);
  assert.equal((await recoverCaseOperation(host,{id,op:'birth'})).outcome,'committed');
  assert.equal((await recoverCaseOperation(host,{id,op:'missing'})).outcome,'not_committed');
  assert.equal((await recoverCaseOperation(host,{id:'absent',op:'missing'})).outcome,'not_committed');
  assert.equal((await recoverCaseOperation({...host,capabilities:{...host.capabilities,native_item_cas:false}},{id,op:'birth'})).outcome,'outcome_unknown');
  assert.equal(await historyEvents(pmRoot,id),before);
});
for(const step of ['before_create','after_create'])test(`interrupted creation at ${step} can prove not committed or committed`,async t=>{
  const {host,birth}=await fixture(t,false);host.boundary=async point=>{if(point===step)throw new Error('Interrupted create');};
  await assert.rejects(createCaseModel(host,birth),hasCode('outcome_unknown'));delete host.boundary;
  assert.equal((await recoverCaseOperation(host,{id:birth.id,op:birth.op})).outcome,step==='before_create'?'not_committed':'committed');
  assert.equal((await createCaseModel(host,birth)).replayed,step==='after_create');
});
