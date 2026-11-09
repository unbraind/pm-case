/** Retry only explicit revision or lock contention; callers reread current state on each attempt. */
export async function retryWriter<T>(attempt: () => Promise<T>, conflict: () => void, maxAttempts = 200): Promise<T> {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts must be a positive safe integer');
  for (let tries = 1; ; tries++) {
    try { return await attempt(); }
    catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if ((code !== 'revision_conflict' && code !== 'lock_conflict') || tries >= maxAttempts) throw error;
      conflict();
    }
  }
}
