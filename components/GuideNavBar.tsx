"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export type GuideNavSection = {
  id: string;
  label: string;
  /** Short label shown in the bar (e.g. "Module 1", "Videos"). Defaults to label. */
  shortLabel?: string;
};

/**
 * Sticky nav bar that lives inside every study guide, just under the
 * site header. It is the guide's own table of contents in one row:
 * a way back to Your Study Guides, the guide title, links that jump to
 * the guide's real sections (only the sections that guide actually
 * has — the list is built by the caller from the guide data), the
 * section currently on screen highlighted, and a reading-progress
 * indicator. On mobile the links scroll horizontally — nothing
 * overflows. Styling reuses the shared `.card` class and the
 * ink/brand utilities, so it follows light + dark mode and all 5 site
 * styles with no extra work.
 *
 * `stickyTopClass` is the distance from the top of the viewport when
 * stuck: "top-16" (64px) under the /guide/[id] header, "top-[72px]"
 * under the home page header. The caller passes the right one.
 */
export default function GuideNavBar({
  title,
  backHref,
  onBack,
  sections,
  activeSection,
  progress,
  onNavigate,
  stickyTopClass = "top-16",
}: {
  title: string;
  backHref?: string;
  /** When provided, the back control is a button calling this instead of a link — used by views where "back" means switching a tab, not a route. */
  onBack?: () => void;
  sections: GuideNavSection[];
  activeSection: string;
  /** Reading progress, 0–100. */
  progress: number;
  onNavigate: (id: string) => void;
  stickyTopClass?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)));
  return (
    <nav
      aria-label="Guide navigation"
      className={`card sticky ${stickyTopClass} z-30 flex items-center gap-2 px-2 py-2 sm:px-3`}
    >
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          title="Back to Your Study Guides"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-sm font-bold text-ink-600 transition hover:bg-ink-100/70 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Guides</span>
        </button>
      ) : (
        <Link
          href={backHref ?? "/"}
          title="Back to Your Study Guides"
          className="inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-2 text-sm font-bold text-ink-600 transition hover:bg-ink-100/70 hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Guides</span>
        </Link>
      )}

      <span
        className="hidden h-5 w-px shrink-0 bg-ink-100 md:block"
        aria-hidden
      />
      <span
        className="hidden min-w-0 max-w-44 shrink-0 truncate text-sm font-bold text-ink-900 md:block"
        title={title}
      >
        {title}
      </span>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto whitespace-nowrap [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {sections.map((s) => {
          const active = activeSection === s.id;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onNavigate(s.id)}
              title={s.label}
              aria-current={active ? "true" : undefined}
              className={`shrink-0 rounded-lg px-2.5 py-2 text-sm transition ${
                active
                  ? "bg-brand-50 font-bold text-brand-700"
                  : "font-medium text-ink-600 hover:bg-ink-100/70 hover:text-ink-900"
              }`}
            >
              {s.shortLabel ?? s.label}
            </button>
          );
        })}
      </div>

      <span
        className="hidden shrink-0 items-center gap-1.5 sm:flex"
        title={`${pct}% read`}
        aria-label={`${pct}% read`}
      >
        <span className="relative inline-flex h-7 w-7 items-center justify-center">
          <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden>
            <circle
              cx="14"
              cy="14"
              r="11"
              fill="none"
              strokeWidth="3.5"
              className="stroke-ink-100 dark:stroke-ink-700"
            />
            <circle
              cx="14"
              cy="14"
              r="11"
              fill="none"
              style={{ stroke: "rgb(var(--brand-500))" }}
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 11}
              strokeDashoffset={2 * Math.PI * 11 * (1 - pct / 100)}
              transform="rotate(-90 14 14)"
            />
          </svg>
          <span className="absolute text-[8px] font-extrabold text-ink-900">
            {pct}
          </span>
        </span>
      </span>
    </nav>
  );
}
