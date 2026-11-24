"use client";

import type { ReactNode } from "react";

/**
 * Onboarding empty state (Notion pattern, without premade content):
 * headline saying what will live here + one line about the outcome +
 * one big primary button. Never ships sample content.
 */
export default function EmptyState({
  icon,
  headline,
  outcome,
  buttonLabel,
  onAction,
}: {
  icon: ReactNode;
  headline: string;
  outcome: string;
  buttonLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-brand-300 bg-white/70 p-6 text-center sm:p-8">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
        {icon}
      </span>
      <h3 className="mt-4 text-lg font-extrabold tracking-tight text-ink-900">
        {headline}
      </h3>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">
        {outcome}
      </p>
      <button
        type="button"
        onClick={onAction}
        className="btn-primary mx-auto mt-4 px-5 py-2.5"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
