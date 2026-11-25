"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Trophy, XCircle } from "lucide-react";
import type { CheckpointQuestion } from "./TargetedPractice";
import type { ErrorAnswerInput } from "@/lib/errorTracking";
import WhyWrongList from "./WhyWrongList";

export default function SectionCheckpoint({
  moduleTitle,
  questions,
  onProgress,
  onFinish,
  onAnswer,
}: {
  moduleTitle: string;
  questions: CheckpointQuestion[];
  onProgress?: (answered: number, correct: number) => void;
  onFinish?: (score: number, total: number) => void;
  /** Fired for every answered question, so the guide can track errors per
   *  user per guide and build personalized practice from them. */
  onAnswer?: (answer: ErrorAnswerInput) => void;
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
    onAnswer?.({
      source: "checkpoint",
      moduleTitle,
      conceptTitle: moduleTitle,
      question: question.question,
      picked: option,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
      correct: option === question.correctAnswer,
    });
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
      <div className="card p-6 text-center">
        <Trophy className="mx-auto h-10 w-10 text-amber-500" />
        <h3 className="mt-2 text-lg font-bold">Section checkpoint complete</h3>
        <p className="text-sm font-medium text-ink-400">{moduleTitle}</p>
        <p className="mt-2 text-xl font-extrabold tracking-tight">
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
          className="btn-primary mt-4"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-extrabold tracking-tight">Section checkpoint</h3>
        <span className="chip">
          {current + 1} / {total}
        </span>
      </div>
      <p className="mt-1 text-sm leading-relaxed text-ink-400">
        {total}-question mastery quiz — finish this quiz to check whether the
        topic is sticking.
      </p>
      <div className="progress-track mt-3">
        <div
          className="progress-fill"
          style={{ width: `${((current + 1) / total) * 100}%` }}
        />
      </div>
      <p className="mt-4 text-base font-bold leading-relaxed text-ink-900">{question.question}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {question.options.map((opt) => {
          const isCorrect = opt === question.correctAnswer;
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
        <div className="feedback-neutral mt-4">
          <p>
            <strong>Why this answer works:</strong> {question.explanation}
          </p>
          <WhyWrongList
            whyWrong={question.whyWrong}
            correctAnswer={question.correctAnswer}
          />
          <button
            type="button"
            onClick={next}
            className="btn-primary mt-4"
          >
            {current + 1 >= total ? "See Results" : "Next Question"}
          </button>
        </div>
      )}
      <p className="mt-3 text-xs font-medium text-ink-400">
        {answeredCount} answered · {correctCount} correct so far
      </p>
    </div>
  );
}
