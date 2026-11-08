import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, rm, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
import { decode } from '@toon-format/toon';

/** Prove one behavioral mutation fails and always restore it before proving the fixed implementation. */
async function proveMutation(root: string, mutation: { file: string; before: string; after: string; test: string; pattern: string }): Promise<void> {
  const path=join(root,mutation.file);const original=await readFile(path,'utf8');assert.equal(original.split(mutation.before).length,2,`Revert seam must identify exactly one behavior: ${mutation.file}`);
  const args=['--test','--test-concurrency=1','--test-name-pattern',mutation.pattern,`test/${mutation.test}`];const options={cwd:root,env:testEnvironment(npmEnvironment(process.env)),encoding:'utf8' as const,timeout:90000,maxBuffer:4*1024*1024};
  try {
    await writeFile(path,original.replace(mutation.before,mutation.after));
    const red=spawnSync(process.execPath,args,options);assert.equal(red.status,1,red.stdout+red.stderr);assert.match(red.stdout+red.stderr,/AssertionError|ERR_TEST_FAILURE/);assert.doesNotMatch(red.stdout+red.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);
  } finally {await writeFile(path,original);}
  const green=spawnSync(process.execPath,args,options);assert.equal(green.status,0,green.stdout+green.stderr);
}

const root=await mkdtemp(join(tmpdir(),'case-reverts-'));const proofs=[];
try{
  for (const path of ['dist','test','scripts','src','index.ts','tsconfig.json','tsconfig.test.json','package.json','manifest.json','README.md','LICENSE','CHANGELOG.md','ARCHITECTURE.md','docs']) await cp(path,join(root,path),{recursive:true});
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
  const mutations=[
    {file:'kernel.js',before:'return Object.entries(partial).every(([key, value]) => Object.hasOwn(full, key) && full[key] === value);',after:'return false;',test:'core.test.ts',pattern:'^independent brute-force oracle'},
    {file:'kernel.js',before:'new Set(recorded.map(row => row.result.identity)).size === recorded.length && ',after:'',test:'core.test.ts',pattern:'^native read-back refuses duplicate receipt bindings'},
    {file:'api.js',before:'insist(found.request_digest === digest(request),',after:'insist(true,',test:'core.test.ts',pattern:'^real SDK owner retains'},
    {file:'api.js',before:'itemHash: owner.revision',after:'itemHash: (await host.client.readItemRevision(owner.id)).item_hash',test:'concurrency.test.ts',pattern:'^competing write at before_update'},
    {file:'api.js',before:"fitEnvelope(host, envelope(committed(id, 'f'.repeat(64), operation, false)), budget);",after:'void budget;',test:'contracts.test.ts',pattern:'^all write budgets refuse'},
    {file:'schema.js',before:"insist(!privatePathPattern.test(value) && !emailAddressPattern.test(value), 'invalid_input', 'Private paths and email addresses are forbidden');",after:"insist(!/(?:[\\\\/](?:home|Users)[\\\\/]|[\\\\/]root(?:[\\\\/]|\\b)|(?<![\\w.+-])[\\w.+-]+@[\\w.-]+\\.[a-z]{2,})/iu.test(value), 'invalid_input', 'Private paths and email addresses are forbidden');",test:'privacy.test.ts',pattern:'^must-allow public data'},
    {file:'schema.js',before:"insist(++visits.count <= submittedNodeBudget, 'invalid_input', 'Submitted input exceeds the traversal budget');",after:"insist(true, 'invalid_input', 'Traversal budget removed');",test:'privacy.test.ts',pattern:'^shared subtrees and oversized'},
    {file:'kernel.js',before:'const memoized = memo.get(key);',after:'const memoized = undefined;',test:'core.test.ts',pattern:'^deterministic covers and domains are reused'},
  ];
  const additional = [
    {file:'scripts/pack-gate.ts',before:"for (const document of ['docs/real-data.md', 'docs/real-data-receipt.json', 'docs/public-harness-receipt.json']) if (!files.includes(document)) throw new Error(`Package document is missing: ${document}`);",after:'void files;',test:'pack-gate.test.ts',pattern:'^package gate refuses each missing'},
    {file:'test/corpus-privacy.test.ts',before:"assert.ok(names.includes(row.imported!.name),'Unreviewed acquisition import');",after:'void names;',test:'corpus-privacy.test.ts',pattern:'^public-only acquisition guard'},
    {file:'test/corpus-privacy.test.ts',before:"if(callee.type==='MemberExpression') assert.ok(!['readFile','readFileSync','readdir','readdirSync','fetch','execFileSync'].includes(callee.property?.name??callee.property?.value??''),'Member acquisition calls refused');",after:'void callee;',test:'corpus-privacy.test.ts',pattern:'^public-only acquisition guard'},
    {file:'test/harness-results.ts',before:'  const rows = output.trim()',after:'  return; const rows = output.trim()',test:'harness-results.test.ts',pattern:'^public harness requires'},
    {file:'test/harness-bindings.ts',before:'  assert.equal(results.length, 4);',after:'  return; assert.equal(results.length, 4);',test:'real-data.test.ts',pattern:'^frozen harness receipts bind'},
    {file:'test/writer-retry.ts',before:" && code !== 'lock_conflict'",after:'',test:'writer-retry.test.ts',pattern:'^writers retry lock'},
    {file:'test/install-tools.ts',before:'  assert.ok(!env.GITHUB_ACTIONS,',after:'  assert.ok(true,',test:'install-tools.test.ts',pattern:'^exact runtime acceptance'},
    {file:'dist/src/api.js',before:'revision: owner.revision, summary, rows, total:',after:'revision: owner.revision, summary: { ...summary, case_counts: { ...summary.case_counts, unresolved: 0 } }, rows, total:',test:'real-data.test.ts',pattern:'^ten pinned resume questions'},
    {file:'dist/src/kernel.js',before:'const model = normalizeModel(raw);\n    return reuse(domainMemo,',after:'const model = raw;\n    return reuse(domainMemo,',test:'core.test.ts',pattern:'^cached covers and domains'},
    {file:'dist/src/kernel.js',before:'const model = normalizeModel(raw);\n    return reuse(coverMemo,',after:'const model = raw;\n    return reuse(coverMemo,',test:'core.test.ts',pattern:'^cached covers and domains'},
  ];
  for(const mutation of [...mutations.map(row=>({...row,file:`dist/src/${row.file}`})),...additional]){
    await proveMutation(root,mutation);proofs.push({function_behavior:mutation.before,test:mutation.test,pattern:mutation.pattern,reverted_exit:1,restored_exit:0});
  }
  const linked=[];
  for(const id of ['pm-case-kernel','pm-case-proof','pm-case-storage']) {
    const item=decode(await readFile(`.agents/pm/features/${id}.toon`,'utf8')) as {tests:{command:string}[]};
    for(const {command} of item.tests) {
      assert.ok(command.startsWith('npm run build && '),'Every linked source test must build first');
      const options={cwd:root,env:{...testEnvironment(npmEnvironment(process.env)),PATH:resolve('node_modules/.bin')+':'+process.env.PATH},encoding:'utf8' as const,timeout:120000,maxBuffer:4*1024*1024};
      await rm(join(root,'dist'),{recursive:true,force:true});
      const red=spawnSync('/bin/sh',['-c',command.slice('npm run build && '.length)],options);assert.equal(red.status,1);assert.match(red.stdout+red.stderr,/ERR_MODULE_NOT_FOUND/);
      const green=spawnSync('/bin/sh',['-c',command],options);assert.equal(green.status,0,green.stdout+green.stderr);linked.push({id,command,reverted_exit:1,restored_exit:0});
    }
  }
  const assertion_probes=[];
  for(const probe of [
    {file:'contracts.test.ts',before:"native.get('corpus-refused')",after:"Promise.reject(Object.assign(new Error('unrelated I/O'), { code: 'io_failure' }))",pattern:'^native harness exercises'},
    {file:'edge.test.ts',before:'host.client.create()',after:"Promise.reject(Object.assign(new Error('unrelated I/O'), { code: 'io_failure' }))",pattern:'^native persisted adapter'},
    {file:'edge.test.ts',before:"createCaseModel(host, { ...birth, id: 'corpus-invalid', related: ['corpus-missing'] })",after:"Promise.reject(new CaseRefusal('invalid_input', 'Unrelated refusal'))",pattern:'^native persisted adapter'},
  ]) {
    await proveMutation(root,{...probe,file:`test/${probe.file}`,test:probe.file});
    assertion_probes.push({test:probe.file,pattern:probe.pattern,wrong_code_exit:1,restored_exit:0});
  }
  await writeFile('revert-receipt.local.json',JSON.stringify({proofs,linked,assertion_probes,workspace_mutated:false},null,2)+'\n');console.log(JSON.stringify({behavioral_reverts:proofs.length,red:proofs.length,restored_green:proofs.length,linked_build_proofs:linked.length,wrong_error_code_proofs:assertion_probes.length}));
}finally{await rm(root,{recursive:true,force:true});}
