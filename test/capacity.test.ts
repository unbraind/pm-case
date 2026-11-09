import test from 'node:test';
import assert from 'node:assert/strict';
import { readCaseModel, proposeCases, selectCases, recordCaseOutcome, digest, canonical } from '../dist/index.js';
import { fixture, select, request, hasCode, historyEvents, observation } from './helpers.ts';

test('native owner at 512 retained operation keys refuses before a new history event', async t => {
  const { host,id,pmRoot }=await fixture(t);await select(host,id);const state=(await readCaseModel(host,id)).state;const template=state.operation_receipts[1];
  for(let i=2;i<512;i++){const result={...template.result,sequence:i+1};state.operation_receipts.push({...template,operation_id:`p${i}`,request_digest:digest(i),result,result_digest:digest(result)});}
  await host.client.update(id,{field:[`case_state=${canonical(state)}`],comment:['Seed structurally valid finite capacity fixture']});const before=await readCaseModel(host,id);const events=await historyEvents(pmRoot,id);const plan=await proposeCases(host,{id,max_cases:32});
  await assert.rejects(selectCases(host,{id,op:'overflow',revision:before.revision,proposal:plan.proposal,max_cases:32}),hasCode('capacity_exceeded'));assert.equal((await readCaseModel(host,id)).revision,before.revision);assert.equal(await historyEvents(pmRoot,id),events);assert.equal((await readCaseModel(host,id)).state.operation_receipts.length,512);
});
test('native owner at 256 observations preserves all evidence on count refusal',async t=>{
  const {host,id,pmRoot}=await fixture(t);await select(host,id);const state=(await readCaseModel(host,id)).state;const caseId=state.selected_plan!.cases[0].case_id;
  for(let i=0;i<256;i++){
    const outcome=observation(caseId,`r${i}`,{reason:'x',recorder:'a',source_refs:[{item_id:'s',item_hash:digest('s'),field_pointer:'/a',content_digest:digest('a')}]});state.outcomes.push(outcome);const result={kind:'record' as const,identity:outcome.execution_id,sequence:i+3,digest:digest(outcome)};state.operation_receipts.push({operation_id:`o${i}`,request_digest:digest(i),result,result_digest:digest(result)});
  }
  await host.client.update(id,{field:[`case_state=${canonical(state)}`],comment:['Seed structurally valid observation capacity fixture']});const before=await readCaseModel(host,id);const events=await historyEvents(pmRoot,id);
  await assert.rejects(recordCaseOutcome(host,await request(host,id,'overflow')),hasCode('capacity_exceeded'));assert.equal((await readCaseModel(host,id)).revision,before.revision);assert.equal(await historyEvents(pmRoot,id),events);
});
