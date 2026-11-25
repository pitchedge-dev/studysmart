import type { PersonalizedQuestion } from "@/components/PersonalizedPractice";

/**
 * Shared storage for generated personalized-practice questions.
 *
 * Why this exists: the generated questions used to live only in the
 * PersonalizedPractice component's own state, so the home-page guide
 * view and the dedicated /guide/[id] page each had their own copy —
 * generating practice in one view showed nothing in the other. Both
 * views now read and write the SAME stored set, keyed by the guide
 * key (the same `guide:<id>` / `local:<hash>` key the error records
 * use), so a set generated anywhere appears everywhere for that
 * guide copy.
 *
 * Stored per browser (localStorage), like the signed-out error
 * records: signed-in users' weak spots sync to Supabase, but the
 * generated questions themselves are derived and cheap to
 * regenerate, so they live on the device. Answers are stored with
 * the questions so a question answered in one view shows as answered
 * in the other — answering the same question twice must not count
 * twice toward mastering the concept.
 */

const STORAGE_PREFIX = "studysmart-personalized-practice:v1:";

export type StoredPractice = {
  questions: PersonalizedQuestion[];
  /** question index -> picked option text. */
  answers: Record<number, string>;
  savedAt: number;
};

function isValidQuestion(q: unknown): q is PersonalizedQuestion {
  if (typeof q !== "object" || q === null) return false;
  const r = q as Record<string, unknown>;
  return (
    typeof r.conceptTitle === "string" &&
    typeof r.question === "string" &&
    Array.isArray(r.options) &&
    r.options.length >= 3 &&
    typeof r.correctAnswer === "string" &&
    typeof r.explanation === "string"
  );
}

export function loadPractice(
  guideKey: string | null | undefined
): StoredPractice | null {
  if (!guideKey || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + guideKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPractice>;
    if (!Array.isArray(parsed.questions)) return null;
    const questions = parsed.questions.filter(isValidQuestion);
    if (questions.length === 0) return null;
    const answers: Record<number, string> = {};
    if (parsed.answers && typeof parsed.answers === "object") {
      for (const [k, v] of Object.entries(parsed.answers)) {
        const idx = Number(k);
        if (Number.isInteger(idx) && typeof v === "string") answers[idx] = v;
      }
    }
    return { questions, answers, savedAt: parsed.savedAt ?? 0 };
  } catch {
    return null;
  }
}

export function savePractice(
  guideKey: string | null | undefined,
  questions: PersonalizedQuestion[],
  answers: Record<number, string>
): void {
  if (!guideKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + guideKey,
      JSON.stringify({ questions, answers, savedAt: Date.now() })
    );
  } catch {
    // Storage full / unavailable — the in-memory questions still work
    // for this view; they just won't carry to the other view.
  }
}

export function clearPractice(guideKey: string | null | undefined): void {
  if (!guideKey || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + guideKey);
  } catch {
    // Ignore — nothing to clear.
  }
}
