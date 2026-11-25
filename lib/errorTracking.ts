import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SM2_QUALITY,
  gradeForAnswer,
  sm2Schedule,
  sm2StateOf,
} from "./review";
import {
  deleteGuideErrors,
  listGuideErrors,
  upsertGuideErrors,
  type GuideErrorRow,
} from "./supabase";

/**
 * Per-user error tracking for one copy of a study guide.
 *
 * A "weak concept" is a concept the user has missed at least once and has
 * not yet answered correctly twice in a row. A concept leaves the weak list
 * once correctStreak reaches 2 — correct answers anywhere (quiz, targeted
 * practice, checkpoint, personalized practice) count toward the streak.
 *
 * Privacy: errors are keyed by (user, guideKey). Signed in, they live in
 * the guide_errors table, readable only by that user (RLS). Signed out,
 * they live only in this browser's localStorage, under the guide key.
 * They are never stored inside the guide JSON, so publishing or sharing a
 * guide never leaks them, and opening someone else's published/shared guide
 * starts with a clean slate for you.
 */

export type GuideErrorRecord = {
  conceptTitle: string;
  moduleTitle: string;
  misses: number;
  correctStreak: number;
  totalAttempts: number;
  lastQuestion?: string;
  lastPicked?: string;
  lastCorrect?: string;
  lastExplanation?: string;
  /** Spaced-repetition schedule (migration 0004). Undefined until the
   *  concept has been answered at least once after the schedule exists;
   *  a missing date means "due now". */
  nextReviewAt?: string;
  reviewIntervalDays?: number;
  /** SM-2 scheduler state (migration 0008): easiness factor (starts
   *  2.5, floor 1.3) and consecutive-pass count. Missing on old records
   *  — they start at the SM-2 defaults, so nothing is lost. */
  easeFactor?: number;
  reviewReps?: number;
};

/** A concept counts as weak once missed and not yet mastered. */
export const MASTERY_STREAK = 2;

export type ErrorAnswerInput = {
  source: "quiz" | "practice" | "checkpoint" | "personalized" | "reasoning" | "teachback";
  moduleTitle: string;
  conceptTitle: string;
  question: string;
  picked: string;
  correctAnswer: string;
  explanation: string;
  correct: boolean;
};

/** Stable key for an unsaved, in-session guide copy, from its content. */
export function localGuideKey(title: string, studyGuide: string): string {
  const input = `${title}\n${studyGuide.slice(0, 2000)}`;
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return `local:${hash.toString(36)}`;
}

export function weakConcepts(records: GuideErrorRecord[]): GuideErrorRecord[] {
  return records
    .filter((r) => r.misses > 0 && r.correctStreak < MASTERY_STREAK)
    .sort((a, b) => b.misses - a.misses || b.totalAttempts - a.totalAttempts);
}

export function masteredConcepts(
  records: GuideErrorRecord[]
): GuideErrorRecord[] {
  return records.filter(
    (r) => r.misses > 0 && r.correctStreak >= MASTERY_STREAK
  );
}

/** Fold one answered question into the per-concept records. Also
 *  advances the SM-2 spaced-repetition schedule (lib/review.ts): the
 *  grade is the student's own self-grade after a correct answer
 *  (Hard / Good / Easy); without one, correct = Good and wrong = Again
 *  (a lapse — due tomorrow, ladder restarts). The 2-in-a-row mastery
 *  rule (MASTERY_STREAK) is unchanged. */
export function applyAnswer(
  records: GuideErrorRecord[],
  answer: ErrorAnswerInput,
  grade?: "again" | "hard" | "good" | "easy"
): GuideErrorRecord[] {
  const conceptTitle = answer.conceptTitle.trim() || "Practice Quiz";
  const existing = records.find((r) => r.conceptTitle === conceptTitle);
  const next: GuideErrorRecord = existing
    ? { ...existing }
    : {
        conceptTitle,
        moduleTitle: answer.moduleTitle,
        misses: 0,
        correctStreak: 0,
        totalAttempts: 0,
      };
  next.totalAttempts += 1;
  if (answer.correct) {
    next.correctStreak += 1;
  } else {
    next.misses += 1;
    next.correctStreak = 0;
    next.lastQuestion = answer.question;
    next.lastPicked = answer.picked;
    next.lastCorrect = answer.correctAnswer;
    next.lastExplanation = answer.explanation;
  }
  // SM-2 step: the student's grade (or the correct/incorrect default)
  // sets the next gap — easy concepts stretch further, hard ones come
  // back sooner, a miss restarts the ladder at 1 day.
  const quality = SM2_QUALITY[grade ?? gradeForAnswer(answer.correct)];
  const scheduled = sm2Schedule(sm2StateOf(next), quality);
  next.reviewReps = scheduled.state.reps;
  next.easeFactor = scheduled.state.easeFactor;
  next.reviewIntervalDays = scheduled.nextIntervalDays;
  next.nextReviewAt = scheduled.nextReviewAt;
  if (!next.moduleTitle) next.moduleTitle = answer.moduleTitle;
  const rest = records.filter((r) => r.conceptTitle !== conceptTitle);
  return [...rest, next];
}

