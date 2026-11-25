"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Flame,
  Loader2,
  RotateCcw,
  Target,
  TrendingUp,
  Trophy,
  Zap,
} from "lucide-react";
import {
  todayKey,
  totalQuestions,
  totalXp,
  type ActivityDay,
} from "@/lib/activity";
import { masterySummary } from "@/lib/mastery";
import {
  loadAllErrors,
  reviewForecast,
  type DueConcept,
} from "@/lib/review";
import {
  WEEKLY_GOAL_LABELS,
  WEEKLY_GOAL_PRESETS,
  daysLeftInWeek,
  loadWeeklyGoal,
  saveWeeklyGoal,
  weekProgress,
  type WeeklyGoal,
  type WeeklyGoalKind,
} from "@/lib/weeklyGoal";
import EmptyState from "./EmptyState";

/**
 * "My Progress" — the student's own learning dashboard.
 *
 * Learning dashboards help students understand their progress,
 * identify weak spots, and stay motivated (Verbert et al., 2013), and
 * self-monitoring is a core part of self-regulated learning
 * (Zimmerman, 2000). Everything here is computed from the user's REAL
 * activity only — their activity days, their error records, their
 * review schedule. A new user sees honest 0s and an empty state, never
 * sample data. The weekly goal is theirs to set (Locke & Latham goal
 * setting): a specific target with visible progress.
 */
