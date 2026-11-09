import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from '@babel/parser';
import { decode } from '@toon-format/toon';
import { walk } from './syntax.ts';
import { runtimeSources } from '../scripts/inventory.ts';

/** Prevent harness acquisition from entering any shipped runtime module. */
function productionImports(source: string): void {
  walk(parse(source, { sourceType: 'module', plugins: ['typescript'] }), node => {
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(String(node.type)) && node.source) {
      assert.doesNotMatch((node.source as { value: string }).value, /(?:^|\/)test(?:\/|$)|corpus|harness/u, 'Production imports must exclude proof code');
    }
    assert.notEqual(node.type, 'ImportExpression', 'Dynamic production imports are forbidden');
    if (['CallExpression', 'OptionalCallExpression'].includes(String(node.type))) {
      const callee = node.callee as { type: string; name?: string; property?: { name?: string; value?: string } };
      assert.ok(!['Import', 'require'].includes(callee.type === 'Import' ? callee.type : callee.name ?? callee.property?.name ?? callee.property?.value ?? ''), 'Dynamic and member production loaders are forbidden');
    }
  });
}

/** Check every runtime setup rather than one currently reviewed line. */
function runtimeProvisioning(source: string): void {
  for (const step of source.split(/(?=^      - name:)/m)) {
    if (step.includes('uses: actions/setup-node@')) assert.match(step, /node-version: (?:22\.19\.0|26\.13\.0|\$\{\{ matrix\.node-version \}\})\s*\n/);
    if (step.includes('uses: oven-sh/setup-bun@')) assert.match(step, /bun-version: 1\.3\.5\s*\n/);
  }
  for (const job of source.split(/(?=^  [a-z_]+:)/m).filter(job => job.includes('run: npm run release:check') || job.includes('run: npm run test:install'))) {
    for (const [major, version] of [['22', '22.19.0'], ['26', '26.13.0']]) {
      const setup = job.indexOf(`node-version: ${version}`); const retained = job.indexOf(`PM_CASE_NODE_${major}=$(command -v node)`);
      assert.ok(setup >= 0 && retained > setup && retained < job.indexOf('run: npm ci'), 'Full gates require both exact runtimes before dependency execution');
    }
  }
  if (source.includes('matrix.node-version')) assert.match(source, /node-version: \['22\.19\.0', '26\.13\.0'\]/);
}

/** Bind release metadata to the package owner and reject inherited scaffold identity anywhere. */
function workflowPackageIdentity(source: string): void {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string; repository: { url: string } };
  assert.doesNotMatch(source, /pm-unit/, 'Workflows must not retain the template package identity');
  if (source.includes('gh pr create')) {
    assert.ok(source.includes('--title "Release ' + pkg.name + ' ${RELEASE_TAG}"'), 'Release PR title must name the owning package');
    const repository = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
    assert.ok(source.includes(`Tracking: [${pkg.name}-release](${repository}/blob/main/.agents/pm/epics/${pkg.name}-release.toon)`), 'Release PR tracking must link the owning package item');
  }
}

/** Read a static property spelling without evaluating computed expressions. */
function propertyName(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const node = value as { type?: string; name?: string; value?: string; expressions?: unknown[]; quasis?: { value: { cooked: string | null } }[] };
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'StringLiteral') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) return node.quasis?.[0].value.cooked ?? undefined;
  return undefined;
}

/** Reject literal PATH separators in string and template segments of composed environment values. */
function pathConventions(source: string): void {
  walk(parse(source, { sourceType: 'module', plugins: ['typescript'] }), node => {
    const left = node.left as { property?: unknown } | undefined;
    const name = propertyName(node.key) ?? propertyName(left?.property);
    if (typeof name !== 'string' || name.toLowerCase() !== 'path') return;
    const expression = node.value ?? node.right;
    let inherited = false; const separators: string[] = [];
    walk(expression, child => {
      if (child.type === 'Identifier' && typeof child.name === 'string' && child.name.toUpperCase() === 'PATH') inherited = true;
      const segments = child.type === 'StringLiteral' ? [String(child.value)] : child.type === 'TemplateElement' ? Object.values(child.value as { raw: string; cooked: string | null }).filter((value): value is string => typeof value === 'string') : [];
      if (segments.some(segment => segment.toUpperCase() === 'PATH')) inherited = true;
      for (const segment of segments) for (const separator of segment.match(/[:;]/gu) ?? []) separators.push(separator);
    });
    if (inherited) assert.deepEqual(separators, [], 'PATH composition must use the platform delimiter');
  });
}

