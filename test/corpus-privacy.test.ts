import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { parse } from '@babel/parser';
import { walk } from './syntax.ts';
import { passages, matrices } from './matrices.ts';
import { publicTrackers } from './corpus.ts';

const privateRepositories = ['pm-observer','pm-web-hosted','pm-gpt'];
/** Public artifact guard rejects exact private repository references without accessing them. */
function checkPublic(text: string): void { for (const name of privateRepositories) assert.ok(!new RegExp(`(?<![\\w-])${name}(?![\\w-])`,'i').test(text), 'Private fleet citation refused'); }
/** Confine every corpus read capability to the reviewed source list and disposable copies. */
function readBoundaries(source: string): void {
  const tree = parse(source,{ sourceType:'module', plugins:['typescript'] }); const seen: string[] = [];
  const allowed = ["fileURLToPath(new URL('../', import.meta.url))","resolve(root, '..', repo)","execFileSync('git', ['archive', revision, '.agents/pm'], { cwd: original, maxBuffer: 32 * 1024 * 1024, env: npmEnvironment(process.env) })","execFileSync('tar', ['-x', '-C', copy], { input: archive })","new PmClient({ cwd: copy, pmRoot: join(copy, '.agents/pm'), noExtensions: true })","fileURLToPath(import.meta.url)"];
  const modules = new Map([
    ['node:fs/promises',['mkdtemp','mkdir','rm','writeFile']], ['node:path',['join','resolve']], ['node:os',['tmpdir']],
    ['node:child_process',['execFileSync']], ['node:crypto',['createHash']], ['node:url',['fileURLToPath']],
    ['@unbrained/pm-cli/sdk/core',['PmClient']], ['@unbrained/pm-cli/sdk/runtime',['certifyCompleteListResult']],
    ['../dist/src/schema.js',['guardSubmitted']], ['../scripts/environment.ts',['npmEnvironment']],
  ]);
  const capabilities = new Set(['fileURLToPath','resolve','execFileSync','PmClient','readFile','readFileSync','fetch']);
  walk(tree,node=>{
    if(node.type==='ImportDeclaration') {
      const names = modules.get((node.source as {value:string}).value); assert.ok(names,'Unreviewed import');
      for(const row of node.specifiers as {type:string;local:{name:string};imported?:{name:string}}[]) {
        assert.equal(row.type,'ImportSpecifier','Namespace and default acquisition imports refused');
        assert.ok(names.includes(row.imported!.name),'Unreviewed acquisition import');
        assert.equal(row.imported!.name,row.local.name,'Aliased acquisition imports refused');
      }
    }
    assert.notEqual(node.type,'ImportExpression','Dynamic import refused');
    if(node.type==='CallExpression'||node.type==='OptionalCallExpression'||node.type==='NewExpression'){
      const callee=node.callee as {name?:string;type:string;property?:{name?:string;value?:string}};
      assert.ok(!['eval','Function','require','Import'].includes(callee.type==='Import' ? callee.type : callee.name??callee.property?.name??callee.property?.value??''),'Dynamic capability refused');
      if(callee.type==='MemberExpression'||callee.type==='OptionalMemberExpression') assert.ok(!['readFile','readFileSync','readdir','readdirSync','fetch','execFileSync'].includes(callee.property?.name??callee.property?.value??''),'Member acquisition calls refused');
      if(callee.type==='Identifier'&&capabilities.has(callee.name!))seen.push(source.slice(node.start as number,node.end as number));
    }
  });
  assert.deepEqual(seen.sort(),allowed.sort(),'Acquisition read boundary differs');
  for(const row of publicTrackers){ assert.match(source,new RegExp(`repo: '${row.repo}', revision: '${row.revision}'`)); }
  assert.match(source,/for \(const \{ repo, revision, ids \} of publicTrackers\)/); assert.match(source,/client\.listAllComplete\(\); certifyCompleteListResult\(all\)/);
}
test('public-only acquisition guard pins capabilities roots and complete SDK reads',()=>{
  const source=readFileSync('test/corpus.ts','utf8');readBoundaries(source);
  for(const changed of [source+"\nawait readFile('unapproved','utf8');",source.replace("resolve(root, '..', repo)","resolve(root, '..', 'unapproved')"),source.replace('cwd: copy, pmRoot','cwd: original, pmRoot'),source.replace("from 'node:fs/promises'","from 'node:fs'"),source+"\nawait import('node:fs');"] )assert.throws(()=>readBoundaries(changed));
  for(const changed of [source.replace('{ mkdtemp, mkdir, rm, writeFile }','{ mkdtemp, mkdir, rm, writeFile, readdir }')+"\nawait readdir('unapproved');", source+"\nimport * as fs from 'node:fs/promises'; await fs.readFile('unapproved');", source+"\nimport fs from 'node:fs/promises'; await fs.readFile('unapproved');"] )assert.throws(()=>readBoundaries(changed),'Unapproved imported acquisition capabilities must be rejected');
  for(const suffix of ["\nawait fs.readFile('unapproved');", "\nawait fs['readdir']('unapproved');", "\nawait fs?.readFile('unapproved');", "\nawait fs.readFile?.('unapproved');", "\nawait fs?.['readdir']?.('unapproved');", "\nloader.require('node:fs');", "\nloader?.['require']?.('node:fs');", "\nglobalThis.eval('unapproved');"]) assert.throws(()=>readBoundaries(source+suffix),'Member acquisition calls must be rejected');
});
test('public passages and domain fixtures retain only verified public coordinates and exact text digests',()=>{
  assert.ok(passages.length>=20);checkPublic(JSON.stringify(passages));checkPublic(JSON.stringify(matrices));
  for(const path of ['docs/real-data-receipt.json','docs/public-harness-receipt.json','docs/real-data.md','README.md','ARCHITECTURE.md'])checkPublic(readFileSync(path,'utf8'));
  for(const row of passages){assert.ok(publicTrackers.some(entry=>entry.repo===row.repo&&entry.revision===row.revision));assert.equal(row.content_digest,createHash('sha256').update(row.text).digest('hex'));assert.ok(row.url.startsWith(`https://github.com/unbraind/${row.repo}/blob/${row.revision}/.agents/pm/`));}
  for(const name of privateRepositories){assert.throws(()=>checkPublic(name));assert.throws(()=>checkPublic(name.toUpperCase()));checkPublic(name+'-tools');}
});
test('corpus guard skips only invalid_input and propagates unexpected failures',()=>{
  const statement=readFileSync('test/corpus.ts','utf8').match(/try \{ guardSubmitted\(text\); \} catch[^\n]+/);
  assert.ok(statement,'The corpus passage guard must be exercised');
  const script=`let accepted=false; for (const text of ['public passage']) { ${statement[0]} accepted=true; } accepted;`;
  assert.equal(runInNewContext(script,{guardSubmitted:()=>{},Error}),true);
  const refused=Object.assign(new Error('Expected refusal'),{code:'invalid_input'});
  assert.equal(runInNewContext(script,{guardSubmitted:()=>{throw refused;},Error}),false);
  for(const error of [new TypeError('Unexpected guard defect'),Object.assign(new Error('Unexpected refusal'),{code:'outcome_unknown'})]) {
    assert.throws(()=>runInNewContext(script,{guardSubmitted:()=>{throw error;},Error}),actual=>actual===error);
  }
});
