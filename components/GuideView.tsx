"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import {
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Focus,
  GraduationCap,
  Lightbulb,
  ListTree,
  Search,
  Sparkles,
  XCircle,
} from "lucide-react";
import TargetedPractice, { type StudyModule } from "./TargetedPractice";
import PersonalizedPractice from "./PersonalizedPractice";
import { applyAnswer, MASTERY_STREAK, useGuideErrors, type ErrorAnswerInput } from "@/lib/errorTracking";
import { recordActivityNow } from "@/lib/activity";
import { MasteryBadge, MasterySummary } from "./MasteryBadge";
import StudyPlan from "./StudyPlan";
import ExplainButtons from "./ExplainButtons";
import Confetti from "./Confetti";
import Pronunciation from "./Pronunciation";
import ShowYourReasoning from "./ShowYourReasoning";
import SectionCheckpoint from "./SectionCheckpoint";
import GuideVideos from "./GuideVideos";
import TutorPanel from "./TutorPanel";
import type { GenerateResult } from "@/app/page";

type QuizQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
};

type TocEntry = {
  id: string;
  label: string;
  kind: string;
};

function formatDate(value?: string): string {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return value;
  }
}

/**
 * A saved guide rendered as its own mini-site: sidebar table of contents,
 * search-within-guide, reading progress, collapsible modules, and every
 * section of a deep guide (objectives, cheat sheet, glossary, real-world
 * applications, FAQ, final review) plus practice, checkpoints, and quiz.
 * Self-contained — used by the dedicated /guide/[id] page.
 */
