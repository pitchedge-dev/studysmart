"use client";

import { useState } from "react";
import { CheckCircle2, Sparkles, XCircle } from "lucide-react";

export type PracticeProblem = {
  type?: string;
  question: string;
  correctAnswer: string;
  options?: string[];
  explanation: string;
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
    translation?: string;
    category?: string;
    pronunciation?: string;
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
    correct: boolean
  ) {
    setAnswers((prev) => {
      const next = { ...prev, [key]: { picked, correct } };
      reportTotals(next);
      return next;
    });
  }

  if (groups.length === 0) return null;

  function submitShortAnswer(key: string, problem: PracticeProblem) {
    const typed = drafts[key] ?? "";
    if (!typed.trim()) return;
    recordAnswer(key, typed.trim(), normalize(typed) === normalize(problem.correctAnswer));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">Targeted practice</h2>
        <p className="text-sm text-slate-500">
          Three problems per concept. Wrong answers open the AI Tutor with a
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
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">{group.conceptTitle}</h3>
              <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
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
                  <div key={pi} className="border-t border-slate-100 pt-4 first:border-t-0 first:pt-0">
                    <p className="text-sm font-semibold text-slate-500">
                      Problem {pi + 1}
                      {problem.type ? ` · ${problem.type}` : ""}
                    </p>
                    <p className="mt-1 font-medium leading-relaxed">
                      {problem.question}
                    </p>

                    {problem.options && problem.options.length === 4 ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        {problem.options.map((opt) => {
                          const isCorrect = opt === problem.correctAnswer;
                          const isPicked = answer?.picked === opt;
                          let cls =
                            "border-slate-200 bg-white hover:border-brand-400";
                          if (answer) {
                            if (isCorrect)
                              cls = "border-green-500 bg-green-50 text-green-800";
                            else if (isPicked)
                              cls = "border-red-500 bg-red-50 text-red-800";
                            else
                              cls = "border-slate-200 bg-slate-50 text-slate-400";
                          }
                          return (
                            <button
                              key={opt}
                              type="button"
                              onClick={() =>
                                recordAnswer(key, opt, opt === problem.correctAnswer)
                              }
                              disabled={!!answer}
                              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${cls}`}
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
                            if (e.key === "Enter") submitShortAnswer(key, problem);
                          }}
                          disabled={!!answer}
                          placeholder="Type your answer…"
                          className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50"
                        />
                        <button
                          type="button"
                          onClick={() => submitShortAnswer(key, problem)}
                          disabled={!!answer || !(drafts[key] ?? "").trim()}
                          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          Check
                        </button>
                      </div>
                    )}

                    {answer && (
                      <div
                        className={`mt-3 rounded-lg p-3 text-sm ${
                          answer.correct
                            ? "bg-green-50 text-green-800"
                            : "bg-red-50 text-red-800"
                        }`}
                      >
                        <p className="font-semibold">
                          {answer.correct
                            ? "Correct!"
                            : `Not quite — the correct answer is: ${problem.correctAnswer}`}
                        </p>
                        <p className="mt-1">
                          <strong>Explanation:</strong> {problem.explanation}
                        </p>
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
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
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
