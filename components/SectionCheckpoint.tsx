"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Trophy, XCircle } from "lucide-react";
import type { CheckpointQuestion } from "./TargetedPractice";

export default function SectionCheckpoint({
  moduleTitle,
  questions,
  onProgress,
  onFinish,
}: {
  moduleTitle: string;
  questions: CheckpointQuestion[];
  onProgress?: (answered: number, correct: number) => void;
  onFinish?: (score: number, total: number) => void;
}) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [finished, setFinished] = useState(false);
  const finishedReported = useRef(false);

  if (questions.length === 0) return null;

  const total = questions.length;
  const answeredCount = Object.keys(answers).length;
  const correctCount = questions.filter(
    (q, i) => answers[i] === q.correctAnswer
  ).length;
  const question = questions[current];
  const picked = answers[current];

  function pick(option: string) {
    if (picked) return;
    const next = { ...answers, [current]: option };
    setAnswers(next);
    const answered = Object.keys(next).length;
    const correct = questions.filter((q, i) => next[i] === q.correctAnswer).length;
    onProgress?.(answered, correct);
  }

  function next() {
    if (current + 1 >= total) {
      setFinished(true);
      if (!finishedReported.current) {
        finishedReported.current = true;
        onFinish?.(correctCount, total);
      }
    } else {
      setCurrent(current + 1);
    }
  }

  if (finished) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-center shadow-sm">
        <Trophy className="mx-auto h-10 w-10 text-amber-500" />
        <h3 className="mt-2 text-lg font-bold">Section checkpoint complete</h3>
        <p className="text-sm text-slate-500">{moduleTitle}</p>
        <p className="mt-2 text-lg font-semibold">
          {correctCount} of {total} correct
        </p>
        <button
          type="button"
          onClick={() => {
            setAnswers({});
            setCurrent(0);
            setFinished(false);
            finishedReported.current = false;
          }}
          className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Section checkpoint</h3>
        <span className="text-sm text-slate-500">
          {current + 1} / {total}
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {total}-question mastery quiz — finish this quiz to check whether the
        topic is sticking.
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-brand-500 transition-all"
          style={{ width: `${((current + 1) / total) * 100}%` }}
        />
      </div>
      <p className="mt-4 font-medium leading-relaxed">{question.question}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {question.options.map((opt) => {
          const isCorrect = opt === question.correctAnswer;
          const isPicked = opt === picked;
          let cls = "border-slate-200 bg-white hover:border-brand-400";
          if (picked) {
            if (isCorrect) cls = "border-green-500 bg-green-50 text-green-800";
            else if (isPicked) cls = "border-red-500 bg-red-50 text-red-800";
            else cls = "border-slate-200 bg-slate-50 text-slate-400";
          }
          return (
            <button
              key={opt}
              type="button"
              onClick={() => pick(opt)}
              disabled={!!picked}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${cls}`}
            >
              <span>{opt}</span>
              {picked && isCorrect && (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
              )}
              {picked && isPicked && !isCorrect && (
                <XCircle className="h-5 w-5 shrink-0 text-red-600" />
              )}
            </button>
          );
        })}
      </div>
      {picked && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
          <p>
            <strong>Why this answer works:</strong> {question.explanation}
          </p>
          <button
            type="button"
            onClick={next}
            className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {current + 1 >= total ? "See Results" : "Next Question"}
          </button>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-400">
        {answeredCount} answered · {correctCount} correct so far
      </p>
    </div>
  );
}
