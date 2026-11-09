import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseModel, proposeCases, selectCases, readCaseModel, generateCover, digest } from '../dist/index.js';
import { fixture, model, source, hasCode } from './helpers.ts';

test('seeded proposal verdict and exact applied state agree for complete partial and refused bounds',async t=>{
  const {host}=await fixture(t,false);let seed=0x4017;let full=0,partial=0,refused=0;
  for(let sequence=0;sequence<24;sequence++){
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;const id=`corpus-m${sequence}`;const constraint=seed%2?[{assignment:{light:'low'},rationale:'Scoped public model',source_refs:[source()]}]:[];const m=model({forbidden_tuples:constraint});await createCaseModel(host,{id,op:'birth',title:'Finite proposal property',model:m});const bound=seed%6;
    if(bound===0){const before=await readCaseModel(host,id);await assert.rejects(proposeCases(host,{id,max_cases:bound}),hasCode('invalid_input'));await assert.rejects(selectCases(host,{id,op:'invalid',revision:before.revision,max_cases:bound,proposal:digest('invalid')}),hasCode('invalid_input'));assert.equal((await readCaseModel(host,id)).revision,before.revision);refused++;continue;}
    const proposal=await proposeCases(host,{id,max_cases:bound});await selectCases(host,{id,op:'plan',revision:proposal.revision,max_cases:bound,proposal:proposal.proposal});const selected=(await readCaseModel(host,id)).state.selected_plan!;assert.deepEqual(selected,generateCover(m,{max_cases:bound}));assert.equal(selected.complete,proposal.complete);if(selected.complete)full++;else partial++;
  }
  assert.ok(full>0&&partial>0&&refused>0);t.diagnostic(JSON.stringify({sequences:24,full,partial,refused}));
});
