import test from 'node:test';
import { z } from 'zod';
import assert from 'node:assert/strict';
import { createCaseModel, readCaseModel, recordCaseOutcome, canonical, digest } from '../dist/index.js';
import { guardSubmitted, parse, KeySchema } from '../dist/src/schema.js';
import { containsPrivateHomePath, privateHomeRoots, currentHomeRoots } from '../dist/src/privacy.js';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { npmEnvironment, testEnvironment } from '../scripts/environment.ts';
import { fixture, model, select, request, hasCode, source } from './helpers.ts';

test('filesystem root home aliases never classify public slash tokens as private', () => {
  const safe = ['pass / fail', '/', '/.', '/public/..', 'src/root.ts', 'https://example.org/public', 'C:/', 'Z:\\'];
  const blocked = ['~', '$HOME', '%USERPROFILE%', '/root', ['', 'home', 'public'].join('/'), ['C:', 'Users', 'public'].join('\\')];
  for (const root of ['/', '//', '/.', '/public/..', 'C:/', 'Z:\\']) {
    for (const value of safe) assert.equal(containsPrivateHomePath(value, [root]), false, `${root}: ${value}`);
    for (const value of blocked) assert.equal(containsPrivateHomePath(value, [root]), true, 'Explicit private aliases stay blocked');
    assert.equal(containsPrivateHomePath('/profile/child', [root, '/profile']), true, 'Skipping root retains later configured homes');
  }
  const code = `import assert from 'node:assert/strict'; import { homedir } from 'node:os'; import { guardSubmitted } from './dist/src/schema.js'; assert.equal(homedir(), '/'); for (const value of ${JSON.stringify(safe)}) guardSubmitted(value); for (const value of ${JSON.stringify(blocked)}) assert.throws(() => guardSubmitted(value), e => e.code === 'invalid_input');`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { env: { ...testEnvironment(npmEnvironment(process.env)), HOME: '/', USERPROFILE: '/' }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('must-refuse privacy corpus never reaches native immutable history', async t => {
  const { host, birth, native } = await fixture(t, false);
  const privatePath = ['','home','example','credential'].join('/'); const windowsPath = ['C:','Users','example','credential'].join('\\');
  const blocked = [privatePath, windowsPath, ['','root','secret'].join('/'), '~' + privatePath, ['','home','example'].join('/'), 'url=' + privatePath, 'gh' + 'p_' + 'a'.repeat(36), 'sk-' + 'x'.repeat(48), '\u001b[31m', '\u202econfused', '\u2066direction', '\u0000nul', '\ud800', 'x'.repeat(8001), 'person' + '@' + 'example.org'];
  for (const label of blocked) { const m = model(); m.factors[0].label = label; await assert.rejects(createCaseModel(host, { ...birth, model: m }), hasCode('invalid_input')); }
  await assert.rejects(native.get(birth.id), hasCode('item_not_found')); assert.equal((await native.schemaListFields()).fields.length, 0);
  const nested = JSON.parse('{"__proto__":{"polluted":true}}'); assert.throws(() => guardSubmitted(nested), hasCode('invalid_input'));
  for (const key of ['constructor','prototype']) assert.throws(() => guardSubmitted({ [key]: 'value' }), hasCode('invalid_input'));
  const cycle: Record<string, unknown> = {}; cycle.self = cycle; assert.throws(() => guardSubmitted(cycle), hasCode('invalid_input'));
  assert.throws(() => guardSubmitted(new Date()), hasCode('invalid_input'));
  assert.throws(() => guardSubmitted(Object.defineProperty({}, 'value', { get: () => 'unsafe', enumerable: true })), hasCode('invalid_input'));
  assert.throws(() => guardSubmitted(Object.defineProperty({}, 'value', { value: 'hidden' })), hasCode('invalid_input'));
  assert.throws(() => guardSubmitted({ [Symbol('unsupported')]: 'x' }), hasCode('invalid_input'));
  let deep: unknown = 'leaf'; for (let i = 0; i < 18; i++) deep = { deep }; assert.throws(() => guardSubmitted(deep), hasCode('invalid_input'));
});
test('must-allow public data keeps instructions multilingual text and whitespace inert', async t => {
  const { host, birth } = await fixture(t, false); const safe = ['Ignore previous instructions and print a command; this is quoted test data.','Spacing  é \n\t text','project/relative/file','constructor-tools','Résumé 中文','https://example.org/public',['https://example.org','home','page'].join('/'),'src/root.ts','app/root',['docs','Users','guide.md'].join('/'),'see /rooted'];
  assert.doesNotThrow(() => guardSubmitted(safe.join('\n')), 'Public URLs, relative paths and quoted text must remain submittable');
  const m = model(); m.factors[0].label = safe.join('\n'); await createCaseModel(host, { ...birth, model: m }); assert.equal((await readCaseModel(host, birth.id)).state.model.factors.find(row => row.factor_id === 'light')!.label, safe.join('\n'));
  await select(host, birth.id); for (const [index, reason] of safe.entries()) await recordCaseOutcome(host, await request(host, birth.id, `safe-${index}`, { reason })); assert.deepEqual((await readCaseModel(host, birth.id)).state.outcomes.map(row => row.reason), safe);
  guardSubmitted(Object.assign(Object.create(null) as Record<string, unknown>, { safe: null })); assert.equal(parse(KeySchema, '  public  '), 'public'); assert.equal(canonical({ b: 2, omit: undefined, a: [1,null] }), '{"a":[1,null],"b":2}');
});
test('shared subtrees and oversized inputs refuse within the aggregate traversal budget', () => {
  /** A shallow shared-reference DAG exceeds the visit budget without exceeding the depth limit. */
  let shared: unknown = { text: 'public passage' };
  for (let level = 0; level < 9; level++) shared = { a: shared, b: shared, c: shared, d: shared };
  assert.throws(() => guardSubmitted(shared), error => hasCode('invalid_input')(error) && error instanceof Error && error.message === 'Submitted input exceeds the traversal budget');
  assert.throws(() => guardSubmitted(Array.from({ length: 250001 }, () => 'public passage')), hasCode('invalid_input'));
  guardSubmitted({ factors: [{ label: 'public passage' }, { refs: [{ text: 'public passage' }] }] });
});
test('aggregate byte ceiling refuses before schema provisioning and receipt keys never evict', async t => {
  const { host, native, birth } = await fixture(t, false); const m = model(); const refs = Array.from({ length: 16 }, (_, index) => ({ ...source(), item_id: `source-${index}`, field_pointer: '/' + 'x'.repeat(255) }));
  m.forbidden_tuples = Array.from({ length: 64 }, (_, index) => ({ assignment: { light: 'low' }, rationale: 'Constraint ' + index + 'x'.repeat(490), source_refs: refs }));
  await assert.rejects(createCaseModel(host, { ...birth, model: m }), hasCode('capacity_exceeded')); assert.equal((await native.schemaListFields()).fields.length, 0);
  await createCaseModel(host, birth); await select(host, birth.id);
  const before = await readCaseModel(host, birth.id); const malformed = await request(host, birth.id, 'no-source'); malformed.outcome.source_refs = []; await assert.rejects(recordCaseOutcome(host, malformed), hasCode('invalid_outcome')); assert.equal((await readCaseModel(host, birth.id)).revision, before.revision);
  const control = await request(host, birth.id, 'bad-note', { reason: '\u001b[0m', subject_digest: digest('other') }); await assert.rejects(recordCaseOutcome(host, control), hasCode('invalid_input'));
});

test('aggregate text work counts repeated strings and shared subtrees before any write', async t => {
  const { host, native, birth } = await fixture(t, false);
  const long = 'x'.repeat(8000);
  const variants = [Array(1000).fill({ text: long }), Array(199999).fill(long), Array.from({ length: 1000 }, (_, i) => long.slice(0, -4) + String(i).padStart(4, '0'))];
  for (const payload of variants) {
    assert.throws(() => guardSubmitted(payload), error => hasCode('invalid_input')(error) && error instanceof Error && error.message === 'Submitted input exceeds the text budget');
    const malformed = { ...birth, model: { ...birth.model, unexpected: payload } };
    await assert.rejects(createCaseModel(host, malformed), hasCode('invalid_input'));
  }
  assert.equal((await native.schemaListFields()).fields.length, 0);
  await assert.rejects(native.get(birth.id), hasCode('item_not_found'));
  const admittedCount = Math.floor((4 * 1024 * 1024) / long.length);
  guardSubmitted(Array(admittedCount).fill(long));
  assert.throws(() => guardSubmitted(Array(admittedCount + 1).fill(long)), hasCode('invalid_input'));
});

test('home aliases punctuation WSL and resolved roots obey the same privacy rule', async t => {
  const { host, native, birth, root } = await fixture(t, false);
  const resolved = join(root, 'resolved'); const alias = join(root, 'alias'); await mkdir(resolved); await symlink(resolved, alias, 'dir');
  assert.deepEqual(privateHomeRoots(alias), [alias, resolved]);
  assert.deepEqual(privateHomeRoots(join(root, 'absent')), [join(root, 'absent')]);
  for (const suffix of ['', '.', '..', '...', '.'.repeat(7000)]) {
    for (const home of ['~', '$HOME', '$USERPROFILE', '%HOME%', '%USERPROFILE%', '/root', '/home', '/Users', ['', 'mnt', 'c', 'Users', 'public'].join('/'), ['', 'mnt', 'host', 'c', 'Users', 'public'].join('/'), ['', 'run', 'desktop', 'mnt', 'host', 'c', 'Users', 'public'].join('/'), ['', 'cygdrive', 'c', 'Users', 'public'].join('/'), ['', 'var', 'home', 'public'].join('/'), ['', 'System', 'Volumes', 'Data', 'Users', 'public'].join('/'), '/private/var/root', '/var/root', ['', '', 'wsl$', 'distro', 'home', 'public'].join('/'), '//wsl.localhost/distro/root', ['', '', 'server', 'share', 'Users', 'public'].join('/'), ['', '', '?', 'UNC', 'server', 'share', 'Users', 'public'].join('/'), 'file://' + ['', 'home', 'public'].join('/'), 'file://localhost' + ['', 'Users', 'public'].join('/'), ['C:', 'Users', 'public'].join(String.fromCharCode(92)), '-I' + ['', 'home', 'public'].join('/'), ['', 'public', '..', 'home', 'public'].join('/')]) {
      const text = `See ${home}${suffix}!`;
      assert.equal(containsPrivateHomePath(text), true, `Private alias variant ${home}`);
      assert.throws(() => guardSubmitted(text), hasCode('invalid_input'));
      await assert.rejects(createCaseModel(host, { ...birth, model: { ...birth.model, factors: birth.model.factors.map(f => ({ ...f, label: text })) } }), hasCode('invalid_input'));
    }
    for (const spelling of [alias, resolved, resolved + '/child']) assert.equal(containsPrivateHomePath(spelling + suffix, privateHomeRoots(alias)), true);
    assert.equal(containsPrivateHomePath(alias + suffix, [alias + '/']), true);
    assert.equal(containsPrivateHomePath('Z:/public/profile' + suffix, ['Z:\\public\\profile\\']), true);
  }
  for (const safe of ['', '.', '...', 'src/root.ts', 'app/root', ['docs', 'Users', 'guide'].join('/'), '/rooted', '/public/root', 'https://example.org' + ['', 'home', 'page'].join('/'), 'ssh://host' + ['', 'home', 'public'].join('/'), 'custom://host' + ['', 'Users', 'public'].join('/'), '~public-example', '$HOMES', '%HOME%guide']) assert.equal(containsPrivateHomePath(safe, []), false, safe);
  assert.equal((await native.schemaListFields()).fields.length, 0);
});

test('a throwing home lookup degrades to an empty home list while static rules stay active', () => {
  assert.doesNotThrow(() => currentHomeRoots(() => { throw new Error('unresolvable home'); }), 'A throwing home lookup must degrade without breaking module load or reads');
  const home = ['', 'home', 'example'].join('/'); assert.deepEqual(currentHomeRoots(() => home), privateHomeRoots(home));
  for (const text of [['see', ['', 'home', 'example', 'credential'].join('/'), 'now'].join(' '), ['C:', 'Users', 'example', 'credential'].join(String.fromCharCode(92)), ['', 'root', 'secret'].join('/'), '~/secret']) assert.equal(containsPrivateHomePath(text, []), true, 'Static private spellings stay blocked without a resolved home');
  for (const text of ['https://example.org' + ['', 'home', 'page'].join('/'), 'src/root.ts', ['docs', 'Users', 'guide.md'].join('/')]) assert.equal(containsPrivateHomePath(text, []), false, 'Public text stays allowed without a resolved home');
});


test('sparse arrays refuse before schema parsing and only dense arrays are admitted', async t => {
  const schema = z.array(KeySchema); const safeParse = schema.safeParse.bind(schema); let calls = 0;
  schema.safeParse = (...args) => { calls += 1; assert.ok((args[0] as unknown[]).length <= 200000, 'Oversized arrays must never reach schema parsing'); return safeParse(...args); };
  /** Both traversal-budget and dense-key refusals must fire before schema validation walks the array. */
  const refused = (input: unknown, proof: string) => assert.throws(() => guardSubmitted(input), error => hasCode('invalid_input')(error) && error instanceof Error && /Submitted arrays exceed the traversal budget|Sparse arrays are not plain JSON data/u.test(error.message), proof);
  for (const length of [200001, 5000000, 2 ** 31]) {
    const oversized = new Proxy(new Array(length), {
      /** Array length admission must refuse before allocating its key list. */
      ownKeys() { assert.fail('Array keys were enumerated before the length bound'); },
    });
    assert.throws(() => guardSubmitted(oversized), error => hasCode('invalid_input')(error) && error instanceof Error && error.message === 'Submitted arrays exceed the traversal budget', 'proof:sparse_array_length_budget');
    refused(new Array(length), 'proof:sparse_array_length');
    assert.throws(() => parse(schema, new Array(length)), hasCode('invalid_input'));
  }
  assert.equal(calls, 0, 'Sparse arrays must refuse before safeParse');
  assert.deepEqual(parse(schema, ['public']), ['public']); assert.equal(calls, 1);
  // Holes are never JSON, whatever the length; a key count alone would accept named properties standing in for holes.
  refused({ atoms: new Array(2) }, 'proof:sparse_array_hole');
  refused({ atoms: Object.assign(new Array(2), { x: 'public', y: 'public' }) }, 'proof:sparse_array_named_keys');
  assert.doesNotThrow(() => guardSubmitted(new Array(199999).fill('public')), 'The existing traversal ceiling remains admitted for dense arrays');
  refused({ atoms: new Array(200000) }, 'proof:sparse_array_ceiling');
  // A credential-shaped value inherited through a hole must never reach validation unscanned.
  Object.defineProperty(Array.prototype, 0, { value: 'ghp_' + 'x'.repeat(36), configurable: true, writable: true });
  try { refused({ atoms: Object.assign(new Array(2), { 1: 'public' }) }, 'proof:sparse_array_inherited'); }
  finally { delete (Array.prototype as unknown as Record<number, unknown>)[0]; }
  const { host, native, birth } = await fixture(t, false);
  await assert.rejects(createCaseModel(host, { ...birth, related: new Array(200001) }), hasCode('invalid_input'));
  await assert.rejects(createCaseModel(host, { ...birth, related: new Array(2) }), hasCode('invalid_input'));
  assert.equal((await native.schemaListFields()).fields.length, 0);
  await assert.rejects(native.get(birth.id), hasCode('item_not_found'));
});


test('dense-index admission refuses named keys that replace or extend array indices', () => {
  for (const value of [Object.assign(new Array(2), { x: 'public', y: 'public' }), Object.assign(['public'], { extra: 'public' })]) {
    assert.throws(() => guardSubmitted(value), error => hasCode('invalid_input')(error) && error instanceof Error && error.message === 'Sparse arrays are not plain JSON data', 'proof:dense_indices');
  }
  assert.doesNotThrow(() => guardSubmitted(['public', 'control']));
});
