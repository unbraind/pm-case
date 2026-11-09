import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, unlinkSync, copyFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { npmEnvironment } from '../scripts/environment.ts';
import { observation, model } from './helpers.ts';
import { packedRequirement, acceptanceRuntime, packedToolNames } from './install-tools.ts';
/** Run a credential-free consumer command and preserve only bounded diagnostics. */
function execute(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, input?: string, expected = 0): string {
  const result = spawnSync(executable, args, { cwd, env, input, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, expected, `${executable} ${args.slice(0, 4).join(' ')}: ${result.stderr.slice(-1500)} ${result.stdout.slice(-1500)}`); return result.stdout || result.stderr;
}
/** Require the stable refusal category and prevent private text from leaking in either output format. */
function privateRefusal(output: string, json: boolean, text: string): void {
  if (json) assert.equal(JSON.parse(output).refusal.code, 'invalid_input'); else assert.match(output, /code: "?invalid_input/);
  assert.ok(!output.includes(text), 'Refusals must never echo private submission text');
}
test('one captured artifact supports npm Bun npx bunx and SDK with Git absent', () => {
  assert.equal(packedRequirement(process.platform), null, packedRequirement(process.platform) ?? '');
  const tools = new Map<string, string>(packedToolNames.flatMap(name => {
    const found = spawnSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf8', env: npmEnvironment(process.env) });
    return found.status === 0 && found.stdout.trim() !== '' ? [[name, found.stdout.trim()] as const] : [];
  }));
  assert.equal(packedRequirement(process.platform, [...tools.keys()]), null, packedRequirement(process.platform, [...tools.keys()]) ?? '');
  const root = mkdtempSync(join(tmpdir(), 'case-packed-')); const env = npmEnvironment(process.env); delete env.NODE_V8_COVERAGE;
  try {
    const packed = JSON.parse(execute('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', root], process.cwd(), env)) as { filename: string; files: { path: string }[] }[];
    const archive = join(root, packed[0].filename); const sha256 = createHash('sha256').update(readFileSync(archive)).digest('hex');
    const bin = join(root, 'bin'); mkdirSync(bin); const bun = tools.get('bun')!;
    for (const [name, target] of [['sh', '/bin/sh'], ['node', process.execPath], ['bun', bun], ['bunx', bun]]) symlinkSync(target, join(bin, name));
    for (const name of ['npm', 'npx']) symlinkSync(tools.get(name)!, join(bin, name));
    const journeys: { manager: string; commands: number; runtime: string; exact_runtimes: string[] }[] = [];
    for (const manager of ['npm', 'bun']) {
      const cwd = join(root, manager); mkdirSync(cwd); writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'case-consumer', version: '1.0.0', private: true, type: 'module' }));
      execute(manager, manager === 'npm' ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', archive, '@unbrained/pm-cli@2026.11.5'] : ['add', '--ignore-scripts', archive, '@unbrained/pm-cli@2026.11.5'], cwd, env);
      const safe = { ...env, PM_PATH: join(cwd, '.agents/pm'), PM_AUTHOR: 'consumer', PATH: bin, GIT_CEILING_DIRECTORIES: root, HOME: join(root, 'isolated-home') }; mkdirSync(safe.HOME, { recursive: true });
      const runner = manager === 'npm' ? 'npx' : 'bunx'; const prefix = manager === 'npm' ? ['--no-install', 'pm'] : ['--bun', '--no-install', 'pm']; let commands = 0;
      /** Native consumer launcher with a PATH that cannot resolve Git. */
      const run = (args: string[], input?: string, expected = 0) => { commands++; return execute(runner, [...prefix, ...args], cwd, safe, input, expected); };
      run(['init', 'packed', '--defaults', '--agent-guidance', 'skip', '--no-merge-fence']); run(['package', 'install', './node_modules/pm-case']); run(['case', '--help']);
      assert.ok(JSON.parse(run(['contracts', '--json', '--output-budget', 'unbounded'])));
      const birthInput = JSON.stringify({ title: 'Public finite inputs', model: model() });
      for (const label of ['~...', '$HOME..', ['', 'mnt', 'c', 'Users', 'public'].join('/') + '..']) {
        const privateModel = model(); privateModel.factors[0].label = label;
        for (const format of [[], ['--json']]) {
          const output = run(['case','create','--id','private-refused','--op','birth','--input','-',...format], JSON.stringify({title:'Private alias refused',model:privateModel}), 2);
          privateRefusal(output, format.length > 0, label);
        }
      }
      const birth = JSON.parse(run(['case','create','--id','packed-suite','--op','birth','--input','-','--json'], birthInput)); assert.equal(birth.ok, true);
      const plan = JSON.parse(run(['case','propose','packed-suite','--max-cases','32','--json'])); assert.equal(plan.data.complete, true);
      const selected = JSON.parse(run(['case','select','packed-suite','--proposal',plan.data.proposal,'--max-cases','32','--revision',plan.revision,'--op','plan','--json'])); assert.equal(selected.ok, true);
      const input = JSON.stringify({ outcome: observation(plan.data.cases[0].case_id,'first') });
      const observed = JSON.parse(run(['case','record','packed-suite','--op','first','--revision',selected.revision,'--input','-','--json'], input)); assert.equal(observed.ok, true);
      for (const format of [[], ['--json']]) {
        const refused = run(['case','record','packed-suite','--op','private-record','--revision',observed.revision,'--input','-',...format], JSON.stringify({outcome:observation(plan.data.cases[0].case_id,'private-record',{reason:'$HOME...'})}), 2);
        privateRefusal(refused, format.length > 0, '$HOME');
      }
      const coverage = JSON.parse(run(['case','coverage','packed-suite','--json','--budget','8192'])); assert.equal(coverage.data.planned_tuple_coverage.covered,12); assert.equal(coverage.data.recorded_execution_tuple_coverage.covered,3);
      const tuple = coverage.data.gaps[0].tuple_id;
      for (const args of [['case','explain','packed-suite','--tuple',tuple],['case','packet','packed-suite','--limit','1']]) {
        const json = run([...args,'--json']); const toon = run(args); assert.ok(JSON.parse(json).ok); assert.match(toon,/source_completeness/); assert.ok(Buffer.byteLength(json)<=6400); assert.ok(Buffer.byteLength(toon)<=6400);
      }
      const page = JSON.parse(run(['case','packet','packed-suite','--limit','1','--json'])); assert.ok(page.next_cursor);
      assert.equal(JSON.parse(run(['case','packet','packed-suite','--limit','1','--cursor',page.next_cursor,'--json'])).data.returned,1);
      assert.equal(JSON.parse(run(['case','packet','packed-suite','--limit','1','--output-cursor',page.next_cursor,'--json'],undefined,2)).code,'read_output_cursor_invalid');
      assert.equal(JSON.parse(run(['case','record','packed-suite','--op','stale','--revision',birth.revision,'--input','-','--json'],input,4)).refusal.code,'revision_conflict');
      assert.equal(JSON.parse(run(['case','record','packed-suite','--op','first','--revision',selected.revision,'--input','-','--json'],input)).receipt.replayed,true);
      const minimum = JSON.parse(run(['case','packet','packed-suite','--limit','1','--budget','1','--json'],undefined,2)).refusal.details.minimum_usable_budget; assert.ok(minimum>1);
      assert.equal(JSON.parse(run(['case','packet','packed-suite','--limit','1','--budget',String(minimum),'--json'])).ok,true);
      assert.equal(JSON.parse(run(['case','record','packed-suite','--op','bad','--revision',observed.revision,'--input','-','--json'],JSON.stringify({outcome:observation(plan.data.cases[0].case_id,'bad',{reason:'\u001b[31m'})}),2)).refusal.code,'invalid_input');
      assert.equal(JSON.parse(run(['case','create','--id','refused','--op','tiny','--budget','1','--input','-','--json'],birthInput,2)).refusal.code,'output_budget');
      assert.equal(JSON.parse(run(['case','coverage','absent','--json'],undefined,3)).refusal.code,'not_found');
      const rejectRecord = (op: string, value: unknown, code: string, status = 2) => { const result=JSON.parse(run(['case','record','packed-suite','--op',op,'--revision',observed.revision,'--input','-','--json'],JSON.stringify({outcome:value}),status));assert.equal(result.refusal.code,code); };
      rejectRecord('unknown-case',observation('d'.repeat(64),'unknown'),'unknown_case');
      rejectRecord('wrong-subject',observation(plan.data.cases[0].case_id,'wrong',{subject_digest:'d'.repeat(64)}),'subject_mismatch');
      rejectRecord('malformed',observation(plan.data.cases[0].case_id,'malformed',{source_refs:[]}),'invalid_outcome');
      assert.equal(JSON.parse(run(['case','record','packed-suite','--op','first','--revision',selected.revision,'--input','-','--json'],JSON.stringify({outcome:observation(plan.data.cases[0].case_id,'first',{reason:'changed replay'})}),4)).refusal.code,'operation_conflict');
      assert.equal(JSON.parse(run(['case','packet','packed-suite','--limit','2','--cursor',page.next_cursor,'--json'],undefined,4)).refusal.code,'stale_cursor');
      for(const [key,invalid,code] of [
        ['population',model({factors:Array.from({length:12},(_,index)=>({...model().factors[0],factor_id:`f${index}`,values:['one','two','three']}))}),'model_limit'],
        ['constraint',model({forbidden_tuples:[{assignment:{absent:'low'},rationale:'Invalid coordinate',source_refs:model().factors[0].source_refs}]}),'invalid_constraint'],
        ['unsatisfiable',model({forbidden_tuples:['low','high'].map(light=>({assignment:{light},rationale:'Excluded light',source_refs:model().factors[0].source_refs}))}),'unsatisfiable_model'],
      ] as const)assert.equal(JSON.parse(run(['case','create','--id',`refused-${key}`,'--op','birth','--input','-','--json'],JSON.stringify({title:'Refused model',model:invalid}),2)).refusal.code,code);
      writeFileSync(join(cwd,'sdk.mjs'), "import assert from 'node:assert/strict';import {createDirectoryHost,createCaseModel,readCaseModel,recordCaseOutcome,caseCoverage,CaseRefusal,exitCode} from 'pm-case';const host=createDirectoryHost('./.agents/pm','consumer');const owner=await readCaseModel(host,'packed-suite');assert.equal(owner.state.outcomes.length,1);await assert.rejects(readCaseModel({...host,capabilities:{...host.capabilities,native_item_cas:false}},owner.id),e=>e instanceof CaseRefusal&&exitCode(e.code)===5);const malformed={id:'too-large',op:'birth',title:'Oversized input',model:{...owner.state.model,unexpected:Array(200000).fill('x'.repeat(8000))}};await assert.rejects(createCaseModel(host,malformed),e=>e.code==='invalid_input');await createCaseModel(host,{id:'packed-second',op:'birth',title:'SDK created owner',model:owner.state.model});await recordCaseOutcome(host,{id:owner.id,op:'sdk-observation',revision:owner.revision,outcome:{...owner.state.outcomes[0],execution_id:'sdk-observation',result:'unresolved'}});assert.equal((await caseCoverage(host,{id:owner.id})).recorded_execution_tuple_coverage.covered,3);console.log('SDK OK '+(globalThis.Bun?'bun':'node'));\n");
      const runtime=manager==='npm'?'node':'bun';assert.match(execute(runtime,['sdk.mjs'],cwd,safe),new RegExp(`SDK OK ${runtime}`));
      const rootHome = { ...safe, HOME: '/', USERPROFILE: '/', npm_config_cache: join(root, 'npm-cache') };
      /** Exercise the same packed CLI with a container-style root home and no Git. */
      const runRoot = (args: string[], input?: string, expected = 0) => { commands++; return execute(runner, [...prefix, ...args], cwd, rootHome, input, expected); };
      for (const format of [[], ['--json']]) {
        const id = format.length ? 'slash-json' : 'slash-toon'; const slashModel = model(); slashModel.factors[0].label = 'pass / fail';
        const created = runRoot(['case','create','--id',id,'--op','birth','--input','-',...format], JSON.stringify({ title: 'pass / fail', model: slashModel }));
        if (format.length) assert.equal(JSON.parse(created).ok, true); else assert.match(created, /ok: true/);
        const proposal = JSON.parse(runRoot(['case','propose',id,'--max-cases','32','--json']));
        const selection = JSON.parse(runRoot(['case','select',id,'--proposal',proposal.data.proposal,'--max-cases','32','--revision',proposal.revision,'--op','plan','--json']));
        for (const reason of ['$HOME', ['', 'home', 'public'].join('/')]) {
          const refused = runRoot(['case','record',id,'--op','private-record','--revision',selection.revision,'--input','-',...format], JSON.stringify({ outcome: observation(proposal.data.cases[0].case_id, 'private', { reason }) }), 2);
          privateRefusal(refused, format.length > 0, reason);
        }
        const recorded = runRoot(['case','record',id,'--op','slash','--revision',selection.revision,'--input','-',...format], JSON.stringify({ outcome: observation(proposal.data.cases[0].case_id, 'slash', { reason: 'pass / fail' }) }));
        if (format.length) assert.equal(JSON.parse(recorded).ok, true); else assert.match(recorded, /ok: true/);
      }
      writeFileSync(join(cwd, 'root-home.mjs'), "import assert from 'node:assert/strict';import {homedir} from 'node:os';import {createDirectoryHost,createCaseModel,readCaseModel,recordCaseOutcome} from 'pm-case';assert.equal(homedir(),'/');const host=createDirectoryHost('./.agents/pm','consumer');const owner=await readCaseModel(host,'slash-json');assert.equal(owner.state.model.factors.find(f=>f.factor_id==='light').label,'pass / fail');assert.equal(owner.state.outcomes[0].reason,'pass / fail');await createCaseModel(host,{id:'slash-sdk',op:'birth',title:'pass / fail',model:owner.state.model});await recordCaseOutcome(host,{id:owner.id,op:'sdk-slash',revision:owner.revision,outcome:{...owner.state.outcomes[0],execution_id:'sdk-slash',reason:'pass / fail'}});console.log('Root home SDK OK');\n");
      assert.match(execute(runtime, ['root-home.mjs'], cwd, rootHome), /Root home SDK OK/);
      writeFileSync(join(cwd, 'stored-fixture.ts'), readFileSync('test/stored-fixture.ts', 'utf8').replaceAll('../dist/index.js', 'pm-case'));
      writeFileSync(join(cwd, 'legacy.mjs'), "import assert from 'node:assert/strict';import {historicalState} from './stored-fixture.ts';import {createDirectoryHost,readCaseModel,createCaseModel,caseCoverage,casePacket,explainCaseTuple,recoverCaseOperation,canonical,CaseRefusal} from 'pm-case';const host=createDirectoryHost('./.agents/pm','consumer');const owner=await readCaseModel(host,'packed-suite');const state=historicalState(owner.state);await host.client.update(owner.id,{field:['case_state='+canonical(state)]});assert.equal(new CaseRefusal('lock_conflict','Locked').retryable,true);await assert.rejects(createCaseModel(host,{id:'legacy-resubmit',op:'birth',title:'Refused resubmission',model:state.model}),e=>e.code==='invalid_input');const report=await caseCoverage(host,{id:owner.id});const tuple=report.gaps[0].tuple_id;await casePacket(host,{id:owner.id,limit:1});await explainCaseTuple(host,{id:owner.id,tuple});assert.equal((await recoverCaseOperation(host,{id:owner.id,op:'birth'})).outcome,'committed');console.log(JSON.stringify({tuple}));\n");
      const legacy = JSON.parse(execute(runtime, ['legacy.mjs'], cwd, safe)) as { tuple: string };
      for (const args of [['propose','--max-cases','32'], ['coverage'], ['explain','--tuple',legacy.tuple], ['packet','--limit','1']]) {
        for (const format of [[], ['--json']]) {
          const output = run(['case', args[0], 'packed-suite', ...args.slice(1), '--budget', '8192', ...format]);
          if (format.length) assert.equal(JSON.parse(output).ok, true); else assert.match(output, /ok: true/);
        }
      }
      const legacyPlan = JSON.parse(run(['case','propose','packed-suite','--max-cases','32','--json']));
      const legacySelected = JSON.parse(run(['case','select','packed-suite','--proposal',legacyPlan.data.proposal,'--max-cases','32','--revision',legacyPlan.revision,'--op','legacy-select','--json'])); assert.equal(legacySelected.ok,true);
      assert.match(run(['case','record','packed-suite','--op','legacy-record','--revision',legacySelected.revision,'--input','-'],JSON.stringify({outcome:observation(legacyPlan.data.cases[0].case_id,'legacy-record')})),/ok: true/);
      writeFileSync(join(cwd,'sdk.mjs'),"import assert from 'node:assert/strict';import {createDirectoryHost,caseCoverage} from 'pm-case';const value=await caseCoverage(createDirectoryHost('./.agents/pm','consumer'),{id:'packed-suite'});assert.equal(value.case_counts.unresolved,1);console.log('SDK OK node');\n");
      const exactRuntimes: string[] = [];
      for (const version of ['v22.19.0', 'v26.13.0'] as const) {
        const node = acceptanceRuntime(version, process.execPath, process.env);
        if (node === null) continue;
        assert.equal(execute(node, ['--version'], cwd, safe).trim(), version, 'Provisioned runtime must have the exact expected version');
        unlinkSync(join(bin, 'node')); symlinkSync(node, join(bin, 'node'));
        assert.match(execute(node, ['sdk.mjs'], cwd, safe), /SDK OK node/);
        const packet = JSON.parse(execute('npx', ['--no-install','pm','case','packet','packed-suite','--limit','1','--json'],cwd,safe)); assert.equal(packet.data.summary.feasible_tuples,12);
        exactRuntimes.push(version); console.log(`packed acceptance: ${manager} ${version} SDK and CLI passed`);
      }
      unlinkSync(join(bin, 'node')); symlinkSync(process.execPath, join(bin, 'node')); journeys.push({ manager, commands, runtime, exact_runtimes: exactRuntimes });
    }
    const handoff = join(root, 'handoff'); mkdirSync(join(handoff, 'release-artifact'), { recursive: true }); mkdirSync(join(handoff, 'dist'));
    copyFileSync(archive, join(handoff, 'release-artifact/package.tgz'));
    writeFileSync(join(handoff, 'dist/index.js'), 'throw new Error("Unverified ignored distribution");\n');
    const publisherBin = join(root, 'publisher-bin'); mkdirSync(publisherBin); writeFileSync(join(publisherBin, 'package.json'), '{"type":"commonjs"}'); symlinkSync(process.execPath, join(publisherBin, 'node'));
    const publisher = join(publisherBin, 'npm');
    writeFileSync(publisher, '#!/usr/bin/env node\nconst fs=require("node:fs"),crypto=require("node:crypto"),path=require("node:path");const target=process.argv[3]||".";const bytes=fs.readFileSync(fs.statSync(target).isFile()?target:path.join(target,"dist/index.js"));process.stdout.write(crypto.createHash("sha256").update(bytes).digest("hex"));\n'); chmodSync(publisher, 0o755);
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8'); const publish = workflow.split('\n').find(line => /^\s*npm publish /.test(line))!.trim();
    const delivered = execute('/bin/bash', ['-c', publish], handoff, { ...env, PATH: publisherBin }); assert.equal(delivered, sha256, 'Publishing must select the validated archive after ignored build mutation');
    const verify = workflow.split('\n').find(line => line.includes('sha256sum --check --strict'))!.trim();
    assert.match(execute('/bin/bash', ['-c', verify], handoff, { ...env, ARTIFACT_SHA256: sha256 }), /OK/);
    writeFileSync(join(handoff, 'release-artifact/package.tgz'), 'Unverified replacement archive');
    const swapped = spawnSync('/bin/bash', ['-c', verify], { cwd: handoff, env: { ...env, ARTIFACT_SHA256: sha256 }, encoding: 'utf8' }); assert.notEqual(swapped.status, 0); assert.match(swapped.stdout + swapped.stderr, /FAILED/);
    assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), sha256);
    writeFileSync('packed-receipt.local.json', JSON.stringify({ sha256, files: packed[0].files.map(file => file.path), journeys, git_in_path: false, handoff: { ignored_distribution_mutated: true, captured_archive_selected: true, swapped_archive_refused: true } }, null, 2));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
