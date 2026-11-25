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
/** A completed 25-minute focus session (Pomodoro pattern). */
export const XP_PER_FOCUS_SESSION = 25;
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
  /** Finished Battle Arena games with accuracy >= 70% — the app's own
   *  win line (BattleArena plays the win fanfare and confetti at >= 0.7).
   *  Local only, like focusSessions (no column in study_activity). */
  arenaWins: number;
  /** Completed 25-minute focus sessions (Pomodoro). Local only — not a
   *  column in the study_activity table, so it is never sent to Supabase
   *  (see syncDayToSupabase). */
  focusSessions: number;
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

/**
 * Storage keys are scoped per user: signed-out play uses the legacy
 * key, and every signed-in account gets its own key. A brand-new
 * account therefore starts at 0 streak / 0 XP instead of inheriting
 * the previous account's counters from this device — that leak was
 * the old behaviour, one shared key for everybody.
 *
 * NOTE: existing signed-in players' local history lives under the
 * legacy key and is NOT copied over (it cannot be attributed to one
 * account — that is exactly the leak). Their server-side days are
 * restored by the Supabase merge below; only the local-only counters
 * (arena wins, focus sessions) restart.
 */
const LEGACY_STORAGE_KEY = "studysmart-activity:v1";

export function storageKeyFor(userId: string | null): string {
  if (!userId) return LEGACY_STORAGE_KEY;
  const safe = userId.replace(/[^a-zA-Z0-9_-]/g, "");
  return `${LEGACY_STORAGE_KEY}:${safe}`;
}

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
    arenaWins: 0,
    focusSessions: 0,
  };
}

function loadLocal(key: string): ActivityState {
  try {
    const raw = window.localStorage.getItem(key);
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

function saveLocal(state: ActivityState, key: string): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Storage unavailable — activity stays in memory for this session.
  }
}

function isStudyDay(day: ActivityDay | undefined): boolean {
  if (!day) return false;
  return (
    day.questionsAnswered > 0 ||
    day.sectionsCompleted > 0 ||
    day.guidesGenerated > 0 ||
    (day.focusSessions ?? 0) > 0
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
        // arenaWins + focusSessions are local-only; the table has no
        // such columns.
        arenaWins: 0,
        focusSessions: 0,
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
    // Scoped to the signed-in user (or the shared signed-out key) —
    // a question answered on one account must never land in another
    // account's streak/XP.
    const storageKey = storageKeyFor(opts?.userId ?? null);
    const state = loadLocal(storageKey);
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
    saveLocal(next, storageKey);
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
  /** Mark one finished Battle Arena game won at >= 70% accuracy (the
   *  app's own win line — see BattleArena's win fanfare / confetti). */
  recordArenaWin: () => void;
  /** A completed 25-minute focus session (+25 XP, counts as a study day). */
  recordFocusSession: () => void;
  saveLastGuide: (guide: LastGuide) => void;
  /** Clear the "continue where you left off" entry (guide unopenable). */
  clearLastGuide: () => void;
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
  // The storage key for whoever is signed in right now. Refs (not
  // state) so the callbacks below always write to the current user's
  // key, even if the user changed between render and callback.
  const keyRef = useRef(storageKeyFor(userId));
  keyRef.current = storageKeyFor(userId);

  // Load local state on mount AND whenever the signed-in user changes
  // (sign-in, sign-out, account switch): each account sees only its
  // own days, streak, XP, and "continue where you left off" entry. A
  // brand-new account loads an empty state — 0 streak, 0 XP.
  useEffect(() => {
    setState(loadLocal(keyRef.current));
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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
                arenaWins: Math.max(l.arenaWins ?? 0, r.arenaWins ?? 0),
                focusSessions: Math.max(l.focusSessions ?? 0, r.focusSessions ?? 0),
              }
            : r;
        }
        const next = { ...prev, days };
        saveLocal(next, keyRef.current);
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
        saveLocal(next, keyRef.current);
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
        saveLocal(next, keyRef.current);
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

  const recordArenaWin = useCallback(() => {
    mutate((day) => ({ ...day, arenaWins: (day.arenaWins ?? 0) + 1 }));
  }, [mutate]);

  const saveLastGuide = useCallback((guide: LastGuide) => {
    setState((prev) => {
      const next = { ...prev, lastGuide: guide };
      saveLocal(next, keyRef.current);
      return next;
    });
  }, []);

  /**
   * Clear the "continue where you left off" entry — used when the saved
   * guide can no longer be opened by this session (deleted, or private
   * to another account while signed out), so the home page never points
   * at a dead guide.
   */
  const clearLastGuide = useCallback(() => {
    setState((prev) => {
      if (!prev.lastGuide) return prev;
      const next = { ...prev, lastGuide: null };
      saveLocal(next, keyRef.current);
      return next;
    });
  }, []);

  /** A completed 25-minute focus session: +25 XP, counts as a study day.
   *  focusSessions is local-only (see ActivityDay) — the Supabase sync
   *  only sends the table's own columns, so it never breaks. */
  const recordFocusSession = useCallback(() => {
    mutate((day) => ({
      ...day,
      focusSessions: (day.focusSessions ?? 0) + 1,
      xp: day.xp + XP_PER_FOCUS_SESSION,
    }));
  }, [mutate]);

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
      saveLocal(next, keyRef.current);
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
    recordArenaWin,
    recordFocusSession,
    saveLastGuide,
    clearLastGuide,
    checklist: {
      generatedGuide:
        Object.values(state.days).some((d) => d.guidesGenerated > 0) ||
        Boolean(state.lastGuide),
      answeredFive: totalQuestionsAnswered >= 5,
      triedArena: Object.values(state.days).some((d) => d.arenaGames > 0),
    },
  };
}
