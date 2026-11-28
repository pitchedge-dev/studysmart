"use client";

import { useEffect, useRef } from "react";
import { Check, Clock3, Loader2, X } from "lucide-react";

/**
 * "Generating" popup — shown while a study guide is being built, so the
 * 17–38 second wait is explained instead of a bare spinner. It states
 * the complex process in plain words and apologises for the wait — the
 * user asked for both, so both are front and centre, not buried.
 *
 * Honesty rules for this popup (do not weaken them):
 * - The stages advance ONLY on real milestones the frontend knows:
 *   the /api/generate request is in flight, the response arrived, the
 *   background enrich pass started. The API does not stream which
 *   provider is being tried, so the popup never names a live provider
 *   and never claims per-provider progress.
 * - "Sending the topic" and "trying AI providers" are ONE stage
 *   ("providers"): the frontend cannot distinguish them — the topic is
 *   sent and the providers are tried inside the same fetch, with no
 *   streaming. Combining them is honest; splitting them would be fake
 *   granularity.
 * - The popup covers the core generation (loading === true). When the
 *   core guide lands the popup closes and the guide appears; the
 *   finishing sections keep arriving in the background with their own
 *   inline status in the guide view ("Adding finishing sections…").
 * - Hiding the popup never cancels the request: the guide still
 *   appears when it is done. Escape hides, it never cancels.
 * - On failure the popup closes and the existing error message shows
 *   exactly as before — it never hangs on a spinner.
 */

export type GeneratingStage = "providers" | "checking" | "finishing";

export interface GeneratingStageMeta {
  id: GeneratingStage;
  title: string;
  description: string;
}

/** The stages, in the order they are reached. Never reorder silently:
 *  the stage machine and the tests rely on this order. */
export const GENERATING_STAGES: readonly GeneratingStageMeta[] = [
  {
    id: "providers",
    title: "Trying AI providers",
    description:
      "We send your topic to the AI and try several providers one by one until one answers.",
  },
  {
    id: "checking",
    title: "Checking your guide",
    description:
      "Making sure the structure, practice questions and worked examples are solid before we show it to you.",
  },
  {
    id: "finishing",
    title: "Adding finishing sections",
    description:
      "Objectives, cheat sheet, real-world uses, FAQ and final review — added in the background.",
  },
] as const;

/** The apology, as one exported string so tests can assert it is
 *  present and reads as a real apology. */
export const GENERATING_APOLOGY =
  "Sorry this is taking a while — your guide is built from scratch just for you, and that takes real work. Thanks for bearing with us.";

/** Plain-words explanation of the whole process behind the wait. */
export const GENERATING_PROCESS =
  "Every guide is made fresh by AI the moment you ask — nothing here is premade. We send your topic to the AI, then try several AI providers one by one until one answers. Then we check the guide — its structure, practice questions and worked examples — and fix anything thin or cut off. Finally we add the objectives, cheat sheet, real-world uses, FAQ and final review.";

export type GeneratingStageStatus = "done" | "active" | "upcoming";

/**
 * Pure stage status: earlier stages are done, the current stage is
 * active, later stages are upcoming. A stage is never reported as done
 * or active before it has been reached.
 */
export function stageStatus(
  current: GeneratingStage,
  stage: GeneratingStage
): GeneratingStageStatus {
  const currentIndex = GENERATING_STAGES.findIndex((s) => s.id === current);
  const stageIndex = GENERATING_STAGES.findIndex((s) => s.id === stage);
  if (stageIndex < currentIndex) return "done";
  if (stageIndex === currentIndex) return "active";
  return "upcoming";
}

/** "12s", "1m 05s", "2m 03s" — seconds under a minute, m:ss above it. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/** Honest caption for the elapsed time, against the measured 17–38s
 *  a live generation takes. Never promises a finish time. */
export function elapsedCaption(elapsedMs: number): string {
  if (elapsedMs < 45_000) return "Most guides take under a minute.";
  if (elapsedMs < 60_000)
    return "Taking a little longer than usual — still working.";
  return "This one is taking a while — sorry. It's still working, and your guide will appear when it's ready.";
}

/**
 * Pure visibility rules, so the hide/reopen behaviour is testable:
 * the popup shows only while generation is running and not hidden;
 * the reopen pill shows only while generation is running and hidden.
 * Hiding never touches the request itself — `loading` is an input
 * here, never an output.
 */
export function shouldShowGeneratingPopup(args: {
  loading: boolean;
  hidden: boolean;
}): boolean {
  return args.loading && !args.hidden;
}

export function shouldShowGeneratingPill(args: {
  loading: boolean;
  hidden: boolean;
}): boolean {
  return args.loading && args.hidden;
}

export default function GeneratingPopup({
  stage,
  elapsedMs,
  topic,
  onHide,
}: {
  /** The stage the frontend has actually reached. */
  stage: GeneratingStage;
  /** Milliseconds since generation started. */
  elapsedMs: number;
  /** The topic being generated, when the user typed one. */
  topic?: string;
  /** Hide the popup. Generation continues in the background. */
  onHide: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close (hide) on Escape — never cancels the request.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onHide();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onHide]);

  // Move focus into the dialog when it opens.
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink-900/50 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Building your study guide"
      onClick={onHide}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="card animate-pop my-4 w-full max-w-lg overflow-hidden outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 w-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400" />
        <div className="max-h-[85vh] overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
              <Loader2 className="h-5 w-5 animate-spin" />
            </span>
            <button
              type="button"
              onClick={onHide}
              aria-label="Hide progress — generation keeps running"
              className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <h3 className="mt-4 text-xl font-extrabold tracking-tight">
            Building your study guide…
          </h3>
          {topic ? (
            <p className="mt-1 truncate text-sm font-semibold text-ink-600">
              {topic}
            </p>
          ) : null}
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            {GENERATING_APOLOGY}
          </p>

          <p className="mt-4 text-sm leading-relaxed text-ink-500">
            {GENERATING_PROCESS}
          </p>

          <ol className="mt-5 space-y-2">
            {GENERATING_STAGES.map((s) => {
              const status = stageStatus(stage, s.id);
              return (
                <li
                  key={s.id}
                  className={`flex items-start gap-3 rounded-2xl border p-3 ${
                    status === "active"
                      ? "border-brand-300 bg-brand-50/60"
                      : status === "done"
                        ? "border-green-200 bg-green-50/50"
                        : "border-ink-100 bg-ink-50/50"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      status === "active"
                        ? "bg-brand-500 text-white"
                        : status === "done"
                          ? "bg-green-500 text-white"
                          : "bg-ink-200 text-ink-500"
                    }`}
                  >
                    {status === "active" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : status === "done" ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Clock3 className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span>
                    <span
                      className={`block text-sm font-bold tracking-tight ${
                        status === "upcoming" ? "text-ink-400" : "text-ink-900"
                      }`}
                    >
                      {s.title}
                      {status === "active" ? "…" : ""}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-500">
                      {s.description}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>

          <p className="mt-4 text-center text-sm font-bold text-ink-700">
            {formatElapsed(elapsedMs)} so far · {elapsedCaption(elapsedMs)}
          </p>

          <button
            type="button"
            onClick={onHide}
            className="btn-primary mt-4 w-full justify-center"
          >
            Hide — keep building in the background
          </button>
          <p className="mt-3 text-center text-xs font-medium text-ink-400">
            Hiding this doesn&apos;t stop anything — your guide will appear
            here when it&apos;s ready.
          </p>
        </div>
      </div>
    </div>
  );
}