export default function GuideView({
  result,
  meta,
  backHref = "/",
  guideKey = null,
  userId = null,
}: {
  result: GenerateResult;
  meta?: {
    authorName?: string;
    createdAt?: string;
    educationLevel?: string;
    testTiming?: string;
  };
  backHref?: string;
  /**
   * The guide copy's error-tracking key — "guide:<study_guides row id>"
   * for a saved/published/shared guide. Errors are private to the
   * signed-in user (userId): opening someone else's published guide
   * starts with a clean slate, and your errors on it are tracked only
   * for you. Null when the guide has no stable copy (errors then stay
   * in this session only).
   */
  guideKey?: string | null;
  userId?: string | null;
}) {
  const modules: StudyModule[] = result.modules ?? [];
  const quiz: QuizQuestion[] = result.quiz ?? [];

  const [collapsedModules, setCollapsedModules] = useState<Record<number, boolean>>({});
  const [activeSection, setActiveSection] = useState("overview");
  const [searchQuery, setSearchQuery] = useState("");
  const [scrollProgress, setScrollProgress] = useState(0);

  // Quiz state (local to this view)
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [quizOpen, setQuizOpen] = useState(false);

  // Practice / checkpoint progress (local to this view)
  const [practiceProgress, setPracticeProgress] = useState({ answered: 0, correct: 0 });
  const [checkpointByModule, setCheckpointByModule] = useState<
    Record<string, { answered: number; correct: number }>
  >({});

  // AI Tutor (local to this view)
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorContext, setTutorContext] = useState<string | undefined>(undefined);
  const [tutorTitle, setTutorTitle] = useState<string | undefined>(undefined);
  const [tutorPrefill, setTutorPrefill] = useState<{
    message: string;
    key: number;
  } | null>(null);

  // Focus reading mode (Readwise pattern): hides the sidebar, narrows
  // the measure to ~65ch, larger type, warm key-term highlights.
  const [focusMode, setFocusMode] = useState(false);
  // Celebration message when a concept (or the whole guide) is mastered.
  const [celebration, setCelebration] = useState<string | null>(null);

  // Per-user error tracking for this guide copy — wrong answers become
  // weak spots, correct ones count toward mastering them. Private to the
  // signed-in user; never shared with a published or shared copy.
  const guideErrors = useGuideErrors(guideKey, userId);

  /** Record an answer: error tracking + XP/streak, and celebrate when a
   *  concept crosses into Mastered (2 correct in a row after a miss). */
  function recordAnswer(answer: ErrorAnswerInput) {
    const title = answer.conceptTitle.trim() || "Practice Quiz";
    const before = guideErrors.records.find((r) => r.conceptTitle === title);
    const after = applyAnswer(guideErrors.records, answer).find(
      (r) => r.conceptTitle === title
    );
    guideErrors.record(answer);
    recordActivityNow("question", { correct: answer.correct, userId });
    if (
      after &&
      after.misses > 0 &&
      after.correctStreak >= MASTERY_STREAK &&
      (!before || before.correctStreak < MASTERY_STREAK)
    ) {
      recordActivityNow("mastery", { userId });
      setCelebration(`Mastered: ${after.conceptTitle}`);
    }
  }

  // Celebrate once per session when every missed concept in this guide
  // is mastered.
  useEffect(() => {
    const withMisses = guideErrors.records.filter((r) => r.misses > 0);
    if (withMisses.length === 0) return;
    if (!withMisses.every((r) => r.correctStreak >= MASTERY_STREAK)) return;
    const key = `studysmart-mastered-guide:${guideKey ?? "local"}`;
    try {
      if (window.sessionStorage.getItem(key)) return;
      window.sessionStorage.setItem(key, "1");
    } catch {
      return;
    }
    setCelebration("Guide fully mastered");
  }, [guideErrors.records, guideKey]);

  /** "Explain simpler / deeper" — asks the tutor about one concept. */
  function explainConcept(
    level: "simpler" | "deeper",
    conceptTitle: string,
    definition: string
  ) {
    const message =
      level === "simpler"
        ? `Explain the concept "${conceptTitle}" in simpler terms, as if to a younger student. The definition given is: "${definition}". Use a short everyday analogy, then check I understood with one quick question.`
        : `Go deeper on the concept "${conceptTitle}". The definition given is: "${definition}". Explain the underlying idea in more depth, with a harder example and one thing that often confuses people about it.`;
    setTutorTitle(level === "simpler" ? "Explain it simpler" : "Go deeper");
    setTutorContext(undefined);
    setTutorPrefill({ message, key: Date.now() });
    setTutorOpen(true);
  }

  // Reading-time estimate from the real word count (200 wpm).
  const wordCount = useMemo(() => {
    const text = [
      result.studyGuide,
      result.summary ?? "",
      result.cheatSheet ?? "",
      ...modules.flatMap((m) => [
        m.title,
        m.intro ?? "",
        ...(m.coreIdeas ?? []),
        ...m.concepts.map(
          (c) =>
            `${c.title} ${c.formulaOrDefinition} ${c.example} ${c.explanation ?? ""}`
        ),
      ]),
    ].join(" ");
    return text.split(/\s+/).filter(Boolean).length;
  }, [result, modules]);
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));

  const totalPracticeProblems = modules.reduce(
    (n, m) => n + m.practice.reduce((a, g) => a + g.problems.length, 0),
    0
  );
  const totalCheckpointQuestions = modules.reduce(
    (n, m) => n + (m.checkpoint?.questions.length ?? 0),
    0
  );
  const totalFinalReview = result.finalReview?.questions.length ?? 0;
  const totalQuestions =
    totalPracticeProblems + totalCheckpointQuestions + totalFinalReview + quiz.length;
  const checkpointProgress = Object.values(checkpointByModule).reduce(
    (acc, v) => ({ answered: acc.answered + v.answered, correct: acc.correct + v.correct }),
    { answered: 0, correct: 0 }
  );
  const answeredTotal =
    practiceProgress.answered + checkpointProgress.answered + Object.keys(answers).length;
  const correctTotal =
    practiceProgress.correct +
    checkpointProgress.correct +
    quiz.filter((q, i) => answers[i] === q.correctAnswer).length;

  // Table of contents: guide sections + modules + concepts + key terms.
  const toc: TocEntry[] = useMemo(() => {
    const entries: TocEntry[] = [{ id: "overview", label: "Overview", kind: "section" }];
    if (result.objectives?.length)
      entries.push({ id: "objectives", label: "What you'll learn", kind: "section" });
    if (result.cheatSheet)
      entries.push({ id: "cheat-sheet", label: "Cheat sheet", kind: "section" });
    for (const m of modules) {
      entries.push({ id: `module-${m.moduleNumber}`, label: `Module ${m.moduleNumber}: ${m.title}`, kind: "module" });
      for (const c of m.concepts) {
        entries.push({ id: `module-${m.moduleNumber}`, label: c.title, kind: "concept" });
      }
    }
    if (result.keyTerms?.length)
      entries.push({ id: "glossary", label: "Glossary", kind: "section" });
    if (result.realWorldApplications?.length)
      entries.push({ id: "applications", label: "Real-world applications", kind: "section" });
    if (result.faq?.length)
      entries.push({ id: "faq", label: "Frequently asked questions", kind: "section" });
    if (result.finalReview?.questions.length)
      entries.push({ id: "final-review", label: "Final review", kind: "section" });
    if (modules.some((m) => m.practice.length > 0))
      entries.push({ id: "practice", label: "Targeted practice", kind: "section" });
    if (quiz.length > 0)
      entries.push({ id: "practice-quiz", label: "Practice quiz", kind: "section" });
    return entries;
  }, [modules, quiz.length, result]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return [];
    return toc.filter((e) => e.label.toLowerCase().includes(q)).slice(0, 8);
  }, [searchQuery, toc]);

  // Reading progress bar (page scroll) + which section is on screen.
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setScrollProgress(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const sections = Array.from(
      document.querySelectorAll<HTMLElement>("[data-guide-section]")
    );
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.getAttribute("data-guide-section") ?? "overview");
          }
        }
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [result]);

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setSearchQuery("");
  }

  function openWrongAnswerTutor(q: QuizQuestion, picked: string) {
    setTutorContext(
      `The quiz question was: "${q.question}". The options were: ${q.options.join("; ")}. The correct answer is "${q.correctAnswer}" but the student chose "${picked}". Explain why the chosen answer is wrong and why the correct answer is right.`
    );
    setTutorTitle("Why was this answer wrong?");
    setTutorOpen(true);
  }

  /** Answering a quiz question records it in this user's error tracking
   *  for this guide copy. */
  function pickQuizAnswer(qi: number, opt: string) {
    const q = quiz[qi];
    if (!q || answers[qi]) return;
    setAnswers((prev) => ({ ...prev, [qi]: opt }));
    recordAnswer({
      source: "quiz",
      moduleTitle: result.guideTitle ?? "Practice Quiz",
      conceptTitle: "Practice Quiz",
      question: q.question,
      picked: opt,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      correct: opt === q.correctAnswer,
    });
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

  let cardIndex = 0;
  const totalCards = modules.reduce((n, m) => n + m.concepts.length, 0);

  const sidebar = (
    <div className="space-y-4">
      <div className="card p-4">
        <label className="flex items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15">
          <Search className="h-4 w-4 shrink-0 text-ink-400" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search this guide…"
            aria-label="Search this guide"
            className="w-full bg-transparent text-sm outline-none placeholder:text-ink-400"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="text-xs font-bold text-ink-400 hover:text-ink-700"
            >
              ✕
            </button>
          )}
        </label>
        {searchQuery.trim().length >= 2 && (
          <div className="mt-2">
            {searchResults.length === 0 ? (
              <p className="px-1 py-2 text-xs font-medium text-ink-400">
                No matches in this guide.
              </p>
            ) : (
              <ul className="space-y-1">
                {searchResults.map((r) => (
                  <li key={`${r.kind}-${r.label}`}>
                    <button
                      type="button"
                      onClick={() => scrollToId(r.id)}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-xs font-semibold text-brand-700 hover:bg-brand-50"
                    >
                      <span className="mr-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-400">
                        {r.kind}
                      </span>
                      {r.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <nav aria-label="Guide contents" className="card p-4">
        <p className="flex items-center gap-2 text-sm font-bold tracking-tight text-ink-900">
          <ListTree className="h-4 w-4 text-brand-600" /> On this page
        </p>
        <div className="mt-3 flex items-center gap-3">
          <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center">
            <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden>
              <circle cx="24" cy="24" r="19" fill="none" strokeWidth="5" className="stroke-ink-100 dark:stroke-ink-700" />
              <circle cx="24" cy="24" r="19" fill="none" stroke="#6366f1" strokeWidth="5" strokeLinecap="round" strokeDasharray={2 * Math.PI * 19} strokeDashoffset={2 * Math.PI * 19 * (1 - scrollProgress / 100)} transform="rotate(-90 24 24)" />
            </svg>
            <span className="absolute text-[10px] font-extrabold text-ink-900">
              {Math.round(scrollProgress)}%
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink-500">Reading progress</p>
            <p className="text-xs font-medium text-ink-400">
              {readingMinutes} min read · {wordCount.toLocaleString()} words
            </p>
          </div>
        </div>
        <ul className="mt-3 space-y-0.5">
          {toc
            .filter((e) => e.kind !== "concept")
            .map((e) => (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => scrollToId(e.id)}
                  className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-sm transition ${
                    activeSection === e.id
                      ? "bg-brand-50 font-bold text-brand-700"
                      : "font-medium text-ink-600 hover:bg-ink-100/70 hover:text-ink-900"
                  }`}
                >
                  {e.label}
                </button>
              </li>
            ))}
        </ul>
      </nav>

      {totalQuestions > 0 && (
        <div className="card p-4">
          <p className="text-sm font-bold tracking-tight text-ink-900">Your progress</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-500">
            {correctTotal} of {totalQuestions} questions correct · {answeredTotal}{" "}
            answered
          </p>
          <div className="progress-track mt-2">
            <div
              className="progress-fill"
              style={{
                width: `${totalQuestions ? (answeredTotal / totalQuestions) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`mx-auto max-w-6xl px-4 pb-24 sm:px-6${focusMode ? " focus-mode" : ""}`}>
      {celebration && (
        <>
          <Confetti onDone={() => setCelebration(null)} />
          <div className="fixed bottom-5 left-1/2 z-[75] -translate-x-1/2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-lift">
            🎉 {celebration}!
          </div>
        </>
      )}
      {/* Reading progress bar */}
      <div className="fixed inset-x-0 top-0 z-50 h-1 bg-ink-100">
        <div
          className="h-full bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400 transition-all duration-150"
          style={{ width: `${scrollProgress}%` }}
        />
      </div>

      {/* Guide hero */}
      <div className="pt-6">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 transition hover:text-brand-700"
        >
          <ArrowLeft className="h-4 w-4" /> Back to StudySMART
        </Link>
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
              {result.guideTitle ?? "Study Guide"}
            </h1>
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-500">
              {result.topicType && (
                <span className="chip capitalize">{result.topicType}</span>
              )}
              {meta?.authorName && <span>by {meta.authorName}</span>}
              {meta?.createdAt && <span>· {formatDate(meta.createdAt)}</span>}
              {meta?.educationLevel && <span>· {meta.educationLevel}</span>}
              {meta?.testTiming && <span>· Test: {meta.testTiming}</span>}
              <span>· {readingMinutes} min read</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setFocusMode((v) => !v)}
              aria-pressed={focusMode}
              className="btn-secondary px-3 py-1.5 text-sm"
              title="Focus mode: hide the sidebar, narrow the text, larger type"
            >
              <Focus className="h-4 w-4 text-brand-600" />
              {focusMode ? "Exit focus" : "Focus mode"}
            </button>
            <span className="chip-amber">
              <GraduationCap className="h-3.5 w-3.5" /> Complete guide
            </span>
          </div>
        </div>
      </div>

      {/* Mastery summary + study plan, from this user's real answers and
          the test date they gave. */}
      <div className="mt-6 space-y-4">
        <MasterySummary records={guideErrors.records} />
        <StudyPlan testTiming={meta?.testTiming} modules={modules} />
      </div>

      {/* Mobile contents — hidden in focus mode */}
      {!focusMode && (
        <details className="card mt-6 p-4 lg:hidden">
          <summary className="cursor-pointer text-sm font-bold text-ink-900">
            Contents &amp; search
          </summary>
          <div className="mt-3">{sidebar}</div>
        </details>
      )}

      <div className={focusMode ? "mt-6" : "mt-6 grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]"}>
        <aside className={focusMode ? "hidden" : "hidden lg:block"}>
          <div className="sticky top-6 space-y-4">{sidebar}</div>
        </aside>

        <div className={focusMode ? "focus-measure min-w-0 space-y-5" : "min-w-0 space-y-5"}>
          {/* Overview */}
          <section id="overview" data-guide-section="overview" className="scroll-mt-6 space-y-5">
            {result.summary && (
              <div className="card p-5 sm:p-6">
                <h2 className="text-sm font-bold tracking-tight text-ink-900">Summary</h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-600">{result.summary}</p>
              </div>
            )}
          </section>

          {/* Objectives */}
          {result.objectives && result.objectives.length > 0 && (
            <section id="objectives" data-guide-section="objectives" className="scroll-mt-6">
              <div className="card p-5 sm:p-6">
                <h2 className="text-base font-bold tracking-tight text-ink-900">
                  What you&apos;ll learn
                </h2>
                <ul className="mt-3 space-y-2">
                  {result.objectives.map((objective, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-600">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xs font-extrabold text-brand-700">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{objective}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* Cheat sheet */}
          {result.cheatSheet && (
            <section id="cheat-sheet" data-guide-section="cheat-sheet" className="scroll-mt-6">
              <div className="card overflow-hidden">
                <div className="border-b border-ink-100 bg-gradient-to-r from-brand-50 to-accent-50 px-5 py-4 sm:px-6">
                  <h2 className="text-base font-bold tracking-tight text-ink-900">
                    Cheat sheet — the whole guide on one page
                  </h2>
                  <p className="mt-0.5 text-xs font-medium text-ink-400">
                    Glance at this right before the test.
                  </p>
                </div>
                <article className="markdown p-5 sm:p-6">
                  <ReactMarkdown>{result.cheatSheet}</ReactMarkdown>
                </article>
              </div>
            </section>
          )}

          {/* Modules */}
          {modules.map((mod) => {
            const isVocabulary = (mod.format ?? "").toLowerCase().includes("vocab");
            const isCoreIdeas = (mod.format ?? "").toLowerCase().includes("core");
            const collapsed = collapsedModules[mod.moduleNumber] ?? false;
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
                        <span className="flex items-center gap-1.5">
                          <MasteryBadge
                            record={guideErrors.records.find(
                              (r) => r.conceptTitle === concept.title
                            )}
                          />
                          <span className="text-xs font-semibold text-ink-400">
                            Card {thisCard} of {totalCards}
                          </span>
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
                        <p className="eyebrow mt-1.5">{concept.category}</p>
                      )}
                      <p className="mt-3 rounded-xl bg-brand-50/70 px-3.5 py-2.5 font-mono text-sm font-semibold leading-relaxed text-brand-800 ring-1 ring-inset ring-brand-100">
                        {concept.formulaOrDefinition}
                      </p>
                      <p className="mt-3 text-sm leading-relaxed text-ink-500">
                        <strong className="font-bold text-ink-800">Example:</strong>{" "}
                        {concept.example}
                      </p>
                      {concept.explanation && (
                        <p className="mt-3 text-sm leading-relaxed text-ink-600">
                          <strong className="font-bold text-ink-800">How it works:</strong>{" "}
                          {concept.explanation}
                        </p>
                      )}
                      {concept.commonMistake && (
                        <p className="mt-2 rounded-xl bg-rose-50/80 px-3 py-2 text-sm leading-relaxed text-rose-800 ring-1 ring-inset ring-rose-100">
                          <strong className="font-bold">Common mistake:</strong>{" "}
                          {concept.commonMistake}
                        </p>
                      )}
                      {concept.tip && (
                        <p className="mt-2 rounded-xl bg-amber-50/80 px-3 py-2 text-sm leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
                          <strong className="font-bold">Watch out:</strong> {concept.tip}
                        </p>
                      )}
                      {concept.memoryTip && (
                        <p className="mt-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-sm leading-relaxed text-emerald-800 ring-1 ring-inset ring-emerald-100">
                          <strong className="font-bold">Remember it:</strong>{" "}
                          {concept.memoryTip}
                        </p>
                      )}
                      <ExplainButtons
                        conceptTitle={concept.title}
                        definition={concept.formulaOrDefinition}
                        onExplain={explainConcept}
                      />
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
                <h3 className="text-base font-bold tracking-tight">Core ideas</h3>
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
              <section
                key={mod.moduleNumber}
                id={`module-${mod.moduleNumber}`}
                data-guide-section={`module-${mod.moduleNumber}`}
                className="scroll-mt-6 space-y-5"
              >
                <div className="card relative overflow-hidden p-5 sm:p-6">
                  <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-brand-500 to-accent-400" />
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedModules((prev) => ({
                        ...prev,
                        [mod.moduleNumber]: !collapsed,
                      }))
                    }
                    aria-expanded={!collapsed}
                    className="block w-full pl-2 text-left"
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="eyebrow">
                        Module {mod.moduleNumber}
                        {mod.format ? ` · ${mod.format}` : ""}
                      </span>
                      <span className="flex items-center gap-2">
                        {isVocabulary && <span className="chip-amber">Spotlight</span>}
                        {collapsed ? (
                          <ChevronDown className="h-5 w-5 text-ink-400" />
                        ) : (
                          <ChevronUp className="h-5 w-5 text-ink-400" />
                        )}
                      </span>
                    </span>
                    <span className="mt-1.5 block text-2xl font-extrabold tracking-tight text-ink-900">
                      {mod.title}
                    </span>
                    {mod.intro && (
                      <span className="mt-1 block text-sm leading-relaxed text-ink-400">
                        {mod.intro}
                      </span>
                    )}
                  </button>
                </div>

                {!collapsed && (
                  <>
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
                      <ShowYourReasoning
                        example={mod.reasoningExample}
                        moduleTitle={mod.title}
                        conceptTitle={mod.concepts[0]?.title ?? mod.title}
                        onAnswer={recordAnswer}
                      />
                    )}
                    {mod.checkpoint && (
                      <SectionCheckpoint
                        moduleTitle={mod.title}
                        questions={mod.checkpoint.questions}
                        onAnswer={recordAnswer}
                        onFinish={() =>
                          recordActivityNow("section", { userId })
                        }
                        onProgress={(answered, correct) =>
                          setCheckpointByModule((prev) => ({
                            ...prev,
                            [`module-${mod.moduleNumber}`]: { answered, correct },
                          }))
                        }
                      />
                    )}
                  </>
                )}
              </section>
            );
          })}

          {/* Glossary */}
          {result.keyTerms && result.keyTerms.length > 0 && (
            <section id="glossary" data-guide-section="glossary" className="scroll-mt-6">
              <div className="card p-5 sm:p-6">
                <h2 className="text-base font-bold tracking-tight text-ink-900">Glossary</h2>
                <p className="mt-1 text-xs font-medium text-ink-400">
                  Key terms and definitions for this topic.
                </p>
                <dl className="mt-3 space-y-2">
                  {result.keyTerms.map((kt) => (
                    <div key={kt.term} className="text-sm leading-relaxed">
                      <dt className="inline font-bold text-ink-900">{kt.term}: </dt>
                      <dd className="inline text-ink-600">{kt.definition}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </section>
          )}

          {/* Real-world applications */}
          {result.realWorldApplications && result.realWorldApplications.length > 0 && (
            <section id="applications" data-guide-section="applications" className="scroll-mt-6">
              <div className="card p-5 sm:p-6">
                <h2 className="text-base font-bold tracking-tight text-ink-900">
                  Where this shows up in real life
                </h2>
                <ul className="mt-3 space-y-2">
                  {result.realWorldApplications.map((app, i) => (
                    <li key={i} className="flex gap-3 text-sm leading-relaxed text-ink-600">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-100 text-xs font-extrabold text-accent-700">
                        {i + 1}
                      </span>
                      <span className="pt-0.5">{app}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          )}

          {/* FAQ */}
          {result.faq && result.faq.length > 0 && (
            <section id="faq" data-guide-section="faq" className="scroll-mt-6">
              <div className="card p-5 sm:p-6">
                <h2 className="text-base font-bold tracking-tight text-ink-900">
                  Frequently asked questions
                </h2>
                <div className="mt-3 space-y-2">
                  {result.faq.map((item, i) => (
                    <details
                      key={i}
                      className="rounded-xl border border-ink-100 bg-white px-4 py-3"
                    >
                      <summary className="cursor-pointer text-sm font-bold leading-relaxed text-ink-900">
                        {item.question}
                      </summary>
                      <p className="mt-2 text-sm leading-relaxed text-ink-600">{item.answer}</p>
                    </details>
                  ))}
                </div>
              </div>
            </section>
          )}

          {/* Final review */}
          {result.finalReview && result.finalReview.questions.length > 0 && (
            <section id="final-review" data-guide-section="final-review" className="scroll-mt-6">
              <h2 className="text-xl font-extrabold tracking-tight">
                Final review — test yourself on the whole guide
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-400">
                One question at a time. Finish it to see your score.
              </p>
              <div className="mt-4">
                <SectionCheckpoint
                  moduleTitle="Final review"
                  questions={result.finalReview.questions}
                  onAnswer={recordAnswer}
                  onProgress={(answered, correct) =>
                    setCheckpointByModule((prev) => ({
                      ...prev,
                      final: { answered, correct },
                    }))
                  }
                />
              </div>
            </section>
          )}

          {/* Targeted practice */}
          {modules.length > 0 && (
            <section id="practice" data-guide-section="practice" className="scroll-mt-6">
              <TargetedPractice
                modules={modules}
                onAskTutor={openPracticeTutor}
                onAnswer={recordAnswer}
                onProgress={(answered, correct) => setPracticeProgress({ answered, correct })}
              />
            </section>
          )}

          {/* Personalized practice from this user's own errors on this
              guide copy — never from another user's data, and never from
              a published or shared copy. */}
          <PersonalizedPractice
            guideTitle={result.guideTitle ?? "Study guide"}
            educationLevel={meta?.educationLevel ?? ""}
            weak={guideErrors.weak}
            mastered={guideErrors.mastered}
            signedIn={Boolean(userId)}
            onAnswer={recordAnswer}
            onClearErrors={guideErrors.clear}
          />

          {/* Full Markdown guide */}
          <section className="space-y-5">
            <article className="markdown card p-5 sm:p-7">
              <ReactMarkdown>{result.studyGuide}</ReactMarkdown>
            </article>
          </section>

          {/* Key concepts */}
          {result.keyConcepts.length > 0 && (
            <div className="card p-5">
              <h2 className="text-sm font-bold tracking-tight text-ink-900">Key Concepts</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.keyConcepts.map((concept, i) => (
                  <span key={i} className="chip">
                    {concept}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Videos that explain this topic */}
          <GuideVideos
            topic={result.guideTitle ?? "Study guide"}
            moduleTitles={modules.map((m) => m.title)}
            guideKey={
              guideKey ??
              `${result.guideTitle}::${result.studyGuide.length}`
            }
          />

          {/* Practice quiz */}
          {quiz.length > 0 && (
            <section id="practice-quiz" data-guide-section="practice-quiz" className="scroll-mt-6 space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-xl font-extrabold tracking-tight">Practice Quiz</h2>
                <button
                  type="button"
                  onClick={() => setQuizOpen((v) => !v)}
                  className="btn-secondary px-3 py-1.5 text-sm"
                >
                  <Lightbulb className="h-4 w-4" />
                  {quizOpen ? "Hide quiz" : `Start quiz (${quiz.length} questions)`}
                </button>
              </div>
              {quizOpen && (
                <div className="space-y-5">
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
                                onClick={() => pickQuizAnswer(qi, opt)}
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
            </section>
          )}

          <p className="flex items-center gap-2 pt-2 text-center text-xs font-medium text-ink-400">
            <BookOpen className="h-4 w-4" />
            Generated on demand by StudySMART — nothing pre-made.
          </p>
        </div>
      </div>

      <TutorPanel
        open={tutorOpen}
        onClose={() => setTutorOpen(false)}
        studyGuide={result.studyGuide}
        context={tutorContext}
        title={tutorTitle}
        prefill={tutorPrefill}
      />
    </div>
  );
}
