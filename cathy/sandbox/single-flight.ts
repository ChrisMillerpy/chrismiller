/** Wraps an async job so concurrent callers share one run instead of starting their own. */
export function singleFlight<T>(job: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => (inFlight ??= job().finally(() => (inFlight = null)));
}
