import assert from 'node:assert/strict';
import { mkdtemp, cp, symlink, rm, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
import { decode } from '@toon-format/toon';
import { selectedTestPassed, selectedTestFailed } from './harness-results.ts';

/** Prove one behavioral mutation fails and always restore it before proving the fixed implementation. */
async function proveMutation(root: string, mutation: { file: string; before: string; after: string; test: string; pattern: string }): Promise<void> {
  const path=join(root,mutation.file);const original=await readFile(path,'utf8');assert.equal(original.split(mutation.before).length,2,`Revert seam must identify exactly one behavior: ${mutation.file}`);
  const args=['--test','--test-concurrency=1','--test-reporter',join(root,'test/harness-reporter.ts'),'--test-name-pattern',mutation.pattern,`test/${mutation.test}`];const options={cwd:root,env:testEnvironment(npmEnvironment(process.env)),encoding:'utf8' as const,timeout:90000,maxBuffer:4*1024*1024};
  const baseline=spawnSync(process.execPath,args,options);assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);selectedTestPassed(baseline.stdout,mutation.pattern,mutation.test);
  try {
    await writeFile(path,original.replace(mutation.before,mutation.after));
    const red=spawnSync(process.execPath,args,options);assert.equal(red.status,1,red.stdout+red.stderr);selectedTestFailed(red.stdout,mutation.pattern,mutation.test);
    // Inspect startup diagnostics separately: assertion payloads can quote source containing error names.
    assert.doesNotMatch(red.stderr,/SyntaxError|ERR_MODULE_NOT_FOUND/);
  } finally {await writeFile(path,original);}
  const green=spawnSync(process.execPath,args,options);assert.equal(green.status,0,green.stdout+green.stderr);selectedTestPassed(green.stdout,mutation.pattern,mutation.test);
}

