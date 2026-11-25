"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
import { masteryLevel } from "@/lib/mastery";
import {
  applyAnswer,
  loadErrors,
  saveErrors,
  type ErrorAnswerInput,
  type GuideErrorRecord,
} from "@/lib/errorTracking";
import {
  dueConcepts,
  loadAllErrors,
  type DueConcept,
  type Sm2Grade,
} from "@/lib/review";
import EmptyState from "./EmptyState";
import type { PersonalizedQuestion } from "./PersonalizedPractice";
import WhyWrongList from "./WhyWrongList";

/**
 * Interleave questions across concepts (Rohrer et al.): arrange them so
 * no two consecutive questions test the same concept, when that is
 * possible. Greedy: always pick the concept with the most questions
 * left that is not the one just used. Falls back to plain order when
 * only one concept has questions.
 */
export function interleaveQuestions<T extends { conceptTitle: string }>(
  list: T[]
): T[] {
  const byConcept = new Map<string, T[]>();
  for (const q of list) {
    const arr = byConcept.get(q.conceptTitle) ?? [];
    arr.push(q);
    byConcept.set(q.conceptTitle, arr);
  }
  const out: T[] = [];
  let last: string | null = null;
  while (out.length < list.length) {
    let best: string | null = null;
    for (const [concept, arr] of byConcept) {
      if (arr.length === 0 || concept === last) continue;
      if (!best || arr.length > (byConcept.get(best)?.length ?? 0)) best = concept;
    }
    if (!best) {
      // Only the last concept has questions left — take them in order.
      for (const arr of byConcept.values()) out.push(...arr);
      break;
    }
    out.push(byConcept.get(best)!.shift()!);
    last = best;
  }
  return out;
}

/**
 * Spaced-repetition Review queue (Quizlet pattern).
 *
 * Lists the user's own weak concepts that are due today, across all
 * their guide copies, with each concept's next-review date. A review
 * session asks fresh questions (via the existing personalized-practice
 * endpoint, which never reuses the missed question) — keyboard 1–4 to
 * answer. Correct answers push the concept's next review out along
 * 1 → 3 → 7 → 16 days; a wrong answer brings it back to tomorrow.
 * Nothing here is premade: an empty queue means the user has no weak
 * concepts due, and the empty state says so.
 */
