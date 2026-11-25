/**
 * Achievements — milestones earned from REAL activity only.
 *
 * Every achievement below is backed by a number the app already measures
 * (see `computeAchievementStats`): focus-timer sessions, streak days, XP,
 * guides generated, concepts mastered, correct answers, days the daily
 * goal was met, arena games played, and arena games won. Nothing here is
 * granted for opening the app, clicking around, or generating a guide
 * without doing the work — and a new user starts with ZERO achievements.
 *
 * STUDY HOURS, MEASURED HONESTLY: the only study duration the app can
 * actually observe is completed 25-minute focus-timer sessions
 * (lib/activity.ts `focusSessions` — one per finished Pomodoro, +25 XP).
 * Study hours = focus sessions x 25 minutes. Time spent reading a guide,
 * answering quiz questions, or having the app open is NOT counted, because
 * it is not measured — counting it would invent hours the user did not
 * provably study. Teach-Back scores are likewise NOT used: a Teach-Back
 * result lives only in component state (it feeds error tracking as a
 * correct/miss answer) and no best score is persisted anywhere, so there
 * is no honest number to award against.
 *
 * Storage: earned achievements live in localStorage always (works signed
 * out). When signed in they are ALSO inserted into the `achievements`
 * Supabase table (migration 0008) — best effort only: if the table does
 * not exist yet the sync fails silently and local state keeps working.
 */

import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  CalendarCheck,
  CheckCircle2,
  Clock,
  Crown,
  Flame,
  GraduationCap,
  Medal,
  Swords,
  Target,
  Trophy,
  Zap,
} from "lucide-react";
import { DAILY_GOAL_QUESTIONS, type ActivityDay } from "./activity";
import { getSupabase } from "./supabase";

/** One completed focus session = 25 minutes of measured study time. */
export const FOCUS_SESSION_MINUTES = 25;
/** An arena game counts as won at >= 70% accuracy — the app's own win
 *  line (BattleArena plays the win fanfare + confetti at >= 0.7). */
export const ARENA_WIN_ACCURACY = 0.7;

export type AchievementCategory =
  | "hours"
  | "streak"
  | "xp"
  | "guides"
  | "mastery"
  | "questions"
  | "goals"
  | "arena"
  | "wins";

/** Certificate tiers — the fancier the tier, the fancier the certificate. */
export type AchievementTier = "bronze" | "silver" | "gold" | "platinum";

export const CATEGORY_META: Record<
  AchievementCategory,
  { label: string; icon: LucideIcon }
> = {
  hours: { label: "Study hours", icon: Clock },
  streak: { label: "Streaks", icon: Flame },
  xp: { label: "Experience", icon: Zap },
  guides: { label: "Study guides", icon: BookOpen },
  mastery: { label: "Mastery", icon: GraduationCap },
  questions: { label: "Correct answers", icon: CheckCircle2 },
  goals: { label: "Daily goals", icon: CalendarCheck },
  arena: { label: "Battle Arena", icon: Swords },
  wins: { label: "Arena victories", icon: Trophy },
};

