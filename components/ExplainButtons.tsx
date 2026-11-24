"use client";

import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";

/**
 * Per-concept "Explain simpler / deeper" buttons (ChatGPT Study Mode
 * pattern). Each button asks the floating tutor for a simpler or deeper
 * explanation of that one concept, using the existing tutor panel — one
 * small Gemini call each, grounded in the guide.
 */
export default function ExplainButtons({
  conceptTitle,
  definition,
  onExplain,
}: {
  conceptTitle: string;
  definition: string;
  onExplain: (level: "simpler" | "deeper", conceptTitle: string, definition: string) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => onExplain("simpler", conceptTitle, definition)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
      >
        <ArrowDownWideNarrow className="h-3.5 w-3.5" /> Explain simpler
      </button>
      <button
        type="button"
        onClick={() => onExplain("deeper", conceptTitle, definition)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
      >
        <ArrowUpNarrowWide className="h-3.5 w-3.5" /> Go deeper
      </button>
    </div>
  );
}