export default function ReviewQueue({
  userId,
  educationLevel,
  onActivity,
  onGenerate,
}: {
  userId: string | null;
  educationLevel?: string;
  /** Called for every answered review question (drives XP + streak). */
  onActivity?: (correct: boolean) => void;
  /** Called by the empty state to send the user to Generate. */
  onGenerate: () => void;
}) {
  const [due, setDue] = useState<DueConcept[]>([]);
  const [totalWeak, setTotalWeak] = useState(0);
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<PersonalizedQuestion[] | null>(null);
  const [current, setCurrent] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [sessionDone, setSessionDone] = useState(false);
  const [sessionCorrect, setSessionCorrect] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Express mode: 15-minute rapid-fire review, weakest concepts first. */
  const [express, setExpress] = useState(false);
  const [expressLeftMs, setExpressLeftMs] = useState(15 * 60 * 1000);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadAllErrors(userId)
      .then((entries) => {
        if (cancelled) return;
        setTotalWeak(
          entries.filter(
            (e) => e.record.misses > 0 && e.record.correctStreak < 2
          ).length
        );
        setDue(dueConcepts(entries));
      })
      .catch(() => {
        if (!cancelled) setDue([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, refreshKey]);

  /** Record one review answer against the guide copy it came from, so
   *  the SM-2 schedule and the 2-in-a-row mastery rule both advance.
   *  Uses the same persistence as the rest of error tracking. Returns
   *  the concept's next interval in days (for the "next review" note). */
  async function recordReviewAnswer(
    guideKey: string,
    q: PersonalizedQuestion,
    pickedOpt: string,
    grade: Sm2Grade
  ): Promise<number | null> {
    const correct = pickedOpt === q.correctAnswer;
    const answer: ErrorAnswerInput = {
      source: "personalized",
      moduleTitle: "",
      conceptTitle: q.conceptTitle,
      question: q.question,
      picked: pickedOpt,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      correct,
    };
    try {
      const records = await loadErrors(userId, guideKey);
      const next = applyAnswer(records, answer, grade);
      await saveErrors(userId, guideKey, next);
      const rec = next.find((r) => r.conceptTitle === q.conceptTitle);
      onActivity?.(correct);
      return rec?.reviewIntervalDays ?? null;
    } catch {
      // Review answers are a bonus — a persistence failure must not
      // break the session.
      onActivity?.(correct);
      return null;
    }
  }

  /** The student's self-grade for the current correct answer (Hard /
   *  Good / Easy). A wrong answer is always a lapse ("Again") and needs
   *  no grade. */
  const [grade, setGrade] = useState<Sm2Grade | null>(null);
  /** Next gap (days) for the concept just answered, once recorded. */
  const [nextIntervalDays, setNextIntervalDays] = useState<number | null>(
    null
  );
  /** Guards against recording the same answer twice (grade tap + Next). */
  const recordedRef = useRef(false);

  async function startReview(isExpress = false) {
    if (due.length === 0 || generating) return;
    setError(null);
    setGenerating(true);
    setQuestions(null);
    setSessionDone(false);
    setSessionCorrect(0);
    setCurrent(0);
    setPicked(null);
    setGrade(null);
    setNextIntervalDays(null);
    recordedRef.current = false;
    setExpress(isExpress);
    setExpressLeftMs(15 * 60 * 1000);
    try {
      // Express mode: weakest concepts first (most misses), retrieval
      // only, against a 15-minute clock. Normal mode: most overdue first.
      const picked = isExpress
        ? [...due].sort((a, b) => b.record.misses - a.record.misses).slice(0, 3)
        : due.slice(0, 3);
      const res = await fetch("/api/personalized-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guideTitle: "Review queue",
          educationLevel: educationLevel ?? "",
          weakConcepts: picked.map((d) => ({
            conceptTitle: d.record.conceptTitle,
            moduleTitle: d.record.moduleTitle,
            misses: d.record.misses,
            lastQuestion: d.record.lastQuestion,
            lastPicked: d.record.lastPicked,
            lastCorrect: d.record.lastCorrect,
            lastExplanation: d.record.lastExplanation,
            masteryLevel: masteryLevel(d.record) ?? undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Could not build your review session.");
      const list = data.questions as PersonalizedQuestion[];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error("No review questions came back — try again.");
      }
      // Interleaving (Rohrer et al.): shuffle so no two consecutive
      // questions test the same concept — the student must choose the
      // right idea from the question itself, not from the previous one.
      setQuestions(interleaveQuestions(list));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  // Express countdown: when the 15 minutes run out, the session ends.
  useEffect(() => {
    if (!express || !questions || sessionDone) return;
    const id = window.setInterval(() => {
      setExpressLeftMs((ms) => {
        if (ms <= 1000) {
          window.clearInterval(id);
          setSessionDone(true);
          setRefreshKey((k) => k + 1);
          return 0;
        }
        return ms - 1000;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [express, questions, sessionDone]);

  function answerCurrent(opt: string) {
    if (!questions || picked) return;
    const q = questions[current];
    setPicked(opt);
    setNextIntervalDays(null);
    const correct = opt === q.correctAnswer;
    if (correct) setSessionCorrect((c) => c + 1);
    // Recording waits for the grade: a correct answer is graded Hard /
    // Good / Easy below (SM-2), a wrong answer is a lapse. The record
    // happens once, when the student moves on.
  }

  /** Record the current answer once, with its SM-2 grade. Grade taps
   *  record right away so the "next review" note appears in the
   *  feedback box; the Next button records only if nothing was graded
   *  yet (correct without a grade counts as Good, wrong is a lapse). */
  async function recordOnce(g: Sm2Grade) {
    if (!questions || !picked || recordedRef.current) return;
    recordedRef.current = true;
    const q = questions[current];
    const correct = picked === q.correctAnswer;
    const dueEntry = due.find(
      (d) => d.record.conceptTitle === q.conceptTitle
    );
    if (dueEntry) {
      const days = await recordReviewAnswer(dueEntry.guideKey, q, picked, g);
      setNextIntervalDays(days);
    } else {
      onActivity?.(correct);
    }
  }

  /** Move on to the next question, recording first if needed. */
  async function advanceFromReview() {
    if (!questions) return;
    if (picked && !recordedRef.current) {
      const q = questions[current];
      const correct = picked === q.correctAnswer;
      await recordOnce(correct ? (grade ?? "good") : "again");
    }
    nextQuestion();
  }

  // Keyboard 1–4 to answer, Enter to continue.
  useEffect(() => {
    if (!questions || sessionDone) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT")
      )
        return;
      if (!picked && ["1", "2", "3", "4"].includes(e.key)) {
        const q = questions[current];
        const opt = q?.options[Number(e.key) - 1];
        if (opt) answerCurrent(opt);
      } else if (picked && e.key === "Enter") {
        void advanceFromReview();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, current, picked, sessionDone]);

  function nextQuestion() {
    if (!questions) return;
    setGrade(null);
    recordedRef.current = false;
    if (current + 1 >= questions.length) {
      setSessionDone(true);
      setRefreshKey((k) => k + 1);
    } else {
      setCurrent((c) => c + 1);
      setPicked(null);
    }
  }

  const q = questions?.[current];

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <RotateCcw className="h-5 w-5 text-brand-600" /> Review queue
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-400">
            Weak concepts due for review today, from your own mistakes across
            all your guides. Get one right, grade how hard it felt, and the
            next gap adapts — Easy stretches further, Hard comes back
            sooner. Get it wrong and it comes back tomorrow.
          </p>
        </div>
        <span className="chip-amber">
          <Clock className="h-3.5 w-3.5" /> {due.length} due today
        </span>
      </div>

      {loading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking what is due…
        </p>
      )}

      {!loading && !questions && due.length === 0 && (
        <div className="mt-4">
          <EmptyState
            icon={<CheckCircle2 className="h-6 w-6" />}
            headline={
              totalWeak === 0
                ? "Nothing to review yet"
                : "All caught up — nothing due today"
            }
            outcome={
              totalWeak === 0
                ? "Concepts you get wrong will land here for spaced review, due tomorrow and then further apart as you get them right."
                : "You still have weak concepts, but none are due today. They will come back on their scheduled day."
            }
            buttonLabel="Generate a study guide"
            onAction={onGenerate}
          />
        </div>
      )}

      {!loading && !questions && due.length > 0 && (
        <div className="mt-4 space-y-3">
          {due.map((d) => (
            <div
              key={`${d.guideKey}::${d.record.conceptTitle}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink-100 bg-white px-4 py-3 shadow-sm"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink-900">
                  {d.record.conceptTitle}
                </p>
                <p className="mt-0.5 text-xs font-medium text-ink-400">
                  {d.record.moduleTitle
                    ? `${d.record.moduleTitle} · `
                    : ""}
                  Missed {d.record.misses} time{d.record.misses === 1 ? "" : "s"} ·{" "}
                  {d.record.totalAttempts} attempt
                  {d.record.totalAttempts === 1 ? "" : "s"}
                  {d.dueDate
                    ? d.overdueDays > 0
                      ? ` · due ${d.overdueDays} day${d.overdueDays === 1 ? "" : "s"} ago`
                      : " · due today"
                    : " · due now"}
                </p>
                {d.record.lastQuestion && (
                  <p className="mt-1 text-xs leading-relaxed text-ink-500">
                    Last missed: {d.record.lastQuestion}
                  </p>
                )}
              </div>
              <span className="chip">Review</span>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => startReview(false)}
              disabled={generating}
              className="btn-primary justify-center"
            >
              {generating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Building your
                  review…
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" /> Start review ({due.length}{" "}
                  due)
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => startReview(true)}
              disabled={generating}
              className="btn-secondary justify-center"
              title="15 minutes, weakest concepts first, retrieval only — the fastest way to lock in what you keep missing."
            >
              <Clock className="h-4 w-4" /> 15-minute express
            </button>
          </div>
          {error && <p className="feedback-wrong font-medium">{error}</p>}
          <p className="text-xs font-medium text-ink-400">
            Mixed review: questions shuffle across concepts, so you have to
            pick the right idea from each question — not from the one before
            it. Tip: press 1–4 to answer, Enter to continue.
          </p>
        </div>
      )}

      {questions && q && !sessionDone && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <span className="chip">
              Question {current + 1} of {questions.length} · {q.conceptTitle}
            </span>
            <span className="flex items-center gap-2">
              {express && (
                <span className="chip-amber tabular-nums">
                  <Clock className="h-3.5 w-3.5" />{" "}
                  {Math.floor(expressLeftMs / 60000)}:
                  {String(Math.floor((expressLeftMs % 60000) / 1000)).padStart(2, "0")}{" "}
                  left
                </span>
              )}
              <span className="text-xs font-semibold text-ink-400">
                {sessionCorrect} correct so far
              </span>
            </span>
          </div>
          <div className="progress-track mt-3">
            <div
              className="progress-fill"
              style={{ width: `${((current + 1) / questions.length) * 100}%` }}
            />
          </div>
          <p className="mt-4 text-base font-bold leading-relaxed text-ink-900">
            {q.question}
          </p>
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {q.options.map((opt, i) => {
              const isCorrect = opt === q.correctAnswer;
              const isPicked = opt === picked;
              let cls = "";
              if (picked) {
                if (isCorrect) cls = "option-correct";
                else if (isPicked) cls = "option-wrong";
                else cls = "option-dimmed";
              }
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => answerCurrent(opt)}
                  disabled={!!picked}
                  className={`option-btn ${cls}`}
                >
                  <span>
                    <kbd className="mr-2 rounded bg-ink-100 px-1.5 py-0.5 text-xs font-bold text-ink-500">
                      {i + 1}
                    </kbd>
                    {opt}
                  </span>
                  {picked && isCorrect && (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                  )}
                  {picked && isPicked && !isCorrect && (
                    <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                  )}
                </button>
              );
            })}
          </div>
          {picked && (
            <div className="feedback-neutral mt-4">
              <p>
                <strong>Explanation:</strong> {q.explanation}
              </p>
              <WhyWrongList
                whyWrong={q.whyWrong}
                correctAnswer={q.correctAnswer}
              />
              {picked === q.correctAnswer && (
                <div className="mt-3">
                  <p className="text-sm font-bold text-ink-900">
                    How hard was that?
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-400">
                    Your grade sets the next gap (SM-2): Easy stretches
                    further, Hard comes back sooner.
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {(
                      [
                        { g: "hard", label: "Hard", hint: "Barely got it" },
                        { g: "good", label: "Good", hint: "Got it, with a pause" },
                        { g: "easy", label: "Easy", hint: "Instant recall" },
                      ] as const
                    ).map(({ g, label, hint }) => (
                      <button
                        key={g}
                        type="button"
                        onClick={() => {
                          setGrade(g);
                          void recordOnce(g);
                        }}
                        className="rounded-xl border border-ink-100 bg-white px-3 py-2 text-left shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
                        title={hint}
                      >
                        <span className="block text-sm font-extrabold text-ink-900">
                          {label}
                        </span>
                        <span className="block text-xs font-medium text-ink-400">
                          {hint}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {picked !== q.correctAnswer && (
                <p className="mt-3 text-sm leading-relaxed text-ink-600">
                  Missed it — this concept is due again tomorrow, and its
                  review ladder restarts.
                </p>
              )}
              {nextIntervalDays !== null && (
                <p className="mt-2 text-sm font-semibold text-ink-700">
                  Next review:{" "}
                  {nextIntervalDays <= 1
                    ? "tomorrow"
                    : `in ${nextIntervalDays} days`}
                </p>
              )}
              <button
                type="button"
                onClick={() => void advanceFromReview()}
                className="btn-primary mt-3"
              >
                {current + 1 >= questions.length
                  ? "See results"
                  : "Next question"}
              </button>
            </div>
          )}
        </div>
      )}

      {questions && sessionDone && (
        <div className="mt-5 rounded-2xl border border-ink-100 bg-white p-5 text-center shadow-sm">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <h3 className="mt-2 text-lg font-extrabold tracking-tight">
            {express ? "Express done" : "Review done"} — {sessionCorrect} of{" "}
            {questions.length} correct
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
            Concepts you got right move further out — Easy ones furthest,
            Hard ones sooner. Ones you missed are due again tomorrow.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuestions(null);
              setSessionDone(false);
              setExpress(false);
              setRefreshKey((k) => k + 1);
            }}
            className="btn-primary mx-auto mt-4"
          >
            <BookOpen className="h-4 w-4" /> Back to the queue
          </button>
        </div>
      )}
    </div>
  );
}
