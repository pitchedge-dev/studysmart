"use client";

import { useRef, useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";

type Message = { role: "user" | "assistant"; content: string };

export default function TutorPanel({
  open,
  onClose,
  studyGuide,
  context,
  title,
}: {
  open: boolean;
  onClose: () => void;
  studyGuide?: string;
  context?: string;
  title?: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  if (!open) return null;

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    setError(null);
    const next: Message[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, studyGuide, context }),
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

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl border-l border-slate-200">
      <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-brand-700">
          <Bot className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">AI Study Assistant</h2>
          <p className="truncate text-xs text-slate-500">
            {title ?? "Ask anything about your study material"}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tutor panel"
          className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
            Ask me to explain a concept, quiz you, rewrite a section of your
            study guide, or walk through a question you got wrong.
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user"
                ? "ml-auto bg-brand-600 text-white"
                : "bg-slate-100 text-slate-800"
            }`}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-500">
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

      <div className="border-t border-slate-200 p-3">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Ask the tutor…"
            className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <button
            type="button"
            onClick={send}
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
