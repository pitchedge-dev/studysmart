/**
 * Mastery levels per concept (Khan Academy pattern), derived ONLY from
 * the user's real answers via their guideErrors records.
 *
 *   Attempted  — answered at least once, no correct streak yet
 *   Familiar   — 1 correct in a row, or 2+ attempts
 *   Proficient — 1 correct in a row after 3+ attempts (knows it, not yet proven)
 *   Mastered   — 2 correct in a row (the same MASTERY_STREAK = 2 rule in
 *                lib/errorTracking.ts — this file only DISPLAYS it, it
 *                never changes the rule)
 *
 * A concept the user has never attempted has no level at all.
 */

import type { GuideErrorRecord } from "./errorTracking";
import { MASTERY_STREAK } from "./errorTracking";

export type MasteryLevel = "Attempted" | "Familiar" | "Proficient" | "Mastered";

export function masteryLevel(r: GuideErrorRecord): MasteryLevel | null {
  if (r.totalAttempts <= 0) return null;
  if (r.correctStreak >= MASTERY_STREAK) return "Mastered";
  if (r.correctStreak === 1 && r.totalAttempts >= 3) return "Proficient";
  if (r.correctStreak === 1 || r.totalAttempts >= 2) return "Familiar";
  return "Attempted";
}

export const MASTERY_META: Record<
  MasteryLevel,
  { color: string; bg: string; ring: string; label: string }
> = {
  Attempted: {
    color: "text-ink-600",
    bg: "bg-ink-100",
    ring: "#8f88b5",
    label: "Attempted",
  },
  Familiar: {
    color: "text-sky-700",
    bg: "bg-sky-50",
    ring: "#38bdf8",
    label: "Familiar",
  },
  Proficient: {
    color: "text-brand-700",
    bg: "bg-brand-50",
    ring: "#6366f1",
    label: "Proficient",
  },
  Mastered: {
    color: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "#10b981",
    label: "Mastered",
  },
};

export type MasterySummary = {
  total: number;
  attempted: number;
  familiar: number;
  proficient: number;
  mastered: number;
  /** Share of attempted concepts that are mastered (0 when none attempted). */
  masteredShare: number;
};

export function masterySummary(records: GuideErrorRecord[]): MasterySummary {
  const summary: MasterySummary = {
    total: 0,
    attempted: 0,
    familiar: 0,
    proficient: 0,
    mastered: 0,
    masteredShare: 0,
  };
  for (const r of records) {
    const level = masteryLevel(r);
    if (!level) continue;
    summary.total += 1;
    if (level === "Attempted") summary.attempted += 1;
    if (level === "Familiar") summary.familiar += 1;
    if (level === "Proficient") summary.proficient += 1;
    if (level === "Mastered") summary.mastered += 1;
  }
  summary.masteredShare =
    summary.total > 0 ? summary.mastered / summary.total : 0;
  return summary;
}
