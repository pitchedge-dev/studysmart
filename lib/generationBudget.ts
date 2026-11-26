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
 *
 * The 2026-11-26 02:37 lesson (see the route comments): a 40s wall
 * with a 25s per-attempt cap let TWO slow Gemini tries eat 36s, and
 * the loop then broke with 4s left because the break threshold was
 * 5s — Moonshot, AIML, SambaNova, Cohere, DeepSeek and Pollinations
 * were never tried. So the caps are now two-tier: the FIRST model in
 * the chain (Gemini 3.8-flash, the proven one) keeps a long cap, and
 * every later model gets a long-enough cap of its own.
 *
 * The 2026-11-26 12:33 lesson (Vercel logs, one POST /api/generate,
 * 50.44s, 503): the 12s cap the 02:37 fix chose for later models
 * could not succeed even on a healthy provider — a 2-module guide
 * takes 14.2s and full guides ~25–40s, so every later attempt timed
 * out before the model could answer, and the wall was spent on
 * attempts that were doomed from the start. The honest trade-off is
 * FEWER, LONGER attempts: the first attempt keeps its 25s cap, and
 * every later attempt now gets 20s — enough for a full-shape guide
 * from a healthy provider. 25s + 20s = 45s leaves 5s for a last try
 * inside the 50s wall. And when a full-shape attempt times out, the
 * route now tries the SIMPLIFIED shape on the SAME model with the
 * remaining time before moving on (see app/api/generate/route.ts):
 * a slow-but-healthy provider may still land a thin guide, and the
 * depth floor + repair path already exist for thin guides. A thin
 * guide that lands beats a 503.
 */

/** /api/generate (core guide only) must answer inside this. */
export const GENERATE_WALL_CLOCK_MS = 50000;
/** The first model in the chain gets this long for one full-shape
 *  attempt — it is the proven model, and a healthy full guide needs
 *  up to ~25s (see the header comment). */
export const GENERATE_FIRST_ATTEMPT_MS = 25000;
/** One full-shape core attempt on any LATER model may take at most
 *  this long — 20s, because a healthy provider needs ~15–25s to
 *  finish a full-shape guide (see the header comment). The previous
 *  12s cap could not succeed even on a healthy provider: every later
 *  attempt timed out before the model could answer. Fewer, longer
 *  attempts beat many short ones that cannot land. */
export const GENERATE_FULL_ATTEMPT_MS = 20000;
/** One simplified-shape fallback attempt may take at most this long. */
export const GENERATE_SIMPLE_ATTEMPT_MS = 15000;
/** The repair pass only starts when the core landed before this. */
export const GENERATE_REPAIR_AFTER_MS = 30000;
/** One repair attempt may take at most this long. */
export const GENERATE_REPAIR_ATTEMPT_MS = 15000;
/** Do not start an attempt with less than this much wall clock left
 *  — below this, even the fastest provider cannot answer. Shared by
 *  /api/generate and /api/enrich. */
export const MIN_REMAINING_MS = 2000;

/** /api/enrich (finishing sections) must answer inside this. */
export const ENRICH_WALL_CLOCK_MS = 45000;
/** One enrichment attempt may take at most this long — the output is
 *  smaller than a core guide, so 12s is proportionate. */
export const ENRICH_ATTEMPT_MS = 12000;

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
