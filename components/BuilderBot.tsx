"use client";

import { useEffect, useRef, useState } from "react";
import { Hammer, Loader2, RotateCcw, Send, Sparkles, Undo2, X } from "lucide-react";
import { updateGuideContent } from "@/lib/supabase";
import type { GenerateResult } from "@/app/page";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  /** Change list attached to an assistant message that applied an edit. */
  changes?: string[];
};

/** What the edit API returns for one request. */
type EditResult = {
  updatedGuide: GenerateResult;
  summary: string;
  changes: string[];
  destructive: boolean;
  destructiveDetail: string | null;
};

const SUGGESTIONS = [
  "Add 3 more practice questions",
  "Simplify the concepts",
  "Make a cheat sheet",
  "Fix any mistakes",
  "Add a worked example",
  "Reorganize the modules",
];

const UNDO_KEY_PREFIX = "studysmart-builder-undo:";
const MAX_UNDO = 5;

function undoKey(guideId: string): string {
  return `${UNDO_KEY_PREFIX}${guideId}`;
}

/**
 * Builder Bot — an AI assistant that edits the student's OWN saved
 * guide in plain words ("add a section", "simplify this", "add 3 more
 * practice questions") and saves the result.
 *
 * Safety, by construction:
 * - It only ever edits the one guide it was opened on (guideId), and
 *   only when the signed-in user owns it (isOwner) — the save matches
 *   id AND user_id, and row-level security enforces the same.
 * - Destructive edits (removing a module, concept, or questions) are
 *   staged and need a tap on "Apply anyway" before anything is saved.
 * - Every applied edit keeps the previous version, so "Undo last
 *   change" puts the guide back exactly as it was.
 * - New content comes from the guide's own material and topic — the
 *   edit API's system prompt forbids inventing studies, citations,
 *   statistics, dates, or quotes that are not already in the guide.
 */
