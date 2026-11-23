"use client";

import { useEffect, useRef, useState } from "react";
import { ReactSketchCanvas, ReactSketchCanvasRef } from "react-sketch-canvas";
import { Check, Eraser, Pen, Trash2, Undo2 } from "lucide-react";

const COLORS = ["#1e293b", "#2563eb", "#dc2626", "#16a34a", "#d97706"];
const SIZES = [2, 4, 6];

/**
 * Handwriting canvas for Show Your Reasoning answers.
 *
 * The student writes their reasoning by hand — Apple Pencil / stylus on
 * iPad, or finger/mouse anywhere else. The canvas is large with smooth
 * strokes (touch-action: none, so the page does not scroll mid-stroke).
 * Submit exports the drawing as a PNG data URL for the AI checker.
 * `resetKey` clears the canvas from the parent (e.g. after "Try again").
 */
export default function ReasoningCanvas({
  onSubmit,
  disabled,
  resetKey,
}: {
  onSubmit: (imageDataUrl: string) => void;
  disabled?: boolean;
  resetKey?: number;
}) {
  const canvasRef = useRef<ReactSketchCanvasRef>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(4);
  const [eraseMode, setEraseMode] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  useEffect(() => {
    canvasRef.current?.clearCanvas();
    setHasInk(false);
  }, [resetKey]);

  async function submit() {
    if (disabled || !hasInk) return;
    const image = await canvasRef.current?.exportImage("png");
    if (image) onSubmit(image);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-ink-100">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50/50 px-3 py-2.5">
        <button
          type="button"
          onClick={() => {
            setEraseMode(false);
            canvasRef.current?.eraseMode(false);
          }}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            !eraseMode
              ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-sm"
              : "bg-ink-100 text-ink-700 hover:bg-ink-200"
          }`}
        >
          <Pen className="h-3.5 w-3.5" /> Pen
        </button>
        <button
          type="button"
          onClick={() => {
            setEraseMode(true);
            canvasRef.current?.eraseMode(true);
          }}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            eraseMode
              ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-sm"
              : "bg-ink-100 text-ink-700 hover:bg-ink-200"
          }`}
        >
          <Eraser className="h-3.5 w-3.5" /> Eraser
        </button>
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Pen color ${c}`}
              onClick={() => {
                setColor(c);
                setEraseMode(false);
                canvasRef.current?.eraseMode(false);
              }}
              className={`h-6 w-6 rounded-full border-2 ${
                color === c && !eraseMode
                  ? "border-ink-900"
                  : "border-transparent"
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1" aria-label="Pen size">
          {SIZES.map((s) => (
            <button
              key={s}
              type="button"
              aria-label={`Pen size ${s}`}
              onClick={() => setSize(s)}
              className={`flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${
                size === s
                  ? "bg-brand-500 text-white"
                  : "bg-ink-100 text-ink-700 hover:bg-ink-200"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => canvasRef.current?.undo()}
            className="inline-flex items-center gap-1 rounded-lg bg-ink-100 px-2 py-1 text-xs font-semibold text-ink-700 transition hover:bg-ink-200"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button
            type="button"
            onClick={() => {
              canvasRef.current?.clearCanvas();
              setHasInk(false);
            }}
            className="inline-flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-600 transition hover:bg-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>
      <ReactSketchCanvas
        ref={canvasRef}
        strokeWidth={size}
        strokeColor={color}
        eraserWidth={24}
        canvasColor="#ffffff"
        style={{ width: "100%", height: 320 }}
        className="touch-none"
        onChange={(paths) => setHasInk(paths.length > 0)}
      />
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/50 px-3 py-2.5">
        <p className="text-xs font-medium text-ink-400">
          Write your reasoning with your stylus (Apple Pencil on iPad, or
          finger/mouse).
        </p>
        <button
          type="button"
          onClick={submit}
          disabled={disabled || !hasInk}
          className="btn-primary px-4 py-2 text-sm disabled:opacity-50"
        >
          <Check className="h-4 w-4" /> Check my reasoning
        </button>
      </div>
    </div>
  );
}
