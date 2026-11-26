/**
 * Client-side helper for the /api/enrich finishing pass (objectives,
 * cheat sheet, real-world applications, FAQ, final review).
 *
 * Why this exists as a shared helper: the finishing sections used to
 * be fetched once, fire-and-forget, from app/page.tsx only. A live
 * re-test (2026-11-26) showed the failure mode that creates: the
 * one-shot background call failed — the lite chain was flapping that
 * morning — and the five sections were silently, permanently absent
 * from the guide, with nothing in the UI saying so and no way to get
 * them back. The standalone /guide/[id] view had no enrich path at
 * all, so a guide opened there could never gain the sections either.
 *
 * This helper makes the fetch retrying (a transient provider outage
 * self-heals within a minute instead of losing the sections for
 * good), observable (callers get a status they can show), and shared
 * by both guide views. It never throws: a failed enrichment returns
 * null and logs a warning, so a caller can show a Retry button
 * instead of failing the page.
 */

export type EnrichmentFields = {
  objectives: string[];
  cheatSheet?: string;
  realWorldApplications: string[];
  faq: { question: string; answer: string }[];
  finalReview?: {
    questions: {
      question: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
      whyWrong?: { option: string; reason: string }[];
    }[];
  };
};

/** True when a guide already has ALL five finishing sections.
 *  A guide with only some of them (e.g. objectives but no FAQ) is
 *  still unfinished — it must be enriched, not treated as done.
 *  (An earlier version used "any field present", which let a
 *  partially-enriched guide count as complete and never fetch the
 *  rest — caught by the logic test, 2026-11-26.) */
export function hasEnrichment(
  guide:
    | Partial<{
        objectives?: string[];
        cheatSheet?: string;
        realWorldApplications?: string[];
        faq?: unknown[];
        finalReview?: { questions?: unknown[] };
      }>
    | null
    | undefined
): boolean {
  if (!guide) return false;
  return (
    (guide.objectives?.length ?? 0) > 0 &&
    (guide.cheatSheet?.trim().length ?? 0) > 0 &&
    (guide.realWorldApplications?.length ?? 0) > 0 &&
    (guide.faq?.length ?? 0) > 0 &&
    (guide.finalReview?.questions?.length ?? 0) > 0
  );
}

const RETRY_DELAYS_MS = [5000, 15000];

function sleep(ms: number): Promise<void> {
  // globalThis, not window: the helper must also work outside a
  // browser context (tests, and any future non-DOM caller).
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

async function fetchEnrichmentOnce(
  text: string,
  images: string[]
): Promise<EnrichmentFields | null> {
  try {
    const res = await fetch("/api/enrich", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, images }),
    });
    if (!res.ok) {
      console.warn(
        "[enrich] background enrichment failed:",
        res.status,
        res.statusText
      );
      return null;
    }
    const data = (await res.json()) as Partial<EnrichmentFields>;
    const fields: EnrichmentFields = {
      objectives: data.objectives ?? [],
      cheatSheet: data.cheatSheet,
      realWorldApplications: data.realWorldApplications ?? [],
      faq: data.faq ?? [],
      finalReview: data.finalReview,
    };
    // A partial 200 (missing or empty sections) is a failure, not a
    // result: merging it would write empty arrays over the guide and
    // leave it unfinished while reporting success. The route
    // validates the full shape, so a partial response is malformed —
    // retry it like any other failure.
    if (!hasEnrichment(fields)) {
      console.warn("[enrich] background enrichment returned incomplete sections");
      return null;
    }
    return fields;
  } catch (err) {
    // Network error / aborted fetch — the core guide already stands.
    console.warn("[enrich] background enrichment failed:", err);
    return null;
  }
}

/**
 * Fetch the finishing sections, retrying transient failures. Tries up
 * to 3 times (5s, then 15s between attempts) and returns null when
 * every attempt failed. `isStale` is checked before each attempt and
 * after each wait — when it returns true (e.g. the student already
 * generated a newer guide) the retry loop stops and returns null, so
 * a late result can never land on the wrong guide.
 */
export async function requestEnrichment(args: {
  text: string;
  images?: string[];
  isStale?: () => boolean;
}): Promise<EnrichmentFields | null> {
  const images = args.images ?? [];
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (args.isStale?.()) return null;
    if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);
    if (args.isStale?.()) return null;
    const fields = await fetchEnrichmentOnce(args.text, images);
    if (fields) return fields;
  }
  return null;
}
