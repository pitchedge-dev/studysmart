"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  Loader2,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";
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
} from "@/lib/review";
import EmptyState from "./EmptyState";
import type { PersonalizedQuestion } from "./PersonalizedPractice";

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
   *  the spaced-repetition schedule and the 2-in-a-row mastery rule both
   *  advance. Uses the same persistence as the rest of error tracking. */
  async function recordReviewAnswer(
    guideKey: string,
    q: PersonalizedQuestion,
    pickedOpt: string
  ): Promise<void> {
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
      const next = applyAnswer(records, answer);
      await saveErrors(userId, guideKey, next);
    } catch {
      // Review answers are a bonus — a persistence failure must not
      // break the session.
    }
    onActivity?.(correct);
  }

  async function startReview() {
    if (due.length === 0 || generating) return;
    setError(null);
    setGenerating(true);
    setQuestions(null);
    setSessionDone(false);
    setSessionCorrect(0);
    setCurrent(0);
    setPicked(null);
    try {
      const res = await fetch("/api/personalized-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guideTitle: "Review queue",
          educationLevel: educationLevel ?? "",
          weakConcepts: due.slice(0, 3).map((d) => ({
            conceptTitle: d.record.conceptTitle,
            moduleTitle: d.record.moduleTitle,
            misses: d.record.misses,
            lastQuestion: d.record.lastQuestion,
            lastPicked: d.record.lastPicked,
            lastCorrect: d.record.lastCorrect,
            lastExplanation: d.record.lastExplanation,
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
      setQuestions(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setGenerating(false);
    }
  }

  function answerCurrent(opt: string) {
    if (!questions || picked) return;
    const q = questions[current];
    setPicked(opt);
    const correct = opt === q.correctAnswer;
    if (correct) setSessionCorrect((c) => c + 1);
    // The question belongs to one of the due concepts — record it
    // against that concept's guide copy.
    const dueEntry = due.find(
      (d) => d.record.conceptTitle === q.conceptTitle
    );
    if (dueEntry) {
      void recordReviewAnswer(dueEntry.guideKey, q, opt);
    } else {
      onActivity?.(correct);
    }
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
        nextQuestion();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, current, picked, sessionDone]);

  function nextQuestion() {
    if (!questions) return;
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
            all your guides. Get one right and it comes back later — get it
            wrong and it comes back tomorrow.
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
          <button
            type="button"
            onClick={startReview}
            disabled={generating}
            className="btn-primary w-full justify-center sm:w-auto"
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
          {error && <p className="feedback-wrong font-medium">{error}</p>}
          <p className="text-xs font-medium text-ink-400">
            Tip: press 1–4 to answer, Enter to continue.
          </p>
        </div>
      )}

      {questions && q && !sessionDone && (
        <div className="mt-5">
          <div className="flex items-center justify-between gap-2">
            <span className="chip">
              Question {current + 1} of {questions.length} · {q.conceptTitle}
            </span>
            <span className="text-xs font-semibold text-ink-400">
              {sessionCorrect} correct so far
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
              <button
                type="button"
                onClick={nextQuestion}
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
            Review done — {sessionCorrect} of {questions.length} correct
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
            Concepts you got right move further out (3, 7, then 16 days).
            Ones you missed are due again tomorrow.
          </p>
          <button
            type="button"
            onClick={() => {
              setQuestions(null);
              setSessionDone(false);
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
