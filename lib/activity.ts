/**
 * Streaks + XP + daily goal (Duolingo pattern, honest version).
 *
 * Every number here comes from the user's REAL activity only — a new user
 * sees 0 everywhere. XP is awarded only for correct answers, completed
 * sections, and mastered concepts — never for clicks, page views, or
 * generating a guide. A "study day" (which builds the streak) is a day
 * with at least one answered question, one completed section, or one
 * generated guide. Daily goal: answer 5 questions a day.
 *
 * Storage: localStorage always (works signed out). When signed in, each
 * day's totals are ALSO upserted to the `study_activity` Supabase table
 * (migration 0004) — best effort only: if the table does not exist yet
 * (migration not applied live), the sync fails silently and local state
 * keeps working. Nothing here blocks the app.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "./supabase";

export const DAILY_GOAL_QUESTIONS = 5;
export const XP_PER_CORRECT = 10;
export const XP_PER_SECTION = 15;
export const XP_PER_MASTERY = 25;
export const STREAK_MILESTONES = [3, 7, 14, 30];

export type ActivityDay = {
  date: string; // YYYY-MM-DD, local date
  xp: number;
  questionsAnswered: number;
  questionsCorrect: number;
  guidesGenerated: number;
  sectionsCompleted: number;
  conceptsMastered: number;
  arenaGames: number;
};

export type LastGuide = {
  title: string;
  guideId: string | null;
  guideKey: string | null;
  openedAt: string; // ISO timestamp
};

export type ActivityState = {
  days: Record<string, ActivityDay>;
  lastGuide: LastGuide | null;
  celebratedMilestones: number[];
};

const STORAGE_KEY = "studysmart-activity:v1";

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateKeyOffset(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return todayKey(d);
}

export function emptyDay(date: string): ActivityDay {
  return {
    date,
    xp: 0,
    questionsAnswered: 0,
    questionsCorrect: 0,
    guidesGenerated: 0,
    sectionsCompleted: 0,
    conceptsMastered: 0,
    arenaGames: 0,
  };
}

function loadLocal(): ActivityState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { days: {}, lastGuide: null, celebratedMilestones: [] };
    const parsed = JSON.parse(raw) as Partial<ActivityState>;
    return {
      days: parsed.days ?? {},
      lastGuide: parsed.lastGuide ?? null,
      celebratedMilestones: parsed.celebratedMilestones ?? [],
    };
  } catch {
    return { days: {}, lastGuide: null, celebratedMilestones: [] };
  }
}

function saveLocal(state: ActivityState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable — activity stays in memory for this session.
  }
}

function isStudyDay(day: ActivityDay | undefined): boolean {
  if (!day) return false;
  return (
    day.questionsAnswered > 0 ||
    day.sectionsCompleted > 0 ||
    day.guidesGenerated > 0
  );
}

/** Consecutive study days ending today (or yesterday, if today has no activity yet). */
export function computeStreak(days: Record<string, ActivityDay>): number {
  let streak = 0;
  // If today has no activity yet, the streak is measured from yesterday.
  const startOffset = isStudyDay(days[todayKey()]) ? 0 : 1;
  for (let i = startOffset; ; i++) {
    if (isStudyDay(days[dateKeyOffset(i)])) streak += 1;
    else break;
  }
  return streak;
}

export function totalXp(days: Record<string, ActivityDay>): number {
  return Object.values(days).reduce((n, d) => n + d.xp, 0);
}

export function totalQuestions(days: Record<string, ActivityDay>): number {
  return Object.values(days).reduce((n, d) => n + d.questionsAnswered, 0);
}

/** Best-effort sync of one day to Supabase. Silently no-ops when the
 *  study_activity table does not exist yet or the user is signed out. */
async function syncDayToSupabase(
  userId: string | null,
  day: ActivityDay
): Promise<void> {
  if (!userId) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("study_activity").upsert(
      {
        user_id: userId,
        activity_date: day.date,
        xp: day.xp,
        questions_answered: day.questionsAnswered,
        questions_correct: day.questionsCorrect,
        guides_generated: day.guidesGenerated,
        sections_completed: day.sectionsCompleted,
        concepts_mastered: day.conceptsMastered,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,activity_date" }
    );
    if (error) throw error;
  } catch {
    // Table missing / RLS / offline — local state is the source of truth.
  }
}

