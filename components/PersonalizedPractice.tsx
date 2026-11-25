"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  Crosshair,
  Loader2,
  RotateCcw,
  Sparkles,
  Target,
  Trash2,
  Trophy,
  Wand2,
  XCircle,
} from "lucide-react";
import type { ErrorAnswerInput, GuideErrorRecord } from "@/lib/errorTracking";
import { masteryLevel } from "@/lib/mastery";
import {
  clearPractice,
  loadPractice,
  savePractice,
} from "@/lib/personalizedPracticeStore";
import WhyWrongList, { type WhyWrongEntryLike } from "./WhyWrongList";

export type PersonalizedQuestion = {
  conceptTitle: string;
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  /** One entry per wrong option, saying why it is wrong. */
  whyWrong?: WhyWrongEntryLike[];
  /** Bloom's level this question targets — matched to the concept's
   *  mastery (Recall for new/weak concepts, Apply/Analyse as it is
   *  mastered). Set by the generator; older responses omit it. */
  difficulty?: "Recall" | "Apply" | "Analyse";
};

/**
 * "Practice your weak spots" — personalized practice for THIS user's copy
 * of THIS guide, built from their own recorded errors only.
 *
 * The weak list comes from the signed-in user's error records for this
 * guide copy (or this browser's local records when signed out). Published
 * guides, shared guides, and other users' copies never show your errors:
 * opening one starts with a clean slate, and your errors on it are tracked
 * only for you. A concept leaves the weak list after two correct answers
 * in a row.
 */
