"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, MessageSquareHeart, Star, X } from "lucide-react";

export const FEEDBACK_STORAGE_KEY = "studysmart-feedback";

export type FeedbackEntry = {
  date: string;
  rating: number;
  text: string;
  topic?: string;
};

export function saveFeedback(entry: FeedbackEntry) {
  try {
    const raw = window.localStorage.getItem(FEEDBACK_STORAGE_KEY);
    const list: FeedbackEntry[] = raw ? JSON.parse(raw) : [];
    list.push(entry);
    window.localStorage.setItem(FEEDBACK_STORAGE_KEY, JSON.stringify(list));
  } catch {
    // localStorage unavailable (private mode, etc.) — feedback is
    // best-effort only; never block the user.
  }
}

const RATING_LABELS = [
  "",
  "Not great",
  "Okay",
  "Good",
  "Great",
  "Excellent",
];

export default function FeedbackModal({
  open,
  onClose,
  topic,
}: {
  open: boolean;
  onClose: () => void;
  topic?: string;
}) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [text, setText] = useState("");
  const [submitted, setSubmitted] = useState(false);

  // Reset the form each time the modal is opened.
  useEffect(() => {
    if (open) {
      setRating(0);
      setHovered(0);
      setText("");
      setSubmitted(false);
    }
  }, [open ]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const activeRating = hovered || rating;

  function submit() {
    if (rating < 1) return;
    saveFeedback({
      date: new Date().toISOString(),
      rating,
      text: text.trim(),
      topic: topic?.trim() ? topic.trim() : undefined,
    });
    setSubmitted(true);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Give feedback"
      onClick={onClose}
    >
      <div
        className="card animate-pop max-h-[90dvh] w-full max-w-md overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 w-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400" />
        <div className="p-6">
          {submitted ? (
            <div className="py-2 text-center">
              <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 className="h-7 w-7" />
              </span>
              <h3 className="mt-4 text-xl font-extrabold tracking-tight">
                Thank you!
              </h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-400">
                Your feedback was saved. It helps make StudySMART better for
                your next study session.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="btn-primary mt-5 w-full"
              >
                Back to studying
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
                  <MessageSquareHeart className="h-5 w-5" />
                </span>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close feedback"
                  className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <h3 className="mt-4 text-xl font-extrabold tracking-tight">
                What could we improve?
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-400">
                Rate your study guide and tell us what would make it better.
                {topic ? (
                  <>
                    {" "}
                    You&apos;re reviewing{" "}
                    <span className="font-semibold text-ink-700">{topic}</span>.
                  </>
                ) : null}
              </p>

              <div className="mt-5">
                <p className="eyebrow">Your rating</p>
                <div
                  className="mt-2 flex items-center gap-1.5"
                  role="radiogroup"
                  aria-label="Star rating out of 5"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={rating === n}
                      aria-label={`${n} star${n === 1 ? "" : "s"}`}
                      onClick={() => setRating(n)}
                      onMouseEnter={() => setHovered(n)}
                      onMouseLeave={() => setHovered(0)}
                      className="rounded-lg p-1 transition hover:scale-110 active:scale-95"
                    >
                      <Star
                        className={`h-8 w-8 transition ${
                          n <= activeRating
                            ? "fill-accent-400 text-accent-500"
                            : "fill-ink-100 text-ink-300"
                        }`}
                      />
                    </button>
                  ))}
                  {activeRating > 0 && (
                    <span className="ml-2 text-sm font-bold text-ink-700">
                      {RATING_LABELS[activeRating]}
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-5">
                <label
                  htmlFor="feedback-text"
                  className="eyebrow"
                >
                  Tell us more <span className="normal-case">(optional)</span>
                </label>
                <textarea
                  id="feedback-text"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  placeholder="What worked well? What was missing or confusing?"
                  className="input mt-2 resize-y leading-relaxed"
                />
              </div>

              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="btn-ghost flex-1 justify-center"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={rating < 1}
                  className="btn-primary flex-1"
                >
                  Submit feedback
                </button>
              </div>
              <p className="mt-3 text-center text-xs font-medium text-ink-400">
                Saved on this device only — nothing is sent anywhere.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