export type AchievementDef = {
  id: string;
  title: string;
  /** The requirement, in plain words — shown on locked and unlocked cards. */
  description: string;
  category: AchievementCategory;
  tier: AchievementTier;
  /** Threshold in the category's unit (minutes for hours, count otherwise). */
  threshold: number;
  icon: LucideIcon;
};

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---- Study hours (measured focus-timer time only) ----
  { id: "hours-1", title: "First Hour", description: "Study for 1 hour with the focus timer (3 sessions)", category: "hours", tier: "bronze", threshold: 60, icon: Clock },
  { id: "hours-5", title: "Deep Focus", description: "Study for 5 hours with the focus timer (12 sessions)", category: "hours", tier: "silver", threshold: 300, icon: Clock },
  { id: "hours-10", title: "Ten-Hour Scholar", description: "Study for 10 hours with the focus timer (24 sessions)", category: "hours", tier: "gold", threshold: 600, icon: Medal },
  { id: "hours-25", title: "Marathon Mind", description: "Study for 25 hours with the focus timer (60 sessions)", category: "hours", tier: "platinum", threshold: 1500, icon: Crown },
  // ---- Streaks ----
  { id: "streak-3", title: "Three-Day Spark", description: "Study 3 days in a row", category: "streak", tier: "bronze", threshold: 3, icon: Flame },
  { id: "streak-7", title: "Week of Wins", description: "Study 7 days in a row", category: "streak", tier: "silver", threshold: 7, icon: Flame },
  { id: "streak-14", title: "Fortnight Focus", description: "Study 14 days in a row", category: "streak", tier: "gold", threshold: 14, icon: Flame },
  { id: "streak-30", title: "Monthly Master", description: "Study 30 days in a row", category: "streak", tier: "platinum", threshold: 30, icon: Crown },
  // ---- Experience ----
  { id: "xp-100", title: "Century Club", description: "Earn 100 XP from real answers and completions", category: "xp", tier: "bronze", threshold: 100, icon: Zap },
  { id: "xp-500", title: "XP Explorer", description: "Earn 500 XP from real answers and completions", category: "xp", tier: "silver", threshold: 500, icon: Zap },
  { id: "xp-1000", title: "Thousand Club", description: "Earn 1,000 XP from real answers and completions", category: "xp", tier: "gold", threshold: 1000, icon: Medal },
  { id: "xp-2500", title: "XP Legend", description: "Earn 2,500 XP from real answers and completions", category: "xp", tier: "platinum", threshold: 2500, icon: Crown },
  // ---- Study guides ----
  { id: "guides-1", title: "First Guide", description: "Generate your first study guide", category: "guides", tier: "bronze", threshold: 1, icon: BookOpen },
  { id: "guides-5", title: "Guide Builder", description: "Generate 5 study guides", category: "guides", tier: "silver", threshold: 5, icon: BookOpen },
  { id: "guides-10", title: "Library Builder", description: "Generate 10 study guides", category: "guides", tier: "gold", threshold: 10, icon: BookOpen },
  { id: "guides-25", title: "Guide Master", description: "Generate 25 study guides", category: "guides", tier: "platinum", threshold: 25, icon: Crown },
  // ---- Mastery ----
  { id: "mastery-1", title: "First Mastery", description: "Master your first concept (2 correct in a row)", category: "mastery", tier: "bronze", threshold: 1, icon: GraduationCap },
  { id: "mastery-5", title: "Mastered Five", description: "Master 5 concepts", category: "mastery", tier: "silver", threshold: 5, icon: GraduationCap },
  { id: "mastery-10", title: "Mastered Ten", description: "Master 10 concepts", category: "mastery", tier: "gold", threshold: 10, icon: GraduationCap },
  { id: "mastery-25", title: "Concept Conqueror", description: "Master 25 concepts", category: "mastery", tier: "platinum", threshold: 25, icon: Crown },
  // ---- Correct answers ----
  { id: "questions-10", title: "Sharp Shooter", description: "Answer 10 questions correctly", category: "questions", tier: "bronze", threshold: 10, icon: Target },
  { id: "questions-50", title: "Quiz Whiz", description: "Answer 50 questions correctly", category: "questions", tier: "silver", threshold: 50, icon: Target },
  { id: "questions-100", title: "Century Correct", description: "Answer 100 questions correctly", category: "questions", tier: "gold", threshold: 100, icon: Medal },
  { id: "questions-250", title: "Answer Ace", description: "Answer 250 questions correctly", category: "questions", tier: "platinum", threshold: 250, icon: Crown },
  // ---- Daily goals (5 questions a day) ----
  { id: "goals-1", title: "Goal Getter", description: "Meet your daily goal (5 questions) in a day", category: "goals", tier: "bronze", threshold: 1, icon: CalendarCheck },
  { id: "goals-7", title: "Week of Goals", description: "Meet your daily goal on 7 different days", category: "goals", tier: "silver", threshold: 7, icon: CalendarCheck },
  { id: "goals-30", title: "Goal Machine", description: "Meet your daily goal on 30 different days", category: "goals", tier: "gold", threshold: 30, icon: CalendarCheck },
  // ---- Battle Arena games played ----
  { id: "arena-1", title: "First Battle", description: "Finish your first Battle Arena game", category: "arena", tier: "bronze", threshold: 1, icon: Swords },
  { id: "arena-5", title: "Arena Regular", description: "Finish 5 Battle Arena games", category: "arena", tier: "silver", threshold: 5, icon: Swords },
  { id: "arena-10", title: "Arena Veteran", description: "Finish 10 Battle Arena games", category: "arena", tier: "gold", threshold: 10, icon: Swords },
  { id: "arena-25", title: "Arena Legend", description: "Finish 25 Battle Arena games", category: "arena", tier: "platinum", threshold: 25, icon: Crown },
  // ---- Battle Arena victories (>= 70% accuracy) ----
  { id: "wins-1", title: "First Victory", description: "Win a Battle Arena game (70%+ accuracy)", category: "wins", tier: "bronze", threshold: 1, icon: Trophy },
  { id: "wins-5", title: "Victory Lap", description: "Win 5 Battle Arena games (70%+ accuracy)", category: "wins", tier: "silver", threshold: 5, icon: Trophy },
  { id: "wins-10", title: "Champion's Circle", description: "Win 10 Battle Arena games (70%+ accuracy)", category: "wins", tier: "gold", threshold: 10, icon: Trophy },
];