export default function PersonalizedPractice({
  guideKey,
  guideTitle,
  educationLevel,
  weak,
  mastered,
  signedIn,
  onAnswer,
  onClearErrors,
}: {
  /** The guide-copy key (`guide:<id>` or `local:<hash>`) — the same
   *  key the error records use. Generated questions are stored under
   *  it, so the home-page guide view and the dedicated /guide/[id]
   *  page render the SAME generated set. Null means no stable key
   *  (questions stay in memory for this view only). */
  guideKey?: string | null;
  guideTitle: string;
  educationLevel: string;
  weak: GuideErrorRecord[];
  mastered: GuideErrorRecord[];
  signedIn: boolean;
  onAnswer: (answer: ErrorAnswerInput) => void;
  onClearErrors: () => void;
}) {
  const [questions, setQuestions] = useState<PersonalizedQuestion[] | null>(null);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Load the stored set for this guide copy, so both views render the
  // same generated practice. Loaded unconditionally — the weak list
  // may still be loading from the account when this mounts, so the
  // filter to still-weak concepts happens at render time, never here
  // (filtering here could delete a good set before the records load).
  useEffect(() => {
    if (!guideKey) return;
    const stored = loadPractice(guideKey);
    if (!stored) return;
    setQuestions(stored.questions);
    setAnswers(stored.answers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guideKey]);

  if (weak.length === 0 && mastered.length === 0) return null;

  const weakTitles = new Set(weak.map((w) => w.conceptTitle));
  // Only questions for concepts that are still weak are shown — a
  // mastered concept's practice has served its purpose. Indices are
  // kept (answers are keyed by them), so hidden questions are skipped
  // in the render loop rather than filtered out of the array.
  const visibleCount = (questions ?? []).filter((q) =>
    weakTitles.has(q.conceptTitle)
  ).length;
  const answeredCount = (questions ?? []).filter(
    (q, i) => weakTitles.has(q.conceptTitle) && answers[i] !== undefined
  ).length;
  const correctCount = (questions ?? []).filter(
    (q, i) => weakTitles.has(q.conceptTitle) && answers[i] === q.correctAnswer
  ).length;

  async function generatePractice() {
    setError(null);
    setLoading(true);
    setQuestions(null);
    setAnswers({});
    try {
      const res = await fetch("/api/personalized-practice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guideTitle,
          educationLevel,
          weakConcepts: weak.slice(0, 3).map((w) => ({
            conceptTitle: w.conceptTitle,
            moduleTitle: w.moduleTitle,
            misses: w.misses,
            lastQuestion: w.lastQuestion,
            lastPicked: w.lastPicked,
            lastCorrect: w.lastCorrect,
            lastExplanation: w.lastExplanation,
            masteryLevel: masteryLevel(w) ?? undefined,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.detail
            ? `${data.error || "Failed to generate personalized practice."} (${data.detail})`
            : data.error || "Failed to generate personalized practice."
        );
      const fresh = data.questions as PersonalizedQuestion[];
      setQuestions(fresh);
      setAnswers({});
      // Stored under the guide key, so the other guide view renders
      // this same set instead of asking to generate again.
      savePractice(guideKey, fresh, {});
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function pick(i: number, opt: string) {
    const q = questions?.[i];
    if (!q || answers[i]) return;
    const next = { ...answers, [i]: opt };
    setAnswers(next);
    // Persisted with the questions, so the other view shows this
    // question as answered — answering it twice must not count twice.
    savePractice(guideKey, questions ?? [], next);
    onAnswer({
      source: "personalized",
      moduleTitle:
        weak.find((w) => w.conceptTitle === q.conceptTitle)?.moduleTitle ??
        "",
      conceptTitle: q.conceptTitle,
      question: q.question,
      picked: opt,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      correct: opt === q.correctAnswer,
    });
  }

  return (
    <div className="card space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <Target className="h-5 w-5 text-brand-600" /> Practice your weak
            spots
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-400">
            Personalized practice for your copy of this guide — built from the
            questions you got wrong. A concept leaves this list once you
            answer it correctly twice in a row. Your errors are private to
            you: they never appear on published or shared copies.
          </p>
          {!signedIn && (
            <p className="mt-2 text-xs font-semibold text-amber-700">
              You are signed out, so your weak spots are only saved on this
              device. Sign in to keep them in your account.
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirmClear) {
              onClearErrors();
              clearPractice(guideKey);
              setQuestions(null);
              setAnswers({});
              setConfirmClear(false);
            } else {
              setConfirmClear(true);
            }
          }}
          className="btn-ghost inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {confirmClear ? "Tap again to confirm" : "Clear my errors for this guide"}
        </button>
      </div>

      {weak.length > 0 ? (
        <div className="space-y-2">
          {weak.map((w) => (
            <div
              key={w.conceptTitle}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-rose-100 bg-rose-50/70 px-3.5 py-2.5"
            >
              <div className="min-w-0">
                <p className="text-sm font-bold text-ink-900">
                  {w.conceptTitle}
                </p>
                {w.moduleTitle && (
                  <p className="text-xs font-medium text-ink-400">
                    {w.moduleTitle}
                  </p>
                )}
              </div>
              <span className="chip shrink-0">
                You missed {w.misses} question{w.misses === 1 ? "" : "s"} on
                this
                {w.correctStreak > 0
                  ? ` · ${w.correctStreak} correct in a row`
                  : ""}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-3">
          <Trophy className="h-5 w-5 shrink-0 text-amber-500" />
          <p className="text-sm font-semibold text-ink-800">
            All weak spots mastered — nice work! New mistakes will show up
            here.
          </p>
        </div>
      )}

      {mastered.length > 0 && weak.length > 0 && (
        <p className="text-xs font-medium text-ink-400">
          Mastered:{" "}
          {mastered.map((m) => m.conceptTitle).join(", ")}
        </p>
      )}

      {weak.length > 0 && (
        <div>
          <button
            type="button"
            onClick={generatePractice}
            disabled={loading}
            className="btn-primary px-5 py-2.5"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Building your
                practice…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" />{" "}
                {questions ? "Generate a new set" : "Generate practice for my weak spots"}
              </>
            )}
          </button>
          {error && <p className="feedback-wrong mt-3 font-medium">{error}</p>}
        </div>
      )}

      {questions && visibleCount > 0 && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-bold text-ink-900">
              Your personalized practice
            </p>
            {answeredCount > 0 && (
              <span className="chip">
                {correctCount} of {answeredCount} correct
              </span>
            )}
          </div>
          {questions.map((q, i) => {
            if (!weakTitles.has(q.conceptTitle)) return null;
            const picked = answers[i];
            return (
              <div
                key={i}
                className="rounded-2xl border border-ink-100 bg-white p-4 sm:p-5"
              >
                <p className="eyebrow">
                  {q.conceptTitle} · Question {i + 1}
                  {q.difficulty && (
                    <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-brand-700">
                      {q.difficulty}
                    </span>
                  )}
                </p>
                <p className="mt-1.5 text-base font-bold leading-relaxed text-ink-900">
                  {q.question}
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {q.options.map((opt) => {
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
                        onClick={() => pick(i, opt)}
                        disabled={!!picked}
                        className={`option-btn ${cls}`}
                      >
                        <span>{opt}</span>
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
                    {picked !== q.correctAnswer && (
                      <p className="mt-1 text-sm font-semibold text-ink-600">
                        <Crosshair className="mr-1 inline h-4 w-4" />
                        This concept stays on your weak list — try another
                        set once you have reviewed it.
                      </p>
                    )}
                    {picked === q.correctAnswer && (
                      <p className="mt-1 text-sm font-semibold text-emerald-700">
                        <Sparkles className="mr-1 inline h-4 w-4" />
                        Correct! Answer this concept correctly once more in a
                        row and it leaves your weak list.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {answeredCount === visibleCount && visibleCount > 0 && (
            <button
              type="button"
              onClick={generatePractice}
              disabled={loading}
              className="btn-secondary"
            >
              <RotateCcw className="h-4 w-4 text-brand-600" /> Practice again
              with a new set
            </button>
          )}
        </div>
      )}
    </div>
  );
}
