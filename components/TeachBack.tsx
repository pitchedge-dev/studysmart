"use client";

import { useState } from "react";
import {
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Loader2,
  MessageCircleQuestion,
  RotateCcw,
  Sparkles,
  XCircle,
} from "lucide-react";

/**
 * "Teach it back" (Feynman / self-explanation pattern).
 *
 * The student closes their notes and explains one concept in their own
 * words, as if teaching a beginner. The AI grades the explanation
 * against the guide's OWN definition — score /10, key points covered,
 * what's missing, misconceptions, and one follow-up question. Writing
 * the explanation is retrieval practice; the gaps it exposes are the
 * point (Rozenblit & Keil's "illusion of explanatory depth").
 *
 * A strong explanation (8+/10) counts as a correct answer for the
 * concept (feeds mastery + the Review queue); a weak one (<=4) counts
 * as a miss, so the concept comes back for review tomorrow.
 */

export type TeachBackResult = {
  score: number;
  keyPointsCovered: string[];
  missingPoints: string[];
  misconceptions: string[];
  feedback: string;
  followUpQuestion: string;
};

export default function TeachBack({
  conceptTitle,
  definition,
  explanation,
  educationLevel,
  onAnswer,
}: {
  conceptTitle: string;
  definition: string;
  explanation?: string;
  educationLevel?: string;
  /** Called once per grading with whether the explanation was strong. */
  onAnswer: (strong: boolean, result: TeachBackResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TeachBackResult | null>(null);
  const [graded, setGraded] = useState(false);

  async function grade() {
    if (text.trim().length < 10 || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/teach-back", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conceptTitle,
          definition,
          explanation: explanation ?? "",
          studentExplanation: text,
          educationLevel: educationLevel ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(data.error || "Could not grade your explanation.");
      const r = data.result as TeachBackResult;
      setResult(r);
      if (!graded) {
        setGraded(true);
        onAnswer(r.score >= 8, r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setText("");
    setResult(null);
    setError(null);
    setGraded(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
      >
        <GraduationCap className="h-3.5 w-3.5" /> Teach it back
      </button>
    );
  }

  const scoreColor =
    !result
      ? ""
      : result.score >= 8
        ? "bg-emerald-500"
        : result.score >= 5
          ? "bg-amber-500"
          : "bg-rose-500";

  return (
    <div className="mt-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-extrabold tracking-tight text-ink-900">
            <GraduationCap className="h-4 w-4 text-brand-600" /> Teach it
            back — {conceptTitle}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-ink-400">
            Close your notes. Explain this in your own words, as if teaching
            someone who has never seen it. Where you get stuck is exactly
            what you need to relearn.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-full px-2 py-1 text-xs font-bold text-ink-400 hover:bg-ink-100"
        >
          Hide
        </button>
      </div>

      {!result && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            placeholder="Explain it simply, in your own words — no peeking at the guide above…"
            className="input mt-3 w-full resize-y"
          />
          {error && <p className="feedback-wrong mt-2 font-medium">{error}</p>}
          <button
            type="button"
            onClick={grade}
            disabled={loading || text.trim().length < 10}
            className="btn-primary mt-3"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Grading your
                explanation…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" /> Check my explanation
              </>
            )}
          </button>
        </>
      )}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-lg font-extrabold text-white ${scoreColor}`}
            >
              {result.score}/10
            </span>
            <p className="text-sm leading-relaxed text-ink-600">
              {result.feedback}
            </p>
          </div>

          {result.keyPointsCovered.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-emerald-600">
                <CheckCircle2 className="h-3.5 w-3.5" /> You covered
              </p>
              <ul className="mt-1 space-y-1">
                {result.keyPointsCovered.map((p, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-600">
                    • {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.missingPoints.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-amber-600">
                <BookOpen className="h-3.5 w-3.5" /> Missing — go back and learn
                these
              </p>
              <ul className="mt-1 space-y-1">
                {result.missingPoints.map((p, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-600">
                    • {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.misconceptions.length > 0 && (
            <div>
              <p className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wide text-rose-600">
                <XCircle className="h-3.5 w-3.5" /> Not quite right
              </p>
              <ul className="mt-1 space-y-1">
                {result.misconceptions.map((p, i) => (
                  <li key={i} className="text-sm leading-relaxed text-ink-600">
                    • {p}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.followUpQuestion && (
            <p className="flex items-start gap-1.5 rounded-xl bg-brand-50/70 px-3 py-2 text-sm leading-relaxed text-ink-600 ring-1 ring-inset ring-brand-100">
              <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <span>
                <strong>Try this:</strong> {result.followUpQuestion}
              </span>
            </p>
          )}

          <button
            type="button"
            onClick={reset}
            className="btn-secondary"
          >
            <RotateCcw className="h-4 w-4" /> Explain it again
          </button>
        </div>
      )}
    </div>
  );
}
