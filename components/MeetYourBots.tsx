"use client";

import { MessageCircle, Mic, Wrench, type LucideIcon } from "lucide-react";

/**
 * "Meet your bots" — the three AI helpers, introduced up front so the
 * user knows what each one does from the beginning instead of finding
 * them buried in menus.
 *
 * 1. Builder Bot — edits your study guide in plain words.
 * 2. AI Tutor — answers questions and explains things.
 * 3. Teach-Back — you explain a concept from memory; it grades you
 *    out of 10 and asks a follow-up. (This is the third helper: the
 *    Feynman / self-explanation bot, the only other conversational
 *    AI helper in the app besides Builder Bot and the Tutor.)
 */
export type BotInfo = {
  id: "builder" | "tutor" | "teachback";
  name: string;
  tagline: string;
  icon: LucideIcon;
};

export const BOTS: BotInfo[] = [
  {
    id: "builder",
    name: "Builder Bot",
    tagline: "Changes your study guide in plain words — just say what to fix, add or simplify.",
    icon: Wrench,
  },
  {
    id: "tutor",
    name: "AI Tutor",
    tagline: "Ask anything about your guide — it explains, answers and helps you understand.",
    icon: MessageCircle,
  },
  {
    id: "teachback",
    name: "Teach-Back",
    tagline: "Explain a concept back from memory — it grades you out of 10 and asks a follow-up.",
    icon: Mic,
  },
];

export default function MeetYourBots({
  onOpenBuilderBot,
  compact = false,
}: {
  /** When given, the Builder Bot card gets an "Open" button that runs it. */
  onOpenBuilderBot?: () => void;
  /** Smaller strip for inside a guide view. */
  compact?: boolean;
}) {
  return (
    <div>
      {!compact && (
        <p className="eyebrow">Meet your bots — three AI helpers</p>
      )}
      <div className={`mt-2 grid gap-2 ${compact ? "sm:grid-cols-3" : "sm:grid-cols-3"}`}>
        {BOTS.map(({ id, name, tagline, icon: Icon }) => (
          <div
            key={id}
            className={`rounded-2xl border p-3 ${
              id === "builder"
                ? "border-amber-300 bg-amber-50/70"
                : "border-ink-100 bg-white"
            }`}
          >
            <p className="flex items-center gap-2 text-sm font-bold text-ink-900">
              <span
                className={`flex h-7 w-7 items-center justify-center rounded-lg ${
                  id === "builder"
                    ? "bg-amber-500 text-white"
                    : "bg-brand-100 text-brand-700"
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              {name}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-500">
              {tagline}
            </p>
            {id === "builder" && onOpenBuilderBot && (
              <button
                type="button"
                onClick={onOpenBuilderBot}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
              >
                <Wrench className="h-3.5 w-3.5" /> Open Builder Bot
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