export default function ProgressDashboard({
  userId,
  days,
  streak,
  xp,
}: {
  userId: string | null;
  days: Record<string, ActivityDay>;
  streak: number;
  xp: number;
}) {
  const [entries, setEntries] = useState<
    Array<{ guideKey: string; record: DueConcept["record"] }>
  >([]);
  const [loadingErrors, setLoadingErrors] = useState(true);
  const [goal, setGoal] = useState<WeeklyGoal | null>(() => loadWeeklyGoal());
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalKind, setGoalKind] = useState<WeeklyGoalKind>(
    goal?.kind ?? "questions"
  );
  const [goalTarget, setGoalTarget] = useState<number>(
    goal?.target ?? WEEKLY_GOAL_PRESETS.questions[1]
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingErrors(true);
    loadAllErrors(userId)
      .then((loaded) => {
        if (!cancelled) setEntries(loaded);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingErrors(false);
      });
  }, [userId]);

  const records = useMemo(() => entries.map((e) => e.record), [entries]);
  const summary = useMemo(() => masterySummary(records), [records]);
  const forecast = useMemo(() => reviewForecast(entries, 7), [entries]);

  const totalQ = useMemo(() => totalQuestions(days), [days]);
  const totalX = useMemo(() => totalXp(days), [days]);
  const overallCorrect = useMemo(
    () =>
      Object.values(days).reduce((n, d) => n + d.questionsCorrect, 0),
    [days]
  );
  const overallAccuracy =
    totalQ > 0 ? Math.round((overallCorrect / totalQ) * 100) : null;

  const last7Keys = useMemo(() => {
    const out: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      out.push(todayKey(d));
    }
    return out;
  }, []);
  const last7 = useMemo(
    () =>
      last7Keys.map((k) => ({
        key: k,
        label: new Date(`${k}T12:00:00`).toLocaleDateString(undefined, {
          weekday: "short",
        }),
        questions: days[k]?.questionsAnswered ?? 0,
        xp: days[k]?.xp ?? 0,
      })),
    [last7Keys, days]
  );
  const maxDayQuestions = Math.max(1, ...last7.map((d) => d.questions));
  const last7Accuracy = useMemo(() => {
    const answered = last7.reduce((n, d) => n + d.questions, 0);
    const correct = last7Keys.reduce(
      (n, k) => n + (days[k]?.questionsCorrect ?? 0),
      0
    );
    return answered > 0 ? Math.round((correct / answered) * 100) : null;
  }, [last7, last7Keys, days]);

  const progress = goal ? weekProgress(days, goal) : null;
  const daysLeft = daysLeftInWeek();

  function saveGoal() {
    const next: WeeklyGoal = { kind: goalKind, target: goalTarget };
    setGoal(next);
    saveWeeklyGoal(next);
    setEditingGoal(false);
  }

  const masteryRows = [
    { label: "Mastered", count: summary.mastered, cls: "bg-emerald-500" },
    { label: "Proficient", count: summary.proficient, cls: "bg-brand-500" },
    { label: "Familiar", count: summary.familiar, cls: "bg-accent-500" },
    { label: "Attempted", count: summary.attempted, cls: "bg-ink-300" },
  ];
  const maxMastery = Math.max(1, ...masteryRows.map((r) => r.count));

  return (
    <div className="space-y-5">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <TrendingUp className="h-6 w-6 text-brand-600" /> My progress
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">
          Your real studying, at a glance — questions, accuracy, mastery and
          what is due next. Nothing here is a sample: a new account starts
          at zero.
        </p>
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            icon: <Flame className="h-5 w-5 text-amber-500" />,
            label: "Day streak",
            value: String(streak),
          },
          {
            icon: <Zap className="h-5 w-5 text-brand-600" />,
            label: "Total XP",
            value: String(xp || totalX),
          },
          {
            icon: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
            label: "Questions answered",
            value: String(totalQ),
          },
          {
            icon: <Target className="h-5 w-5 text-accent-600" />,
            label: "Accuracy overall",
            value: overallAccuracy === null ? "—" : `${overallAccuracy}%`,
          },
        ].map((s) => (
          <div key={s.label} className="card p-4">
            <div className="flex items-center gap-2">
              {s.icon}
              <span className="text-xs font-bold uppercase tracking-wide text-ink-400">
                {s.label}
              </span>
            </div>
            <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Last 7 days */}
      <div className="card p-5 sm:p-6">
        <h3 className="text-base font-extrabold tracking-tight">
          Last 7 days — questions answered
        </h3>
        {totalQ === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<TrendingUp className="h-6 w-6" />}
              headline="No activity yet"
              outcome="Answer your first question — in a guide quiz, the Review queue or Battle Arena — and this chart fills in with your real week."
              buttonLabel="Generate a study guide"
              onAction={() => window.scrollTo({ top: 0, behavior: "smooth" })}
            />
          </div>
        ) : (
          <>
            <div className="mt-4 flex h-32 items-end gap-2">
              {last7.map((d) => (
                <div
                  key={d.key}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <span className="text-xs font-bold tabular-nums text-ink-900">
                    {d.questions}
                  </span>
                  <div
                    className={`w-full max-w-10 rounded-t-lg ${
                      d.key === todayKey()
                        ? "bg-gradient-to-t from-brand-500 to-brand-400"
                        : "bg-brand-100"
                    }`}
                    style={{
                      height: `${Math.max(
                        d.questions > 0 ? 8 : 2,
                        (d.questions / maxDayQuestions) * 100
                      )}%`,
                    }}
                    title={`${d.label}: ${d.questions} questions, ${d.xp} XP`}
                  />
                  <span className="text-[11px] font-semibold text-ink-400">
                    {d.label}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-3 text-sm leading-relaxed text-ink-500">
              Accuracy in the last 7 days:{" "}
              <strong className="text-ink-900">
                {last7Accuracy === null ? "—" : `${last7Accuracy}%`}
              </strong>
              {last7Accuracy !== null && overallAccuracy !== null && (
                <>
                  {" "}
                  (overall {overallAccuracy}%).
                  {last7Accuracy > overallAccuracy
                    ? " You are improving — keep going."
                    : last7Accuracy < overallAccuracy
                      ? " A little below your usual — the Review queue is the fastest way back up."
                      : " Right on your usual level."}
                </>
              )}
            </p>
          </>
        )}
      </div>

      {/* Weekly goal */}
      <div className="card p-5 sm:p-6">
        <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
          <Target className="h-5 w-5 text-brand-600" /> Weekly goal
        </h3>
        {!goal || editingGoal ? (
          <div className="mt-3">
            <p className="text-sm leading-relaxed text-ink-500">
              Pick something specific to aim for this week — specific goals
              with visible progress work better than “study more”.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select
                value={goalKind}
                onChange={(e) => {
                  const k = e.target.value as WeeklyGoalKind;
                  setGoalKind(k);
                  setGoalTarget(WEEKLY_GOAL_PRESETS[k][1]);
                }}
                className="rounded-xl border border-ink-200 bg-white px-3 py-2 text-base font-semibold text-ink-900 sm:text-sm"
                aria-label="Goal type"
              >
                {(Object.keys(WEEKLY_GOAL_LABELS) as WeeklyGoalKind[]).map(
                  (k) => (
                    <option key={k} value={k}>
                      {WEEKLY_GOAL_LABELS[k]}
                    </option>
                  )
                )}
              </select>
              <div className="flex flex-wrap gap-1.5">
                {WEEKLY_GOAL_PRESETS[goalKind].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setGoalTarget(preset)}
                    className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                      goalTarget === preset
                        ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                        : "bg-ink-100 text-ink-700 hover:bg-ink-200"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={saveGoal}
                className="btn-primary px-4 py-2"
              >
                Set goal
              </button>
            </div>
          </div>
        ) : (
          progress && (
            <div className="mt-3 flex flex-wrap items-center gap-4">
              <span className="relative inline-flex h-20 w-20 items-center justify-center">
                <svg width="80" height="80" viewBox="0 0 80 80" aria-hidden>
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    strokeWidth="8"
                    className="stroke-ink-100 dark:stroke-ink-700"
                  />
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    fill="none"
                    style={{ stroke: "rgb(var(--brand-500))" }}
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={2 * Math.PI * 34}
                    strokeDashoffset={
                      2 * Math.PI * 34 * (1 - progress.pct / 100)
                    }
                    transform="rotate(-90 40 40)"
                  />
                </svg>
                <span className="absolute text-sm font-extrabold text-ink-900">
                  {Math.round(progress.pct)}%
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-base font-bold text-ink-900">
                  {progress.done} of {progress.target}{" "}
                  {WEEKLY_GOAL_LABELS[goal.kind].toLowerCase()} this week
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-500">
                  {progress.done >= progress.target
                    ? "Goal reached — nice work. Set a bigger one for next week, or keep the streak going."
                    : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left in the week. ${
                        progress.pct >= 50
                          ? "On track — keep it up."
                          : "A short review session today would put you back on track."
                      }`}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setGoalKind(goal.kind);
                    setGoalTarget(goal.target);
                    setEditingGoal(true);
                  }}
                  className="btn-ghost mt-2 px-3 py-1.5 text-xs"
                >
                  Change goal
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {/* Mastery + review forecast */}
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="card p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
            <Trophy className="h-5 w-5 text-amber-500" /> Mastery — your
            concepts
          </h3>
          {loadingErrors ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your
              concepts…
            </p>
          ) : summary.total === 0 ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-500">
              No concepts attempted yet — answer questions in a guide and
              your mastery levels will show up here.
            </p>
          ) : (
            <div className="mt-4 space-y-3">
              {masteryRows.map((r) => (
                <div key={r.label}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-bold text-ink-900">{r.label}</span>
                    <span className="font-semibold tabular-nums text-ink-500">
                      {r.count}
                    </span>
                  </div>
                  <div className="progress-track mt-1">
                    <div
                      className={`progress-fill ${r.cls}`}
                      style={{
                        width: `${(r.count / maxMastery) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
              <p className="text-sm leading-relaxed text-ink-500">
                {summary.mastered} of {summary.total} attempted concepts
                mastered.
              </p>
            </div>
          )}
        </div>

        <div className="card p-5 sm:p-6">
          <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
            <CalendarDays className="h-5 w-5 text-brand-600" /> Review
            forecast — next 7 days
          </h3>
          {loadingErrors ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your
              schedule…
            </p>
          ) : forecast.every((f) => f.due === 0) ? (
            <p className="mt-3 text-sm leading-relaxed text-ink-500">
              Nothing scheduled for review in the next 7 days. Concepts you
              get wrong will appear here on their SM-2 due day.
            </p>
          ) : (
            <div className="mt-4 grid grid-cols-7 gap-1.5 text-center">
              {forecast.map((f, i) => (
                <div
                  key={f.date}
                  className={`rounded-xl border px-1 py-2 ${
                    i === 0
                      ? "border-brand-200 bg-brand-50"
                      : "border-ink-100 bg-white"
                  }`}
                  title={`${f.date}: ${f.due} due`}
                >
                  <p className="text-[11px] font-bold uppercase tracking-wide text-ink-400">
                    {i === 0
                      ? "Today"
                      : new Date(`${f.date}T12:00:00`).toLocaleDateString(
                          undefined,
                          { weekday: "short" }
                        )}
                  </p>
                  <p className="mt-0.5 text-lg font-extrabold tabular-nums text-ink-900">
                    {f.due}
                  </p>
                  <p className="text-[10px] font-medium text-ink-400">due</p>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 flex items-center gap-1.5 text-sm leading-relaxed text-ink-500">
            <RotateCcw className="h-4 w-4 shrink-0 text-ink-400" />
            Reviews are scheduled by SM-2: easy concepts wait longer, hard
            ones come back sooner.
          </p>
        </div>
      </div>
    </div>
  );
}
