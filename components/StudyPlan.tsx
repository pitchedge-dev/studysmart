"use client";

import { CalendarDays } from "lucide-react";

/**
 * Study plan from the test date the user already gave (Coursera pattern).
 * Spreads the guide's modules across the days until the test. Computed
 * from the real test timing — if there is no test date, renders nothing.
 * Never invents a date.
 */

export function testDaysFromTiming(testTiming: string | undefined): number | null {
  if (!testTiming) return null;
  switch (testTiming) {
    case "Today":
      return 0;
    case "Tomorrow":
      return 1;
    case "In 2–3 days":
      return 3;
    case "In a week":
      return 7;
    case "In 2+ weeks":
      return 14;
    default:
      return null; // "No test — just learning" and anything else: no plan.
  }
}

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

export default function StudyPlan({
  testTiming,
  modules,
}: {
  testTiming: string | undefined;
  modules: Array<{ moduleNumber: number; title: string }>;
}) {
  const days = testDaysFromTiming(testTiming);
  if (days === null || modules.length === 0) return null;

  if (days === 0) {
    return (
      <div className="card p-4 sm:p-5">
        <p className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink-900">
          <CalendarDays className="h-4 w-4 text-brand-600" /> Your study plan
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          Your test is today — skip to the cheat sheet and the final review,
          then work through the modules you feel least sure about.
        </p>
      </div>
    );
  }

  // Spread modules across the days until the test: group consecutive
  // modules onto each study day, starting tomorrow.
  const plan: Array<{ date: Date; label: string; titles: string[] }> = [];
  const perDay = Math.ceil(modules.length / days);
  for (let d = 1; d <= days; d++) {
    const slice = modules.slice((d - 1) * perDay, d * perDay);
    if (slice.length === 0) break;
    const date = new Date();
    date.setDate(date.getDate() + d);
    plan.push({
      date,
      label: d === days ? `Day ${d} — test day` : `Day ${d}`,
      titles: slice.map((m) => `Module ${m.moduleNumber}: ${m.title}`),
    });
  }

  return (
    <div className="card p-4 sm:p-5">
      <p className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink-900">
        <CalendarDays className="h-4 w-4 text-brand-600" /> Your study plan
      </p>
      <p className="mt-1 text-xs font-medium text-ink-400">
        {modules.length} module{modules.length === 1 ? "" : "s"} spread across{" "}
        {days} day{days === 1 ? "" : "s"} until your test ({testTiming}).
      </p>
      <ol className="mt-3 space-y-2">
        {plan.map((day) => (
          <li key={day.label} className="flex gap-3 text-sm leading-relaxed">
            <span className="w-36 shrink-0 font-bold text-ink-900">
              {day.label}
              <span className="block text-xs font-medium text-ink-400">
                {formatDay(day.date)}
              </span>
            </span>
            <span className="text-ink-600">{day.titles.join(" · ")}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
