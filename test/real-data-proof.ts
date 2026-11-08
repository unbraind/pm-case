import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { createDirectoryHost, createCaseModel, proposeCases, selectCases, recordCaseOutcome, readCaseModel, caseCoverage, casePacket, envelope, fitEnvelope, digest, canonical } from '../dist/index.js';
import { wire } from '../dist/src/output.js';
import { matrices, passages, gold } from './matrices.ts';
import { expectedQuestions, summaryQuestions, detailedModels } from './proof-contract.ts';
import type { Outcome } from '../dist/index.js';
import { harnessPlanBindings } from './harness-bindings.ts';
import type { HarnessResult } from './harness-bindings.ts';

/** Recompute frozen-corpus questions through current production packets in a disposable non-Git tracker. */
export async function collectRealDataProof() {
const harness=JSON.parse(await readFile('docs/public-harness-receipt.json','utf8')) as {results:HarnessResult[]};
harnessPlanBindings(harness.results);
const root=await mkdtemp(join(tmpdir(),'case-real-data-')); const results=[]; const questions=[];
try {
  const pmRoot=join(root,'.agents/pm');const native=new PmClient({cwd:root,pmRoot,author:'public-proof',noExtensions:true});await native.init('proof',{defaults:true,agentGuidance:'skip',mergeFence:false});const host=createDirectoryHost(pmRoot,'public-proof');
  const evidence=await native.create({id:'proof-evidence',type:'Task',title:'Public scoped harness receipts',description:canonical(harness)});const revision=await native.readItemRevision(evidence.item.id);const source_ref={item_id:evidence.item.id,item_hash:revision.item_hash,field_pointer:'/description',content_digest:digest(harness)};
  for(const model of matrices){
    const frozen=gold(model);const goldTriples=gold(model,3);const id=`proof-${model.model_key}`;await createCaseModel(host,{id,op:'birth',title:`Public ${model.model_key} matrix`,model,related:[evidence.item.id]});
    const plan=await proposeCases(host,{id,max_cases:256});assert.equal(plan.feasible_tuples,frozen.tuples.length);assert.equal(plan.covered_tuples,frozen.tuples.length);assert.equal(plan.uncovered_tuples,0);assert.ok(plan.cases.every(row=>frozen.valid.some(valid=>canonical(row.assignment)===canonical(valid))));
    await selectCases(host,{id,op:'plan',revision:plan.revision,proposal:plan.proposal,max_cases:256});const run=harness.results.find(row=>row.repo===model.model_key&&row.result==='pass')!;assert.ok(run);const selected=plan.cases.find(row=>canonical(row.assignment)===canonical(run.assignment))!;assert.ok(selected);
    const pass:Outcome={execution_id:'public-harness',case_id:selected.case_id,subject_digest:model.subject_digest,oracle_digest:run.oracle_digest,result:'pass',reason:'Scoped public test harness passed for the explicitly pinned coordinates',source_refs:[source_ref],observed_at:'2026-11-06T00:00:00Z',recorder:'public-proof',evidence_grade:'reported'};
    await recordCaseOutcome(host,{id,op:'observed',revision:(await readCaseModel(host,id)).revision,outcome:pass});await recordCaseOutcome(host,{id,op:'unavailable',revision:(await readCaseModel(host,id)).revision,outcome:{...pass,execution_id:'unavailable',case_id:plan.cases[1].case_id,result:'unresolved',reason:'This selected combination has not been run; no execution evidence is claimed'}});
    const coverage=await caseCoverage(host,{id});const packet=await casePacket(host,{id,limit:1});const encoded=wire(fitEnvelope(host,envelope(packet)),'json');assert.ok(Buffer.byteLength(encoded)<=6400);
    const naive=JSON.stringify({passages:passages.filter(row=>row.repo===model.model_key),assignments:frozen.valid,outcomes:(await readCaseModel(host,id)).state.outcomes});
    results.push({model,owner_id:id,owner_revision:coverage.revision,outcomes:(await readCaseModel(host,id)).state.outcomes,model_digest:plan.model_digest,gold_pair_sha256:frozen.sha256,gold_feasible_pairs:frozen.tuples,cartesian:frozen.population,feasible:frozen.valid.length,pairwise_cases:plan.cases.length,planned:coverage.planned_tuple_coverage,recorded:coverage.recorded_execution_tuple_coverage,case_counts:coverage.case_counts,excluded:coverage.excluded,gaps:coverage.gaps,selected_cases:plan.cases,packet_bytes:Buffer.byteLength(encoded),packet_estimated_tokens:Math.ceil(Buffer.byteLength(encoded)/4),naive_bytes:Buffer.byteLength(naive),naive_estimated_tokens:Math.ceil(Buffer.byteLength(naive)/4),three_way:{product_supported:false,reason:'v1 refuses strengths above two',feasible_obligations:goldTriples.tuples.length,full_assignment_reference_cases:goldTriples.valid.length}});
    const missing=frozen.tuples.filter(tuple=>{const entries=JSON.parse(tuple) as [string,string][];return !entries.every(([key,value])=>selected.assignment[key]===value);}).map(tuple=>canonical(Object.fromEntries(JSON.parse(tuple) as [string,string][]))).sort();
    const facts=[[summaryQuestions[0],missing.length],[summaryQuestions[1],1],[summaryQuestions[2],[]]] as const;
    for(const [index,[question,expected]] of facts.entries()){const start=performance.now();const current=await casePacket(host,{id,limit:1}); const response=wire(fitEnvelope(host,envelope(current)),'json'); const delivered=JSON.parse(response) as {data:typeof current}; const summary=delivered.data.summary; const actual=[summary.feasible_tuples-summary.recorded_execution_tuple_coverage.covered,summary.case_counts.unresolved,summary.conflicts][index]; assert.deepEqual(actual,expected);questions.push({model:model.model_key,question,expected,actual,calls:1,elapsed_ms:Math.round(performance.now()-start),packet_bytes:Buffer.byteLength(response),max_page_bytes:Buffer.byteLength(response),naive_bytes:Buffer.byteLength(naive)});}
    if(detailedModels.some(row=>row.model_key===model.model_key)) {
      const start=performance.now();const actual:string[]=[];let cursor:string|undefined;let calls=0,bytes=0,max=0;
      do{const page=await casePacket(host,{id,limit:5,cursor});const response=wire(fitEnvelope(host,envelope(page)),'json');const size=Buffer.byteLength(response);assert.ok(size<=6400);bytes+=size;max=Math.max(max,size);calls++;for(const row of (JSON.parse(response) as {data:typeof page}).data.rows)if(row.kind==='gap')actual.push(canonical(row.assignment));cursor=page.next_cursor??undefined;}while(cursor);
      actual.sort();assert.deepEqual(actual,missing);questions.push({model:model.model_key,question:'which exact feasible pair assignments remain unobserved',expected:missing,actual,calls,elapsed_ms:Math.round(performance.now()-start),packet_bytes:bytes,max_page_bytes:max,naive_bytes:Buffer.byteLength(naive)});
    }
  }
  const red=harness.results.find(row=>row.result==='fail')!;assert.ok(red?.source_digest);const base=matrices[0];const model={...base,model_key:'historical-regression',subject_digest:red.source_digest};const id='proof-regression';await createCaseModel(host,{id,op:'birth',title:'Reproduced public historical missing combination',model});const plan=await proposeCases(host,{id,max_cases:256});await selectCases(host,{id,op:'plan',revision:plan.revision,proposal:plan.proposal,max_cases:256});const target=plan.cases.find(row=>canonical(row.assignment)===canonical(red.assignment))!;
  await recordCaseOutcome(host,{id,op:'failed',revision:(await readCaseModel(host,id)).revision,outcome:{execution_id:'regression',case_id:target.case_id,subject_digest:red.source_digest,oracle_digest:red.oracle_digest,result:'fail',reason:'Restoring the historical nonzero-close shortcut retains transaction markers after closure',source_refs:[source_ref],observed_at:'2026-11-06T00:00:00Z',recorder:'public-proof',evidence_grade:'reported'}});
  const regression=await caseCoverage(host,{id});const packetBytes=questions.reduce((n,row)=>n+row.packet_bytes,0),naiveBytes=questions.reduce((n,row)=>n+row.naive_bytes,0);assert.equal(questions.length,expectedQuestions());assert.ok(packetBytes<=naiveBytes/2);assert.equal(results.filter(row=>row.pairwise_cases<=row.feasible/2).length,matrices.length);
  return {schema_version:1,passages:passages.length,source_revisions:[...new Set(passages.map(row=>row.revision))],matrices:results,questions,totals:{calls:questions.reduce((n,row)=>n+row.calls,0),packet_bytes:packetBytes,naive_bytes:naiveBytes,reduction_percent:100*(1-packetBytes/naiveBytes)},regression:{subject_digest:red.source_digest,planned:regression.planned_tuple_coverage,recorded:regression.recorded_execution_tuple_coverage,case_counts:regression.case_counts},limitations:['V1 does not generate three-way suites; exhaustive triple reference only.','Harness receipts are reported evidence, not authenticated execution.','No native database or MCP provider certification.']};
} finally {await rm(root,{recursive:true,force:true});}

}
