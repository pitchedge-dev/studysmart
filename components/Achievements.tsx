"use client";

import { useMemo, useState } from "react";
import { Award, Clock, Flame, Lock, Trophy, X, Zap } from "lucide-react";
import Confetti from "./Confetti";
import Certificate from "./Certificate";
import {
  ACHIEVEMENTS,
  CATEGORY_META,
  TIER_META,
  formatProgress,
  formatThreshold,
  progressValue,
  type AchievementCategory,
  type AchievementDef,
  type AchievementStats,
  type EarnedAchievement,
  type NewUnlock,
} from "@/lib/achievements";

/**
 * Achievements section — every milestone the user has earned (or can
 * earn) from real study activity, with progress toward each one and a
 * fancy certificate for every unlocked achievement. New users start at
 * zero: locked cards show the requirement, never a seeded reward.
 */

const TIER_CARD: Record<string, string> = {
  bronze: "border-amber-700/40",
  silver: "border-slate-400/50",
  gold: "border-yellow-500/60",
  platinum: "border-violet-500/60",
};

const TIER_MEDALLION: Record<string, string> = {
  bronze: "bg-gradient-to-br from-amber-500 to-amber-700 text-white",
  silver: "bg-gradient-to-br from-slate-400 to-slate-600 text-white",
  gold: "bg-gradient-to-br from-yellow-400 to-amber-600 text-white",
  platinum: "bg-gradient-to-br from-violet-500 to-indigo-700 text-white",
};

const TIER_CHIP: Record<string, string> = {
  bronze: "bg-amber-100 text-amber-800",
  silver: "bg-slate-100 text-slate-700",
  gold: "bg-yellow-100 text-amber-800",
  platinum: "bg-violet-100 text-violet-800",
};

function formatEarnedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function Achievements({
  stats,
  earned,
  newlyUnlocked,
  onDismissNew,
  displayName,
}: {
  stats: AchievementStats;
  earned: EarnedAchievement[];
  newlyUnlocked: NewUnlock[];
  onDismissNew: () => void;
  displayName: string;
}) {
  const [filter, setFilter] = useState<"all" | AchievementCategory>("all");
  const [certificate, setCertificate] = useState<{
    def: AchievementDef;
    earnedAt: string;
  } | null>(null);

  const earnedById = useMemo(
    () => new Map(earned.map((e) => [e.id, e.earnedAt])),
    [earned]
  );

  const visible = useMemo(
    () =>
      filter === "all"
        ? ACHIEVEMENTS
        : ACHIEVEMENTS.filter((d) => d.category === filter),
    [filter]
  );

  const unlockedCount = earned.length;
  const categories: Array<"all" | AchievementCategory> = [
    "all",
    "hours",
    "streak",
    "xp",
    "guides",
    "mastery",
    "questions",
    "goals",
    "arena",
    "wins",
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight text-ink-900">
          <Trophy className="h-6 w-6 text-amber-500" /> Achievements
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-500">
          Milestones you earn by actually studying — focus sessions, streaks,
          mastered concepts, arena wins. Nothing here is given away.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="card p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
            <Trophy className="h-3.5 w-3.5 text-amber-500" /> Unlocked
          </p>
          <p className="mt-1 text-2xl font-extrabold text-ink-900">
            {unlockedCount}
            <span className="text-base font-bold text-ink-400">
              /{ACHIEVEMENTS.length}
            </span>
          </p>
        </div>
        <div className="card p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
            <Clock className="h-3.5 w-3.5 text-brand-500" /> Focus time
          </p>
          <p className="mt-1 text-2xl font-extrabold text-ink-900">
            {formatHours(stats.focusMinutes)}
          </p>
          <p className="text-xs font-medium text-ink-400">
            {stats.focusSessions} focus session
            {stats.focusSessions === 1 ? "" : "s"} · 25 min each
          </p>
        </div>
        <div className="card p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
            <Flame className="h-3.5 w-3.5 text-orange-500" /> Streak
          </p>
          <p className="mt-1 text-2xl font-extrabold text-ink-900">
            {stats.streak}
            <span className="text-base font-bold text-ink-400">
              {" "}
              day{stats.streak === 1 ? "" : "s"}
            </span>
          </p>
        </div>
        <div className="card p-4">
          <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-400">
            <Zap className="h-3.5 w-3.5 text-accent-500" /> XP
          </p>
          <p className="mt-1 text-2xl font-extrabold text-ink-900">
            {stats.xp.toLocaleString()}
          </p>
          <p className="text-xs font-medium text-ink-400">
            {stats.conceptsMastered} concept
            {stats.conceptsMastered === 1 ? "" : "s"} mastered
          </p>
        </div>
      </div>

      {/* New-unlock celebration (first time each achievement is earned). */}
      {newlyUnlocked.length > 0 && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 p-5 text-white shadow-lift">
          <Confetti />
          <div className="relative flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
                <Award className="h-5 w-5 shrink-0" />
                {newlyUnlocked.length === 1
                  ? "New achievement unlocked!"
                  : `${newlyUnlocked.length} new achievements unlocked!`}
              </p>
              <ul className="mt-2 space-y-1">
                {newlyUnlocked.map(({ def }) => (
                  <li key={def.id} className="flex items-center gap-2 text-sm">
                    <def.icon className="h-4 w-4 shrink-0" />
                    <span className="font-bold">{def.title}</span>
                    <span className="truncate text-amber-100">
                      — {TIER_META[def.tier].label} · {def.description}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-2">
                {newlyUnlocked.map(({ def, earnedAt }) => (
                  <button
                    key={def.id}
                    type="button"
                    onClick={() => setCertificate({ def, earnedAt })}
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-sm font-extrabold text-amber-700 shadow-sm transition hover:bg-amber-50"
                  >
                    <Award className="h-4 w-4" /> View {def.title} certificate
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              onClick={onDismissNew}
              aria-label="Dismiss new achievements"
              className="shrink-0 rounded-full p-2 text-white/80 transition hover:bg-white/20 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}

      {/* Category filter */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter achievements by category">
        {categories.map((c) => {
          const label = c === "all" ? "All" : CATEGORY_META[c].label;
          const count =
            c === "all"
              ? ACHIEVEMENTS.length
              : ACHIEVEMENTS.filter((d) => d.category === c).length;
          const unlocked =
            c === "all"
              ? unlockedCount
              : ACHIEVEMENTS.filter(
                  (d) => d.category === c && earnedById.has(d.id)
                ).length;
          return (
            <button
              key={c}
              type="button"
              onClick={() => setFilter(c)}
              aria-pressed={filter === c}
              className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                filter === c
                  ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                  : "bg-ink-100 text-ink-700 hover:bg-ink-200"
              }`}
            >
              {label} · {unlocked}/{count}
            </button>
          );
        })}
      </div>

      {unlockedCount === 0 && (
        <div className="rounded-2xl border border-dashed border-brand-300 bg-white/70 p-5 text-sm leading-relaxed text-ink-500">
          <p className="font-bold text-ink-900">Your first achievements are waiting.</p>
          <p className="mt-1">
            Finish a 25-minute focus session, answer 5 questions, or generate
            your first study guide — each one earns a badge and a certificate.
          </p>
        </div>
      )}

      {/* Achievement grid */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((def) => {
          const earnedAt = earnedById.get(def.id);
          const unlocked = Boolean(earnedAt);
          const current = progressValue(def, stats);
          const pct = Math.min(
            100,
            Math.round((current / def.threshold) * 100)
          );
          const Icon = def.icon;
          return (
            <article
              key={def.id}
              className={`card relative overflow-hidden p-5 ${
                unlocked ? TIER_CARD[def.tier] : "opacity-75"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-sm ${
                    unlocked ? TIER_MEDALLION[def.tier] : "bg-ink-100 text-ink-400"
                  }`}
                  aria-hidden
                >
                  {unlocked ? (
                    <Icon className="h-6 w-6" />
                  ) : (
                    <Lock className="h-5 w-5" />
                  )}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-extrabold tracking-tight text-ink-900">
                    {def.title}
                  </h3>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                    {def.description}
                  </p>
                  <span
                    className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-extrabold ${
                      unlocked ? TIER_CHIP[def.tier] : "bg-ink-100 text-ink-500"
                    }`}
                  >
                    {TIER_META[def.tier].label}
                    {" · "}
                    {CATEGORY_META[def.category].label}
                  </span>
                </div>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-xs font-bold">
                  <span className="text-ink-500">
                    {formatProgress(def, stats)} / {formatThreshold(def)}
                  </span>
                  <span className={unlocked ? "text-emerald-700" : "text-ink-400"}>
                    {unlocked
                      ? `Earned ${formatEarnedAt(earnedAt!)}`
                      : `${pct}%`}
                  </span>
                </div>
                <div className="progress-track mt-1.5">
                  <div
                    className={`progress-fill ${
                      unlocked ? "" : "opacity-60"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>

              {unlocked && (
                <button
                  type="button"
                  onClick={() =>
                    setCertificate({ def, earnedAt: earnedAt! })
                  }
                  className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-amber-400 to-amber-500 px-4 py-2 text-sm font-extrabold text-white shadow-sm transition hover:from-amber-500 hover:to-amber-600"
                >
                  <Award className="h-4 w-4" /> View certificate
                </button>
              )}
            </article>
          );
        })}
      </div>

      <p className="text-xs leading-relaxed text-ink-400">
        Study hours count completed 25-minute focus sessions only — time spent
        reading or with the app open is not measured, so it is never counted.
        Teach-Back scores are not stored anywhere, so they have no
        achievements yet.
      </p>

      {certificate && (
        <Certificate
          def={certificate.def}
          userName={displayName}
          earnedAt={certificate.earnedAt}
          onClose={() => setCertificate(null)}
        />
      )}
    </div>
  );
}
