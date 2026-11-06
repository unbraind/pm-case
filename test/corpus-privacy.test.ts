import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from '@babel/parser';
import { passages, matrices } from './matrices.ts';
import { publicTrackers } from './corpus.ts';

const privateRepositories = ['pm-observer','pm-web-hosted','pm-gpt'];
/** Public artifact guard rejects exact private repository references without accessing them. */
function checkPublic(text: string): void { for (const name of privateRepositories) assert.ok(!new RegExp(`(?<![\\w-])${name}(?![\\w-])`,'i').test(text), 'Private fleet citation refused'); }
/** Walk static syntax nodes without evaluating acquisition code or third-party imports. */
function walk(value: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const child of value) walk(child,visit); return; }
  if (typeof value !== 'object' || value === null) return; const node = value as Record<string, unknown>; if (typeof node.type === 'string') visit(node);
  for (const [key, child] of Object.entries(node)) if (!['loc','start','end','extra','comments','tokens'].includes(key)) walk(child,visit);
}
/** Confine every corpus read capability to the reviewed source list and disposable copies. */
function readBoundaries(source: string): void {
  const tree = parse(source,{ sourceType:'module', plugins:['typescript'] }); const seen: string[] = [];
  const allowed = ["fileURLToPath(new URL('../', import.meta.url))","resolve(root, '..', repo)","execFileSync('git', ['archive', revision, '.agents/pm'], { cwd: original, maxBuffer: 32 * 1024 * 1024, env: npmEnvironment(process.env) })","execFileSync('tar', ['-x', '-C', copy], { input: archive })","new PmClient({ cwd: copy, pmRoot: join(copy, '.agents/pm'), noExtensions: true })","fileURLToPath(import.meta.url)"];
  const modules = new Set(['node:fs/promises','node:path','node:os','node:child_process','node:crypto','node:url','@unbrained/pm-cli/sdk/core','@unbrained/pm-cli/sdk/runtime','../dist/src/schema.js','../scripts/environment.ts']);
  const capabilities = new Set(['fileURLToPath','resolve','execFileSync','PmClient','readFile','readFileSync','fetch']);
  walk(tree,node=>{
    if(node.type==='ImportDeclaration') { assert.ok(modules.has((node.source as {value:string}).value),'Unreviewed import'); for(const row of node.specifiers as {local:{name:string};imported?:{name:string}}[])assert.equal(row.imported?.name??row.local.name,row.local.name,'Aliased acquisition imports refused'); }
    assert.notEqual(node.type,'ImportExpression','Dynamic import refused');
    if(node.type==='CallExpression'||node.type==='NewExpression'){ const callee=node.callee as {name?:string;type:string}; assert.ok(!['eval','Function','require'].includes(callee.name??''),'Dynamic capability refused'); if(callee.type==='Identifier'&&capabilities.has(callee.name!))seen.push(source.slice(node.start as number,node.end as number)); }
  });
  assert.deepEqual(seen.sort(),allowed.sort(),'Acquisition read boundary differs');
  for(const row of publicTrackers){ assert.match(source,new RegExp(`repo: '${row.repo}', revision: '${row.revision}'`)); }
  assert.match(source,/for \(const \{ repo, revision, ids \} of publicTrackers\)/); assert.match(source,/client\.listAllComplete\(\); certifyCompleteListResult\(all\)/);
}
test('public-only acquisition guard pins capabilities roots and complete SDK reads',()=>{
  const source=readFileSync('test/corpus.ts','utf8');readBoundaries(source);
  for(const changed of [source+"\nawait readFile('unapproved','utf8');",source.replace("resolve(root, '..', repo)","resolve(root, '..', 'unapproved')"),source.replace('cwd: copy, pmRoot','cwd: original, pmRoot'),source.replace("from 'node:fs/promises'","from 'node:fs'"),source+"\nawait import('node:fs');"] )assert.throws(()=>readBoundaries(changed));
});
test('public passages and domain fixtures retain only verified public coordinates and exact text digests',()=>{
  assert.ok(passages.length>=20);checkPublic(JSON.stringify(passages));checkPublic(JSON.stringify(matrices));
  for(const path of ['docs/real-data-receipt.json','docs/public-harness-receipt.json','docs/real-data.md','README.md','ARCHITECTURE.md'])checkPublic(readFileSync(path,'utf8'));
  for(const row of passages){assert.ok(publicTrackers.some(entry=>entry.repo===row.repo&&entry.revision===row.revision));assert.equal(row.content_digest,createHash('sha256').update(row.text).digest('hex'));assert.ok(row.url.startsWith(`https://github.com/unbraind/${row.repo}/blob/${row.revision}/.agents/pm/`));}
  for(const name of privateRepositories){assert.throws(()=>checkPublic(name));assert.throws(()=>checkPublic(name.toUpperCase()));checkPublic(name+'-tools');}
});
