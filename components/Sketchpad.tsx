"use client";

import { useRef, useState } from "react";
import { ReactSketchCanvas, ReactSketchCanvasRef } from "react-sketch-canvas";
import { Eraser, Pen, Trash2, Undo2 } from "lucide-react";

const COLORS = ["#1e293b", "#dc2626", "#2563eb", "#16a34a", "#d97706"];

export default function Sketchpad() {
  const canvasRef = useRef<ReactSketchCanvasRef>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [eraseMode, setEraseMode] = useState(false);

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 bg-ink-50/50 px-3 py-2.5">
        <span className="mr-1 text-sm font-extrabold tracking-tight text-ink-900">Workspace</span>
        <button
          type="button"
          onClick={() => setEraseMode(false)}
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
          onClick={() => setEraseMode(true)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            eraseMode
              ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-sm"
              : "bg-ink-100 text-ink-700 hover:bg-ink-200"
          }`}
        >
          <Eraser className="h-3.5 w-3.5" /> Eraser
        </button>
        <div className="flex items-center gap-1.5 ml-1">
          {COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Pen color ${c}`}
              onClick={() => {
                setColor(c);
                setEraseMode(false);
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
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => canvasRef.current?.undo()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold bg-ink-100 text-ink-700 transition hover:bg-ink-200"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button
            type="button"
            onClick={() => canvasRef.current?.clearCanvas()}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold bg-rose-50 text-rose-600 transition hover:bg-rose-100"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        </div>
      </div>
      <ReactSketchCanvas
        ref={canvasRef}
        strokeWidth={3}
        strokeColor={color}
        eraserWidth={24}
        canvasColor="#ffffff"
        style={{ width: "100%", height: 420 }}
        className="touch-none"
      />
      <p className="border-t border-ink-100 bg-ink-50/50 px-3 py-2.5 text-xs font-medium text-ink-400">
        Sketch, annotate, and take handwritten notes — works with mouse, stylus,
        and touchscreens.
      </p>
    </div>
  );
}