/** Best-effort load of the user's days from Supabase, merged over local
 *  state (per-day, per-field max — never lowers a real number). */
async function loadDaysFromSupabase(
  userId: string
): Promise<Record<string, ActivityDay>> {
  const sb = getSupabase();
  if (!sb) return {};
  try {
    const { data, error } = await sb
      .from("study_activity")
      .select("*")
      .eq("user_id", userId);
    if (error || !data) return {};
    const out: Record<string, ActivityDay> = {};
    for (const row of data as Array<Record<string, unknown>>) {
      const date = String(row.activity_date ?? "");
      if (!date) continue;
      out[date] = {
        date,
        xp: Number(row.xp ?? 0),
        questionsAnswered: Number(row.questions_answered ?? 0),
        questionsCorrect: Number(row.questions_correct ?? 0),
        guidesGenerated: Number(row.guides_generated ?? 0),
        sectionsCompleted: Number(row.sections_completed ?? 0),
        conceptsMastered: Number(row.concepts_mastered ?? 0),
        arenaGames: Number(row.arena_games ?? 0),
      };
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Standalone recorder for screens that do not mount the useActivity hook
 * (e.g. the dedicated /guide/[id] page). Loads the stored state, applies
 * one event, saves, and best-effort syncs to Supabase. The home page's
 * hook picks the new totals up on its next mount.
 */
export function recordActivityNow(
  kind: "question" | "section" | "mastery",
  opts?: { correct?: boolean; userId?: string | null }
): void {
  try {
    const state = loadLocal();
    const key = todayKey();
    const day = { ...(state.days[key] ?? emptyDay(key)) };
    if (kind === "question") {
      day.questionsAnswered += 1;
      if (opts?.correct) {
        day.questionsCorrect += 1;
        day.xp += XP_PER_CORRECT;
      }
    } else if (kind === "section") {
      day.sectionsCompleted += 1;
      day.xp += XP_PER_SECTION;
    } else {
      day.conceptsMastered += 1;
      day.xp += XP_PER_MASTERY;
    }
    const next = { ...state, days: { ...state.days, [key]: day } };
    saveLocal(next);
    void syncDayToSupabase(opts?.userId ?? null, day);
  } catch {
    // Activity recording must never break studying.
  }
}

export type ActivityApi = {
  state: ActivityState;
  streak: number;
  xp: number;
  today: ActivityDay;
  todayGoalDone: boolean;
  totalQuestionsAnswered: number;
  /** Milestone just crossed (3/7/14/30) that has not been celebrated yet. */
  milestone: number | null;
  dismissMilestone: () => void;
  recordQuestion: (correct: boolean) => void;
  recordGuideGenerated: (title: string, guideId?: string | null, guideKey?: string | null) => void;
  recordSectionCompleted: () => void;
  recordConceptMastered: () => void;
  recordArenaGame: (correct: number, total: number) => void;
  /** Mark one finished Battle Arena game (no question counts — those
   *  are recorded per answer, so this never double-counts). */
  recordArenaPlayed: () => void;
  saveLastGuide: (guide: LastGuide) => void;
  checklist: { generatedGuide: boolean; answeredFive: boolean; triedArena: boolean };
};

export function useActivity(userId: string | null): ActivityApi {
  const [state, setState] = useState<ActivityState>(() => ({
    days: {},
    lastGuide: null,
    celebratedMilestones: [],
  }));
  const [loaded, setLoaded] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const userRef = useRef(userId);
  userRef.current = userId;

  // Load local state on mount; merge Supabase days when signed in.
  useEffect(() => {
    setState(loadLocal());
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!userId || !loaded) return;
    let cancelled = false;
    loadDaysFromSupabase(userId).then((remote) => {
      if (cancelled || Object.keys(remote).length === 0) return;
      setState((prev) => {
        const days = { ...prev.days };
        for (const [date, r] of Object.entries(remote)) {
          const l = days[date];
          days[date] = l
            ? {
                date,
                xp: Math.max(l.xp, r.xp),
                questionsAnswered: Math.max(l.questionsAnswered, r.questionsAnswered),
                questionsCorrect: Math.max(l.questionsCorrect, r.questionsCorrect),
                guidesGenerated: Math.max(l.guidesGenerated, r.guidesGenerated),
                sectionsCompleted: Math.max(l.sectionsCompleted, r.sectionsCompleted),
                conceptsMastered: Math.max(l.conceptsMastered, r.conceptsMastered),
                arenaGames: Math.max(l.arenaGames, r.arenaGames),
              }
            : r;
        }
        const next = { ...prev, days };
        saveLocal(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, loaded]);

  const mutate = useCallback(
    (fn: (day: ActivityDay, prev: ActivityState) => ActivityDay) => {
      setState((prev) => {
        const key = todayKey();
        const day = fn({ ...(prev.days[key] ?? emptyDay(key)) }, prev);
        const next: ActivityState = {
          ...prev,
          days: { ...prev.days, [key]: day },
        };
        saveLocal(next);
        void syncDayToSupabase(userRef.current, day);
        return next;
      });
    },
    []
  );

  const recordQuestion = useCallback(
    (correct: boolean) => {
      mutate((day) => ({
        ...day,
        questionsAnswered: day.questionsAnswered + 1,
        questionsCorrect: day.questionsCorrect + (correct ? 1 : 0),
        xp: day.xp + (correct ? XP_PER_CORRECT : 0),
      }));
    },
    [mutate]
  );

  const recordGuideGenerated = useCallback(
    (title: string, guideId?: string | null, guideKey?: string | null) => {
      const openedAt = new Date().toISOString();
      mutate((day) => ({
        ...day,
        guidesGenerated: day.guidesGenerated + 1,
      }));
      setState((prev) => {
        const next = {
          ...prev,
          lastGuide: { title, guideId: guideId ?? null, guideKey: guideKey ?? null, openedAt },
        };
        saveLocal(next);
        return next;
      });
    },
    [mutate]
  );

  const recordSectionCompleted = useCallback(() => {
    mutate((day) => ({
      ...day,
      sectionsCompleted: day.sectionsCompleted + 1,
      xp: day.xp + XP_PER_SECTION,
    }));
  }, [mutate]);

  const recordConceptMastered = useCallback(() => {
    mutate((day) => ({
      ...day,
      conceptsMastered: day.conceptsMastered + 1,
      xp: day.xp + XP_PER_MASTERY,
    }));
  }, [mutate]);

  const recordArenaGame = useCallback(
    (correct: number, total: number) => {
      mutate((day) => ({
        ...day,
        arenaGames: day.arenaGames + 1,
        questionsAnswered: day.questionsAnswered + total,
        questionsCorrect: day.questionsCorrect + correct,
        xp: day.xp + correct * XP_PER_CORRECT,
      }));
    },
    [mutate]
  );

  const recordArenaPlayed = useCallback(() => {
    mutate((day) => ({ ...day, arenaGames: day.arenaGames + 1 }));
  }, [mutate]);

  const saveLastGuide = useCallback((guide: LastGuide) => {
    setState((prev) => {
      const next = { ...prev, lastGuide: guide };
      saveLocal(next);
      return next;
    });
  }, []);

  const streak = computeStreak(state.days);
  const xp = totalXp(state.days);
  const today = state.days[todayKey()] ?? emptyDay(todayKey());
  const totalQuestionsAnswered = totalQuestions(state.days);

  // First uncelebrated milestone the current streak has reached.
  const milestone =
    STREAK_MILESTONES.find(
      (m) => streak >= m && !state.celebratedMilestones.includes(m)
    ) ?? null;

  const dismissMilestone = useCallback(() => {
    if (milestone === null) return;
    setState((prev) => {
      const next = {
        ...prev,
        celebratedMilestones: [...prev.celebratedMilestones, milestone],
      };
      saveLocal(next);
      return next;
    });
  }, [milestone]);

  return {
    state,
    streak,
    xp,
    today,
    todayGoalDone: today.questionsAnswered >= DAILY_GOAL_QUESTIONS,
    totalQuestionsAnswered,
    milestone,
    dismissMilestone,
    recordQuestion,
    recordGuideGenerated,
    recordSectionCompleted,
    recordConceptMastered,
    recordArenaGame,
    recordArenaPlayed,
    saveLastGuide,
    checklist: {
      generatedGuide:
        Object.values(state.days).some((d) => d.guidesGenerated > 0) ||
        Boolean(state.lastGuide),
      answeredFive: totalQuestionsAnswered >= 5,
      triedArena: Object.values(state.days).some((d) => d.arenaGames > 0),
    },
  };
}
