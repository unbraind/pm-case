/** Retry only explicit revision or lock contention; callers reread current state on each attempt. */
export async function retryWriter<T>(attempt: () => Promise<T>, conflict: () => void): Promise<T> {
  for (;;) {
    try { return await attempt(); }
    catch (error) {
      const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : undefined;
      if (code !== 'revision_conflict' && code !== 'lock_conflict') throw error;
      conflict();
    }
  }
}