test('all production imports exclude static dynamic member and optional proof loaders', () => {
  for (const path of runtimeSources()) productionImports(readFileSync(path, 'utf8'));
  for (const code of ["import '../test/corpus.ts';", "export * from '../test/harness-plan.ts';", "await import('../test/corpus.ts');", "require('../test/corpus.ts');", "loader.require('../test/corpus.ts');", "loader?.require('../test/corpus.ts');", "loader['require']?.('../test/corpus.ts');"]) assert.throws(() => productionImports(code), assert.AssertionError);
});

test('all CI and release jobs provision their exact acceptance runtimes', () => {
  for (const path of readdirSync('.github/workflows').filter(name => name.endsWith('.yml'))) {
    const source = readFileSync(`.github/workflows/${path}`, 'utf8'); runtimeProvisioning(source);
    for (const version of ['22.19.0', '26.13.0', '1.3.5']) if (source.includes(`version: ${version}`)) assert.throws(() => runtimeProvisioning(source.replaceAll(`version: ${version}`, 'version: latest')), assert.AssertionError);
  }
  const source = readFileSync('.github/workflows/release.yml', 'utf8');
  assert.throws(() => runtimeProvisioning(source.replaceAll('PM_CASE_NODE_26=', 'MISSING_NODE_26=')), assert.AssertionError);
  assert.match(source, /pkg_name="pm-case"/); assert.doesNotMatch(source, /pm-unit/);
});

test('all workflow release metadata binds the owning package identity', () => {
  for (const path of readdirSync('.github/workflows').filter(name => /\.ya?ml$/.test(name))) {
    const source = readFileSync(`.github/workflows/${path}`, 'utf8'); workflowPackageIdentity(source);
    for (const match of source.matchAll(/pm-case/g)) {
      const changed = source.slice(0, match.index) + 'pm-unit' + source.slice(match.index + match[0].length);
      assert.throws(() => workflowPackageIdentity(changed), assert.AssertionError, `Every package coordinate in ${path} must reject template drift`);
    }
  }
  const source = readFileSync('.github/workflows/release.yml', 'utf8');
  for (const [before, after] of [['Release pm-case', 'Release wrong-package'], ['Tracking: [pm-case-release]', 'Tracking: [wrong-item]']]) assert.throws(() => workflowPackageIdentity(source.replace(before, after)), assert.AssertionError);
});

test('harness archives share frozen provenance while retaining intentional path scopes', () => {
  const harvest = readFileSync('test/corpus.ts', 'utf8'); const harness = readFileSync('test/public-harness.acceptance.ts', 'utf8');
  assert.match(harvest, /Harvest only tracker passages; the harness needs the full tree/);
  assert.match(harvest, /Both archives use the same frozen revision/);
  assert.match(harvest, /\['archive', revision, '\.agents\/pm'\]/);
  assert.match(harness, /\['archive', source\.revision\]/);
  assert.match(harness, /publicTrackers\.find/);
});

test('all receipt producers and consumers validate planned coordinates before side effects', () => {
  const producer = readFileSync('test/public-harness.acceptance.ts', 'utf8');
  assert.match(producer, /publicHarnessArguments\(check, resolve\('test\/harness-reporter\.ts'\)\)/);
  assert.match(producer, /command: publicHarnessCommand\(check\)/);
  for (const [path, validation, sideEffect] of [
    ['test/public-harness.acceptance.ts', 'harnessPlanBindings(results);', "await writeFile('docs/public-harness-receipt.json'"],
    ['test/public-harness.acceptance.ts', "selectedTestFailed(red.stdout, check.pattern, check.file)", "results.push({...common,result:'fail'"],
    ['test/real-data-proof.ts', 'harnessPlanBindings(harness.results);', 'const root=await mkdtemp('],
  ]) {
    const source = readFileSync(path, 'utf8'); const guard = source.indexOf(validation);
    assert.ok(guard >= 0 && guard < source.indexOf(sideEffect), 'Every evidence path must validate the same plan before persistence');
  }
});