export default function BuilderBot({
  open,
  onClose,
  guide,
  guideId,
  isOwner,
  userId,
  onGuideUpdated,
}: {
  open: boolean;
  onClose: () => void;
  guide: GenerateResult;
  guideId: string | null;
  isOwner: boolean;
  userId: string | null;
  onGuideUpdated: (guide: GenerateResult) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** A destructive edit, staged and waiting for the student's tap. */
  const [pendingEdit, setPendingEdit] = useState<EditResult | null>(null);
  /** Previous guide versions, newest last — for undo. */
  const [undoStack, setUndoStack] = useState<GenerateResult[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef(guide);
  guideRef.current = guide;

  // Seed one undo step from the previous session (the last pre-edit
  // version, saved to localStorage when an edit was applied).
  useEffect(() => {
    if (!open || !guideId) return;
    try {
      const raw = window.localStorage.getItem(undoKey(guideId));
      if (!raw) return;
      const saved = JSON.parse(raw) as GenerateResult;
      if (saved && typeof saved.studyGuide === "string") {
        setUndoStack((prev) =>
          prev.length === 0 ? [saved] : prev
        );
      }
    } catch {
      // No usable saved undo — start with an empty stack.
    }
    // Only on open / guide change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, guideId]);

  function scrollToBottom() {
    setTimeout(
      () => bottomRef.current?.scrollIntoView({ behavior: "smooth" }),
      50
    );
  }

  /** Save one guide version to the student's account and show it. */
  async function saveGuide(
    next: GenerateResult
  ): Promise<boolean> {
    if (!guideId || !userId) return false;
    const ok = await updateGuideContent({
      id: guideId,
      userId,
      guide: next as unknown as Record<string, unknown>,
      quiz: next.quiz,
    });
    if (ok) onGuideUpdated(next);
    return ok;
  }

  /** Apply an edit the bot produced: keep the current version for
   *  undo, save the new one, and show what changed. */
  async function applyEdit(result: EditResult) {
    const previous = guideRef.current;
    setPendingEdit(null);
    setLoading(true);
    setError(null);
    try {
      const ok = await saveGuide(result.updatedGuide);
      if (!ok) throw new Error("The change could not be saved. Please try again.");
      setUndoStack((prev) => {
        const next = [...prev, previous].slice(-MAX_UNDO);
        return next;
      });
      try {
        if (guideId) {
          window.localStorage.setItem(undoKey(guideId), JSON.stringify(previous));
        }
      } catch {
        // Storage unavailable — the in-memory stack still works.
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: result.summary,
          changes: result.changes,
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  async function sendMessage(text: string) {
    const instruction = text.trim();
    if (!instruction || loading) return;
    if (!guideId || !isOwner || !userId) {
      setError("Builder Bot works on your own saved guides.");
      return;
    }
    setError(null);
    setPendingEdit(null);
    const history = messages
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));
    const next: ChatMessage[] = [...messages, { role: "user", content: instruction }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/builder-bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guideId,
          instruction,
          guide: guideRef.current,
          history,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Builder Bot could not make that change.");
      const result = data as EditResult;
      if (result.destructive) {
        // Stage it — nothing is saved until the student taps Apply.
        setPendingEdit(result);
        setMessages([
          ...next,
          {
            role: "assistant",
            content: `I worked out this change, but it would remove something: ${result.destructiveDetail ?? "part of the guide"}. Review it below — nothing is saved until you tap “Apply anyway”.`,
            changes: result.changes,
          },
        ]);
      } else {
        await applyEdit(result);
        return;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  async function undoLastChange() {
    if (undoStack.length === 0 || loading) return;
    const previous = undoStack[undoStack.length - 1];
    setLoading(true);
    setError(null);
    try {
      const ok = await saveGuide(previous);
      if (!ok) throw new Error("The undo could not be saved. Please try again.");
      setUndoStack((prev) => prev.slice(0, -1));
      try {
        if (guideId) window.localStorage.removeItem(undoKey(guideId));
      } catch {
        // Ignore storage errors.
      }
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: "Done — reverted to the previous version of your guide.",
        },
      ]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  if (!open) return null;

  async function send() {
    await sendMessage(input);
  }

  const canEdit = Boolean(guideId && isOwner && userId);

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md animate-fade-up flex-col bg-white shadow-2xl border-l border-ink-100 dark:border-ink-700 dark:bg-ink-800">
      <div className="flex items-center gap-3 border-b border-ink-100 bg-gradient-to-r from-brand-50 to-white px-4 py-3 dark:border-ink-700 dark:from-ink-800 dark:to-ink-800">
        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
          <Hammer className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">Builder Bot</h2>
          <p className="truncate text-xs font-medium text-ink-400">
            Ask for changes to this guide in plain words
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Builder Bot"
          className="rounded-lg p-2 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="rounded-xl bg-brand-50/70 p-4 text-sm leading-relaxed text-ink-600 ring-1 ring-inset ring-brand-100 dark:bg-brand-950/50 dark:text-ink-200">
            Tell me what to change about this guide — I&apos;ll edit it and
            save it for you. Try one of these, or write your own:
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={!canEdit || loading}
                  onClick={() => void sendMessage(s)}
                  className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-200 transition hover:bg-brand-50 disabled:opacity-50 dark:bg-ink-700 dark:text-brand-300 dark:ring-ink-600"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="space-y-1">
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
                m.role === "user"
                  ? "ml-auto bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                  : "bg-ink-100 text-ink-800 dark:bg-ink-700 dark:text-ink-100"
              }`}
            >
              {m.content}
            </div>
            {m.changes && m.changes.length > 0 && (
              <div className="max-w-[85%] rounded-xl bg-emerald-50 px-3 py-2 text-xs leading-relaxed text-emerald-900 ring-1 ring-inset ring-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-100 dark:ring-emerald-900">
                <p className="font-bold">What changed:</p>
                <ul className="mt-1 list-disc pl-4">
                  {m.changes.map((c, j) => (
                    <li key={j}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm font-medium text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Building your change…
          </div>
        )}
        {pendingEdit && (
          <div className="rounded-xl bg-amber-50 p-4 text-sm leading-relaxed text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-950/40 dark:text-amber-100 dark:ring-amber-900">
            <p className="font-bold">Review before applying</p>
            <p className="mt-1">{pendingEdit.summary}</p>
            <ul className="mt-2 list-disc pl-4 text-xs">
              {pendingEdit.changes.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={loading}
                onClick={() => void applyEdit(pendingEdit)}
                className="btn-primary px-3 py-1.5 text-sm"
              >
                Apply anyway
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={() => {
                  setPendingEdit(null);
                  setMessages((prev) => [
                    ...prev,
                    {
                      role: "assistant",
                      content: "Got it — I didn't change anything. Tell me what you'd like instead.",
                    },
                  ]);
                }}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
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
        {undoStack.length > 0 && (
          <button
            type="button"
            onClick={() => void undoLastChange()}
            disabled={loading}
            className="mb-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-bold text-ink-500 transition hover:bg-ink-100 hover:text-ink-800 disabled:opacity-50"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo last change
          </button>
        )}
        {!canEdit ? (
          <p className="flex items-center gap-2 rounded-xl bg-ink-100/70 px-3 py-2 text-xs font-medium text-ink-500 dark:bg-ink-700 dark:text-ink-300">
            <RotateCcw className="h-4 w-4 shrink-0" />
            Builder Bot works on your own saved guides — sign in as the
            guide&apos;s owner to edit it.
          </p>
        ) : (
          <>
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void send();
                }}
                placeholder="Ask for a change — e.g. add 3 practice questions…"
                aria-label="Ask Builder Bot for a change"
                className="input min-w-0 flex-1"
              />
              <button
                type="button"
                onClick={() => void send()}
                disabled={loading || !input.trim()}
                className="btn-primary px-4"
                aria-label="Send to Builder Bot"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[11px] font-medium leading-relaxed text-ink-400">
              <Sparkles className="h-3.5 w-3.5 shrink-0" />
              Edits save to this guide only. Removing a section asks first,
              and every change can be undone.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
