/**
 * Race a promise against a deadline: resolve with the promise's value
 * if it settles first, otherwise resolve with `fallback` when the
 * deadline passes. The underlying promise keeps running detached —
 * its late value is simply dropped, never awaited.
 *
 * Used by /api/videos: the video lookup can legitimately take 20–30s
 * (each suggestion path walks several providers with 10s aborts), and
 * the Videos section used to sit on "Finding videos that explain
 * this…" for the whole of it. The route now answers within the
 * deadline with whatever verified (or nothing — the search links
 * still help), instead of hanging until Vercel kills it at 30s.
 * Pure (no I/O) so the race semantics are logic-testable.
 */
export function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}
