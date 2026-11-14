/**
 * `Promise.all(items.map(fn))` with at most `limit` running at once. Results keep the input order. After the first
 * rejection or an abort no new item starts; it rejects with that error (the signal's reason on abort) once the
 * running items have settled.
 */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let error: unknown;
  const worker = async () => {
    while (!failed && !signal?.aborted && next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i]!, i);
      } catch (e) {
        if (!failed) {
          failed = true;
          error = e;
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw error;
  signal?.throwIfAborted();
  return results;
}
