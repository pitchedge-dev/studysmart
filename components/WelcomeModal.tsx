"use client";

import { useEffect } from "react";
import { Sparkles, Swords, X } from "lucide-react";
import MeetYourBots from "./MeetYourBots";

/**
 * Welcome popup — shown the first time the app is opened, and reopenable
 * any time from the header ("How it works") or the command palette
 * ("Show welcome"). It says, in plain words, how StudySMART is powered,
 * introduces the three bots, and lists the headline features. Short and
 * skimmable — a welcome card, not an essay.
 *
 * "How it is powered", stated honestly from lib/providers.ts: every guide
 * is generated fresh by AI the moment you ask — nothing here is premade.
 * Google Gemini answers first, and Groq, OpenRouter, Cerebras, NVIDIA,
 * SambaNova, Cohere, Cloudflare, DeepSeek, Novita, SiliconFlow, AIML API,
 * Hugging Face, Moonshot, Zhipu and Qwen are wired in as free backup
 * providers, plus Pollinations — which needs no key at all and is
 * tried early in the chain as a safety net — so if one is busy or
 * out of free calls another one takes over. (Which of them actually
 * have keys set is an env-var matter — the popup claims the wiring,
 * not the keys.)
 * (Vercel AI Gateway was removed 2026-11-26: it needs a card on file.)
 */

export const WELCOME_STORAGE_KEY = "studysmart-welcome-seen";

export function markWelcomeSeen() {
  try {
    window.localStorage.setItem(WELCOME_STORAGE_KEY, "1");
  } catch {
    // localStorage unavailable — the popup may show again next visit.
  }
}

export function hasSeenWelcome(): boolean {
  try {
    return window.localStorage.getItem(WELCOME_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

const FEATURES = [
  "Study guides, generated on demand",
  "Battle Arena games",
  "Review queue (spaced repetition)",
  "Organise guides by course",
  "5 site styles + dark mode",
  "Streaks, XP & mastery",
];

export default function WelcomeModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
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

  function close() {
    markWelcomeSeen();
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-ink-900/50 p-4 backdrop-blur-sm sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to StudySMART"
      onClick={close}
    >
      <div
        className="card animate-pop my-4 w-full max-w-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-1.5 w-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400" />
        <div className="max-h-[85vh] overflow-y-auto p-6">
          <div className="flex items-start justify-between gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
              <Sparkles className="h-5 w-5" />
            </span>
            <button
              type="button"
              onClick={close}
              aria-label="Close welcome"
              className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <h3 className="mt-4 text-xl font-extrabold tracking-tight">
            Welcome to StudySMART
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">
            Turn any topic into a study guide, a game, and a plan — made for
            you, in seconds.
          </p>

          <div className="mt-5 rounded-2xl border border-brand-100 bg-brand-50/60 p-4">
            <p className="text-sm font-bold tracking-tight text-ink-900">
              How it&apos;s powered
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
              Every guide is generated fresh by AI the moment you ask — nothing
              here is premade. Google Gemini answers first, and Groq,
              OpenRouter, Cerebras, NVIDIA, SambaNova, Cohere, Cloudflare,
              DeepSeek, Novita, SiliconFlow, AIML API, Hugging Face,
              Moonshot, Zhipu and Qwen are wired in as free backup
              providers, plus Pollinations — which needs no key at all and
              is tried early in the chain as a safety net. If one is busy or out
              of free calls, another takes over automatically.
            </p>
          </div>

          <div className="mt-5">
            <MeetYourBots />
          </div>

          <div className="mt-5">
            <p className="eyebrow">What you can do here</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {FEATURES.map((f) => (
                <li
                  key={f}
                  className="rounded-full bg-ink-100/70 px-2.5 py-1 text-xs font-semibold text-ink-700"
                >
                  {f}
                </li>
              ))}
            </ul>
            <p className="mt-3 flex items-center gap-1.5 text-xs leading-relaxed text-ink-400">
              <Swords className="h-3.5 w-3.5 shrink-0 text-brand-600" />
              Tip: tell the guide how long you&apos;ll study, and it will be
              built to fit that time.
            </p>
          </div>

          <button
            type="button"
            onClick={close}
            className="btn-primary mt-6 w-full justify-center"
          >
            Start studying
          </button>
          <p className="mt-3 text-center text-xs font-medium text-ink-400">
            You can reopen this anytime: header → How it works, or Ctrl/⌘ K →{" "}
            Show welcome.
          </p>
        </div>
      </div>
    </div>
  );
}