test('harness PATH composition and linked commands use platform conventions', () => {
  for (const path of [...readdirSync('test', { recursive: true }).map(String), ...readdirSync('scripts', { recursive: true }).map(name => `../scripts/${name}`)].filter(name => name.endsWith('.ts'))) {
    const source = readFileSync(`test/${path}`, 'utf8');
    pathConventions(source);
  }
  for (const path of runtimeSources()) pathConventions(readFileSync(path, 'utf8'));
  for (const expression of ["bin + ':' + process.env.PATH", "[bin, process.env.PATH].join(':')", "[bin, process.env.PATH].join(';')"]) assert.throws(() => pathConventions(`const env = { PATH: ${expression} };`), assert.AssertionError);
  for (const separator of [':', ';', '\\x3a', '\\u003b']) {
    for (const inherited of ['process.env.PATH', "process.env['Path']", 'process.env[`PATH`]']) {
      for (const expression of ['`${bin}' + separator + '${' + inherited + '}`', '`${bin}' + separator + 'extra${' + inherited + '}`', 'bin + "prefix' + separator + '" + ' + inherited, '[bin, ' + inherited + '].join(`' + separator + '`)']) {
        for (const source of [`const env = { PATH: ${expression} };`, `const env = { 'Path': ${expression} };`, `const env = { [\`PATH\`]: ${expression} };`, `process.env.PATH = ${expression};`, `process.env['PATH'] = ${expression};`, `process.env[\`Path\`] = ${expression};`]) assert.throws(() => pathConventions(source), assert.AssertionError, source);
      }
    }
  }
  pathConventions('const env = { PATH: [bin, process.env.PATH].join(delimiter) };');
  pathConventions('const env = { PATH: `${bin}${delimiter}${process.env.PATH}` };');
  pathConventions('process.env.PATH = bin + delimiter + process.env.PATH;');
  for (const path of ['test/public-harness.acceptance.ts', 'test/revert.acceptance.ts']) assert.match(readFileSync(path, 'utf8'), /\+\s*delimiter\s*\+/);
  const revert = readFileSync('test/revert.acceptance.ts', 'utf8');
  assert.doesNotMatch(revert, /spawnSync\('\/bin\/sh'/); assert.match(revert, /spawnSync\(command,\{\.\.\.options,shell:true\}\)/);
  assert.ok(revert.indexOf('const baseline=spawnSync(process.execPath') < revert.indexOf('await writeFile(path,original.replace'));
  assert.match(revert, /selectedTestFailed\(red.stdout,mutation.pattern,mutation.test\)/);
});

test('documented archive installs create and enter a fresh consumer directory outside the source checkout', () => {
  const text = readFileSync('README.md', 'utf8'); let documented = 0;
  for (const block of text.matchAll(/```sh\n([\s\S]*?)```/g)) {
    const lines = block[1].split('\n');
    const install = lines.findIndex(line => /^(?:npm install|bun add) .*pm-case.*\.tgz/.test(line));
    if (install < 0) continue; documented += 1;
    assert.ok(lines.slice(0, install).some(line => /^mkdir .+&& cd /.test(line)), 'Every documented archive install must create and enter a fresh consumer directory first');
    assert.match(lines[install], /\.{2}\//, 'Archive paths must resolve from the consumer directory, never the package directory');
  }
  assert.ok(documented > 0, 'At least one documented archive install must exist');
});

test('linked release gates keep timeouts above the measured full-run duration', () => {
  let gates = 0;
  for (const path of readdirSync('.agents/pm', { recursive: true }).map(String).filter(name => name.endsWith('.toon'))) {
    const decoded = decode(readFileSync(join('.agents/pm', path), 'utf8')) as { tests?: { command: string; timeout_seconds?: number }[] };
    for (const entry of decoded.tests ?? []) if (/release:check/.test(entry.command)) { gates += 1; assert.ok((entry.timeout_seconds ?? 0) > 3000, `Linked release gates must exceed the measured 2552-second run: ${path}`); }
  }
  assert.ok(gates >= 2, 'Both npm and Bun release gates must stay linked with bounded timeouts');
});

test('all documented CLI and SDK installs initialize a tracker before package use', () => {
  const source = readFileSync('README.md', 'utf8');
  for (const block of source.matchAll(/```(?:sh|ts)\n([\s\S]*?)```/g)) {
    const commands = block[1].split('\n'); let initialized = false;
    for (const command of commands) {
      if (/^(?:npm install|bun add)/.test(command)) initialized = false;
      if (/pm init demo|await native\.init\(/.test(command)) initialized = true;
      if (/pm package install|const host = createDirectoryHost/.test(command)) assert.ok(initialized, 'Every installation path must initialize the tracker first');
    }
  }
  assert.match(source, /await native\.init\(/);
  assert.match(readFileSync('docs/real-data.md', 'utf8'), /Packet-framing changes may require regenerating the receipt/);
});
