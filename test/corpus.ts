import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PmClient } from '@unbrained/pm-cli/sdk/core';
import { certifyCompleteListResult } from '@unbrained/pm-cli/sdk/runtime';
import { guardSubmitted } from '../dist/src/schema.js';
import { npmEnvironment } from '../scripts/environment.ts';

/** Frozen public-only acquisition allowlist; metadata and commit visibility checked before admission. */
export const publicTrackers = [
  { repo: 'pm-csv', revision: 'd48dd3e07cf3b2d7153b2b687fa581735cffad0a', ids: ['pm-csv-row-lineage','pm-csv-zv31'] },
  { repo: 'pm-beads', revision: '85b6392112929e967dfb5e174c773a0590124c35', ids: ['pm-beads-y6cp'] },
  { repo: 'pm-ops', revision: '274c15895a88a12bec3d154a7a0ebf61e014b799', ids: ['ops-sdk-adoption-1025'] },
] as const;
/** Exact selected public passage with independently captured source identity. */
export interface Passage {
  /** Repository allowlist entry. */
  repo: string;
  /** Published immutable Git commit. */
  revision: string;
  /** Source item identity. */
  item_id: string;
  /** Native canonical source document revision. */
  item_hash: string;
  /** Exact source field or comment address. */
  field_pointer: string;
  /** Reviewed public text; never executed. */
  text: string;
  /** SHA-256 of exact UTF-8 text bytes. */
  content_digest: string;
  /** Immutable published source location. */
  url: string;
}
/** Read only frozen public Git objects into disposable copies and export selected reviewed passages. */
export async function harvest(): Promise<Passage[]> {
  const root = fileURLToPath(new URL('../', import.meta.url)); const scratch = await mkdtemp(join(tmpdir(), 'case-public-')); const passages: Passage[] = [];
  try {
    for (const { repo, revision, ids } of publicTrackers) {
      const original = resolve(root, '..', repo); const copy = join(scratch, repo); await mkdir(copy);
      const archive = execFileSync('git', ['archive', revision, '.agents/pm'], { cwd: original, maxBuffer: 32 * 1024 * 1024, env: npmEnvironment(process.env) });
      execFileSync('tar', ['-x', '-C', copy], { input: archive });
      const client = new PmClient({ cwd: copy, pmRoot: join(copy, '.agents/pm'), noExtensions: true }); const all = await client.listAllComplete(); certifyCompleteListResult(all);
      for (const id of ids) {
        const result = await client.get(id, { outputInclude: 'full', outputLimit: 'unbounded', outputBudget: 'unbounded' });
        if (!('item' in result) || !('item_hash' in result)) throw new Error('Incomplete selected source'); const item = result.item;
        const fields: [string, unknown][] = ['description','acceptance_criteria','repro_steps','expected_result','actual_result','resolution'].map(key => [`/${key}`,item[key]]);
        for (const [index, comment] of (item.comments ?? []).entries()) fields.push([`/comments/${index}/text`,comment.text]);
        let accepted = 0;
        for (const [field_pointer, text] of fields) {
          if (typeof text !== 'string' || text.length < 20 || text.length > 5000) continue;
          try { guardSubmitted(text); } catch { continue; }
          if (/pm-observer|pm-web-hosted|pm-gpt/i.test(text)) continue;
          const folder = item.type === 'Issue' ? 'issues' : item.type === 'Feature' ? 'features' : 'tasks';
          passages.push({ repo, revision, item_id: id, item_hash: String(result.item_hash), field_pointer, text, content_digest: createHash('sha256').update(text).digest('hex'), url: `https://github.com/unbraind/${repo}/blob/${revision}/.agents/pm/${folder}/${id}.toon` });
          if (++accepted === (repo === 'pm-csv' ? 5 : 7)) break;
        }
      }
    }
  } finally { await rm(scratch, { recursive: true, force: true }); }
  if (passages.length < 20) throw new Error('At least twenty reviewed source passages are required'); return passages;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) { const passages = await harvest(); await mkdir('test/fixtures', { recursive: true }); await writeFile('test/fixtures/public-passages.json', JSON.stringify(passages, null, 2) + '\n'); console.log(JSON.stringify({ passages: passages.length, sources: publicTrackers.map(row => ({ repo: row.repo, revision: row.revision })) })); }
