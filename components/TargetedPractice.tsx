"use client";

import { useState } from "react";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";
import type { ErrorAnswerInput } from "@/lib/errorTracking";
import WhyWrongList, { type WhyWrongEntryLike } from "./WhyWrongList";

export type PracticeProblem = {
  type?: string;
  question: string;
  correctAnswer: string;
  options?: string[];
  explanation: string;
  /** One entry per wrong option, saying why it is wrong. */
  whyWrong?: WhyWrongEntryLike[];
};

export type PracticeGroup = {
  conceptTitle: string;
  problems: PracticeProblem[];
};

export type ReasoningExample = {
  question: string;
  solution: string;
  explanation: string;
};

export type CheckpointQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  /** One entry per wrong option, saying why it is wrong. */
  whyWrong?: WhyWrongEntryLike[];
};

export type StudyModule = {
  moduleNumber: number;
  title: string;
  intro: string;
  format?: string;
  concepts: {
    kind?: string;
    label: string;
    title: string;
    formulaOrDefinition: string;
    example: string;
    /** Step-by-step worked example with real numbers or a concrete case. */
    workedExample?: {
      problem: string;
      steps: string[];
      answer: string;
    };
    translation?: string;
    category?: string;
    pronunciation?: string;
    tip?: string;
    /** Full plain-language explanation of how the concept works. */
    explanation?: string;
    /** The most common mistake with this concept and how to avoid it. */
    commonMistake?: string;
    /** Short memory aid for this concept. */
    memoryTip?: string;
  }[];
  coreIdeas?: string[];
  reasoningExample?: ReasoningExample;
  checkpoint?: { questions: CheckpointQuestion[] };
  practice: PracticeGroup[];
};

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/, "");
}

