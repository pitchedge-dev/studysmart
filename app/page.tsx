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
  MessageSquareHeart,
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
import TargetedPractice, { type StudyModule } from "@/components/TargetedPractice";
import Pronunciation from "@/components/Pronunciation";
import ShowYourReasoning from "@/components/ShowYourReasoning";
import SectionCheckpoint from "@/components/SectionCheckpoint";
import FeedbackModal from "@/components/FeedbackModal";

const Sketchpad = dynamic(() => import("@/components/Sketchpad"), {
  ssr: false,
  loading: () => (
    <div className="card p-6 text-sm font-medium text-ink-400">
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
  topicType?: string;
  languageCode?: string;
  guideTitle?: string;
  studyGuide: string;
  keyConcepts: string[];
  modules?: StudyModule[];
  quiz?: QuizQuestion[];
};

type Tab = "guide" | "quiz" | "arena";

export default function Home() {
  const [inputText, setInputText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [extractConcepts, setExtractConcepts] = useState(true);
  const [educationLevel, setEducationLevel] = useState("");
  const [testTiming, setTestTiming] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [tab, setTab] = useState<Tab>("guide");
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

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
          educationLevel: educationLevel || undefined,
          testTiming: testTiming || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate study material.");
      setResult(data as GenerateResult);
      setAnswers({});
      setPracticeProgress({ answered: 0, correct: 0 });
      setCheckpointByModule({});
      setBestScores({});
      setTab("guide");
      setWorkspaceOpen(false);
      // Ask for feedback once per session, after the first guide lands —
      // never on the blank landing page, and never on every load.
      try {
        if (!window.sessionStorage.getItem("studysmart-feedback-shown")) {
          window.sessionStorage.setItem("studysmart-feedback-shown", "1");
          window.setTimeout(() => setFeedbackOpen(true), 1500);
        }
      } catch {
        // sessionStorage unavailable — skip the one-time prompt.
      }
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

  function openPracticeTutor(args: {
    question: string;
    picked: string;
    correctAnswer: string;
    explanation: string;
    conceptTitle: string;
  }) {
    setTutorContext(
      `The student is working on the concept "${args.conceptTitle}". The practice problem was: "${args.question}". The correct answer is "${args.correctAnswer}" but the student answered "${args.picked}". The explanation given was: "${args.explanation}". Give a step-by-step breakdown of why the student's answer is wrong and how to reach the correct answer.`
    );
    setTutorTitle("Why was this answer wrong?");
    setTutorOpen(true);
  }

  const modules = result?.modules ?? [];
  const totalCards = modules.reduce((n, m) => n + m.concepts.length, 0);
  const totalPracticeProblems = modules.reduce(
    (n, m) => n + m.practice.reduce((a, g) => a + g.problems.length, 0),
    0
  );
  const totalCheckpointQuestions = modules.reduce(
    (n, m) => n + (m.checkpoint?.questions.length ?? 0),
    0
  );
  let cardIndex = 0;

  // Live progress, kept in local state only and saved automatically as you work.
  const [practiceProgress, setPracticeProgress] = useState({
    answered: 0,
    correct: 0,
  });
  const [checkpointByModule, setCheckpointByModule] = useState<
    Record<number, { answered: number; correct: number }>
  >({});
  const checkpointProgress = Object.values(checkpointByModule).reduce(
    (acc, v) => ({ answered: acc.answered + v.answered, correct: acc.correct + v.correct }),
    { answered: 0, correct: 0 }
  );
  const [bestScores, setBestScores] = useState<Record<number, number>>({});
  const bestTestScore =
    Object.values(bestScores).length > 0
      ? Math.max(...Object.values(bestScores))
      : null;
  const guideContentForGame = result
    ? [
        result.studyGuide,
        ...modules.flatMap((m) => [
          `Module ${m.moduleNumber}: ${m.title}`,
          ...(m.coreIdeas ?? []),
          ...m.concepts.map(
            (c) => `${c.title}: ${c.formulaOrDefinition}. Example: ${c.example}`
          ),
        ]),
      ].join("\n")
    : "";

  const quiz = result?.quiz ?? [];
  const answeredCount = Object.keys(answers).length;
  const correctCount = quiz.filter(
    (q, i) => answers[i] === q.correctAnswer
  ).length;

  return (
    <div className="mx-auto max-w-5xl px-4 pb-24 sm:px-6">
      {/* Header */}
      <header className="sticky top-0 z-30 -mx-4 border-b border-ink-100/70 bg-white/80 px-4 py-3 backdrop-blur-lg sm:-mx-6 sm:px-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
            <GraduationCap className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-extrabold leading-tight tracking-tight">
              Study<span className="gradient-text">SMART</span>
            </h1>
            <p className="hidden text-xs font-medium text-ink-400 sm:block">
              Learn anything, smarter — powered by AI.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700"
          >
            <MessageSquareHeart className="h-3.5 w-3.5" /> Give feedback
          </button>
          <span className="chip-amber hidden sm:inline-flex">
            <Sparkles className="h-3.5 w-3.5" /> Generated on demand
          </span>
        </div>
      </header>

      {/* Hero */}
      {!result && !loading && (
        <div className="hero-glow animate-fade-up -mx-4 px-4 pb-2 pt-10 text-center sm:-mx-6 sm:px-6 sm:pt-14">
          <p className="chip mx-auto">
            <Brain className="h-3.5 w-3.5" /> Your notes in · A full study kit out
          </p>
          <h2 className="mx-auto mt-4 max-w-2xl text-4xl font-extrabold leading-[1.08] tracking-tight text-ink-900 sm:text-5xl">
            Turn any topic into a{" "}
            <span className="gradient-text">beautiful study guide</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-ink-500 sm:text-lg">
            Paste your notes, snap a photo, or just type a topic. StudySMART
            builds your guide, practice, and game — fresh, every time.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2 text-xs font-semibold text-ink-500">
            <span className="chip">
              <BookOpen className="h-3.5 w-3.5" /> Study guide
            </span>
            <span className="chip">
              <Lightbulb className="h-3.5 w-3.5" /> Practice quiz
            </span>
            <span className="chip">
              <Swords className="h-3.5 w-3.5" /> Battle Arena
            </span>
            <span className="chip-amber">
              <Bot className="h-3.5 w-3.5" /> AI tutor
            </span>
          </div>
        </div>
      )}

      {/* Create / Input view */}
      <section className="card animate-fade-up mt-6 overflow-hidden">
        <div className="h-1.5 w-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400" />
        <div className="p-5 sm:p-7">
          <label
            htmlFor="study-input"
            className="text-base font-bold tracking-tight text-ink-900"
          >
            What do you want to learn today?
          </label>
          <p className="mt-0.5 text-sm text-ink-400">
            Paste notes, upload a photo of your textbook, or type a topic.
          </p>
          <textarea
            id="study-input"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            rows={6}
            placeholder="What do you want to learn today? Paste your notes, upload an image, or type a topic"
            className="input mt-3 min-h-32 resize-y leading-relaxed"
          />

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="education-level"
                className="text-sm font-bold tracking-tight text-ink-900"
              >
                Education level
              </label>
              <select
                id="education-level"
                value={educationLevel}
                onChange={(e) => setEducationLevel(e.target.value)}
                className="input mt-1.5"
              >
                <option value="" disabled>
                  Choose your level…
                </option>
                <option value="Elementary School">Elementary School</option>
                <option value="Middle School">Middle School</option>
                <option value="High School">High School</option>
                <option value="College / University">College / University</option>
                <option value="Adult learning">Adult learning</option>
              </select>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">
                The guide is written at the right level for you.
              </p>
            </div>
            <div>
              <label
                htmlFor="test-timing"
                className="text-sm font-bold tracking-tight text-ink-900"
              >
                When is your test?
              </label>
              <select
                id="test-timing"
                value={testTiming}
                onChange={(e) => setTestTiming(e.target.value)}
                className="input mt-1.5"
              >
                <option value="" disabled>
                  Choose when your test is…
                </option>
                <option value="Today">Today</option>
                <option value="Tomorrow">Tomorrow</option>
                <option value="In 2–3 days">In 2–3 days</option>
                <option value="In a week">In a week</option>
                <option value="In 2+ weeks">In 2+ weeks</option>
                <option value="No test — just learning">
                  No test — just learning
                </option>
              </select>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">
                Closer tests get a shorter, high-yield guide.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
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
              className="btn-secondary"
            >
              <ImagePlus className="h-4 w-4 text-brand-600" /> Upload Image
            </button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/50">
              <input
                type="checkbox"
                checked={includeQuiz}
                onChange={(e) => setIncludeQuiz(e.target.checked)}
                className="h-4 w-4 accent-indigo-600"
              />
              Include Practice Quiz
            </label>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-ink-200 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/50">
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
              className="btn-primary ml-auto px-6 py-2.5"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Generating…
                </>
              ) : (
                <>
                  <Wand2 className="h-4 w-4" /> Generate my study guide
                </>
              )}
            </button>
          </div>

          {images.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {images.map((src, i) => (
                <div key={i} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`Uploaded note ${i + 1}`}
                    className="h-20 w-20 rounded-xl border border-ink-200 object-cover shadow-sm"
                  />
                  <button
                    type="button"
                    aria-label="Remove image"
                    onClick={() =>
                      setImages((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-ink-900 p-1 text-white shadow-md transition hover:bg-rose-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="feedback-wrong mt-4 font-medium">{error}</div>
          )}
        </div>
      </section>

      {/* Loading state */}
      {loading && (
        <div className="card animate-fade-up mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
            <Brain className="h-8 w-8" />
          </span>
          <p className="text-lg font-bold tracking-tight">
            Building your study guide…
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-ink-400">
            Reading your notes and generating your personal study material —
            nothing pre-made, everything fresh.
          </p>
          <div className="shimmer-bar mt-1 h-2 w-56 rounded-full" />
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
        <section className="mt-8 animate-fade-up">
          <div className="flex flex-wrap gap-1.5 rounded-2xl bg-ink-100/70 p-1.5">
            <button
              type="button"
              onClick={() => setTab("guide")}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all sm:flex-none ${
                tab === "guide"
                  ? "bg-white text-brand-700 shadow-soft"
                  : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <BookOpen className="h-4 w-4" /> Study Guide
            </button>
            {quiz.length > 0 && (
              <button
                type="button"
                onClick={() => setTab("quiz")}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all sm:flex-none ${
                  tab === "quiz"
                    ? "bg-white text-brand-700 shadow-soft"
                    : "text-ink-500 hover:text-ink-800"
                }`}
              >
                <Lightbulb className="h-4 w-4" /> Practice Quiz
                {answeredCount > 0 && (
                  <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-bold text-brand-700">
                    {correctCount}/{quiz.length}
                  </span>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab("arena")}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all sm:flex-none ${
                tab === "arena"
                  ? "bg-white text-brand-700 shadow-soft"
                  : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <Swords className="h-4 w-4" /> Battle Arena
            </button>
          </div>

          {tab === "guide" && (
            <div className="mt-6 space-y-5">
              {result.guideTitle && (
                <div>
                  <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
                    {result.guideTitle}
                  </h1>
                  {result.topicType && (
                    <p className="mt-2">
                      <span className="chip capitalize">
                        {result.topicType}
                      </span>
                    </p>
                  )}
                </div>
              )}
              {!result.guideTitle && result.topicType && (
                <p>
                  <span className="chip capitalize">{result.topicType}</span>
                </p>
              )}

              {modules.length > 0 && (
                <div className="card overflow-hidden p-5 sm:p-6">
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <div className="flex items-center gap-4">
                      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-2xl font-extrabold text-white shadow-glow">
                        {totalCards}
                      </span>
                      <div>
                        <p className="text-base font-bold text-ink-900">
                          Topics to master
                        </p>
                        <p className="text-sm text-ink-400">
                          {modules.length} module
                          {modules.length === 1 ? "" : "s"} ·{" "}
                          {totalPracticeProblems + totalCheckpointQuestions}{" "}
                          practice questions
                        </p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-sm font-bold text-ink-900">
                        {practiceProgress.correct + checkpointProgress.correct}
                        /
                        {totalPracticeProblems + totalCheckpointQuestions}{" "}
                        correct · Your progress
                      </p>
                      <p className="mt-0.5 text-xs font-medium text-ink-400">
                        Saved automatically · Best test score:{" "}
                        {bestTestScore === null ? (
                          "—"
                        ) : (
                          <span className="chip-amber">
                            {bestTestScore}/10
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  <div className="progress-track mt-4">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${
                          totalPracticeProblems + totalCheckpointQuestions
                            ? ((practiceProgress.answered + checkpointProgress.answered) /
                                (totalPracticeProblems + totalCheckpointQuestions)) *
                              100
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {modules.length > 0 &&
                modules.map((mod) => {
                  const isVocabulary =
                    (mod.format ?? "").toLowerCase().includes("vocab");
                  const isCoreIdeas =
                    (mod.format ?? "").toLowerCase().includes("core");
                  const conceptCards = (
                    <div className="grid gap-4 sm:grid-cols-2">
                      {mod.concepts.map((concept) => {
                        cardIndex += 1;
                        const thisCard = cardIndex;
                        return (
                          <article
                            key={`${mod.moduleNumber}-${concept.title}`}
                            className="card card-hover animate-fade-up p-5"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="chip">{concept.label}</span>
                              <span className="text-xs font-semibold text-ink-400">
                                Card {thisCard} of {totalCards}
                              </span>
                            </div>
                            <h3 className="mt-3 text-lg font-extrabold tracking-tight text-ink-900">
                              {concept.title}
                            </h3>
                            {concept.translation && (
                              <p className="mt-1 text-base font-semibold text-brand-700">
                                {concept.translation}
                              </p>
                            )}
                            {concept.category && (
                              <p className="eyebrow mt-1.5">
                                {concept.category}
                              </p>
                            )}
                            <p className="mt-3 rounded-xl bg-brand-50/70 px-3.5 py-2.5 font-mono text-sm font-semibold leading-relaxed text-brand-800 ring-1 ring-inset ring-brand-100">
                              {concept.formulaOrDefinition}
                            </p>
                            <p className="mt-3 text-sm leading-relaxed text-ink-500">
                              <strong className="font-bold text-ink-800">
                                Example:
                              </strong>{" "}
                              {concept.example}
                            </p>
                            {(concept.pronunciation || isVocabulary) && (
                              <Pronunciation
                                term={concept.title}
                                pronunciation={concept.pronunciation}
                                languageCode={result.languageCode}
                              />
                            )}
                          </article>
                        );
                      })}
                    </div>
                  );
                  const coreIdeas = mod.coreIdeas && mod.coreIdeas.length > 0 && (
                    <div className="card p-5 sm:p-6">
                      <h3 className="text-base font-bold tracking-tight">
                        Core ideas
                      </h3>
                      <ol className="mt-3 space-y-3">
                        {mod.coreIdeas.map((idea, i) => (
                          <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-600">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-extrabold text-brand-700">
                              {i + 1}
                            </span>
                            <span className="pt-0.5">{idea}</span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  );
                  return (
                    <div key={mod.moduleNumber} className="space-y-5">
                      <div className="card relative overflow-hidden p-5 sm:p-6">
                        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-brand-500 to-accent-400" />
                        <div className="flex flex-wrap items-center justify-between gap-2 pl-2">
                          <p className="eyebrow">
                            Module {mod.moduleNumber}
                            {mod.format ? ` · ${mod.format}` : ""}
                          </p>
                          {isVocabulary && (
                            <span className="chip-amber">Spotlight</span>
                          )}
                        </div>
                        <h2 className="mt-1.5 pl-2 text-2xl font-extrabold tracking-tight text-ink-900">
                          {mod.title}
                        </h2>
                        {mod.intro && (
                          <p className="mt-1 pl-2 text-sm leading-relaxed text-ink-400">
                            {mod.intro}
                          </p>
                        )}
                      </div>

                      {isCoreIdeas ? (
                        <>
                          {coreIdeas}
                          {conceptCards}
                        </>
                      ) : (
                        <>
                          {conceptCards}
                          {coreIdeas}
                        </>
                      )}

                      {mod.reasoningExample && (
                        <ShowYourReasoning example={mod.reasoningExample} />
                      )}

                      {mod.checkpoint && (
                        <SectionCheckpoint
                          moduleTitle={mod.title}
                          questions={mod.checkpoint.questions}
                          onProgress={(answered, correct) =>
                            setCheckpointByModule((prev) => ({
                              ...prev,
                              [mod.moduleNumber]: { answered, correct },
                            }))
                          }
                          onFinish={(score) =>
                            setBestScores((prev) => ({
                              ...prev,
                              [mod.moduleNumber]: Math.max(
                                prev[mod.moduleNumber] ?? 0,
                                score
                              ),
                            }))
                          }
                        />
                      )}
                    </div>
                  );
                })}

              {modules.length > 0 && (
                <TargetedPractice
                  modules={modules}
                  onAskTutor={openPracticeTutor}
                  onProgress={(answered, correct) =>
                    setPracticeProgress({ answered, correct })
                  }
                />
              )}

              {result.keyConcepts.length > 0 && (
                <div className="card p-5">
                  <h2 className="text-sm font-bold tracking-tight text-ink-900">
                    Key Concepts
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {result.keyConcepts.map((concept, i) => (
                      <span key={i} className="chip">
                        {concept}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setWorkspaceOpen((v) => !v)}
                  className="btn-secondary"
                >
                  <Pencil className="h-4 w-4 text-brand-600" />
                  {workspaceOpen ? "Close Workspace" : "Open Workspace"}
                </button>
                <p className="text-xs font-medium text-ink-400">
                  Sketchpad for handwritten notes alongside your guide.
                </p>
              </div>

              <div
                className={`grid gap-5 ${
                  workspaceOpen ? "lg:grid-cols-2" : "grid-cols-1"
                }`}
              >
                <article className="markdown card p-5 sm:p-7">
                  <ReactMarkdown>{result.studyGuide}</ReactMarkdown>
                </article>
                {workspaceOpen && <Sketchpad />}
              </div>

              {/* Floating AI Edit button */}
              <button
                type="button"
                onClick={() => setEditOpen((v) => !v)}
                className="fixed bottom-24 right-5 z-40 inline-flex items-center gap-1.5 rounded-full bg-gradient-to-b from-accent-400 to-accent-500 px-4 py-2.5 text-sm font-bold text-white shadow-lift transition hover:from-accent-500 hover:to-accent-600 active:scale-95"
              >
                <Sparkles className="h-4 w-4" /> AI Edit
              </button>

              {editOpen && (
                <div className="card animate-pop fixed bottom-36 right-5 z-40 w-[calc(100vw-2.5rem)] max-w-sm p-4 shadow-lift">
                  <h3 className="text-sm font-bold tracking-tight">
                    Edit with AI
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-ink-400">
                    Describe how to rewrite the study guide — for example,
                    simplify a section, add more detail, or change the tone.
                  </p>
                  <textarea
                    value={editInstructions}
                    onChange={(e) => setEditInstructions(e.target.value)}
                    rows={3}
                    placeholder="Rewrite instructions…"
                    className="input mt-3"
                  />
                  <div className="mt-2 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setEditOpen(false)}
                      className="btn-ghost"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={applyEdit}
                      disabled={editLoading || !editInstructions.trim()}
                      className="btn-primary px-4 py-2"
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
            <div className="mt-6 space-y-5">
              <div className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-extrabold tracking-tight">
                    Practice Quiz
                  </h2>
                  <span className="chip">
                    {answeredCount} of {quiz.length} answered · {correctCount}{" "}
                    correct
                  </span>
                </div>
                <div className="progress-track mt-3">
                  <div
                    className="progress-fill"
                    style={{
                      width: `${quiz.length ? (answeredCount / quiz.length) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>

              {quiz.map((q, qi) => {
                const picked = answers[qi];
                return (
                  <div key={qi} className="card animate-fade-up p-5 sm:p-6">
                    <p className="text-base font-bold leading-relaxed text-ink-900">
                      <span className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-brand-100 text-xs font-extrabold text-brand-700">
                        {qi + 1}
                      </span>
                      {q.question}
                    </p>
                    <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                      {q.options.map((opt) => {
                        const isCorrect = opt === q.correctAnswer;
                        const isPicked = opt === picked;
                        let cls = "";
                        if (picked) {
                          if (isCorrect) cls = "option-correct";
                          else if (isPicked) cls = "option-wrong";
                          else cls = "option-dimmed";
                        }
                        return (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setAnswers((prev) => ({ ...prev, [qi]: opt }))
                            }
                            disabled={!!picked}
                            className={`option-btn ${cls}`}
                          >
                            <span>{opt}</span>
                            {picked && isCorrect && (
                              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
                            )}
                            {picked && isPicked && !isCorrect && (
                              <XCircle className="h-5 w-5 shrink-0 text-rose-500" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                    {picked && (
                      <div className="feedback-neutral mt-4">
                        <p>
                          <strong>Explanation:</strong> {q.explanation}
                        </p>
                        {picked !== q.correctAnswer && (
                          <button
                            type="button"
                            onClick={() => openWrongAnswerTutor(q, picked)}
                            className="btn-secondary mt-3 px-3 py-1.5"
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
              <BattleArena
                guideTopic={result.guideTitle}
                guideContent={guideContentForGame}
                topicType={result.topicType}
              />
            </div>
          )}
        </section>
      )}

      {/* Empty state hint */}
      {!result && !loading && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-dashed border-brand-300 bg-white/70 p-5 text-sm leading-relaxed text-ink-500">
          <Upload className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
          <p>
            Your study guide, quiz, and Battle Arena game will appear here once
            you generate them. Everything is created fresh from your own notes —
            nothing is pre-filled.
          </p>
        </div>
      )}

      {/* Standalone Battle Arena — no study guide needed. Play a game from
          any topic or notes, straight from the landing page. */}
      {!result && !loading && (
        <section className="mt-6 animate-fade-up">
          <BattleArena />
        </section>
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
        className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow transition hover:scale-105 active:scale-95"
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

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        topic={result?.guideTitle ?? (inputText.trim() ? inputText.trim() : undefined)}
      />
    </div>
  );
}
