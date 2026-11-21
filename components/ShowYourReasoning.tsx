"use client";

import { useState } from "react";
import { Lightbulb } from "lucide-react";
import type { ReasoningExample } from "./TargetedPractice";

export default function ShowYourReasoning({
  example,
}: {
  example: ReasoningExample;
}) {
  const [reasoning, setReasoning] = useState("");
  const [checked, setChecked] = useState(false);

  return (
    <div className="card p-5 sm:p-6">
      <h3 className="text-base font-extrabold tracking-tight">Show your reasoning</h3>
      <p className="mt-2 text-base font-bold leading-relaxed text-ink-900">{example.question}</p>
      <p className="mt-1 text-sm leading-relaxed text-ink-400">
        Write the operation or evidence you used in your notebook before
        checking your work.
      </p>
      <textarea
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        rows={3}
        placeholder="Write your reasoning here…"
        className="input mt-3"
      />
      {!checked ? (
        <button
          type="button"
          onClick={() => setChecked(true)}
          className="btn-primary mt-3"
        >
          <Lightbulb className="h-4 w-4" /> Check your work
        </button>
      ) : (
        <div className="feedback-neutral mt-4">
          <p>
            <strong>Solution:</strong> {example.solution}
          </p>
          <p className="mt-1">
            <strong>Why it works:</strong> {example.explanation}
          </p>
        </div>
      )}
    </div>
  );
}
