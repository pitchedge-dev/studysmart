"use client";

import { Flame, Star } from "lucide-react";
import { DAILY_GOAL_QUESTIONS } from "@/lib/activity";

/**
 * Header widget: streak flame + total XP + today's daily-goal ring.
 * Every number comes from real activity (0 for a new user).
 * The ring is an SVG circle: today's answered questions / 5.
 */
export default function StreakWidget({
  streak,
  xp,
  todayAnswered,
  todayCorrect,
}: {
  streak: number;
  xp: number;
  todayAnswered: number;
  todayCorrect: number;
}) {
  const goal = DAILY_GOAL_QUESTIONS;
  const progress = Math.min(1, todayAnswered / goal);
  const r = 13;
  const circumference = 2 * Math.PI * r;
  const goalDone = todayAnswered >= goal;

  return (
    <div
      className="flex items-center gap-2 rounded-full border border-ink-200 bg-white px-2.5 py-1 shadow-sm dark:border-ink-700 dark:bg-ink-800"
      title={
        goalDone
          ? `Daily goal done — ${todayAnswered} questions answered today (${todayCorrect} correct).`
          : `Daily goal: answer ${goal} questions today — ${todayAnswered} so far.`
      }
    >
      <span
        className="inline-flex items-center gap-1 text-sm font-extrabold text-ink-800"
        title={`${streak}-day study streak`}
      >
        <Flame
          className={`h-4 w-4 ${streak > 0 ? "fill-accent-400 text-accent-500" : "text-ink-300"}`}
        />
        {streak}
      </span>
      <span className="h-4 w-px bg-ink-200 dark:bg-ink-700" aria-hidden />
      <span
        className="inline-flex items-center gap-1 text-sm font-extrabold text-ink-800"
        title={`${xp} XP earned from correct answers, completed sections, and mastered concepts`}
      >
        <Star className="h-4 w-4 fill-accent-400 text-accent-500" />
        {xp.toLocaleString()}
      </span>
      <span className="h-4 w-px bg-ink-200 dark:bg-ink-700" aria-hidden />
      <span className="relative inline-flex h-7 w-7 items-center justify-center">
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden>
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            strokeWidth="3.5"
            className="stroke-ink-100 dark:stroke-ink-700"
          />
          <circle
            cx="16"
            cy="16"
            r={r}
            fill="none"
            style={{
              stroke: goalDone ? "var(--success)" : "rgb(var(--brand-500))",
            }}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - progress)}
            transform="rotate(-90 16 16)"
          />
        </svg>
        <span className="absolute text-[9px] font-extrabold text-ink-700">
          {todayAnswered}/{goal}
        </span>
      </span>
    </div>
  );
}
