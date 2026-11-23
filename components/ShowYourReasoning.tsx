"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Lightbulb,
  Loader2,
  RotateCcw,
  XCircle,
} from "lucide-react";
import type { ReasoningExample } from "./TargetedPractice";
import type { ErrorAnswerInput } from "@/lib/errorTracking";
import ReasoningCanvas from "./ReasoningCanvas";

export type ReasoningCheck = {
  readable: boolean;
  transcription: string;
  /** Score out of 10, reflecting BOTH the final answer (the work) and the
   *  reasoning steps shown (the process). */
  score: number;
  pros: string[];
  cons: string[];
  hint: string;
};

function verdictFor(score: number): "correct" | "partial" | "incorrect" {
  if (score >= 9) return "correct";
  if (score >= 5) return "partial";
  return "incorrect";
}

/**
 * Show Your Reasoning — handwritten answers only.
 *
 * The student writes their reasoning by hand on the canvas (stylus /
 * Apple Pencil on iPad, finger or mouse elsewhere) and the AI reads the
 * handwriting and grades it. The feedback scores BOTH the work (is the
 * final answer right?) and the process (are the steps logical, in the
 * right order, complete, with the working shown?) — a score out of 10,
 * plus pros, cons, and a hint for the next try. Wrong or incomplete
 * reasoning is recorded in this user's personal error tracking for this
 * guide copy (via onAnswer); a fully correct answer counts toward
 * mastering the concept. Nothing here is shared with published or
 * shared copies of the guide.
 */
export default function ShowYourReasoning({
  example,
  moduleTitle,
  conceptTitle,
  onAnswer,
}: {
  example: ReasoningExample;
  moduleTitle: string;
  conceptTitle?: string;
  /** Fired once per AI check, so the guide can track this user's errors. */
  onAnswer?: (answer: ErrorAnswerInput) => void;
}) {
  const [checking, setChecking] = useState(false);
  const [feedback, setFeedback] = useState<ReasoningCheck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [showSolution, setShowSolution] = useState(false);

  async function checkHandwriting(imageDataUrl: string) {
    setError(null);
    setChecking(true);
    try {
      const res = await fetch("/api/check-reasoning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: imageDataUrl,
          question: example.question,
          solution: example.solution,
          explanation: example.explanation,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data.detail
            ? `${data.error || "The reasoning could not be checked."} (${data.detail})`
            : data.error || "The reasoning could not be checked."
        );
      }
      const check = data as ReasoningCheck;
      setFeedback(check);
      // Only a readable check counts toward error tracking. Unreadable
      // handwriting is never graded and never recorded as an error.
      if (check.readable && onAnswer) {
        const verdict = verdictFor(check.score);
        onAnswer({
          source: "reasoning",
          moduleTitle,
          conceptTitle: conceptTitle ?? moduleTitle,
          question: example.question,
          picked: check.transcription || "(handwritten reasoning)",
          correctAnswer: example.solution,
          explanation: `${example.explanation} Hint for next time: ${check.hint}`,
          correct: verdict === "correct",
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setChecking(false);
    }
  }

  function tryAgain() {
    setFeedback(null);
    setError(null);
    setShowSolution(false);
    setResetKey((k) => k + 1);
  }

  const verdict = feedback && feedback.readable ? verdictFor(feedback.score) : null;

  return (
    <div className="card p-5 sm:p-6">
      <h3 className="text-base font-extrabold tracking-tight">Show your reasoning</h3>
      <p className="mt-2 text-base font-bold leading-relaxed text-ink-900">{example.question}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-400">
        Work it out by hand — show your steps, not just the answer. The AI
        checks both your final answer and the working you show.
      </p>

      <div className="mt-4">
        <ReasoningCanvas
          onSubmit={checkHandwriting}
          disabled={checking}
          resetKey={resetKey}
        />
      </div>

      {checking && (
        <p className="mt-3 flex items-center gap-2 text-sm font-medium text-ink-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Reading your handwriting…
        </p>
      )}

      {error && (
        <div className="feedback-error mt-4">
          <p>{error}</p>
        </div>
      )}

      {feedback && !feedback.readable && (
        <div className="feedback-neutral mt-4">
          <p className="font-bold">I couldn&apos;t read your handwriting.</p>
          <p className="mt-1">
            {feedback.hint ||
              "Write a little bigger and clearer, and try again — I won't guess at what you wrote."}
          </p>
          <button type="button" onClick={tryAgain} className="btn-secondary mt-3">
            <RotateCcw className="h-4 w-4" /> Try again
          </button>
        </div>
      )}

      {feedback && feedback.readable && verdict && (
        <div className="mt-4 space-y-4">
          <div
            className={`flex flex-wrap items-center gap-3 rounded-xl border p-4 ${
              verdict === "correct"
                ? "border-emerald-200 bg-emerald-50"
                : verdict === "partial"
                  ? "border-amber-200 bg-amber-50"
                  : "border-rose-200 bg-rose-50"
            }`}
          >
            <span className="text-3xl font-extrabold tracking-tight text-ink-900">
              {feedback.score}
              <span className="text-lg text-ink-400">/10</span>
            </span>
            <div>
              <p className="text-sm font-extrabold tracking-tight text-ink-900">
                {verdict === "correct"
                  ? "Correct — solid work and solid reasoning"
                  : verdict === "partial"
                    ? "Partly right — good start, but something's missing"
                    : "Not there yet — check the cons below and try again"}
              </p>
              <p className="text-xs font-medium text-ink-400">
                Scored on both your final answer and the steps you showed.
              </p>
            </div>
          </div>

          {feedback.transcription && (
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wide text-ink-400">
                What I read from your handwriting
              </p>
              <p className="mt-1 rounded-lg bg-ink-50 px-3 py-2 text-sm leading-relaxed text-ink-700">
                &ldquo;{feedback.transcription}&rdquo;
              </p>
            </div>
          )}

          {feedback.pros.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight text-ink-900">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" /> Pros — what you did well
              </p>
              <ul className="mt-2 space-y-1.5">
                {feedback.pros.map((pro, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-600">
                    <span className="text-emerald-600">•</span> {pro}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feedback.cons.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight text-ink-900">
                <XCircle className="h-4 w-4 text-rose-500" /> Cons — what was wrong or missing
              </p>
              <ul className="mt-2 space-y-1.5">
                {feedback.cons.map((con, i) => (
                  <li key={i} className="flex gap-2 text-sm leading-relaxed text-ink-600">
                    <span className="text-rose-500">•</span> {con}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {feedback.hint && (
            <div className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-ink-700">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                <strong>Hint for next time:</strong> {feedback.hint}
              </span>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={tryAgain} className="btn-secondary">
              <RotateCcw className="h-4 w-4" /> Try again
            </button>
            {!showSolution && (
              <button
                type="button"
                onClick={() => setShowSolution(true)}
                className="btn-ghost"
              >
                <Lightbulb className="h-4 w-4" /> See the worked solution
              </button>
            )}
          </div>

          {showSolution && (
            <div className="feedback-neutral">
              <p>
                <strong>Solution:</strong> {example.solution}
              </p>
              <p className="mt-1">
                <strong>Why it works:</strong> {example.explanation}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
