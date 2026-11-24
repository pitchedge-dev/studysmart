"use client";

import { Award, CheckCircle2, Circle, TrendingUp } from "lucide-react";
import {
  MASTERY_META,
  masteryLevel,
  masterySummary,
  type MasteryLevel,
} from "@/lib/mastery";
import type { GuideErrorRecord } from "@/lib/errorTracking";

/** Small per-concept mastery badge. Renders nothing for a concept the
 *  user has never attempted. */
export function MasteryBadge({ record }: { record: GuideErrorRecord | undefined }) {
  if (!record) return null;
  const level = masteryLevel(record);
  if (!level) return null;
  const meta = MASTERY_META[level];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.bg} ${meta.color} ring-1 ring-inset ring-current/10`}
      title={`${level}: ${record.totalAttempts} attempt${record.totalAttempts === 1 ? "" : "s"}, ${record.misses} miss${record.misses === 1 ? "" : "es"}, ${record.correctStreak} correct in a row`}
    >
      {level === "Mastered" ? (
        <Award className="h-3.5 w-3.5" />
      ) : level === "Proficient" ? (
        <TrendingUp className="h-3.5 w-3.5" />
      ) : level === "Familiar" ? (
        <CheckCircle2 className="h-3.5 w-3.5" />
      ) : (
        <Circle className="h-3.5 w-3.5" />
      )}
      {level}
    </span>
  );
}

const LEVEL_ORDER: MasteryLevel[] = ["Attempted", "Familiar", "Proficient", "Mastered"];

/** Per-guide mastery summary: a ring + counts per level, from the user's
 *  real answers on this guide copy. Renders nothing until something has
 *  been attempted. */
export function MasterySummary({ records }: { records: GuideErrorRecord[] }) {
  const summary = masterySummary(records);
  if (summary.total === 0) return null;
  const r = 26;
  const circumference = 2 * Math.PI * r;
  const masteredPct = Math.round(summary.masteredShare * 100);
  return (
    <div className="card flex flex-wrap items-center gap-4 p-4 sm:p-5">
      <span className="relative inline-flex h-16 w-16 items-center justify-center">
        <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            strokeWidth="6"
            className="stroke-ink-100 dark:stroke-ink-700"
          />
          <circle
            cx="32"
            cy="32"
            r={r}
            fill="none"
            style={{ stroke: MASTERY_META.Mastered.ring }}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - summary.masteredShare)}
            transform="rotate(-90 32 32)"
          />
        </svg>
        <span className="absolute text-sm font-extrabold text-ink-900">
          {masteredPct}%
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold tracking-tight text-ink-900">
          Mastery — {summary.mastered} of {summary.total} concepts mastered
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {LEVEL_ORDER.map((level) => {
            const count =
              level === "Attempted"
                ? summary.attempted
                : level === "Familiar"
                  ? summary.familiar
                  : level === "Proficient"
                    ? summary.proficient
                    : summary.mastered;
            const meta = MASTERY_META[level];
            return (
              <span
                key={level}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${meta.bg} ${meta.color}`}
              >
                {level} · {count}
              </span>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs font-medium text-ink-400">
          A concept is mastered after 2 correct answers in a row. Misses
          send it back to the Review queue.
        </p>
      </div>
    </div>
  );
}
