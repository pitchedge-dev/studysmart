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
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <h3 className="font-semibold">Show your reasoning</h3>
      <p className="mt-2 font-medium leading-relaxed">{example.question}</p>
      <p className="mt-1 text-sm text-slate-500">
        Write the operation or evidence you used in your notebook before
        checking your work.
      </p>
      <textarea
        value={reasoning}
        onChange={(e) => setReasoning(e.target.value)}
        rows={3}
        placeholder="Write your reasoning here…"
        className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
      />
      {!checked ? (
        <button
          type="button"
          onClick={() => setChecked(true)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          <Lightbulb className="h-4 w-4" /> Check your work
        </button>
      ) : (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
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
