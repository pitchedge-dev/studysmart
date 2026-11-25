"use client";

/**
 * "Why the other options are wrong" — shown under an answered
 * multiple-choice question, next to the explanation of the right
 * answer. One line per wrong option: the option, and the mistake
 * behind it. Renders nothing when the question carries no usable
 * whyWrong entries (older guides predate the field).
 *
 * Every MCQ renderer in the app (checkpoints, targeted practice,
 * guide quiz, personalized practice, Review queue, pre-test) uses
 * this one component, so the teaching looks the same everywhere.
 */
export type WhyWrongEntryLike = {
  option: string;
  reason: string;
};

function norm(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export default function WhyWrongList({
  whyWrong,
  correctAnswer,
}: {
  whyWrong?: WhyWrongEntryLike[] | null;
  correctAnswer: string;
}) {
  if (!Array.isArray(whyWrong) || whyWrong.length === 0) return null;
  const entries = whyWrong.filter(
    (w) =>
      typeof w?.option === "string" &&
      w.option.trim().length > 0 &&
      typeof w?.reason === "string" &&
      w.reason.trim().length > 0 &&
      norm(w.option) !== norm(correctAnswer)
  );
  if (entries.length === 0) return null;
  return (
    <div className="mt-3">
      <p className="text-sm font-bold text-ink-900">
        Why the other options are wrong:
      </p>
      <ul className="mt-1.5 space-y-1.5">
        {entries.map((w, i) => (
          <li key={i} className="text-sm leading-relaxed text-ink-600">
            <span className="font-semibold text-ink-800">{w.option} — </span>
            {w.reason}
          </li>
        ))}
      </ul>
    </div>
  );
}
