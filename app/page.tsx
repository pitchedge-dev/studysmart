"use client";

import { useRef, useState } from "react";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import {
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  GraduationCap,
  ImagePlus,
  Lightbulb,
  Loader2,
  Pencil,
  Sparkles,
  Swords,
  Upload,
  Wand2,
  X,
  XCircle,
} from "lucide-react";
import TutorPanel from "@/components/TutorPanel";
import BattleArena from "@/components/BattleArena";

const Sketchpad = dynamic(() => import("@/components/Sketchpad"), {
  ssr: false,
  loading: () => (
    <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
      Loading workspace…
    </div>
  ),
});

type QuizQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

type GenerateResult = {
  studyGuide: string;
  keyConcepts: string[];
  quiz?: QuizQuestion[];
};

type Tab = "guide" | "quiz" | "arena";

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [extractConcepts, setExtractConcepts] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [tab, setTab] = useState<Tab>("guide");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  // AI Edit
  const [editOpen, setEditOpen] = useState(false);
  const [editInstructions, setEditInstructions] = useState("");
  const [editLoading, setEditLoading] = useState(false);

  // Quiz state
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorContext, setTutorContext] = useState<string | undefined>(undefined);
  const [tutorTitle, setTutorTitle] = useState<string | undefined>(undefined);

  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageFiles(files: FileList | null) {
    if (!files) return;
    const readers = Array.from(files).map(
      (file) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Could not read image."));
          reader.readAsDataURL(file);
        })
    );
    Promise.all(readers)
      .then((dataUrls) => setImages((prev) => [...prev, ...dataUrls]))
      .catch(() => setError("One of the images could not be read."));
  }

  async function generate() {
    if ((!inputText.trim() && images.length === 0) || loading) return;
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputText.trim(),
          images,
          includeQuiz,
          extractConcepts,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate study material.");
      setResult(data as GenerateResult);
      setAnswers({});
      setTab("guide");
      setWorkspaceOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function applyEdit() {
    if (!result || !editInstructions.trim() || editLoading) return;
    setEditLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            {
              role: "user",
              content: `Rewrite the study guide according to these instructions: ${editInstructions.trim()}. Return the full updated study guide in Markdown.`,
            },
          ],
          studyGuide: result.studyGuide,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "The edit could not be applied.");
      setResult({ ...result, studyGuide: data.reply });
      setEditInstructions("");
      setEditOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setEditLoading(false);
    }
  }

  function openWrongAnswerTutor(q: QuizQuestion, picked: string) {
    setTutorContext(
      `The quiz question was: "${q.question}". The options were: ${q.options.join("; ")}. The correct answer is "${q.correctAnswer}" but the student chose "${picked}". Explain why the chosen answer is wrong and why the correct answer is right.`
    );
    setTutorTitle("Why was this answer wrong?");
    setTutorOpen(true);
  }

  const quiz = result?.quiz ?? [];
  const answeredCount = Object.keys(answers).length;
  const correctCount = quiz.filter(
    (q, i) => answers[i] === q.correctAnswer
  ).length;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24">
      {/* Header */}
      <header className="flex items-center gap-3 py-6">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-600 text-white">
          <GraduationCap className="h-6 w-6" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">StudySMART</h1>
          <p className="text-sm text-slate-500">
            Learn anything, smarter — powered by AI.
          </p>
        </div>
      </header>

      {/* Create / Input view */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <label
          htmlFor="study-input"
          className="text-sm font-semibold text-slate-700"
        >
          What do you want to learn today?
        </label>
        <textarea
          id="study-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={6}
          placeholder="What do you want to learn today? Paste your notes, upload an image, or type a topic"
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleImageFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <ImagePlus className="h-4 w-4" /> Upload Image
          </button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={includeQuiz}
              onChange={(e) => setIncludeQuiz(e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Include Practice Quiz
          </label>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={extractConcepts}
              onChange={(e) => setExtractConcepts(e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Extract Key Concepts
          </label>
          <button
            type="button"
            onClick={generate}
            disabled={loading || (!inputText.trim() && images.length === 0)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-5 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Generating…
              </>
            ) : (
              <>
                <Wand2 className="h-4 w-4" /> Generate
              </>
            )}
          </button>
        </div>

        {images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`Uploaded note ${i + 1}`}
                  className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                />
                <button
                  type="button"
                  aria-label="Remove image"
                  onClick={() =>
                    setImages((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-slate-900 p-0.5 text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
      </section>

      {/* Loading state */}
      {loading && (
        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-slate-200 bg-white py-12 text-center shadow-sm">
          <Brain className="h-10 w-10 text-brand-600" />
          <p className="text-lg font-semibold">Building your study guide…</p>
          <p className="text-sm text-slate-500">
            Reading your notes and generating your personal study material.
          </p>
          <div className="flex gap-2">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="brainstorm-dot h-3 w-3 rounded-full bg-brand-500"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Results dashboard — only shown once real data exists */}
      {result && !loading && (
        <section className="mt-6">
          <div className="flex flex-wrap gap-2 border-b border-slate-200">
            <button
              type="button"
              onClick={() => setTab("guide")}
              className={`inline-flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium ${
                tab === "guide"
                  ? "border-b-2 border-brand-600 bg-white text-brand-700"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <BookOpen className="h-4 w-4" /> Study Guide
            </button>
            {quiz.length > 0 && (
              <button
                type="button"
                onClick={() => setTab("quiz")}
                className={`inline-flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium ${
                  tab === "quiz"
                    ? "border-b-2 border-brand-600 bg-white text-brand-700"
                    : "text-slate-500 hover:text-slate-700"
                }`}
              >
                <Lightbulb className="h-4 w-4" /> Practice Quiz
                {answeredCount > 0 && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">
                    {correctCount}/{quiz.length}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab("arena")}
              className={`inline-flex items-center gap-1.5 rounded-t-lg px-4 py-2 text-sm font-medium ${
                tab === "arena"
                  ? "border-b-2 border-brand-600 bg-white text-brand-700"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Swords className="h-4 w-4" /> Battle Arena
            </button>
          </div>

          {tab === "guide" && (
            <div className="mt-4 space-y-4">
              {result.keyConcepts.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="text-sm font-semibold text-slate-700">
                    Key Concepts
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {result.keyConcepts.map((concept, i) => (
                      <span
                        key={i}
                        className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700"
                      >
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setWorkspaceOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="h-4 w-4" />
                  {workspaceOpen ? "Close Workspace" : "Open Workspace"}
                </button>
                <p className="text-xs text-slate-500">
                  Sketchpad for handwritten notes alongside your guide.
                </p>
              </div>

              <div
                className={`grid gap-4 ${
                  workspaceOpen ? "lg:grid-cols-2" : "grid-cols-1"
                }`}
              >
                <article className="markdown rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                  <ReactMarkdown>{result.studyGuide}</ReactMarkdown>
                </article>
                {workspaceOpen && <Sketchpad />}
              </div>

              {/* Floating AI Edit button */}
              <button
                type="button"
                onClick={() => setEditOpen((v) => !v)}
                className="fixed bottom-24 right-5 z-40 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-4 py-2.5 text-sm font-medium text-white shadow-lg hover:bg-amber-600"
              >
                <Sparkles className="h-4 w-4" /> AI Edit
              </button>

              {editOpen && (
                <div className="fixed bottom-36 right-5 z-40 w-[calc(100vw-2.5rem)] max-w-sm rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
                  <h3 className="text-sm font-semibold">Edit with AI</h3>
                  <p className="mt-1 text-xs text-slate-500">
                    Describe how to rewrite the study guide — for example,
                    simplify a section, add more detail, or change the tone.
                  </p>
                  <textarea
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    rows={3}
                    placeholder="Rewrite instructions…"
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditOpen(false)}
                      className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={applyEdit}
                      disabled={editLoading || !editInstructions.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                    >
                      {editLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Wand2 className="h-4 w-4" />
                      )}
                      Apply Edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {tab === "quiz" && (
            <div className="mt-4 space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-semibold">Practice Quiz</h2>
                  <span className="text-sm text-slate-500">
                    {answeredCount} of {quiz.length} answered · {correctCount}{" "}
                    correct
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full bg-brand-500 transition-all"
                    style={{
                      width: `${quiz.length ? (answeredCount / quiz.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              {quiz.map((q, qi) => {
                const picked = answers[qi];
                return (
                  <div
                    key={qi}
                    className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
                  >
                    <p className="font-medium leading-relaxed">
                      <span className="mr-2 text-slate-400">{qi + 1}.</span>
                      {q.question}
                    </p>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      {q.options.map((opt) => {
                        const isCorrect = opt === q.correctAnswer;
                        const isPicked = opt === picked;
                        let cls =
                          "border-slate-200 bg-white hover:border-brand-400";
                        if (picked) {
                          if (isCorrect)
                            cls = "border-green-500 bg-green-50 text-green-800";
                          else if (isPicked)
                            cls = "border-red-500 bg-red-50 text-red-800";
                          else
                            cls = "border-slate-200 bg-slate-50 text-slate-400";
                        }
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setAnswers((prev) => ({ ...prev, [qi]: opt }))
                            }
                            disabled={!!picked}
                            className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition ${cls}`}
                          >
                            <span>{opt}</span>
                            {picked && isCorrect && (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                            )}
                            {picked && isPicked && !isCorrect && (
                              <XCircle className="h-5 w-5 shrink-0 text-red-600" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {picked && (
                      <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                        <p>
                          <strong>Explanation:</strong> {q.explanation}
                        </p>
                        {picked !== q.correctAnswer && (
                          <button
                            type="button"
                            onClick={() => openWrongAnswerTutor(q, picked)}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                          >
                            <Sparkles className="h-4 w-4 text-brand-600" />
                            Ask AI Tutor
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === "arena" && (
            <div className="mt-4">
              <BattleArena />
            </div>
          )}
        </section>
      )}

      {/* Empty state hint */}
      {!result && !loading && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-dashed border-slate-300 bg-white/60 p-5 text-sm text-slate-500">
          <Upload className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
          <p>
            Your study guide, quiz, and Battle Arena game will appear here once
            you generate them. Everything is created fresh from your own notes —
            nothing is pre-filled.
          </p>
        </div>
      )}

      {/* Global floating AI Study Assistant */}
      <button
        type="button"
        onClick={() => {
          setTutorTitle(
            result ? "AI Study Assistant" : "AI Study Assistant"
          );
          setTutorContext(undefined);
          setTutorOpen(true);
        }}
        aria-label="Open AI Study Assistant"
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-brand-600 text-white shadow-lg hover:bg-brand-700"
      >
        <Bot className="h-6 w-6" />
      </button>

      <TutorPanel
        open={tutorOpen}
        onClose={() => setTutorOpen(false)}
        studyGuide={result?.studyGuide}
        context={tutorContext}
        title={tutorTitle}
      />
    </div>
  );
}
