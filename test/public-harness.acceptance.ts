import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { publicTrackers } from './corpus.ts';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
import { selectedTestPassed } from './harness-results.ts';

import { publicChecks, historicalChecks } from './harness-plan.ts';

const scratch = await mkdtemp(join(tmpdir(), 'case-harness-')); const results = [];
try {
  for (const check of publicChecks) {
    const source = publicTrackers.find(row => row.repo === check.repo)!; const original = resolve(process.env.PM_CASE_PUBLIC_ROOT ?? '..', source.repo); const copy = join(scratch, source.repo); await mkdir(copy);
    const archive = execFileSync('git', ['archive', source.revision], { cwd: original, maxBuffer: 32 * 1024 * 1024, env: npmEnvironment(process.env) }); execFileSync('tar', ['-x','-C',copy], { input: archive });
    const installation=spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',['ci','--ignore-scripts','--no-audit','--no-fund'],{cwd:copy,env:npmEnvironment(process.env),shell:process.platform === 'win32',encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024}); assert.equal(installation.status,0,'Frozen public harness dependencies must install successfully');
    const env = { ...testEnvironment(npmEnvironment(process.env)), PM_PATH: '', PM_AUTHOR: 'public-proof', PATH: join(copy,'node_modules/.bin') + delimiter + process.env.PATH, GIT_CEILING_DIRECTORIES: scratch };
    const args = ['--test','--test-concurrency=1','--test-reporter',resolve('test/harness-reporter.ts'),'--test-name-pattern',check.pattern,check.file]; const started = performance.now();
    const run = spawnSync(process.execPath,args,{cwd:copy,env,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
    await writeFile(`public-${source.repo}.local.log`,run.stdout+run.stderr); assert.equal(run.status,0,`Public scoped harness failed; inspect public-${source.repo}.local.log`);
    selectedTestPassed(run.stdout, check.pattern, check.file);
    const oracleDigest = createHash('sha256').update(await readFile(join(copy,check.file))).digest('hex');
    const publicArgs = args.map(value => value === resolve('test/harness-reporter.ts') ? 'test/harness-reporter.ts' : value);
    const common = { repo: source.repo, revision: source.revision, test_file: check.file, test_name: check.pattern, assignment: check.assignment, oracle_digest: oracleDigest, result: 'pass', exit_code: run.status, elapsed_ms: Math.round(performance.now()-started), output_sha256: createHash('sha256').update(run.stdout+run.stderr).digest('hex'), command: 'node '+publicArgs.map(value=>JSON.stringify(value)).join(' '), source_visibility: 'public' };
    results.push(common);
    if (historicalChecks.some(row => row.repo === source.repo)) {
      const path = join(copy,'index.ts'); const fixed = await readFile(path,'utf8'); const before = 'const postCloseStatus = compensationItemStatus(pmRoot, id);'; assert.equal(fixed.split(before).length,2);
      const reverted = fixed.replace(before,'const postCloseStatus = undefined;'); await writeFile(path,reverted);
      try {
        const redStarted=performance.now(); const red=spawnSync(process.execPath,args,{cwd:copy,env,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024}); await writeFile('public-regression.local.log',red.stdout+red.stderr); assert.notEqual(red.status,0); assert.match(red.stdout+red.stderr,/confirmed closure removes the batch marker/);
        results.push({...common,result:'fail',exit_code:red.status,elapsed_ms:Math.round(performance.now()-redStarted),variant:'historical nonzero-receipt shortcut',source_digest:createHash('sha256').update(reverted).digest('hex'),output_sha256:createHash('sha256').update(red.stdout+red.stderr).digest('hex')});
      } finally { await writeFile(path,fixed); }
      const restored=spawnSync(process.execPath,args,{cwd:copy,env,encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024}); assert.equal(restored.status,0,'Restored public regression must pass');
      selectedTestPassed(restored.stdout, check.pattern, check.file);
    }
  }
  await writeFile('docs/public-harness-receipt.json',JSON.stringify({ schema_version:1, automatic_execution_in_product:false, results },null,2)+'\n'); console.log(JSON.stringify({passing:results.filter(row=>row.result==='pass').length,regressions_reproduced:results.filter(row=>row.result==='fail').length}));
} finally { await rm(scratch,{recursive:true,force:true}); }
