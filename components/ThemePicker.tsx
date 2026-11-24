"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { STYLES, applyStyle, getStyle, type StyleId } from "@/lib/style";

/**
 * ThemePicker — pick one of 5 site styles. Applies instantly (no reload)
 * and persists in localStorage (+ best-effort profile sync when signed in).
 *
 * Two renderings:
 * - "header": a small button in the top bar that opens a popover with all
 *   5 styles, each with live color swatches and a mini preview.
 * - "panel": the full list, used in the Account modal.
 *
 * Listens for the "studysmart:open-style-picker" window event (fired by
 * the Cmd/Ctrl+K palette's "Change site style" action) to open the popover.
 */
export default function ThemePicker({
  variant = "header",
  userId,
  style,
  onStyleChange,
}: {
  variant?: "header" | "panel";
  userId?: string | null;
  style: StyleId;
  onStyleChange: (id: StyleId) => void;
}) {
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onEvent = () => setOpen(true);
    window.addEventListener("studysmart:open-style-picker", onEvent);
    return () =>
      window.removeEventListener("studysmart:open-style-picker", onEvent);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (popRef.current && !popRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open ]);

  function pick(id: StyleId) {
    applyStyle(id, userId ?? null);
    onStyleChange(id);
  }

  const current = STYLES.find((s) => s.id === style) ?? STYLES[0];

  if (variant === "panel") {
    return (
      <div className="space-y-2">
        <p className="text-sm font-bold">Style</p>
        <p className="text-xs leading-relaxed text-ink-400">
          Pick a look for the whole site — it saves on this device
          {userId ? " and to your account" : ""}.
        </p>
        <div className="grid grid-cols-1 gap-2">
          {STYLES.map((s) => (
            <StyleOption
              key={s.id}
              id={s.id}
              name={s.name}
              tagline={s.tagline}
              swatches={s.swatches}
              active={s.id === style}
              onPick={() => pick(s.id)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="relative" ref={popRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Site style: ${current.name}. Change style`}
        title={`Style: ${current.name}`}
        aria-expanded={open}
        className="inline-flex items-center justify-center gap-1.5 rounded-full border border-ink-200 bg-white p-2 text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
      >
        <Palette className="h-4 w-4" />
        <span
          className="flex -space-x-1"
          aria-hidden
          style={{ lineHeight: 0 }}
        >
          {current.swatches.slice(0, 3).map((c) => (
            <span
              key={c}
              className="h-3 w-3 rounded-full ring-2 ring-white"
              style={{ backgroundColor: c }}
            />
          ))}
        </span>
      </button>
      {open && (
        <div className="card animate-pop absolute right-0 z-50 mt-2 w-72 p-3 shadow-lift">
          <p className="px-1 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-ink-400">
            Site style
          </p>
          <div className="space-y-1.5">
            {STYLES.map((s) => (
              <StyleOption
                key={s.id}
                id={s.id}
                name={s.name}
                tagline={s.tagline}
                swatches={s.swatches}
                active={s.id === style}
                onPick={() => {
                  pick(s.id);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function StyleOption({
  name,
  tagline,
  swatches,
  active,
  onPick,
}: {
  id: StyleId;
  name: string;
  tagline: string;
  swatches: [string, string, string, string];
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-xl border p-2.5 text-left transition ${
        active
          ? "border-brand-500 bg-brand-50 shadow-soft"
          : "border-ink-100 bg-white hover:border-brand-300 hover:bg-brand-50/50"
      }`}
    >
      {/* Mini preview: a tiny page mock in the style's own colors. */}
      <span
        className="mt-0.5 flex h-12 w-16 shrink-0 flex-col overflow-hidden rounded-lg ring-1 ring-inset ring-black/10"
        style={{ backgroundColor: swatches[2] }}
        aria-hidden
      >
        <span
          className="h-2.5 w-full"
          style={{ backgroundColor: swatches[0] }}
        />
        <span className="flex flex-1 gap-1 p-1">
          <span
            className="h-full w-2/3 rounded-sm"
            style={{ backgroundColor: swatches[3], opacity: 0.25 }}
          />
          <span className="flex flex-1 flex-col gap-1">
            <span
              className="h-1.5 w-full rounded-sm"
              style={{ backgroundColor: swatches[0], opacity: 0.85 }}
            />
            <span
              className="h-1.5 w-3/4 rounded-sm"
              style={{ backgroundColor: swatches[1], opacity: 0.7 }}
            />
          </span>
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
          {name}
          {active && (
            <Check className="h-4 w-4 shrink-0 text-brand-600" aria-label="Current style" />
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-500">
          {tagline}
        </span>
        <span className="mt-1.5 flex gap-1" aria-hidden>
          {swatches.map((c) => (
            <span
              key={c}
              className="h-3.5 w-3.5 rounded-full ring-1 ring-inset ring-black/10"
              style={{ backgroundColor: c }}
            />
          ))}
        </span>
      </span>
    </button>
  );
}

// Re-export for callers that only need the current style id.
export { getStyle };
