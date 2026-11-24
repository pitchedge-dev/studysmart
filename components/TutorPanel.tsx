"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Lightbulb, Loader2, Send, X } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };

export default function TutorPanel({
  open,
  onClose,
  studyGuide,
  context,
  title,
  /** When this changes, the message is sent to the tutor automatically
   *  (used by "Explain simpler / deeper" and "Ask AI Tutor" buttons). */
  prefill,
}: {
  open: boolean;
  onClose: () => void;
  studyGuide?: string;
  context?: string;
  title?: string;
  prefill?: { message: string; key: number } | null;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Hint mode (Khanmigo Socratic pattern): the tutor asks what the
   *  student tried first and gives one hint at a time instead of the
   *  answer. Persisted per browser. */
  const [hintMode, setHintMode] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem("studysmart-tutor-hint") === "1";
    } catch {
      return false;
    }
  });
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastPrefillKey = useRef<number | null>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        "studysmart-tutor-hint",
        hintMode ? "1" : "0"
      );
    } catch {
      // Storage unavailable — the preference just won't persist.
    }
  }, [hintMode]);

  async function sendMessage(text: string, history: Message[]) {
    setError(null);
    const next: Message[] = [...history, { role: "user", content: text }];
    setMessages(next);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next,
          studyGuide,
          context,
          hintMode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The tutor could not respond.");
      setMessages([...next, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
      setTimeout(
        () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
        50
      );
    }
  }

  // A prefill (e.g. "Explain this simpler") auto-sends once per key.
  useEffect(() => {
    if (!open || !prefill || prefill.key === lastPrefillKey.current) return;
    lastPrefillKey.current = prefill.key;
    void sendMessage(prefill.message, messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, prefill]);

  if (!open) return null;

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    await sendMessage(text, messages);
  }

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md animate-fade-up flex-col bg-white shadow-2xl border-l border-ink-100 dark:border-ink-700 dark:bg-ink-800">
      <div className="flex items-center gap-3 border-b border-ink-100 bg-gradient-to-r from-brand-50 to-white px-4 py-3 dark:border-ink-700 dark:from-ink-800 dark:to-ink-800">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">AI Study Assistant</h2>
          <p className="truncate text-xs font-medium text-ink-400">
            {title ?? "Ask anything about your study material"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tutor panel"
          className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="border-b border-ink-100 px-4 py-2.5 dark:border-ink-700">
        <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-ink-700">
          <input
            type="checkbox"
            checked={hintMode}
            onChange={(e) => setHintMode(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          <Lightbulb className="h-4 w-4 text-amber-500" />
          Hint mode — ask me what I tried, one hint at a time
        </label>
        <p className="mt-1 pl-7 text-xs leading-relaxed text-ink-400">
          {hintMode
            ? "On: the tutor will not give the answer straight away — it asks what you tried first, then gives one hint at a time."
            : "Off: the tutor answers directly. Turn it on to work it out yourself, with hints."}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="rounded-xl bg-brand-50/70 p-4 text-sm leading-relaxed text-ink-600 ring-1 ring-inset ring-brand-100 dark:bg-brand-950/50 dark:text-ink-200">
            Ask me to explain a concept, quiz you, rewrite a section of your
            study guide, or walk through a question you got wrong.
            {hintMode
              ? " Hint mode is on — I'll start by asking what you've tried."
              : ""}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-auto bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                : "bg-ink-100 text-ink-800 dark:bg-ink-700 dark:text-ink-100"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm font-medium text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-ink-100 bg-white p-3 dark:border-ink-700 dark:bg-ink-800">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder={
              hintMode ? "What have you tried so far?…" : "Ask the tutor…"
            }
            className="input min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            className="btn-primary px-4"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
