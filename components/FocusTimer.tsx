"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Coffee, Pause, Play, RotateCcw, Timer, Zap } from "lucide-react";

/**
 * Focus timer (Pomodoro pattern): 25 minutes of full focus, 5-minute
 * break, long 15-minute break after every 4 focus sessions. Attention
 * fades after roughly 25–50 minutes of continuous work, so short fixed
 * blocks with breaks keep focus up and make starting easier.
 *
 * A completed 25-minute focus session earns XP through onFocusComplete
 * (the parent records it — XP only for real completed work). The timer
 * survives a page reload: the end time is stored in localStorage and
 * the countdown resumes from it.
 */

const FOCUS_MS = 25 * 60 * 1000;
const BREAK_MS = 5 * 60 * 1000;
const LONG_BREAK_MS = 15 * 60 * 1000;
const STORAGE_KEY = "studysmart-focus-timer:v1";

type Mode = "focus" | "break" | "long-break";

const MODE_MS: Record<Mode, number> = {
  focus: FOCUS_MS,
  break: BREAK_MS,
  "long-break": LONG_BREAK_MS,
};

const MODE_LABEL: Record<Mode, string> = {
  focus: "Focus",
  break: "Break",
  "long-break": "Long break",
};

function loadStored(): { mode: Mode; endAt: number; rounds: number } | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      mode?: Mode;
      endAt?: number;
      rounds?: number;
    };
    if (!parsed.mode || !parsed.endAt) return null;
    if (parsed.endAt <= Date.now()) return null;
    return {
      mode: parsed.mode,
      endAt: parsed.endAt,
      rounds: parsed.rounds ?? 0,
    };
  } catch {
    return null;
  }
}

function formatMs(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function FocusTimer({
  onFocusComplete,
  completedSessions,
}: {
  /** Called once when a 25-minute focus block finishes. */
  onFocusComplete: () => void;
  /** All completed 25-minute focus sessions, across all days, from
   *  the recorded activity state (the same total the Achievements
   *  section shows). The card must never keep its own count: a
   *  component-local count reset to 0 every time the card remounted
   *  (switching sections unmounts it), which is how the home card
   *  showed "0 focus sessions done" right after a session the
   *  Achievements section counted as 1 (2026-11-25). */
  completedSessions: number;
}) {
  const [mode, setMode] = useState<Mode>("focus");
  const [endAt, setEndAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number>(FOCUS_MS);
  const [rounds, setRounds] = useState(0);
  const completedRef = useRef(false);
  const onFocusCompleteRef = useRef(onFocusComplete);
  onFocusCompleteRef.current = onFocusComplete;

  // Resume a running timer after reload.
  useEffect(() => {
    const stored = loadStored();
    if (stored) {
      setMode(stored.mode);
      setEndAt(stored.endAt);
      setRounds(stored.rounds);
      setRemaining(stored.endAt - Date.now());
    }
  }, []);

  const persist = useCallback(
    (m: Mode, end: number | null, r: number) => {
      try {
        if (end === null) window.localStorage.removeItem(STORAGE_KEY);
        else
          window.localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ mode: m, endAt: end, rounds: r })
          );
      } catch {
        // Timer still works in memory.
      }
    },
    []
  );

  const start = useCallback(
    (m: Mode, r: number) => {
      const end = Date.now() + MODE_MS[m];
      setMode(m);
      setEndAt(end);
      setRemaining(MODE_MS[m]);
      setRounds(r);
      completedRef.current = false;
      persist(m, end, r);
    },
    [persist]
  );

  const stop = useCallback(() => {
    setEndAt(null);
    setRemaining(MODE_MS[mode]);
    persist(mode, null, rounds);
  }, [mode, rounds, persist]);

  // Tick + finish handling.
  useEffect(() => {
    if (endAt === null) return;
    const tick = () => {
      const left = endAt - Date.now();
      if (left <= 0) {
        setRemaining(0);
        setEndAt(null);
        persist(mode, null, rounds);
        if (mode === "focus" && !completedRef.current) {
          completedRef.current = true;
          const nextRounds = rounds + 1;
          setRounds(nextRounds);
          onFocusCompleteRef.current();
          // Auto-start the break so the rhythm keeps going.
          const nextMode: Mode =
            nextRounds % 4 === 0 ? "long-break" : "break";
          start(nextMode, nextRounds);
        } else if (mode !== "focus") {
          start("focus", rounds);
        }
        return;
      }
      setRemaining(left);
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => window.clearInterval(id);
  }, [endAt, mode, rounds, persist, start]);

  const running = endAt !== null;
  const progress =
    1 - remaining / MODE_MS[mode];

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-extrabold tracking-tight text-ink-900">
          <Timer className="h-4 w-4 text-brand-600" /> Focus timer
        </p>
        <span className="chip">
          <Zap className="h-3.5 w-3.5" /> {completedSessions} focus{" "}
          {completedSessions === 1 ? "session" : "sessions"} done
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-400">
        25 minutes of full focus, 5-minute break — long break after 4
        rounds. A finished focus session earns XP.
      </p>
      <div className="mt-4 flex items-center gap-4">
        <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
          <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              strokeWidth="8"
              className="stroke-ink-100"
            />
            <circle
              cx="50"
              cy="50"
              r="44"
              fill="none"
              strokeWidth="8"
              strokeLinecap="round"
              className={
                mode === "focus" ? "stroke-brand-500" : "stroke-emerald-500"
              }
              strokeDasharray={2 * Math.PI * 44}
              strokeDashoffset={2 * Math.PI * 44 * (1 - progress)}
            />
          </svg>
          <span className="absolute text-lg font-extrabold tabular-nums text-ink-900">
            {formatMs(remaining)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-900">
            {running
              ? mode === "focus"
                ? "Focusing — no peeking at other tabs."
                : "Break — stretch, drink some water."
              : mode === "focus"
                ? "Ready when you are."
                : "Break over — back to focus."}
          </p>
          <p className="mt-0.5 text-xs font-medium text-ink-400">
            {MODE_LABEL[mode]} · round {rounds % 4 === 0 ? 4 : rounds % 4} of
            4 before a long break
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {running ? (
              <button
                type="button"
                onClick={stop}
                className="btn-secondary"
              >
                <Pause className="h-4 w-4" /> Pause
              </button>
            ) : (
              <button
                type="button"
                onClick={() => start(mode, rounds)}
                className="btn-primary"
              >
                <Play className="h-4 w-4" />{" "}
                {mode === "focus" ? "Start 25-min focus" : "Start break"}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setMode("focus");
                setRounds(0);
                setEndAt(null);
                setRemaining(FOCUS_MS);
                persist("focus", null, 0);
              }}
              className="btn-secondary"
            >
              <RotateCcw className="h-4 w-4" /> Reset
            </button>
            {!running && mode !== "focus" && (
              <button
                type="button"
                onClick={() => start("focus", rounds)}
                className="btn-secondary"
              >
                <Coffee className="h-4 w-4" /> Skip break
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