export const TIER_META: Record<
  AchievementTier,
  { label: string; icon: LucideIcon }
> = {
  bronze: { label: "Bronze", icon: Medal },
  silver: { label: "Silver", icon: Medal },
  gold: { label: "Gold", icon: Trophy },
  platinum: { label: "Platinum", icon: Crown },
};

/** Fallback symbol for a category (used by the summary chips). */
export const CATEGORY_ICON: Record<AchievementCategory, LucideIcon> = {
  hours: Clock,
  streak: Flame,
  xp: Zap,
  guides: BookOpen,
  mastery: GraduationCap,
  questions: Target,
  goals: CalendarCheck,
  arena: Swords,
  wins: Trophy,
};

export type AchievementStats = {
  /** Measured focus-timer minutes (sessions x 25). */
  focusMinutes: number;
  focusSessions: number;
  streak: number;
  xp: number;
  guidesCreated: number;
  conceptsMastered: number;
  questionsCorrect: number;
  /** Days the 5-question daily goal was met. */
  goalDays: number;
  arenaGames: number;
  arenaWins: number;
};

export function emptyStats(): AchievementStats {
  return {
    focusMinutes: 0,
    focusSessions: 0,
    streak: 0,
    xp: 0,
    guidesCreated: 0,
    conceptsMastered: 0,
    questionsCorrect: 0,
    goalDays: 0,
    arenaGames: 0,
    arenaWins: 0,
  };
}

/** Totals straight from the activity log — `?? 0` guards days recorded
 *  before a field existed, so old activity is never lost. */
export function computeAchievementStats(
  days: Record<string, ActivityDay>,
  streak: number,
  xp: number
): AchievementStats {
  const list = Object.values(days);
  const focusSessions = list.reduce(
    (n, d) => n + (d.focusSessions ?? 0),
    0
  );
  return {
    focusSessions,
    focusMinutes: focusSessions * FOCUS_SESSION_MINUTES,
    streak,
    xp,
    guidesCreated: list.reduce((n, d) => n + (d.guidesGenerated ?? 0), 0),
    conceptsMastered: list.reduce((n, d) => n + (d.conceptsMastered ?? 0), 0),
    questionsCorrect: list.reduce((n, d) => n + (d.questionsCorrect ?? 0), 0),
    goalDays: list.filter(
      (d) => (d.questionsAnswered ?? 0) >= DAILY_GOAL_QUESTIONS
    ).length,
    arenaGames: list.reduce((n, d) => n + (d.arenaGames ?? 0), 0),
    arenaWins: list.reduce((n, d) => n + (d.arenaWins ?? 0), 0),
  };
}

/** The current value for one achievement's category, in its unit. */
export function progressValue(def: AchievementDef, stats: AchievementStats): number {
  switch (def.category) {
    case "hours":
      return stats.focusMinutes;
    case "streak":
      return stats.streak;
    case "xp":
      return stats.xp;
    case "guides":
      return stats.guidesCreated;
    case "mastery":
      return stats.conceptsMastered;
    case "questions":
      return stats.questionsCorrect;
    case "goals":
      return stats.goalDays;
    case "arena":
      return stats.arenaGames;
    case "wins":
      return stats.arenaWins;
  }
}

/** Human-readable current value ("3h 25m" for hours, plain count otherwise). */
export function formatProgress(def: AchievementDef, stats: AchievementStats): string {
  const value = progressValue(def, stats);
  if (def.category === "hours") {
    const h = Math.floor(value / 60);
    const m = value % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  return String(value);
}

/** Human-readable threshold ("5h" for hours, plain count otherwise). */
export function formatThreshold(def: AchievementDef): string {
  if (def.category === "hours") {
    const h = def.threshold / 60;
    return Number.isInteger(h) ? `${h}h` : `${def.threshold}m`;
  }
  return String(def.threshold);
}

export type EarnedAchievement = {
  id: string;
  /** ISO timestamp of when it was earned. */
  earnedAt: string;
};

const STORAGE_KEY = "studysmart-achievements:v1";

function loadLocal(): EarnedAchievement[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as EarnedAchievement[];
    return Array.isArray(parsed)
      ? parsed.filter((e) => typeof e?.id === "string" && typeof e?.earnedAt === "string")
      : [];
  } catch {
    return [];
  }
}

