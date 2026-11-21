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
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2">
        <span className="text-sm font-semibold text-slate-700 mr-1">Workspace</span>
        <button
          type="button"
          onClick={() => setEraseMode(false)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            !eraseMode
              ? "bg-brand-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
          }`}
        >
          <Pen className="h-3.5 w-3.5" /> Pen
        </button>
        <button
          type="button"
          onClick={() => setEraseMode(true)}
          className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${
            eraseMode
              ? "bg-brand-600 text-white"
              : "bg-slate-100 text-slate-700 hover:bg-slate-200"
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
                  ? "border-slate-900"
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
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-slate-100 text-slate-700 hover:bg-slate-200"
          >
            <Undo2 className="h-3.5 w-3.5" /> Undo
          </button>
          <button
            type="button"
            onClick={() => canvasRef.current?.clearCanvas()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium bg-red-50 text-red-600 hover:bg-red-100"
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
      <p className="px-3 py-2 text-xs text-slate-500 border-t border-slate-200">
        Sketch, annotate, and take handwritten notes — works with mouse, stylus,
        and touchscreens.
      </p>
    </div>
  );
}