function localStorageKey(guideKey: string): string {
  return `studysmart-errors:${guideKey}`;
}

function loadLocal(guideKey: string): GuideErrorRecord[] {
  try {
    const raw = window.localStorage.getItem(localStorageKey(guideKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as GuideErrorRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocal(guideKey: string, records: GuideErrorRecord[]): void {
  try {
    window.localStorage.setItem(
      localStorageKey(guideKey),
      JSON.stringify(records)
    );
  } catch {
    // Storage full or unavailable — errors stay in memory for this session.
  }
}

function toRow(
  userId: string,
  guideKey: string,
  r: GuideErrorRecord
): GuideErrorRow {
  return {
    user_id: userId,
    guide_key: guideKey,
    concept_title: r.conceptTitle,
    module_title: r.moduleTitle,
    misses: r.misses,
    correct_streak: r.correctStreak,
    total_attempts: r.totalAttempts,
    last_question: r.lastQuestion ?? null,
    last_picked: r.lastPicked ?? null,
    last_correct: r.lastCorrect ?? null,
    last_explanation: r.lastExplanation ?? null,
    next_review_at: r.nextReviewAt ?? null,
    review_interval_days: r.reviewIntervalDays ?? null,
    ease_factor: r.easeFactor ?? null,
    review_reps: r.reviewReps ?? null,
  };
}

function fromRow(row: GuideErrorRow): GuideErrorRecord {
  return {
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
  };
}

/** Load this user's errors for one guide copy. */
export async function loadErrors(
  userId: string | null,
  guideKey: string
): Promise<GuideErrorRecord[]> {
  if (!userId) return loadLocal(guideKey);
  const rows = await listGuideErrors(userId, guideKey);
  return rows.map(fromRow);
}

/** Persist this user's errors for one guide copy. */
export async function saveErrors(
  userId: string | null,
  guideKey: string,
  records: GuideErrorRecord[]
): Promise<void> {
  if (!userId) {
    saveLocal(guideKey, records);
    return;
  }
  await upsertGuideErrors(userId, guideKey, records.map((r) => toRow(userId, guideKey, r)));
}

/** Delete all of this user's errors for one guide copy (reset). */
export async function clearErrors(
  userId: string | null,
  guideKey: string
): Promise<void> {
  if (!userId) {
    try {
      window.localStorage.removeItem(localStorageKey(guideKey));
    } catch {
      // Nothing to clear.
    }
    return;
  }
  await deleteGuideErrors(userId, guideKey);
}

/**
 * React hook for one guide copy's error records. Loads the user's records
 * for the guide key (Supabase when signed in, localStorage when signed
 * out), keeps them in state, and persists every recorded answer. The same
 * hook drives both the inline Generate-tab view and the dedicated
 * /guide/[id] view, so errors follow the user across both.
 */
export function useGuideErrors(
  guideKey: string | null,
  userId: string | null
): {
  records: GuideErrorRecord[];
  weak: GuideErrorRecord[];
  mastered: GuideErrorRecord[];
  record: (answer: ErrorAnswerInput) => void;
  clear: () => void;
} {
  const [records, setRecords] = useState<GuideErrorRecord[]>([]);
  const recordsRef = useRef<GuideErrorRecord[]>([]);

  useEffect(() => {
    if (!guideKey) {
      recordsRef.current = [];
      setRecords([]);
      return;
    }
    let cancelled = false;
    loadErrors(userId, guideKey)
      .then((loaded) => {
        if (cancelled) return;
        recordsRef.current = loaded;
        setRecords(loaded);
      })
      .catch(() => {
        // Errors are a bonus, never a blocker — keep the guide usable.
      });
    return () => {
      cancelled = true;
    };
  }, [guideKey, userId]);

  const record = useCallback(
    (answer: ErrorAnswerInput) => {
      if (!guideKey) return;
      const next = applyAnswer(recordsRef.current, answer);
      recordsRef.current = next;
      setRecords(next);
      saveErrors(userId, guideKey, next).catch(() => {
        // Persistence failing must not break answering questions.
      });
    },
    [guideKey, userId]
  );

  const clear = useCallback(() => {
    if (!guideKey) return;
    recordsRef.current = [];
    setRecords([]);
    clearErrors(userId, guideKey).catch(() => {
      // Best effort only.
    });
  }, [guideKey, userId]);

  const weak = useMemo(() => weakConcepts(records), [records]);
  const mastered = useMemo(() => masteredConcepts(records), [records]);

  return { records, weak, mastered, record, clear };
}
