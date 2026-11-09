/** Frozen public scenarios; CSV also runs the historical regression variant. */
export const publicChecks = [
  { repo: 'pm-csv', file: 'test/atomic.test.ts', pattern: '^a nonzero close receipt cleans markers only after a status recheck proves closure$', assignment: { runtime: 'node', close_receipt: 'conflict', persisted_status: 'closed', cleanup: 'ok' } },
  { repo: 'pm-beads', file: 'test/repair.test.ts', pattern: '^proposals bind exact source revisions, revalidate current text and reject forged or sparse edits$', assignment: { runtime: 'node', line_ending: 'lf', source: 'changed', topology: 'cycle', action: 'preview' } },
  { repo: 'pm-ops', file: 'test/backend-capabilities.test.ts', pattern: '^read-only source directories are unchanged and disposable copies are cleaned$', assignment: { runtime: 'node', permissions: 'readonly', format: 'current', history: 'healthy' } },
] as const;

/** Repositories with a deliberate historical failure variant. */
export const historicalChecks = publicChecks.filter(row => row.repo === 'pm-csv');

/** Use the same selected-test invocation for execution and portable receipt coordinates. */
export function publicHarnessArguments(check: typeof publicChecks[number], reporter = 'test/harness-reporter.ts'): string[] {
  return ['--test', '--test-concurrency=1', '--test-reporter', reporter, '--test-name-pattern', check.pattern, check.file];
}

/** Render the frozen portable command without machine-specific executable or reporter paths. */
export function publicHarnessCommand(check: typeof publicChecks[number]): string {
  return 'node ' + publicHarnessArguments(check).map(value => JSON.stringify(value)).join(' ');
}
