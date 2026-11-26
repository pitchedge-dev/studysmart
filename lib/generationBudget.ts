/**
 * Wall-clock budgets for server-side generation.
 *
 * Vercel Hobby kills a function at 60 seconds — that limit is not
 * raisable on this plan, so every generation route must finish well
 * inside it. The old /api/generate ran the core pass and the
 * enrichment pass concurrently behind one loading state and only
 * checked its 45s wall clock *between* attempts: an enrichment
 * attempt started at ~44s ran its full 15s cap to ~59s while the core
 * pass could run 35s + 20s, so the request was still working when
 * Vercel killed it at 60s (HTTP 504 on a full generation, while a
 * lighter one finished in ~14s).
 *
 * Two rules now hold in every generation route:
 *  1. Each route does ONE job and returns inside its own budget
 *     (/api/generate = core guide only; /api/enrich = finishing
 *     sections, called by the client after the core lands).
 *  2. Every model attempt's abort timeout is cut down to the wall
 *     clock REMAINING when the attempt starts — an attempt started
 *     with 6s left gets a 6s abort, never its full cap — so a route
 *     can never overrun its budget the way the old code did.
 */

/** /api/generate (core guide only) must answer inside this. */
export const GENERATE_WALL_CLOCK_MS = 40000;
/** One full-shape core attempt may take at most this long. */
export const GENERATE_FULL_ATTEMPT_MS = 25000;
/** One simplified-shape fallback attempt may take at most this long. */
export const GENERATE_SIMPLE_ATTEMPT_MS = 15000;
/** The repair pass only starts when the core landed before this. */
export const GENERATE_REPAIR_AFTER_MS = 20000;
/** One repair attempt may take at most this long. */
export const GENERATE_REPAIR_ATTEMPT_MS = 15000;

/** /api/enrich (finishing sections) must answer inside this. */
export const ENRICH_WALL_CLOCK_MS = 45000;
/** One enrichment attempt may take at most this long. */
export const ENRICH_ATTEMPT_MS = 15000;

/** Milliseconds left before `wallClockMs` elapses from `startedAt`.
 *  Never negative. */
export function remainingMs(
  startedAt: number,
  wallClockMs: number,
  now: number = Date.now()
): number {
  return Math.max(0, wallClockMs - (now - startedAt));
}

/**
 * The abort timeout for one model attempt: the attempt's own cap, cut
 * down to whatever wall clock is left. Returns 0 when the budget is
 * already spent — the caller must not start the attempt then.
 */
export function attemptTimeoutMs(
  startedAt: number,
  wallClockMs: number,
  capMs: number,
  now: number = Date.now()
): number {
  return Math.min(capMs, remainingMs(startedAt, wallClockMs, now));
}
