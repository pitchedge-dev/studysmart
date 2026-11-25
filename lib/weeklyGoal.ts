/**
 * Weekly study goal (goal-setting theory, Locke & Latham).
 *
 * Specific, challenging goals with visible progress feedback beat vague
 * "study more" intentions (Locke & Latham, 2002; Harkin et al., 2016
 * meta-analysis: monitoring goal progress reliably improves
 * attainment). The goal is the student's own choice — kind + target —
 * stored only in this browser, and progress is measured from their real
 * activity days (lib/activity.ts): questions answered, XP earned, or
 * focus minutes (25 minutes per completed focus session).
 */

import { todayKey, type ActivityDay } from "./activity";

export type WeeklyGoalKind = "questions" | "xp" | "focus";

export type WeeklyGoal = {
  kind: WeeklyGoalKind;
  /** Target for the week: questions, XP, or focus minutes. */
  target: number;
};

export const WEEKLY_GOAL_LABELS: Record<WeeklyGoalKind, string> = {
  questions: "Questions answered",
  xp: "XP earned",
  focus: "Focus minutes",
};

export const WEEKLY_GOAL_PRESETS: Record<WeeklyGoalKind, number[]> = {
  questions: [25, 50, 100],
  xp: [100, 250, 500],
  focus: [60, 120, 180],
};

const STORAGE_KEY = "studysmart-weekly-goal:v1";

export function loadWeeklyGoal(): WeeklyGoal | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeeklyGoal>;
    if (
      parsed.kind !== "questions" &&
      parsed.kind !== "xp" &&
      parsed.kind !== "focus"
    )
      return null;
    const target = Number(parsed.target);
    if (!Number.isFinite(target) || target <= 0) return null;
    return { kind: parsed.kind, target: Math.round(target) };
  } catch {
    return null;
  }
}

export function saveWeeklyGoal(goal: WeeklyGoal): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(goal));
  } catch {
    // Storage unavailable — the goal still works for this session.
  }
}

/** Monday (YYYY-MM-DD) of the week containing `d`. Weeks run Mon–Sun. */
export function weekStartKey(d = new Date()): string {
  const day = d.getDay(); // 0 = Sunday
  const back = (day + 6) % 7; // days since Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() - back);
  return todayKey(monday);
}

/** The 7 date keys (Mon–Sun) of the current week. */
export function currentWeekKeys(): string[] {
  const start = weekStartKey();
  const out: string[] = [];
  const base = new Date(`${start}T12:00:00`);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    out.push(todayKey(d));
  }
  return out;
}

/** Days left in the current week, including today. */
export function daysLeftInWeek(): number {
  const today = todayKey();
  return Math.max(1, currentWeekKeys().filter((k) => k >= today).length);
}

function goalValue(day: ActivityDay | undefined, kind: WeeklyGoalKind): number {
  if (!day) return 0;
  if (kind === "questions") return day.questionsAnswered;
  if (kind === "xp") return day.xp;
  return (day.focusSessions ?? 0) * 25;
}

/** This week's progress toward the goal, from real activity only. */
export function weekProgress(
  days: Record<string, ActivityDay>,
  goal: WeeklyGoal
): { done: number; target: number; pct: number } {
  const done = currentWeekKeys().reduce(
    (n, k) => n + goalValue(days[k], goal.kind),
    0
  );
  return { done, target: goal.target, pct: Math.min(100, (done / goal.target) * 100) };
}
