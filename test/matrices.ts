import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { digest } from '../dist/index.js';
import type { CaseModel, Assignment } from '../dist/index.js';
import type { Passage } from './corpus.ts';

/** Reviewed immutable public passages, exported through complete SDK reads from frozen public copies. */
export const passages = JSON.parse(readFileSync(new URL('fixtures/public-passages.json', import.meta.url), 'utf8')) as Passage[];
/** Attach exact native source coordinates and content identities to reviewed factor definitions. */
function references(repo: string) { return passages.filter(row => row.repo === repo).map(({ item_id, item_hash, field_pointer, content_digest }) => ({ item_id, item_hash, field_pointer, content_digest })); }
/** Create one public-package matrix from explicit reviewed factor and exclusion declarations. */
function matrix(repo: string, definitions: Record<string, string[]>, exclusions: Assignment[], mandatory: Assignment[]): CaseModel {
  const refs = references(repo); return { model_key: repo, factors: Object.entries(definitions).map(([factor_id, values]) => ({ factor_id, values, label: factor_id, source_refs: refs })), strength: 2, forbidden_tuples: exclusions.map(assignment => ({ assignment, rationale: 'Excluded by the scoped operation contract documented in docs/real-data.md', source_refs: refs })), mandatory_cases: mandatory, subject_digest: digest({ repo, revision: passages.find(row => row.repo === repo)!.revision }), };
}
/** Three distinct reviewed public configuration populations, including required regression scenarios. */
export const matrices = [
  matrix('pm-csv', { runtime: ['node','bun'], close_receipt: ['ok','conflict'], persisted_status: ['closed','open'], cleanup: ['ok','fail'] }, [{ close_receipt: 'ok', persisted_status: 'open' }], [{ runtime: 'node', close_receipt: 'conflict', persisted_status: 'closed', cleanup: 'ok' }]),
  matrix('pm-beads', { runtime: ['node','bun'], line_ending: ['lf','crlf'], source: ['stable','changed'], topology: ['cycle','acyclic'], action: ['explain','preview'] }, [{ topology: 'acyclic', action: 'preview' }], [{ runtime: 'node', line_ending: 'lf', source: 'changed', topology: 'cycle', action: 'preview' }]),
  matrix('pm-ops', { runtime: ['node','bun'], permissions: ['readonly','writable'], format: ['current','future'], history: ['healthy','corrupt'] }, [], [{ runtime: 'node', permissions: 'readonly', format: 'current', history: 'healthy' }]),
];
/** Independent mixed-radix oracle; freeze tuple strings before invoking the production generator. */
export function gold(model: CaseModel, strength: number = model.strength) {
  const factors = model.factors; const population = factors.reduce((n, row) => n * row.values.length, 1); const valid: Assignment[] = [];
  for (let i = 0; i < population; i++) { let n = i; const row: Assignment = {}; for (const f of factors) { row[f.factor_id] = f.values[n % f.values.length]; n = Math.floor(n / f.values.length); } if (!model.forbidden_tuples.some(c => Object.keys(c.assignment).every(k => row[k] === c.assignment[k]))) valid.push(row); }
  const tuples = new Set<string>();
  /** Choose factor positions independently of the production tuple enumeration implementation. */
  function choose(indices: number[], from: number): void {
    if (indices.length === strength) { for (const row of valid) tuples.add(JSON.stringify(indices.map(i => [factors[i].factor_id,row[factors[i].factor_id]]).sort(([a],[b]) => a < b ? -1 : 1))); return; }
    for (let index = from; index < factors.length; index++) choose([...indices,index], index + 1);
  }
  choose([],0); const sorted = [...tuples].sort(); return { population, valid, tuples: sorted, sha256: createHash('sha256').update(JSON.stringify(sorted)).digest('hex') };
}
