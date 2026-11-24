"use client";

import { useEffect, useMemo } from "react";

/**
 * Reusable confetti — the same approach as Battle Arena's results screen:
 * deterministic pieces (same positions every render), CSS animation only,
 * zero dependencies. Renders as a fixed overlay that never intercepts
 * clicks, and removes itself after `onDone` fires.
 */

const CONFETTI_COLORS = [
  "#6366f1",
  "#f59e0b",
  "#10b981",
  "#f43f5e",
  "#8b5cf6",
  "#facc15",
];

export default function Confetti({
  pieces = 48,
  durationMs = 6000,
  onDone,
}: {
  pieces?: number;
  durationMs?: number;
  onDone?: () => void;
}) {
  const items = useMemo(
    () =>
      Array.from({ length: pieces }, (_, i) => ({
        left: (i * 37 + 11) % 100,
        delay: ((i * 13) % 10) / 10,
        duration: 2.2 + ((i * 7) % 10) / 10,
        size: 6 + ((i * 5) % 8),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 3 === 0,
      })),
    [pieces]
  );

  // Auto-dismiss so the overlay never lingers.
  useEffect(() => {
    if (!onDone) return;
    const id = window.setTimeout(onDone, durationMs);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden"
    >
      {items.map((p, i) => (
        <span
          key={i}
          className="arena-confetti absolute -top-3"
          style={{
            left: `${p.left}%`,
            width: p.size,
            height: p.round ? p.size : p.size * 0.5,
            backgroundColor: p.color,
            borderRadius: p.round ? "50%" : "2px",
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        />
      ))}
    </div>
  );
}
