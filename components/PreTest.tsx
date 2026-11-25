"use client";

import { useMemo, useState } from "react";
import {
  CheckCircle2,
  FlaskConical,
  RotateCcw,
  TrendingUp,
  XCircle,
} from "lucide-react";
import type {
  CheckpointQuestion,
  StudyModule,
} from "@/components/TargetedPractice";
import {
  extractDiagnosticQuestions,
  loadPreTest,
  savePreTest,
  type DiagnosticQuestion,
  type PreTestState,
} from "@/lib/pretest";
import WhyWrongList from "./WhyWrongList";

/**
 * "Test yourself first" — a short diagnostic before studying.
 *
 * Research (Richland, Kornell & Kao 2009): trying to answer questions
 * BEFORE reading makes the later reading stick better — even when the
 * first guesses are wrong. So this card asks 3 questions from the
 * guide itself, before the student studies it, and lets them retake
 * the same 3 afterwards to see their own improvement. Guessing is
 * fine and expected; nothing here counts as a mistake, earns XP, or
 * touches the error records.
 */
export default function PreTest({
  guideKey,
  modules,
  finalReviewQuestions,
}: {
  guideKey: string | null;
  modules: StudyModule[];
  finalReviewQuestions?: CheckpointQuestion[];
}) {
  const { questions } = useMemo(
    () => extractDiagnosticQuestions(modules, finalReviewQuestions, 3),
    [modules, finalReviewQuestions]
  );
  const [saved, setSaved] = useState<PreTestState>(() =>
    loadPreTest(guideKey)
  );
  const [phase, setPhase] = useState<"intro" | "asking" | "done">(
    saved.pre ? "done" : "intro"
  );
  const [round, setRound] = useState<"pre" | "post">("pre");
  const [current, setCurrent] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [correctCount, setCorrectCount] = useState(0);

  if (questions.length === 0) return null;
  const total = questions.length;
  const q: DiagnosticQuestion | undefined = questions[current];

  function start(nextRound: "pre" | "post") {
    setRound(nextRound);
    setCurrent(0);
    setPicked(null);
    setCorrectCount(0);
    setPhase("asking");
  }

  function pick(opt: string) {
    if (!q || picked) return;
    setPicked(opt);
    if (opt === q.correctAnswer) setCorrectCount((c) => c + 1);
  }

  function next() {
    if (!q) return;
    if (current + 1 >= total) {
      const result = {
        score: correctCount,
        total,
        at: new Date().toISOString(),
      };
      const nextSaved: PreTestState =
        round === "pre"
          ? { ...saved, pre: result }
          : { ...saved, post: result };
      setSaved(nextSaved);
      savePreTest(guideKey, nextSaved);
      setPhase("done");
    } else {
      setCurrent((c) => c + 1);
      setPicked(null);
    }
  }

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-extrabold tracking-tight">
            <FlaskConical className="h-5 w-5 text-brand-600" /> Test yourself
            first
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-ink-400">
            {total} quick questions from this guide — before you study it.
            Guessing is completely fine: trying first helps you learn more,
            even when the guess is wrong. No XP, no penalty, and wrong
            guesses never land in your weak spots.
          </p>
        </div>
        {saved.pre && saved.post && (
          <span className="chip-amber">
            <TrendingUp className="h-3.5 w-3.5" /> Before {saved.pre.score}/
            {saved.pre.total} → After {saved.post.score}/{saved.post.total}
          </span>
        )}
      </div>

      {phase === "intro" && (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => start("pre")}
            className="btn-primary px-5 py-2.5"
          >
            <FlaskConical className="h-4 w-4" /> Try the {total} questions
          </button>
          <p className="mt-2 text-xs font-medium text-ink-400">
            Research: students who tried questions before reading remembered
            more afterwards (Richland, Kornell &amp; Kao, 2009).
          </p>
        </div>
      )}

      {phase === "asking" && q && (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <span className="chip">
              {round === "pre" ? "Before studying" : "After studying"} ·{" "}
              Question {current + 1} of {total} · {q.conceptTitle}
            </span>
            <span className="text-xs font-semibold text-ink-400">
              {correctCount} correct so far
            </span>
          </div>
          <p className="mt-3 text-base font-bold leading-relaxed text-ink-900">
            {q.question}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                  onClick={() => pick(opt)}
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
                <strong>Answer:</strong> {q.correctAnswer}
                {q.explanation ? ` — ${q.explanation}` : ""}
              </p>
              <WhyWrongList
                whyWrong={q.whyWrong}
                correctAnswer={q.correctAnswer}
              />
              <button
                type="button"
                onClick={next}
                className="btn-primary mt-3"
              >
                {current + 1 >= total ? "See my score" : "Next question"}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "done" && saved.pre && (
        <div className="mt-4 space-y-3">
          <div className="rounded-2xl border border-ink-100 bg-white p-4 text-center shadow-sm">
            <p className="text-lg font-extrabold tracking-tight">
              Before studying: {saved.pre.score} of {saved.pre.total} correct
            </p>
            {saved.post ? (
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                After studying: {saved.post.score} of {saved.post.total}{" "}
                correct
                {saved.post.score > saved.pre.score
                  ? ` — up ${saved.post.score - saved.pre.score}. That is the pretest working: trying first made the reading stick.`
                  : saved.post.score === saved.pre.score
                    ? " — same as before. The guide's practice sections are the fastest way to close the gap."
                    : " — lower than before. Worth another pass through the modules you missed."}
              </p>
            ) : (
              <p className="mt-1 text-sm leading-relaxed text-ink-500">
                Study the guide, then retake the same {total} questions to
                see how much you improved.
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => start("post")}
              className="btn-secondary justify-center"
            >
              <RotateCcw className="h-4 w-4" />{" "}
              {saved.post ? "Retake again" : "Retake after studying"}
            </button>
            {saved.post && (
              <button
                type="button"
                onClick={() => start("pre")}
                className="btn-ghost justify-center"
              >
                Start over
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
