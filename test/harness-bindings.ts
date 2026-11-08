import assert from 'node:assert/strict';
import { canonical, digest } from '../dist/index.js';
import type { Assignment, Outcome } from '../dist/index.js';
import { matrices } from './matrices.ts';
import { publicTrackers } from './corpus.ts';
import { publicChecks, historicalChecks, publicHarnessCommand } from './harness-plan.ts';

/** Frozen, reported public execution coordinates, independent of external checkout availability. */
export interface HarnessResult {
  /** Public repository. */
  repo: string;
  /** Frozen public revision. */
  revision: string;
  /** Reviewed test file. */
  test_file: string;
  /** Reviewed test-name pattern. */
  test_name: string;
  /** Portable invocation of the reviewed test. */
  command: string;
  /** Visibility of the acquisition source. */
  source_visibility: string;
  /** Explicit reviewed scenario. */
  assignment: Assignment;
  /** Selected test content identity. */
  oracle_digest: string;
  /** Reported outcome. */
  result: string;
  /** Observed process exit. */
  exit_code: number;
  /** Historical variant identity when applicable. */
  source_digest?: string;
}
/** Validate every public and historical execution coordinate before consuming reported evidence. */
export function harnessPlanBindings(results: HarnessResult[]): void {
  assert.equal(results.length, publicChecks.length + historicalChecks.length);
  for (const source of publicTrackers) {
    const runs = results.filter(row => row.repo === source.repo);
    assert.equal(runs.length, [...publicChecks, ...historicalChecks].filter(row => row.repo === source.repo).length);
    assert.equal(runs.filter(row => row.result === 'pass').length, publicChecks.filter(row => row.repo === source.repo).length);
    assert.equal(runs.filter(row => row.result === 'fail').length, historicalChecks.filter(row => row.repo === source.repo).length);
    const planned = publicChecks.find(row => row.repo === source.repo)!; assert.ok(planned);
    for (const run of runs) {
      assert.equal(run.revision, source.revision, 'Harness revision must bind the public corpus');
      assert.equal(run.test_file, planned.file, 'Harness test file must bind the reviewed plan');
      assert.equal(run.test_name, planned.pattern, 'Harness test name must bind the reviewed plan');
      assert.equal(run.command, publicHarnessCommand(planned), 'Harness command must bind the reviewed plan');
      assert.deepEqual(run.assignment, planned.assignment, 'Harness assignment must bind the reviewed plan');
      assert.equal(run.source_visibility, 'public', 'Harness source must remain public');
      assert.equal(run.exit_code, run.result === 'pass' ? 0 : 1);
    }
  }
}

/** Reject drift between reported public harness coordinates, corpus models, and recorded observations. */
export function harnessBindings(results: HarnessResult[], records: { model: typeof matrices[number]; selected_cases: { case_id: string; assignment: Assignment }[]; outcomes: Outcome[] }[], regression: { subject_digest: string }): void {
  harnessPlanBindings(results);
  assert.equal(records.length, matrices.length);
  assert.deepEqual(records.map(row => row.model.model_key).sort(), matrices.map(row => row.model_key).sort());
  for (const source of publicTrackers) {
    const runs = results.filter(row => row.repo === source.repo);
    for (const run of runs) {
      const record = records.find(row => row.model.model_key === source.repo)!; assert.ok(record);
      const expectedModel = matrices.find(row => row.model_key === source.repo)!;
      assert.deepEqual(record.model, expectedModel, 'Receipt model must match the independently frozen corpus');
      assert.ok(expectedModel.mandatory_cases.some(row => canonical(row) === canonical(run.assignment)), 'Harness assignment must bind the reviewed mandatory case');
      const selected = record.selected_cases.find(row => canonical(row.assignment) === canonical(run.assignment)); assert.ok(selected);
      if (run.result === 'pass') {
        assert.equal(run.exit_code, 0);
        const outcome = record.outcomes.find(row => row.execution_id === 'public-harness')!; assert.ok(outcome);
        assert.equal(outcome.case_id, selected.case_id); assert.equal(outcome.oracle_digest, run.oracle_digest);
        assert.equal(outcome.result, run.result); assert.equal(outcome.subject_digest, digest({ repo: source.repo, revision: source.revision }));
      } else {
        assert.equal(source.repo, 'pm-csv'); assert.equal(run.result, 'fail'); assert.equal(run.exit_code, 1);
        assert.equal(run.source_digest, regression.subject_digest);
        assert.equal(run.oracle_digest, runs.find(row => row.result === 'pass')?.oracle_digest);
      }
    }
  }
}
