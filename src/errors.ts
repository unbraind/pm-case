import { isPmCliExpectedError } from '@unbrained/pm-cli/sdk';
/** Typed domain refusal with a public remedy and no submitted text in diagnostics. */
export class CaseRefusal extends Error {
  /** Machine-readable refusal category. */
  readonly code: string;
  /** Safe recovery instruction for callers. */
  readonly remedy: string;
  /** Whether rereading and retrying the original request can succeed. */
  readonly retryable: boolean;
  /** Bounded diagnostic metadata for callers. */
  readonly details: Record<string, unknown>;
  /** Preserve the native host exit contract. */
  readonly nativeExit?: number;
  /** Construct a refusal without reflecting input. */
  constructor(code: string, message: string, remedy = 'Review the input using the documented schema', details: Record<string, unknown> = {}, nativeExit?: number) {
    super(message); this.name = 'CaseRefusal'; this.code = code; this.remedy = remedy; this.details = details; this.nativeExit = nativeExit;
    this.retryable = ['revision_conflict', 'lock_conflict', 'contention', 'stale_cursor'].includes(code);
  }
}
/** Enforce a domain invariant before writing. */
export function insist(ok: unknown, code: string, message: string, remedy?: string, details?: Record<string, unknown>): asserts ok {
  if (!ok) throw new CaseRefusal(code, message, remedy, details);
}
/** Preserve host contract errors; never echo arbitrary system errors or submitted text. */
export function refusal(error: unknown): CaseRefusal {
  if (error instanceof CaseRefusal) return error;
  if (isPmCliExpectedError(error) && typeof error.code === 'string') {
    const remedy = 'Reread the authorized owner and reconcile the original operation key';
    return new CaseRefusal(error.code === 'item_revision_conflict' ? 'revision_conflict' : error.code, 'Native host refused the operation', remedy, {}, error.exitCode);
  }
  return new CaseRefusal('outcome_unknown', 'The host outcome could not be verified', 'Read back the original operation key before retrying; retain the same key');
}
/** Public process exit categories. */
export function exitCode(code: string, nativeExit?: number): number {
  if (nativeExit !== undefined) return [2, 3, 4, 5].includes(nativeExit) ? nativeExit : 5;
  if (code === 'not_found') return 3;
  if (['revision_conflict', 'operation_conflict', 'stale_cursor'].includes(code)) return 4;
  if (['backend_unsupported', 'permission_denied', 'incomplete_read', 'outcome_unknown'].includes(code)) return 5;
  return 2;
}
