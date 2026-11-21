"use client";

import { useRef, useState } from "react";
import { AudioLines, Mic } from "lucide-react";

function normalize(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,;:!?'"’]/g, "")
    .replace(/\s+/g, " ");
}

export default function Pronunciation({
  term,
  pronunciation,
  languageCode,
}: {
  term: string;
  pronunciation?: string;
  languageCode?: string;
}) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState<string | null>(null);
  const [result, setResult] = useState<"correct" | "try-again" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<unknown>(null);

  const lang =
    languageCode ||
    (typeof navigator !== "undefined" ? navigator.language : "") ||
    "en-US";

  function speak() {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setError("Your browser does not support spoken audio.");
      return;
    }
    setError(null);
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(term);
    utterance.lang = lang;
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }

  function listen() {
    if (typeof window === "undefined") return;
    const w = window as unknown as Record<string, unknown>;
    const Recognition =
      (w.SpeechRecognition as unknown) ??
      (w.webkitSpeechRecognition as unknown);
    if (!Recognition || typeof Recognition !== "function") {
      setError(
        "Speech recognition is not supported in this browser — listening still works with the Speak button above."
      );
      return;
    }
    setError(null);
    setHeard(null);
    setResult(null);
    setListening(true);
    const rec = new (Recognition as new () => {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
      onerror: ((e: unknown) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
    })();
    recognitionRef.current = rec;
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const transcript = e.results[0]?.[0]?.transcript ?? "";
      setHeard(transcript);
      const said = normalize(transcript);
      const target = normalize(term);
      setResult(said === target || (said.length > 0 && (said.includes(target) || target.includes(said))) ? "correct" : "try-again");
      setListening(false);
    };
    rec.onerror = () => {
      setError("Could not hear you — please try again.");
      setListening(false);
    };
    rec.onend = () => setListening(false);
    try {
      rec.start();
    } catch {
      setError("Could not start listening — please try again.");
      setListening(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg bg-slate-50 p-3">
      {pronunciation && (
        <p className="text-sm text-slate-600">
          <strong>Pronunciation:</strong> {pronunciation}
        </p>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={speak}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <AudioLines className="h-4 w-4 text-brand-600" /> Speak
        </button>
        <button
          type="button"
          onClick={listen}
          disabled={listening}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <Mic className="h-4 w-4 text-brand-600" />
          {listening ? "Listening…" : "Say it"}
        </button>
      </div>
      {heard !== null && (
        <p className="mt-2 text-sm text-slate-700">
          You said: “{heard}” —{" "}
          <strong className={result === "correct" ? "text-green-700" : "text-red-700"}>
            {result === "correct" ? "Correct!" : "Try again."}
          </strong>
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
