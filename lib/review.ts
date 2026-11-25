/**
 * Spaced-repetition Review queue (Quizlet pattern), scheduled with the
 * SM-2 algorithm (Wozniak, SuperMemo 2, 1987) — the scheduler Anki grew
 * out of, and the one most flashcard apps still use.
 *
 * Why SM-2 instead of a fixed ladder: the old schedule pushed every
 * correct concept out along the same fixed rungs (1 → 3 → 7 → 16 days),
 * whether the student found it trivial or barely remembered it. SM-2
 * keeps one number per concept — the easiness factor (EF), starting at
 * 2.5 — and grows the gap by that factor after each pass. A concept the
 * student rates Easy stretches further each time; one rated Hard grows
 * slowly and comes back sooner. A miss is a lapse: the ladder restarts
 * at 1 day. The evidence for expanding gaps over cramming is a 2006
 * meta-analysis by Cepeda, Pashler, Vul, Wixted & Rohrer (839
 * experiments, "distributed practice beating massed practice in
 * essentially every material and population studied").
 *
 * Built ONLY from the user's own error records across all their guide
 * copies (guide_errors when signed in, localStorage when signed out).
 * A concept with no next_review_at yet is due now.
 */

import type { GuideErrorRecord } from "./errorTracking";
import { listAllGuideErrors } from "./supabase";

/** SM-2 easiness factor: starts at 2.5, never drops below 1.3. */
export const SM2_DEFAULT_EASE = 2.5;
export const SM2_MIN_EASE = 1.3;

/** Self-grade after a correct answer (Anki-style buttons). */
export type Sm2Grade = "again" | "hard" | "good" | "easy";

/** SM-2 recall quality q (0–5) behind each grade. */
export const SM2_QUALITY: Record<Sm2Grade, number> = {
  again: 2, // wrong answer — a lapse
  hard: 3, // correct, with serious difficulty
  good: 4, // correct after a short hesitation
  easy: 5, // perfect, instant recall
};

export type Sm2State = {
  /** Repetition count: consecutive passes (0 after a lapse). */
  reps: number;
  /** Easiness factor — the multiplier between gaps. */
  easeFactor: number;
  /** Current interval in days. */
  intervalDays: number;
};

export function sm2StateOf(record: {
  reviewReps?: number;
  easeFactor?: number;
  reviewIntervalDays?: number;
}): Sm2State {
  return {
    reps: record.reviewReps ?? 0,
    easeFactor:
      typeof record.easeFactor === "number" && record.easeFactor >= SM2_MIN_EASE
        ? record.easeFactor
        : SM2_DEFAULT_EASE,
    intervalDays: record.reviewIntervalDays ?? 1,
  };
}

/** SM-2 ease update: EF' = EF + (0.1 − (5−q) × (0.08 + (5−q) × 0.02)), floored at 1.3. */
export function sm2NextEase(easeFactor: number, quality: number): number {
  const next =
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  return Math.max(SM2_MIN_EASE, Math.round(next * 100) / 100);
}

/**
 * One SM-2 step. Pass = quality ≥ 3: reps + 1, interval 1 day, then 6,
 * then previous × EF. Fail (quality < 3) = lapse: reps reset to 0,
 * interval back to 1 day. Returns the new state plus the next-review
 * date and a short human-readable reason for the UI.
 */
export function sm2Schedule(
  prev: Sm2State,
  quality: number
): { state: Sm2State; nextReviewAt: string; nextIntervalDays: number } {
  const easeFactor = sm2NextEase(prev.easeFactor, quality);
  let reps = prev.reps;
  let intervalDays: number;
  if (quality < 3) {
    reps = 0;
    intervalDays = 1;
  } else {
    reps = prev.reps + 1;
    if (reps === 1) intervalDays = 1;
    else if (reps === 2) intervalDays = 6;
    else intervalDays = Math.max(1, Math.round(prev.intervalDays * easeFactor));
  }
  return {
    state: { reps, easeFactor, intervalDays },
    nextReviewAt: addDays(todayDateKey(), intervalDays),
    nextIntervalDays: intervalDays,
  };
}

/** Grade from a plain correct/incorrect answer (no self-grade given). */
export function gradeForAnswer(correct: boolean): Sm2Grade {
  return correct ? "good" : "again";
}