const root=await mkdtemp(join(tmpdir(),'case-reverts-'));const proofs=[];
try{
  for (const path of ['dist','test','scripts','src','index.ts','tsconfig.json','tsconfig.test.json','package.json','manifest.json','README.md','LICENSE','CHANGELOG.md','ARCHITECTURE.md','docs','.github']) await cp(path,join(root,path),{recursive:true});
  await symlink(resolve('node_modules'),join(root,'node_modules'),'dir');
  const mutations=[
    {file:'kernel.js',before:'return Object.entries(partial).every(([key, value]) => Object.hasOwn(full, key) && full[key] === value);',after:'return false;',test:'core.test.ts',pattern:'^independent brute-force oracle'},
    {file:'kernel.js',before:'new Set(recorded.map(row => row.result.identity)).size === recorded.length && ',after:'',test:'core.test.ts',pattern:'^native read-back refuses duplicate receipt bindings'},
    {file:'api.js',before:'insist(found.request_digest === digest(request),',after:'insist(true,',test:'core.test.ts',pattern:'^real SDK owner retains'},
    {file:'api.js',before:'itemHash: owner.revision',after:'itemHash: (await host.client.readItemRevision(owner.id)).item_hash',test:'concurrency.test.ts',pattern:'^competing write at before_update'},
    {file:'api.js',before:"fitEnvelope(host, envelope(committed(id, 'f'.repeat(64), operation, false)), budget);",after:'void budget;',test:'contracts.test.ts',pattern:'^all write budgets refuse'},
    {file:'schema.js',before:"insist(!containsPrivateHomePath(value) && !emailAddressPattern.test(value), 'invalid_input', 'Private paths and email addresses are forbidden');",after:"insist(!/(?:[\\\\/](?:home|Users)[\\\\/]|[\\\\/]root(?:[\\\\/]|\\b)|(?<![\\w.+-])[\\w.+-]+@[\\w.-]+\\.[a-z]{2,})/iu.test(value), 'invalid_input', 'Private paths and email addresses are forbidden');",test:'privacy.test.ts',pattern:'^must-allow public data'},
    {file:'schema.js',before:"insist(++visits.count <= submittedNodeBudget, 'invalid_input', 'Submitted input exceeds the traversal budget');",after:"insist(true, 'invalid_input', 'Traversal budget removed');",test:'privacy.test.ts',pattern:'^shared subtrees and oversized'},
    {file:'kernel.js',before:'const memoized = memo.get(key);',after:'const memoized = undefined;',test:'core.test.ts',pattern:'^deterministic covers and domains are reused'},
  ];
  const additional = [
    {file:'dist/src/schema.js',before:"insist(value.length <= submittedNodeBudget, 'invalid_input', 'Submitted arrays exceed the traversal budget');",after:'void value.length;',test:'privacy.test.ts',pattern:'^sparse arrays refuse'},
    {file:'README.md',before:'npm install "$archive"',after:'npm install ../pm-case-2026.11.6.tgz',test:'review-classes.test.ts',pattern:'^documented archive installs'},
    {file:'test/install-tools.ts',before:"['bun', 'npm', 'npx', 'sha256sum'] as const",after:"['bun', 'npm', 'npx'] as const",test:'install-tools.test.ts',pattern:'^packed acceptance requires'},
    {file:'test/review-classes.test.ts',before:'source.split(/(?=^  [A-Za-z0-9_-]+:)/m)',after:'source.split(/(?=^  [a-z_]+:)/m)',test:'review-classes.test.ts',pattern:'^runtime provisioning isolates'},
    {file:'test/review-classes.test.ts',before:'source.split(/(?=^[ \\t]*- (?:name|uses):)/m)',after:'source.split(/(?=^      - name:)/m)',test:'review-classes.test.ts',pattern:'^runtime provisioning isolates'},
    {file:'dist/src/privacy.js',before:'try {\n        return privateHomeRoots(lookup());\n    }\n    catch {\n        return [];\n    }',after:'return privateHomeRoots(lookup());',test:'privacy.test.ts',pattern:'^a throwing home lookup'},
    {file:'dist/src/privacy.js',before:"if (root === '/')\n                        continue;",after:'void root;',test:'privacy.test.ts',pattern:'^filesystem root home aliases'},
    {file:'test/review-classes.test.ts',before:"child.type === 'TemplateElement'",after:'false',test:'review-classes.test.ts',pattern:'^harness PATH composition'},
    ...[
      "assert.equal(run.test_file, planned.file, 'Harness test file must bind the reviewed plan');",
      "assert.equal(run.test_name, planned.pattern, 'Harness test name must bind the reviewed plan');",
      "assert.equal(run.command, publicHarnessCommand(planned), 'Harness command must bind the reviewed plan');",
      "assert.deepEqual(run.assignment, planned.assignment, 'Harness assignment must bind the reviewed plan');",
      "assert.equal(run.source_visibility, 'public', 'Harness source must remain public');",
    ].map(before => ({file:'test/harness-bindings.ts',before,after:'void run;',test:'real-data.test.ts',pattern:'^every public and historical harness row'})),
    ...[
      ['--title "Release pm-case', '--title "Release pm-unit'],
      ['Tracking: [pm-case-release]', 'Tracking: [pm-unit-release]'],
      ['https://github.com/unbraind/pm-case/blob/main/.agents/pm/epics/pm-case-release.toon', 'https://github.com/unbraind/pm-unit/blob/main/.agents/pm/epics/pm-unit-release.toon'],
    ].map(([before, after]) => ({file:'.github/workflows/release.yml',before,after,test:'review-classes.test.ts',pattern:'^all workflow release metadata'})),
    {file:'test/real-data-proof.ts',before:'harnessPlanBindings(harness.results);',after:'void harness;',test:'review-classes.test.ts',pattern:'^all receipt producers and consumers'},
    {file:'test/public-harness.acceptance.ts',before:'  harnessPlanBindings(results);',after:'  void results;',test:'review-classes.test.ts',pattern:'^all receipt producers and consumers'},
    {file:'dist/src/host.js',before:'const root = resolve(pmRoot);',after:'const root = pmRoot;',test:'review.test.ts',pattern:'^directory hosts pin relative'},
    {file:'dist/src/host.js',before:'cwd: root, pmRoot: root',after:'cwd: pmRoot, pmRoot',test:'review.test.ts',pattern:'^directory hosts pin relative'},
    {file:'dist/src/host.js',before:'normalizeItemId(id, (await readSettings(root)).id_prefix)',after:'normalizeItemId(id, (await readSettings(pmRoot)).id_prefix)',test:'review.test.ts',pattern:'^directory hosts pin relative'},
    {file:'dist/src/host.js',before:"settings: async () => (await readSettingsSection(root, 'case')).value",after:"settings: async () => (await readSettingsSection(pmRoot, 'case')).value",test:'review.test.ts',pattern:'^directory hosts pin relative'},
    {file:'dist/src/host.js',before:"settings: async () => (await readSettingsSection(root, 'case')).value",after:'settings: async () => (await readSettings(root)).case',test:'review.test.ts',pattern:'^directory hosts pin relative'},
    {file:'dist/src/schema.js',before:"insist(visits.characters <= submittedTextBudget, 'invalid_input', 'Submitted input exceeds the text budget');",after:'void visits.characters;',test:'privacy.test.ts',pattern:'^aggregate text work counts'},
    {file:'dist/src/privacy.js',before:"while (end > 0 && match[0][end - 1] === '.')",after:"if (end > 0 && match[0][end - 1] === '.')",test:'privacy.test.ts',pattern:'^home aliases punctuation'},
    {file:'dist/src/privacy.js',before:'return [home, realpathSync(home)];',after:'return [home, home];',test:'privacy.test.ts',pattern:'^home aliases punctuation'},
    {file:'test/public-harness.acceptance.ts',before:"+ delimiter + process.env.PATH",after:"+ ':' + process.env.PATH",test:'review-classes.test.ts',pattern:'^harness PATH composition'},
    {file:'test/revert.acceptance.ts',before:['+delimiter','+process.env.PATH'].join(''),after:"+':'+process.env.PATH",test:'review-classes.test.ts',pattern:'^harness PATH composition'},
    {file:'test/revert.acceptance.ts',before:['const green=','spawnSync(command,{...options,shell:true});'].join(''),after:["const green=", "spawnSync(", "'/bin/sh',['-c',command],options);"].join(''),test:'review-classes.test.ts',pattern:'^harness PATH composition'},
    {file:'test/corpus.ts',before:'// Both archives use the same frozen revision, so provenance is identical.',after:'// Provenance comment removed.',test:'review-classes.test.ts',pattern:'^harness archives share'},
    {file:'docs/real-data.md',before:'Packet-framing changes may require regenerating the receipt;',after:'Receipt regeneration note removed;',test:'review-classes.test.ts',pattern:'^all documented CLI and SDK'},
    {file:'README.md',before:"await native.init('demo', { defaults: true, agentGuidance: 'skip', mergeFence: false });",after:'// Initialization removed.',test:'review-classes.test.ts',pattern:'^all documented CLI and SDK'},
    {file:'.github/workflows/release.yml',before:'PM_CASE_NODE_26=$(command -v node)',after:'UNPROVISIONED_26=$(command -v node)',test:'review-classes.test.ts',pattern:'^all CI and release jobs'},
    {file:'test/corpus-privacy.test.ts',before:"||callee.type==='OptionalMemberExpression'",after:'',test:'corpus-privacy.test.ts',pattern:'^public-only acquisition guard'},
    {file:'test/review-classes.test.ts',before:"assert.notEqual(node.type, 'ImportExpression', 'Dynamic production imports are forbidden');",after:'void node;',test:'review-classes.test.ts',pattern:'^all production imports'},
    {file:'test/review-classes.test.ts',before:"['CallExpression', 'OptionalCallExpression'].includes(String(node.type))",after:"['CallExpression'].includes(String(node.type))",test:'review-classes.test.ts',pattern:'^all production imports'},
    {file:'test/corpus-privacy.test.ts',before:"callee.type==='Import' ? callee.type : callee.name??callee.property?.name??callee.property?.value??''",after:"callee.name??''",test:'corpus-privacy.test.ts',pattern:'^public-only acquisition guard'},
    {file:'README.md',before:'npm ci\nnpm pack',after:'npm ci\nnpm run build',test:'review.test.ts',pattern:'^every documented local archive'},
    {file:'dist/src/errors.js',before:"'revision_conflict', 'lock_conflict', 'contention'",after:"'revision_conflict', 'contention'",test:'review.test.ts',pattern:'^transient refusal metadata'},
    {file:'test/writer-retry.ts',before:' || tries >= maxAttempts',after:'',test:'writer-retry.test.ts',pattern:'^writers bound every conflict'},
    {file:'dist/src/kernel.js',before:'parse(CaseModelSchema, raw, stored)',after:'parse(CaseModelSchema, raw)',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/kernel.js',before:'const model = normalizeModel(raw, stored);\n    return reuse(domainMemo,',after:'const model = normalizeModel(raw);\n    return reuse(domainMemo,',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/kernel.js',before:'const model = normalizeModel(raw, stored);\n    return reuse(coverMemo,',after:'const model = normalizeModel(raw);\n    return reuse(coverMemo,',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/kernel.js',before:'enumerateFeasibleTuples(model, stored)',after:'enumerateFeasibleTuples(model)',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/kernel.js',before:'normalizeModel(state.model, true)',after:'normalizeModel(state.model)',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/kernel.js',before:'generateCover(state.model, { max_cases: plan.max_cases }, true)',after:'generateCover(state.model, { max_cases: plan.max_cases })',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/kernel.js',before:'enumerateFeasibleTuples(state.model, true)',after:'enumerateFeasibleTuples(state.model)',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/api.js',before:'generateCover(owner.state.model, { max_cases: maxCases }, true)',after:'generateCover(owner.state.model, { max_cases: maxCases })',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/api.js',before:'generateCover(state.model, { max_cases: input.max_cases }, true)',after:'generateCover(state.model, { max_cases: input.max_cases })',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'dist/src/api.js',before:'enumerateFeasibleTuples(owner.state.model, true)',after:'enumerateFeasibleTuples(owner.state.model)',test:'review.test.ts',pattern:'^stored owners remain readable'},
    {file:'scripts/pack-gate.ts',before:"for (const document of ['docs/real-data.md', 'docs/real-data-receipt.json', 'docs/public-harness-receipt.json']) if (!files.includes(document)) throw new Error(`Package document is missing: ${document}`);",after:'void files;',test:'pack-gate.test.ts',pattern:'^package gate refuses each missing'},
    {file:'test/corpus-privacy.test.ts',before:"assert.ok(names.includes(row.imported!.name),'Unreviewed acquisition import');",after:'void names;',test:'corpus-privacy.test.ts',pattern:'^public-only acquisition guard'},
    {file:'test/corpus-privacy.test.ts',before:"if(callee.type==='MemberExpression'||callee.type==='OptionalMemberExpression') assert.ok(!['readFile','readFileSync','readdir','readdirSync','fetch','execFileSync'].includes(callee.property?.name??callee.property?.value??''),'Member acquisition calls refused');",after:'void callee;',test:'corpus-privacy.test.ts',pattern:'^public-only acquisition guard'},
    {file:'test/harness-results.ts',before:'export function selectedTestPassed(output: string, pattern: string, file: string): void {',after:'export function selectedTestPassed(output: string, pattern: string, file: string): void { return;',test:'harness-results.test.ts',pattern:'^public harness requires'},
    {file:'test/harness-bindings.ts',before:'  assert.equal(results.length, publicChecks.length + historicalChecks.length);',after:'  return; assert.equal(results.length, publicChecks.length + historicalChecks.length);',test:'real-data.test.ts',pattern:'^frozen harness receipts bind'},
    {file:'test/writer-retry.ts',before:" && code !== 'lock_conflict'",after:'',test:'writer-retry.test.ts',pattern:'^writers retry lock'},
    {file:'test/install-tools.ts',before:'  assert.ok(!env.GITHUB_ACTIONS,',after:'  assert.ok(true,',test:'install-tools.test.ts',pattern:'^exact runtime acceptance'},
    {file:'dist/src/api.js',before:'revision: owner.revision, summary, rows, total:',after:'revision: owner.revision, summary: { ...summary, case_counts: { ...summary.case_counts, unresolved: 0 } }, rows, total:',test:'real-data.test.ts',pattern:'^ten pinned resume questions'},
    {file:'dist/src/kernel.js',before:'const model = normalizeModel(raw, stored);\n    return reuse(domainMemo,',after:'const model = raw;\n    return reuse(domainMemo,',test:'core.test.ts',pattern:'^cached covers and domains'},
    {file:'dist/src/kernel.js',before:'const model = normalizeModel(raw, stored);\n    return reuse(coverMemo,',after:'const model = raw;\n    return reuse(coverMemo,',test:'core.test.ts',pattern:'^cached covers and domains'},
  ];
  for(const mutation of [...mutations.map(row=>({...row,file:`dist/src/${row.file}`})),...additional]){
    await proveMutation(root,mutation);proofs.push({function_behavior:mutation.before,test:mutation.test,pattern:mutation.pattern,baseline_exit:0,named_failure:true,reverted_exit:1,restored_exit:0});
    console.log(JSON.stringify({proved:mutation.test,pattern:mutation.pattern}));
  }
  const linked=[];
  for(const id of ['pm-case-kernel','pm-case-proof','pm-case-storage']) {
    const item=decode(await readFile(`.agents/pm/features/${id}.toon`,'utf8')) as {tests:{command:string}[]};
    for(const {command} of item.tests) {
      assert.ok(command.startsWith('npm run build && '),'Every linked source test must build first');
      const options={cwd:root,env:{...testEnvironment(npmEnvironment(process.env)),PATH:resolve('node_modules/.bin')+delimiter+process.env.PATH},encoding:'utf8' as const,timeout:120000,maxBuffer:4*1024*1024};
      const baseline=spawnSync(command,{...options,shell:true});assert.equal(baseline.status,0,baseline.stdout+baseline.stderr);
      await rm(join(root,'dist'),{recursive:true,force:true});
      const red=spawnSync(command.slice('npm run build && '.length),{...options,shell:true});assert.equal(red.status,1);assert.match(red.stdout+red.stderr,/ERR_MODULE_NOT_FOUND/);
      const green=spawnSync(command,{...options,shell:true});assert.equal(green.status,0,green.stdout+green.stderr);linked.push({id,command,reverted_exit:1,restored_exit:0});
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