function saveLocal(earned: EarnedAchievement[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(earned));
  } catch {
    // Storage unavailable — achievements stay in memory for this session.
  }
}

/** Best-effort: insert one earned achievement for the signed-in user.
 *  Silently no-ops when the table does not exist yet or signed out. */
async function syncEarnedToSupabase(
  userId: string | null,
  earned: EarnedAchievement
): Promise<void> {
  if (!userId) return;
  const sb = getSupabase();
  if (!sb) return;
  try {
    const { error } = await sb.from("achievements").upsert(
      {
        user_id: userId,
        achievement_id: earned.id,
        earned_at: earned.earnedAt,
      },
      { onConflict: "user_id,achievement_id" }
    );
    if (error) throw error;
  } catch {
    // Table missing / RLS / offline — local state is the source of truth.
  }
}

/** Best-effort: load the user's earned achievements from Supabase. */
async function loadEarnedFromSupabase(
  userId: string
): Promise<EarnedAchievement[]> {
  const sb = getSupabase();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("achievements")
      .select("achievement_id, earned_at")
      .eq("user_id", userId);
    if (error || !data) return [];
    return (data as Array<Record<string, unknown>>)
      .map((row) => ({
        id: String(row.achievement_id ?? ""),
        earnedAt: String(row.earned_at ?? ""),
      }))
      .filter((e) => e.id && e.earnedAt);
  } catch {
    return [];
  }
}

/**
 * Pure evaluation: which definitions are met by `stats` and not already
 * in `earnedIds`. Returns the newly-unlocked definitions (never re-awards).
 */
export function evaluateAchievements(
  stats: AchievementStats,
  earnedIds: ReadonlySet<string>
): AchievementDef[] {
  return ACHIEVEMENTS.filter(
    (def) => !earnedIds.has(def.id) && progressValue(def, stats) >= def.threshold
  );
}

export type NewUnlock = {
  def: AchievementDef;
  earnedAt: string;
};

export type AchievementsApi = {
  earned: EarnedAchievement[];
  earnedIds: Set<string>;
  /** Unlocks since the user last dismissed the celebration banner. */
  newlyUnlocked: NewUnlock[];
  dismissNewlyUnlocked: () => void;
};

export function useAchievements(
  userId: string | null,
  stats: AchievementStats
): AchievementsApi {
  const [earned, setEarned] = useState<EarnedAchievement[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [newlyUnlocked, setNewlyUnlocked] = useState<NewUnlock[]>([]);
  const earnedRef = useRef<EarnedAchievement[]>([]);
  earnedRef.current = earned;
  const userRef = useRef(userId);
  userRef.current = userId;

  // Load local earned set on mount; merge Supabase rows when signed in.
  useEffect(() => {
    setEarned(loadLocal());
    setLoaded(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!userId || !loaded) return;
    let cancelled = false;
    loadEarnedFromSupabase(userId).then((remote) => {
      if (cancelled || remote.length === 0) return;
      setEarned((prev) => {
        const ids = new Set(prev.map((e) => e.id));
        const merged = [...prev];
        for (const r of remote) {
          if (!ids.has(r.id)) merged.push(r);
        }
        if (merged.length === prev.length) return prev;
        saveLocal(merged);
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [userId, loaded]);

  // Evaluate on every stats change; award each achievement exactly once.
  useEffect(() => {
    if (!loaded) return;
    const ids = new Set(earnedRef.current.map((e) => e.id));
    const fresh = evaluateAchievements(stats, ids);
    if (fresh.length === 0) return;
    const now = new Date().toISOString();
    const added: EarnedAchievement[] = fresh.map((def) => ({
      id: def.id,
      earnedAt: now,
    }));
    setEarned((prev) => {
      const next = [...prev, ...added];
      saveLocal(next);
      return next;
    });
    setNewlyUnlocked((prev) => [
      ...prev,
      ...fresh.map((def) => ({ def, earnedAt: now })),
    ]);
    for (const a of added) void syncEarnedToSupabase(userRef.current, a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, loaded]);

  const dismissNewlyUnlocked = () => setNewlyUnlocked([]);

  return {
    earned,
    earnedIds: new Set(earned.map((e) => e.id)),
    newlyUnlocked,
    dismissNewlyUnlocked,
  };
}