export function todayDateKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T12:00:00`);
  d.setDate(d.getDate() + days);
  return todayDateKey(d);
}

/**
 * Next-review date + interval to store after one answer.
 * Kept for callers that only know correct/incorrect: correct = Good
 * (q=4, ease unchanged), wrong = Again (q=2, lapse, due tomorrow).
 */
export function scheduleAfterAnswer(
  correct: boolean,
  currentIntervalDays: number | undefined,
  opts?: { easeFactor?: number; reps?: number }
): { nextReviewAt: string; reviewIntervalDays: number } {
  const prev: Sm2State = {
    reps: opts?.reps ?? 0,
    easeFactor: opts?.easeFactor ?? SM2_DEFAULT_EASE,
    intervalDays: currentIntervalDays ?? 1,
  };
  const { nextReviewAt, nextIntervalDays } = sm2Schedule(
    prev,
    SM2_QUALITY[gradeForAnswer(correct)]
  );
  return { nextReviewAt, reviewIntervalDays: nextIntervalDays };
}

export type DueConcept = {
  guideKey: string;
  record: GuideErrorRecord;
  dueDate: string | null; // YYYY-MM-DD, null = due now (no date stored)
  overdueDays: number;
};

function isDue(r: GuideErrorRecord): boolean {
  if (!r.nextReviewAt) return true; // No date stored yet — due now.
  return r.nextReviewAt <= todayDateKey();
}

function overdueDays(r: GuideErrorRecord): number {
  if (!r.nextReviewAt) return 0;
  const due = new Date(`${r.nextReviewAt}T12:00:00`).getTime();
  const today = new Date(`${todayDateKey()}T12:00:00`).getTime();
  return Math.max(0, Math.round((today - due) / 86400000));
}

/** All weak concepts due today, across every guide copy. */
export function dueConcepts(
  entries: Array<{ guideKey: string; record: GuideErrorRecord }>
): DueConcept[] {
  return entries
    .filter(
      ({ record }) =>
        record.misses > 0 && record.correctStreak < 2 && isDue(record)
    )
    .map(({ guideKey, record }) => ({
      guideKey,
      record,
      dueDate: record.nextReviewAt ?? null,
      overdueDays: overdueDays(record),
    }))
    .sort((a, b) => b.overdueDays - a.overdueDays || b.record.misses - a.record.misses);
}

/** Count of weak concepts due today (for the nav badge). */
export function dueCount(
  entries: Array<{ guideKey: string; record: GuideErrorRecord }>
): number {
  return dueConcepts(entries).length;
}

/** Review forecast: how many weak concepts come due on each of the
 *  next `days` days, from their stored next-review dates. Concepts with
 *  no date are due today. Only the user's own records, nothing invented. */
export function reviewForecast(
  entries: Array<{ guideKey: string; record: GuideErrorRecord }>,
  days = 7
): Array<{ date: string; due: number }> {
  const out: Array<{ date: string; due: number }> = [];
  const today = todayDateKey();
  for (let i = 0; i < days; i++) out.push({ date: addDays(today, i), due: 0 });
  for (const { record } of entries) {
    if (!(record.misses > 0 && record.correctStreak < 2)) continue;
    const key = record.nextReviewAt ?? today;
    const slot = out.find((s) => s.date === key);
    if (slot) slot.due += 1;
  }
  return out;
}

const LOCAL_ERROR_PREFIX = "studysmart-errors:";

/** Load every error record for this user, across all guide copies.
 *  Signed in: the guide_errors table. Signed out: every
 *  `studysmart-errors:*` localStorage entry. */
export async function loadAllErrors(
  userId: string | null
): Promise<Array<{ guideKey: string; record: GuideErrorRecord }>> {
  if (userId) {
    const rows = await listAllGuideErrors(userId);
    return rows.map((row) => ({
      guideKey: row.guide_key,
      record: {
        conceptTitle: row.concept_title,
        moduleTitle: row.module_title,
        misses: row.misses,
        correctStreak: row.correct_streak,
        totalAttempts: row.total_attempts,
        lastQuestion: row.last_question ?? undefined,
        lastPicked: row.last_picked ?? undefined,
        lastCorrect: row.last_correct ?? undefined,
        lastExplanation: row.last_explanation ?? undefined,
        nextReviewAt: row.next_review_at ?? undefined,
        reviewIntervalDays: row.review_interval_days ?? undefined,
        easeFactor: row.ease_factor ?? undefined,
        reviewReps: row.review_reps ?? undefined,
      },
    }));
  }
  const out: Array<{ guideKey: string; record: GuideErrorRecord }> = [];
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key || !key.startsWith(LOCAL_ERROR_PREFIX)) continue;
      const guideKey = key.slice(LOCAL_ERROR_PREFIX.length);
      try {
        const parsed = JSON.parse(
          window.localStorage.getItem(key) ?? "[]"
        ) as GuideErrorRecord[];
        if (!Array.isArray(parsed)) continue;
        for (const record of parsed) {
          out.push({ guideKey, record });
        }
      } catch {
        // One corrupt entry must not break the whole queue.
      }
    }
  } catch {
    // Storage unavailable.
  }
  return out;
}
