"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Command, Search } from "lucide-react";

/**
 * Cmd/Ctrl+K command palette + `?` shortcut help (Linear pattern).
 * Hand-rolled, zero dependencies. Every action listed here is a real
 * action passed in by the parent — nothing is shown that is not wired.
 * Opens with Cmd/Ctrl+K (or the search button); `?` opens the help
 * overlay instead. Arrow keys + Enter to run, Esc to close.
 */

export type PaletteAction = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  run: () => void;
};

export default function CommandPalette({
  actions,
  shortcuts,
}: {
  actions: PaletteAction[];
  /** Rows for the `?` help overlay: [keys, what it does]. */
  shortcuts: Array<{ keys: string; description: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return actions;
    return actions.filter(
      (a) =>
        a.label.toLowerCase().includes(q) ||
        a.group.toLowerCase().includes(q)
    );
  }, [actions, query]);

  useEffect(() => {
    setSelected(0);
  }, [query, open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setHelpOpen(false);
        setOpen((v) => !v);
        setQuery("");
        return;
      }
      if (open) {
        if (e.key === "Escape") {
          setOpen(false);
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelected((s) => Math.min(s + 1, filtered.length - 1));
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelected((s) => Math.max(s - 1, 0));
          return;
        }
        if (e.key === "Enter") {
          const action = filtered[selected];
          if (action) {
            setOpen(false);
            action.run();
          }
          return;
        }
        return;
      }
      if (!typing && e.key === "?" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        setHelpOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, selected]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open ]);

  function run(action: PaletteAction) {
    setOpen(false);
    action.run();
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open command palette (Ctrl+K)"
        title="Search & commands (Ctrl+K)"
        className="inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
      >
        <Search className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="hidden rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-500 sm:inline">
          Ctrl K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[80] flex items-start justify-center bg-ink-900/40 px-4 pt-24 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Command palette"
            className="card w-full max-w-lg overflow-hidden p-0 shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
              <Command className="h-4 w-4 shrink-0 text-ink-400" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Jump to a section, open a guide, toggle dark mode…"
                aria-label="Search commands"
                className="w-full bg-transparent text-base outline-none sm:text-sm placeholder:text-ink-400"
              />
              <kbd className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-500">
                ESC
              </kbd>
            </div>
            <ul className="max-h-80 overflow-y-auto p-2">
              {filtered.length === 0 && (
                <li className="px-3 py-4 text-center text-sm font-medium text-ink-400">
                  No matching command.
                </li>
              )}
              {filtered.map((a, i) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => run(a)}
                    onMouseEnter={() => setSelected(i)}
                    className={`flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                      i === selected
                        ? "bg-brand-50 font-bold text-brand-700"
                        : "font-medium text-ink-700"
                    }`}
                  >
                    <span>
                      <span className="mr-2 text-[10px] font-bold uppercase tracking-wide text-ink-400">
                        {a.group}
                      </span>
                      {a.label}
                    </span>
                    {a.hint && (
                      <kbd className="shrink-0 rounded bg-ink-100 px-1.5 py-0.5 text-[10px] font-bold text-ink-500">
                        {a.hint}
                      </kbd>
                    )}
                  </button>
                </li>
              ))}
            </ul>
            <p className="border-t border-ink-100 px-4 py-2 text-xs font-medium text-ink-400">
              ↑↓ to move · Enter to run · Esc to close · Press ? anytime for
              all shortcuts.
            </p>
          </div>
        </div>
      )}

      {helpOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-ink-900/40 px-4 backdrop-blur-sm"
          onClick={() => setHelpOpen(false)}
        >
          <div
            role="dialog"
            aria-label="Keyboard shortcuts"
            className="card w-full max-w-md p-5 shadow-lift"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-base font-extrabold tracking-tight">
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              Every shortcut below is wired up — nothing here is a dead hint.
            </p>
            <ul className="mt-3 space-y-2">
              {shortcuts.map((s) => (
                <li
                  key={s.keys}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="font-medium text-ink-700">
                    {s.description}
                  </span>
                  <kbd className="shrink-0 rounded-lg bg-ink-100 px-2 py-1 text-xs font-bold text-ink-600">
                    {s.keys}
                  </kbd>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="btn-primary mt-4 w-full justify-center"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
}
