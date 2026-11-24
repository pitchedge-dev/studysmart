/**
 * Spaced-repetition Review queue (Quizlet pattern).
 *
 * Built ONLY from the user's own error records across all their guide
 * copies (guide_errors when signed in, localStorage when signed out).
 * Each weak concept gets a next-review date: wrong = due tomorrow, then
 * intervals grow 1 → 3 → 7 → 16 days after correct answers. A concept
 * with no next_review_at yet (records written before the column existed)
 * is due now.
 */

import type { GuideErrorRecord } from "./errorTracking";
import { listAllGuideErrors } from "./supabase";

export const REVIEW_INTERVALS = [1, 3, 7, 16];

export type DueConcept = {
  guideKey: string;
  record: GuideErrorRecord;
  dueDate: string | null; // YYYY-MM-DD, null = due now (no date stored)
  overdueDays: number;
};

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

/** Next interval after a correct answer (1 → 3 → 7 → 16, stays at 16). */
export function nextIntervalAfterCorrect(
  currentDays: number | undefined
): number {
  if (!currentDays) return 3;
  const idx = REVIEW_INTERVALS.indexOf(currentDays);
  if (idx === -1) return 3;
  return REVIEW_INTERVALS[Math.min(idx + 1, REVIEW_INTERVALS.length - 1)];
}

/** Next-review date + interval to store after one answer. */
export function scheduleAfterAnswer(
  correct: boolean,
  currentIntervalDays: number | undefined
): { nextReviewAt: string; reviewIntervalDays: number } {
  if (!correct) {
    return { nextReviewAt: addDays(todayDateKey(), 1), reviewIntervalDays: 1 };
  }
  const interval = nextIntervalAfterCorrect(currentIntervalDays);
  return {
    nextReviewAt: addDays(todayDateKey(), interval),
    reviewIntervalDays: interval,
  };
}

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