export default function TargetedPractice({
  modules,
  onAskTutor,
  onProgress,
  onAnswer,
}: {
  modules: StudyModule[];
  onAskTutor: (args: {
    question: string;
    picked: string;
    correctAnswer: string;
    explanation: string;
    conceptTitle: string;
  }) => void;
  onProgress?: (answered: number, correct: number) => void;
  /** Fired for every answered problem, so the guide can track errors per
   *  user per guide and build personalized practice from them. */
  onAnswer?: (answer: ErrorAnswerInput) => void;
}) {
  // key: `${moduleIdx}-${groupIdx}-${problemIdx}` -> { picked, correct }
  const [answers, setAnswers] = useState<
    Record<string, { picked: string; correct: boolean }>
  >({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const groups = modules.flatMap((m, mi) =>
    m.practice.map((g, gi) => ({ group: g, moduleIdx: mi, groupIdx: gi }))
  );

  function reportTotals(
    next: Record<string, { picked: string; correct: boolean }>
  ) {
    if (!onProgress) return;
    let answered = 0;
    let correct = 0;
    for (const { group, moduleIdx, groupIdx } of groups) {
      group.problems.forEach((_, pi) => {
        const a = next[`${moduleIdx}-${groupIdx}-${pi}`];
        if (a) {
          answered += 1;
          if (a.correct) correct += 1;
        }
      });
    }
    onProgress(answered, correct);
  }

  function recordAnswer(
    key: string,
    picked: string,
    correct: boolean,
    problem?: PracticeProblem,
    group?: PracticeGroup,
    moduleTitle?: string
  ) {
    setAnswers((prev) => {
      const next = { ...prev, [key]: { picked, correct } };
      reportTotals(next);
      return next;
    });
    if (problem && group) {
      onAnswer?.({
        source: "practice",
        moduleTitle: moduleTitle ?? "",
        conceptTitle: group.conceptTitle,
        question: problem.question,
        picked,
        correctAnswer: problem.correctAnswer,
        explanation: problem.explanation,
        correct,
      });
    }
  }

  if (groups.length === 0) return null;

  function submitShortAnswer(
    key: string,
    problem: PracticeProblem,
    group?: PracticeGroup,
    moduleTitle?: string
  ) {
    const typed = drafts[key] ?? "";
    if (!typed.trim()) return;
    recordAnswer(
      key,
      typed.trim(),
      normalize(typed) === normalize(problem.correctAnswer),
      problem,
      group,
      moduleTitle
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-extrabold tracking-tight">Targeted practice</h2>
        <p className="mt-1 text-sm leading-relaxed text-ink-400">
          Practice problems per concept. Wrong answers open the AI Tutor with a
          step-by-step breakdown.
        </p>
      </div>

      {groups.map(({ group, moduleIdx, groupIdx }) => {
        const correctCount = group.problems.filter((p, pi) => {
          const a = answers[`${moduleIdx}-${groupIdx}-${pi}`];
          return a?.correct;
        }).length;
        const answeredCount = group.problems.filter(
          (_, pi) => answers[`${moduleIdx}-${groupIdx}-${pi}`]
        ).length;
        return (
          <div
            key={`${moduleIdx}-${groupIdx}`}
            className="card card-hover p-5 sm:p-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{group.conceptTitle}</h3>
              <span className="chip">
                {correctCount} of {group.problems.length} correct
                {answeredCount > 0 && answeredCount < group.problems.length
                  ? ` · ${answeredCount} answered`
                  : ""}
              </span>
            </div>

            <div className="mt-4 space-y-5">
              {group.problems.map((problem, pi) => {
                const key = `${moduleIdx}-${groupIdx}-${pi}`;
                const answer = answers[key];
                return (
                  <div key={pi} className="border-t border-ink-100 pt-5 first:border-t-0 first:pt-0">
                    <p className="eyebrow">
                      Problem {pi + 1}
                      {problem.type ? ` · ${problem.type}` : ""}
                    </p>
                    <p className="mt-1.5 text-base font-bold leading-relaxed text-ink-900">
                      {problem.question}
                    </p>

                    {problem.options && problem.options.length === 4 ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {problem.options.map((opt) => {
                          const isCorrect = opt === problem.correctAnswer;
                          const isPicked = answer?.picked === opt;
                          let cls =
                            "";
                          if (answer) {
                            if (isCorrect)
                              cls = "option-correct";
                            else if (isPicked)
                              cls = "option-wrong";
                            else
                              cls = "option-dimmed";
                          }
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                recordAnswer(
                                  key,
                                  opt,
                                  opt === problem.correctAnswer,
                                  problem,
                                  group,
                                  modules[moduleIdx]?.title
                                )
                              }
                              disabled={!!answer}
                              className={`option-btn ${cls}`}
                            >
                              <span>{opt}</span>
                              {answer && isCorrect && (
                                <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                              )}
                              {answer && isPicked && !isCorrect && (
                                <XCircle className="h-5 w-5 shrink-0 text-red-600" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={drafts[key] ?? ""}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              submitShortAnswer(key, problem, group, modules[moduleIdx]?.title);
                          }}
                          disabled={!!answer}
                          placeholder="Type your answer…"
                          className="input min-w-0 flex-1 disabled:bg-ink-50"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            submitShortAnswer(key, problem, group, modules[moduleIdx]?.title)
                          }
                          disabled={!!answer || !(drafts[key] ?? "").trim()}
                          className="btn-primary"
                        >
                          Check
                        </button>
                      </div>
                    )}

                    {answer && (
                      <div
                        className={`mt-3 ${answer.correct ? "feedback-correct" : "feedback-wrong"}`}
                      >
                        <p className="font-semibold">
                          {answer.correct
                            ? "Correct!"
                            : `Not quite — the correct answer is: ${problem.correctAnswer}`}
                        </p>
                        <p className="mt-1">
                          <strong>Explanation:</strong> {problem.explanation}
                        </p>
                        <WhyWrongList
                          whyWrong={problem.whyWrong}
                          correctAnswer={problem.correctAnswer}
                        />
                        {!answer.correct && (
                          <button
                            type="button"
                            onClick={() =>
                              onAskTutor({
                                question: problem.question,
                                picked: answer.picked,
                                correctAnswer: problem.correctAnswer,
                                explanation: problem.explanation,
                                conceptTitle: group.conceptTitle,
                              })
                            }
                            className="btn-secondary mt-3 px-3 py-1.5"
                          >
                            <Sparkles className="h-4 w-4 text-brand-600" />
                            Ask AI Tutor
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
