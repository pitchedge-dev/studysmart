"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import ReactMarkdown from "react-markdown";
import {
  BookOpen,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  FileUp,
  Globe,
  GraduationCap,
  ImagePlus,
  Library,
  Lightbulb,
  Loader2,
  Menu,
  MessageSquareHeart,
  Moon,
  Pencil,
  RotateCcw,
  Sparkles,
  Sun,
  Swords,
  TrendingUp,
  Trophy,
  Upload,
  User,
  UserPlus,
  Users,
  Wand2,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import TutorPanel from "@/components/TutorPanel";
import BattleArena, { type GameData } from "@/components/BattleArena";
import TargetedPractice, { type StudyModule } from "@/components/TargetedPractice";
import PersonalizedPractice from "@/components/PersonalizedPractice";
import {
  applyAnswer,
  loadErrors,
  localGuideKey,
  MASTERY_STREAK,
  saveErrors,
  useGuideErrors,
  type ErrorAnswerInput,
} from "@/lib/errorTracking";
import { useActivity } from "@/lib/activity";
import { computeAchievementStats, useAchievements } from "@/lib/achievements";
import Achievements from "@/components/Achievements";
import { dueCount as dueCountOf, loadAllErrors } from "@/lib/review";
import {
  hasEnrichment,
  requestEnrichment,
  type EnrichmentFields,
} from "@/lib/enrichGuide";
import { getTheme, toggleTheme } from "@/lib/theme";
import {
  applyStyle,
  getStyle,
  loadStyleFromProfile,
  type StyleId,
} from "@/lib/style";
import ThemePicker from "@/components/ThemePicker";
import StreakWidget from "@/components/StreakWidget";
import CommandPalette, { type PaletteAction } from "@/components/CommandPalette";
import ReviewQueue from "@/components/ReviewQueue";
import FocusTimer from "@/components/FocusTimer";
import TeachBack, { type TeachBackResult } from "@/components/TeachBack";
import Confetti from "@/components/Confetti";
import { MasteryBadge, MasterySummary } from "@/components/MasteryBadge";
import StudyPlan from "@/components/StudyPlan";
import ExplainButtons from "@/components/ExplainButtons";
import EmptyState from "@/components/EmptyState";
import Pronunciation from "@/components/Pronunciation";
import ShowYourReasoning from "@/components/ShowYourReasoning";
import SectionCheckpoint from "@/components/SectionCheckpoint";
import GuideVideos from "@/components/GuideVideos";
import GivenResources from "@/components/GivenResources";
import {
  writePendingArenaExport,
  type ArenaExportSource,
} from "@/lib/arenaExport";
import type { GivenResource } from "@/lib/guideSchema";
import PreTest from "@/components/PreTest";
import WhyWrongList, { type WhyWrongEntryLike } from "@/components/WhyWrongList";
import ProgressDashboard from "@/components/ProgressDashboard";
import GuideNavBar, { type GuideNavSection } from "@/components/GuideNavBar";
import FeedbackModal from "@/components/FeedbackModal";
import GeneratingPopup, {
  type GeneratingStage,
  shouldShowGeneratingPill,
  shouldShowGeneratingPopup,
  formatElapsed,
} from "@/components/GeneratingPopup";
import WelcomeModal, { hasSeenWelcome } from "@/components/WelcomeModal";
import MeetYourBots from "@/components/MeetYourBots";
import {
  STUDY_HOURS_OPTIONS,
  studyHoursLabel,
  thinGuideNote,
} from "@/lib/studyTime";
import AuthModal from "@/components/AuthModal";
import YourGuides from "@/components/YourGuides";
import Browse from "@/components/Browse";
import Friends, { type FriendEntry } from "@/components/Friends";
import {
  getGuideById,
  getMyProfile,
  getProfilesByIds,
  getSupabase,
  listFriendships,
  saveGuideToAccount,
  updateGuideContent,
  type AppUser,
  type Profile,
} from "@/lib/supabase";

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
  /** One entry per wrong option, saying why it is wrong. */
  whyWrong?: WhyWrongEntryLike[];
};

export type GenerateResult = {
  topicType?: string;
  languageCode?: string;
  guideTitle?: string;
  studyGuide: string;
  summary?: string;
  /** "How long will you study?" — echoed back by /api/generate. */
  studyHours?: string;
  keyTerms?: { term: string; definition: string }[];
  keyConcepts: string[];
  modules?: StudyModule[];
  quiz?: QuizQuestion[];
  /** Learning objectives — added by the enrichment pass. */
  objectives?: string[];
  /** One-page cheat sheet in Markdown — added by the enrichment pass. */
  cheatSheet?: string;
  /** Real-world applications — added by the enrichment pass. */
  realWorldApplications?: string[];
  /** Frequently asked questions — added by the enrichment pass. */
  faq?: { question: string; answer: string }[];
  /** Final review quiz covering the whole guide. */
  finalReview?: { questions: QuizQuestion[] };
  /** Materials the teacher gave for this unit (files uploaded when generating). */
  givenResources?: GivenResource[];
};

type Section = "generate" | "my-guides" | "browse" | "arena" | "review" | "friends" | "achievements" | "progress";
type ResultView = "guide" | "quiz";

/** Keyboard shortcuts shown by the `?` help overlay — every one of
 *  these is wired up (see the keydown effect and CommandPalette). */
const SHORTCUTS: Array<{ keys: string; description: string }> = [
  { keys: "Ctrl/⌘ K", description: "Open the command palette" },
  { keys: "?", description: "Show this shortcut help" },
  { keys: "G then D", description: "Go to Generate" },
  { keys: "G then G", description: "Go to Your Study Guides" },
  { keys: "G then B", description: "Go to Browse" },
  { keys: "G then A", description: "Go to Battle Arena" },
  { keys: "G then R", description: "Go to Review queue" },
  { keys: "G then P", description: "Go to My Progress" },
  { keys: "G then F", description: "Go to Friends" },
  { keys: "G then C", description: "Go to Achievements" },
  { keys: "1–4", description: "Answer a Review question (in the Review queue)" },
  { keys: "Enter", description: "Continue to the next Review question" },
];

/** The top nav bar is the section navigation — one section at a time. */
const NAV_LINKS: { id: Section; label: string; icon: typeof Wand2 }[] = [
  { id: "generate", label: "Generate", icon: Wand2 },
  { id: "my-guides", label: "Your Study Guides", icon: Library },
  { id: "browse", label: "Browse", icon: Globe },
  { id: "arena", label: "Battle Arena", icon: Swords },
  { id: "review", label: "Review", icon: RotateCcw },
  { id: "progress", label: "Progress", icon: TrendingUp },
  { id: "friends", label: "Friends", icon: Users },
  { id: "achievements", label: "Achievements", icon: Trophy },
];

type UploadedFile = {
  name: string;
  size: number;
  kind: "text" | "image";
  /** Extracted text for text/PDF files. */
  text?: string;
  /** Data URL for images (sent to Gemini as image input). */
  dataUrl?: string;
};

const MAX_TOTAL_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB across all files
const MAX_PDF_PAGES = 50;
const MAX_FILE_CHARS = 100000;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function Home() {
  const router = useRouter();
  const [inputText, setInputText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [fileNotice, setFileNotice] = useState<string | null>(null);
  const [includeQuiz, setIncludeQuiz] = useState(true);
  const [extractConcepts, setExtractConcepts] = useState(true);
  const [educationLevel, setEducationLevel] = useState("");
  const [testTiming, setTestTiming] = useState("");
  // "How long will you study?" — nothing pre-selected; no choice means
  // standard depth. Scales how deep the generated guide is.
  const [studyHours, setStudyHours] = useState("");
  const [loading, setLoading] = useState(false);
  // "Generating" popup state — the popup explains the wait while a
  // guide is being built. `generatingStage` advances only on real
  // milestones the frontend knows (see components/GeneratingPopup.tsx):
  // the /api/generate request is in flight ("providers"), the response
  // arrived ("checking"), the background enrich pass started
  // ("finishing"). Hiding the popup never cancels the request — the
  // guide still appears when it is done.
  const [generatingStage, setGeneratingStage] =
    useState<GeneratingStage>("providers");
  const [generatingStartedAt, setGeneratingStartedAt] = useState<
    number | null
  >(null);
  const [generatingElapsedMs, setGeneratingElapsedMs] = useState(0);
  const [generatingPopupHidden, setGeneratingPopupHidden] = useState(false);
  // Elapsed-time ticker for the popup (and its reopen pill): one
  // interval while generation runs, stopped the moment it ends.
  useEffect(() => {
    if (!loading || generatingStartedAt === null) return;
    const tick = () => setGeneratingElapsedMs(Date.now() - generatingStartedAt);
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [loading, generatingStartedAt]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [section, setSection] = useState<Section>("generate");
  const [resultView, setResultView] = useState<ResultView>("guide");
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  // Row id of the just-generated guide once it is saved to the account —
  // the post-generation Builder Bot banner links to it.
  const [savedGuideId, setSavedGuideId] = useState<string | null>(null);

  // Welcome popup: show once, the first time the app is opened. The
  // flag lives in localStorage; the popup is reopenable from the header
  // ("How it works") and the command palette ("Show welcome").
  useEffect(() => {
    if (!hasSeenWelcome()) setWelcomeOpen(true);
  }, []);

  // Account / library state
  const [user, setUser] = useState<AppUser | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authInitialMode, setAuthInitialMode] =
    useState<"signin" | "signup">("signin");
  // Open the account modal on a specific tab — "Sign in" for existing
  // users, "Make an account" for new ones. The mode resets on every
  // open, so a previous choice never leaks into the next one.
  function openSignIn() {
    setAuthInitialMode("signin");
    setAuthOpen(true);
  }
  function openSignUp() {
    setAuthInitialMode("signup");
    setAuthOpen(true);
  }
  const [friends, setFriends] = useState<FriendEntry[]>([]);
  const [savedGame, setSavedGame] = useState<{
    game: GameData;
    topic: string;
    key: number;
  } | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  // Streaks + XP + daily goal, from real activity only (0 for a new user).
  const activity = useActivity(user?.id ?? null);

  // Achievements — evaluated from real activity only (see
  // lib/achievements.ts). Study hours come from measured focus-timer
  // sessions; nothing here is granted for opening the app.
  const achievementStats = useMemo(
    () =>
      computeAchievementStats(
        activity.state.days,
        activity.streak,
        activity.xp
      ),
    [activity.state.days, activity.streak, activity.xp]
  );
  const achievements = useAchievements(user?.id ?? null, achievementStats);
  const [darkMode, setDarkMode] = useState(false);
  const [celebration, setCelebration] = useState<string | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [tutorPrefill, setTutorPrefill] = useState<{
    message: string;
    key: number;
  } | null>(null);

  // Dark mode follows the saved preference (lib/theme.ts).
  useEffect(() => {
    setDarkMode(getTheme() === "dark");
  }, []);

  function toggleDark() {
    setDarkMode(toggleTheme() === "dark");
  }

  // Site style follows the saved preference (lib/style.ts). When signed
  // in, the profile's saved style wins so the look follows the user.
  const [style, setStyle] = useState<StyleId>("indigo");
  useEffect(() => {
    setStyle(getStyle());
  }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    loadStyleFromProfile(user.id).then((saved) => {
      if (!cancelled && saved && saved !== getStyle()) {
        applyStyle(saved, user.id);
        setStyle(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Celebrate a streak milestone (3/7/14/30 days) once, when crossed.
  useEffect(() => {
    if (activity.milestone !== null) {
      setCelebration(`🔥 ${activity.milestone}-day streak!`);
    }
  }, [activity.milestone]);

  // Deep link from a standalone guide's "Turn into Battle Arena" button:
  // /?arena=1 opens the Arena, which consumes the pending export and
  // auto-generates the game templates from that guide.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("arena") === "1") {
      params.delete("arena");
      const rest = params.toString();
      window.history.replaceState(
        null,
        "",
        window.location.pathname + (rest ? `?${rest}` : "")
      );
      goToSection("arena");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // How many weak concepts are due for review (nav badge).
  useEffect(() => {
    let cancelled = false;
    loadAllErrors(user?.id ?? null)
      .then((entries) => {
        if (!cancelled) setDueCount(dueCountOf(entries));
      })
      .catch(() => {
        if (!cancelled) setDueCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, [user, section]);

  // "Continue where you left off" must never point at a guide this
  // session cannot open. The entry lives in localStorage, so it can
  // outlive its guide: the guide may have been deleted, or it may be
  // private to another account while this browser is signed out (the
  // "Guide not found" dead end). Validate the saved entry whenever it
  // changes and whenever the sign-in changes; clear it when the guide
  // is unreadable. An entry with no guide id is an unsaved in-session
  // guide, which is gone after a reload — clear that too.
  const lastGuideId = activity.state.lastGuide?.guideId ?? null;
  useEffect(() => {
    const entry = activity.state.lastGuide;
    if (!entry) return;
    if (!entry.guideId) {
      activity.clearLastGuide();
      return;
    }
    let cancelled = false;
    getGuideById(entry.guideId).then((found) => {
      if (!cancelled && !found) activity.clearLastGuide();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastGuideId, user?.id]);

  // `g` then a letter jumps to a section (Linear-style, reliable only
  // because every target is a real section). Never fires while typing.
  const gPendingRef = useRef(false);
  // Generation counter: each call to generate() bumps it, so a
  // background /api/enrich result can tell whether the student has
  // already generated a newer guide (and drop its own result then).
  const enrichmentTokenRef = useRef(0);
  // Finishing-sections status for the guide on screen: while the
  // background enrichment is running the guide shows a subtle
  // "Adding finishing sections…" line; if every retry fails it shows
  // a Retry button instead of silently leaving the sections out
  // (2026-11-26: a one-shot background call failed and the five
  // sections were permanently absent with nothing saying so).
  const [enrichmentStatus, setEnrichmentStatus] = useState<
    "idle" | "pending" | "done" | "failed"
  >("idle");
  // The notes/images the last enrichment ran on, so the Retry button
  // can re-fire it for the same guide.
  const lastEnrichInputRef = useRef<{
    notes: string;
    images: string[];
    generated: GenerateResult;
    savedId: string | null;
  } | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      )
        return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (gPendingRef.current) {
        gPendingRef.current = false;
        const map: Record<string, Section> = {
          d: "generate",
          g: "my-guides",
          b: "browse",
          a: "arena",
          r: "review",
          p: "progress",
          f: "friends",
          c: "achievements",
        };
        const next = map[e.key.toLowerCase()];
        if (next) {
          e.preventDefault();
          goToSection(next);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        gPendingRef.current = true;
        window.setTimeout(() => {
          gPendingRef.current = false;
        }, 1200);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Guide navigation state
  const [collapsedModules, setCollapsedModules] = useState<Record<number, boolean>>({});
  const [showBackToTop, setShowBackToTop] = useState(false);
  // In-guide nav bar (inline guide view): which section is on screen + reading progress.
  const [activeInlineSection, setActiveInlineSection] = useState("overview");
  const [inlineScrollProgress, setInlineScrollProgress] = useState(0);

  // Per-user error tracking for the guide currently on screen — one copy,
  // one key. Saved guides use their row id; unsaved in-session guides use
  // a content hash. Errors are private to this user and never travel with
  // a published or shared guide.
  const [currentGuideId, setCurrentGuideId] = useState<string | null>(null);
  const guideErrors = useGuideErrors(currentGuideId, user?.id ?? null);

  /** Record an answer: error tracking + XP/streak, and celebrate when a
   *  concept crosses into Mastered (2 correct in a row after a miss). */
  function recordAnswer(answer: ErrorAnswerInput) {
    const title = answer.conceptTitle.trim() || "Practice Quiz";
    const before = guideErrors.records.find((r) => r.conceptTitle === title);
    const after = applyAnswer(guideErrors.records, answer).find(
      (r) => r.conceptTitle === title
    );
    guideErrors.record(answer);
    activity.recordQuestion(answer.correct);
    if (
      after &&
      after.misses > 0 &&
      after.correctStreak >= MASTERY_STREAK &&
      (!before || before.correctStreak < MASTERY_STREAK)
    ) {
      activity.recordConceptMastered();
      setCelebration(`Mastered: ${after.conceptTitle}`);
    }
  }

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

  /**
   * "Teach it back" grading → error tracking. A strong explanation
   * (8+/10) counts as a correct answer for the concept; a weak one
   * (4 or less) counts as a miss, so the concept comes back in the
   * Review queue. Middle scores (5–7) leave tracking untouched.
   */
  function handleTeachBack(
    moduleTitle: string,
    conceptTitle: string,
    result: TeachBackResult
  ) {
    if (result.score >= 8) {
      recordAnswer({
        source: "teachback",
        moduleTitle,
        conceptTitle,
        question: `Teach it back: ${conceptTitle}`,
        picked: "Explained from memory",
        correctAnswer: "Complete, accurate explanation",
        explanation: result.feedback,
        correct: true,
      });
    } else if (result.score <= 4) {
      recordAnswer({
        source: "teachback",
        moduleTitle,
        conceptTitle,
        question: `Teach it back: ${conceptTitle}`,
        picked: "Explanation had gaps",
        correctAnswer: "Complete, accurate explanation",
        explanation:
          result.missingPoints[0] ??
          result.misconceptions[0] ??
          result.feedback,
        correct: false,
      });
    }
  }

  /** Post-game "Review your misses": Battle Arena misses become weak
   *  concepts on an arena guide key, so the Review queue picks them up
   *  (due tomorrow, then 1 → 3 → 7 → 16 days). */
  async function handleArenaMisses(
    misses: Array<{
      question: string;
      picked: string;
      correctAnswer: string;
      explanation: string;
    }>
  ) {
    const topic = result?.guideTitle ?? savedGame?.topic ?? "Battle Arena";
    const key = `arena:${topic.slice(0, 80)}`;
    try {
      const records = await loadErrors(user?.id ?? null, key);
      let next = records;
      for (const m of misses) {
        next = applyAnswer(next, {
          source: "quiz",
          moduleTitle: topic,
          conceptTitle: `${topic} — Arena`,
          question: m.question,
          picked: m.picked,
          correctAnswer: m.correctAnswer,
          explanation: m.explanation,
          correct: false,
        });
      }
      await saveErrors(user?.id ?? null, key, next);
    } catch {
      // Best effort — the misses just won't appear in the queue.
    }
    goToSection("review");
  }

  // Command palette actions — every one of these really works.
  const paletteActions: PaletteAction[] = [
    { id: "go-generate", label: "Go to Generate", group: "Navigate", hint: "G D", run: () => goToSection("generate") },
    { id: "go-guides", label: "Go to Your Study Guides", group: "Navigate", hint: "G G", run: () => goToSection("my-guides") },
    { id: "go-browse", label: "Go to Browse", group: "Navigate", hint: "G B", run: () => goToSection("browse") },
    { id: "go-arena", label: "Start Battle Arena", group: "Navigate", hint: "G A", run: () => goToSection("arena") },
    { id: "go-review", label: "Open Review queue", group: "Navigate", hint: "G R", run: () => goToSection("review") },
    { id: "go-friends", label: "Go to Friends", group: "Navigate", hint: "G F", run: () => goToSection("friends") },
    { id: "go-achievements", label: "View Achievements", group: "Navigate", hint: "G C", run: () => goToSection("achievements") },
    ...(activity.state.lastGuide?.guideId
      ? [
          {
            id: "continue",
            label: `Continue: ${activity.state.lastGuide.title}`,
            group: "Guide",
            run: () => openGuideDetail(activity.state.lastGuide!.guideId!),
          },
        ]
      : []),
    {
      id: "toggle-dark",
      label: darkMode ? "Switch to light mode" : "Switch to dark mode",
      group: "Appearance",
      run: toggleDark,
    },
    {
      id: "change-style",
      label: "Change site style",
      group: "Appearance",
      run: () =>
        window.dispatchEvent(new Event("studysmart:open-style-picker")),
    },
    { id: "open-tutor", label: "Open AI tutor", group: "Actions", run: () => setTutorOpen(true) },
    { id: "show-welcome", label: "Show welcome — how StudySMART works", group: "Help", run: () => setWelcomeOpen(true) },
    { id: "give-feedback", label: "Give feedback", group: "Help", run: () => setFeedbackOpen(true) },
  ];

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

  // Switching sections never clears the input or the generated guide —
  // all of that state lives here and survives the switch.
  function goToSection(next: Section) {
    setSection(next);
    setMenuOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---- Account session -------------------------------------------------
  async function refreshAuth() {
    const sb = getSupabase();
    if (!sb) {
      setUser(null);
      setProfile(null);
      return;
    }
    const { data } = await sb.auth.getSession();
    const sessionUser = data.session?.user ?? null;
    setUser(sessionUser);
    setProfile(
      sessionUser ? await getMyProfile(sessionUser.id) : null
    );
  }

  useEffect(() => {
    refreshAuth();
    const sb = getSupabase();
    if (!sb) return;
    const { data: listener } = sb.auth.onAuthStateChange(() => {
      refreshAuth();
    });
    return () => listener.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the accepted-friends list loaded for Your Study Guides'
  // send-to-friend dropdown, even when the Friends section is not on screen.
  useEffect(() => {
    if (!user) {
      setFriends([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const list = await listFriendships(user.id);
      const ids = list.flatMap((r) => [r.requester_id, r.addressee_id]);
      const found = await getProfilesByIds([...new Set(ids)]);
      const byId: Record<string, Profile> = {};
      for (const p of found) byId[p.user_id] = p;
      if (cancelled) return;
      setFriends(
        list
          .filter((r) => r.status === "accepted")
          .map((r) => ({
            friendshipId: r.id,
            profile:
              byId[
                r.requester_id === user.id ? r.addressee_id : r.requester_id
              ] ?? null,
          }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  useEffect(() => {
    const onScroll = () => setShowBackToTop(window.scrollY > 600);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string) || "");
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsText(file);
    });
  }

  function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Could not read file."));
      reader.readAsDataURL(file);
    });
  }

  async function extractPdfText(file: File): Promise<string> {
    // pdfjs-dist is loaded in the browser only, on demand.
    const pdfjs = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${"6.5.438"}/build/pdf.worker.min.mjs`;
    const buffer = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pages = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const chunks: string[] = [];
    for (let i = 1; i <= pages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      chunks.push(
        content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
      );
    }
    return chunks.join("\n");
  }

  /** Upload .pdf / .txt / .md / .csv files and images. Text is extracted in
   *  the browser and appended to the notes at generate time; images keep the
   *  existing image path to Gemini. */
  async function handleUploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setFileNotice(null);
    const incoming = Array.from(files);
    const currentTotal = uploadedFiles.reduce((n, f) => n + f.size, 0);
    const incomingTotal = incoming.reduce((n, f) => n + f.size, 0);
    if (currentTotal + incomingTotal > MAX_TOTAL_UPLOAD_BYTES) {
      setFileNotice(
        `Those files are too large to process — keep total uploads under ${formatBytes(MAX_TOTAL_UPLOAD_BYTES)}.`
      );
      return;
    }
    const done: UploadedFile[] = [];
    for (const file of incoming) {
      const lower = file.name.toLowerCase();
      try {
        if (/\.(png|jpe?g|webp)$/.test(lower)) {
          const dataUrl = await readFileAsDataUrl(file);
          setImages((prev) => [...prev, dataUrl]);
          done.push({ name: file.name, size: file.size, kind: "image", dataUrl });
        } else if (/\.pdf$/.test(lower)) {
          const text = await extractPdfText(file);
          if (!text.trim()) {
            setFileNotice(
              `Could not read any text from ${file.name} — it may be a scanned image PDF.`
            );
            continue;
          }
          done.push({
            name: file.name,
            size: file.size,
            kind: "text",
            text: text.slice(0, MAX_FILE_CHARS),
          });
        } else if (/\.(txt|md|csv)$/.test(lower)) {
          const text = await readFileAsText(file);
          done.push({
            name: file.name,
            size: file.size,
            kind: "text",
            text: text.slice(0, MAX_FILE_CHARS),
          });
        } else {
          setFileNotice(
            `${file.name} is not a supported file type. Upload .pdf, .txt, .md, .csv, or an image.`
          );
        }
      } catch {
        setFileNotice(`Could not read ${file.name}. Try a different file.`);
      }
    }
    if (done.length > 0) {
      setUploadedFiles((prev) => [...prev, ...done]);
    }
  }

  function removeUploadedFile(index: number) {
    setUploadedFiles((prev) => {
      const removed = prev[index];
      if (removed?.kind === "image" && removed.dataUrl) {
        setImages((imgs) => imgs.filter((src) => src !== removed.dataUrl));
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  const fileTextChars = uploadedFiles.reduce(
    (n, f) => n + (f.text?.length ?? 0),
    0
  );
  const combinedNotes = [
    inputText.trim(),
    ...uploadedFiles
      .filter((f) => f.kind === "text" && f.text?.trim())
      .map((f) => `--- From file: ${f.name} ---\n${f.text}`),
  ]
    .filter(Boolean)
    .join("\n\n");

  /**
   * Finishing sections (objectives, cheat sheet, applications, FAQ,
   * final review) arrive via /api/enrich AFTER the core guide lands —
   * see app/api/enrich/route.ts. This runs in the background: the
   * guide is already usable, and a slow or failed enrichment never
   * fails the generation. When the sections arrive they are merged
   * into the guide on screen — but only when that guide is still the
   * one showing (the merge checks object identity, so opening another
   * guide meanwhile never gets the wrong sections) — and, when the
   * guide was saved, into the saved row too, merged into the CURRENT
   * saved content so a Builder Bot edit made meanwhile is never
   * clobbered. The generation token drops the result when the student
   * has already generated a newer guide.
   *
   * The fetch retries transient failures (see lib/enrichGuide.ts):
   * a one-shot call that fails once used to lose the five sections
   * permanently and silently (live re-test 2026-11-26). Now a failed
   * run sets the status to "failed" and the guide view offers a
   * Retry button instead of leaving the sections out with no word.
   */
  async function enrichGuideInBackground(args: {
    notes: string;
    images: string[];
    generated: GenerateResult;
    savedId: string | null;
    generation: number;
  }) {
    lastEnrichInputRef.current = args;
    setEnrichmentStatus("pending");
    const enrichment = await requestEnrichment({
      text: args.notes,
      images: args.images,
      isStale: () => enrichmentTokenRef.current !== args.generation,
    });
    if (!enrichment) {
      // Stale (a newer guide was generated) or every retry failed.
      // Only show "failed" when this is still the current guide —
      // a stale result must stay silent.
      if (enrichmentTokenRef.current === args.generation)
        setEnrichmentStatus("failed");
      return;
    }
    if (enrichmentTokenRef.current !== args.generation) return;
    const fields: EnrichmentFields = {
      objectives: enrichment.objectives ?? [],
      cheatSheet: enrichment.cheatSheet,
      realWorldApplications: enrichment.realWorldApplications ?? [],
      faq: enrichment.faq ?? [],
      finalReview: enrichment.finalReview,
    };
    setResult((prev) =>
      prev === args.generated ? { ...prev, ...fields } : prev
    );
    setEnrichmentStatus("done");
    if (args.savedId && user) {
      const current = await getGuideById(args.savedId);
      if (!current) return;
      const base = current.guide as unknown as GenerateResult;
      const merged = { ...base, ...fields };
      await updateGuideContent({
        id: args.savedId,
        userId: user.id,
        guide: merged as unknown as Record<string, unknown>,
        quiz: merged.quiz,
      });
    }
  }

  /** Re-run the finishing-sections fetch for the guide on screen —
   *  the Retry button shown when the background enrichment failed. */
  function retryEnrichment() {
    const last = lastEnrichInputRef.current;
    if (!last || enrichmentStatus === "pending") return;
    const generation = ++enrichmentTokenRef.current;
    void enrichGuideInBackground({ ...last, generation });
  }

  async function generate() {
    const notes = combinedNotes;
    if ((!notes && images.length === 0) || loading) return;
    setError(null);
    setLoading(true);
    // "Generating" popup: a fresh run starts at the first stage, with
    // a fresh clock, and the popup visible again even if the last run
    // was hidden.
    setGeneratingStage("providers");
    setGeneratingStartedAt(Date.now());
    setGeneratingElapsedMs(0);
    setGeneratingPopupHidden(false);
    setResult(null);
    setSaveNote(null);
    setSavedGuideId(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: notes,
          images,
          includeQuiz,
          extractConcepts,
          educationLevel: educationLevel || undefined,
          testTiming: testTiming || undefined,
          studyHours: studyHours || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.detail ? `${data.error || "Failed to generate study material."} (${data.detail})` : data.error || "Failed to generate study material."
        );
      const generated = data as GenerateResult;
      // "Generating" popup: the core guide arrived — the request is no
      // longer waiting on providers; the guide is now being checked
      // (and saved, when signed in) before it is shown.
      setGeneratingStage("checking");
      setResult(generated);
      setAnswers({});
      setPracticeProgress({ answered: 0, correct: 0 });
      setCheckpointByModule({});
      setBestScores({});
      setCollapsedModules({});
      setActiveInlineSection("overview");
      setSection("generate");
      setResultView("guide");
      setWorkspaceOpen(false);
      // Signed in? Save the guide to the account automatically.
      // Either way, the guide copy gets its error-tracking key: the saved
      // row id when it was saved, a content hash otherwise.
      let savedId: string | null = null;
      if (user) {
        const saved = await saveGuideToAccount({
          user,
          profile,
          topic: (inputText.trim() || generated.guideTitle || "Study guide").slice(0, 500),
          educationLevel,
          testTiming,
          guide: generated as unknown as Record<string, unknown>,
          quiz: generated.quiz,
          kind: "guide",
        });
        // The saved row id powers the "Edit with Builder Bot" banner
        // shown right under a fresh guide.
        setSavedGuideId(saved?.id ?? null);
        savedId = saved?.id ?? null;
        setSaveNote(
          saved
            ? "Saved to Your Study Guides."
            : "Generated, but could not save it to your account."
        );
        const guideKey = saved
          ? `guide:${saved.id}`
          : localGuideKey(
              generated.guideTitle ?? "Study guide",
              generated.studyGuide
            );
        setCurrentGuideId(guideKey);
        activity.recordGuideGenerated(
          (inputText.trim() || generated.guideTitle || "Study guide").slice(0, 500),
          saved?.id ?? null,
          guideKey
        );
      } else {
        const guideKey = localGuideKey(
          generated.guideTitle ?? "Study guide",
          generated.studyGuide
        );
        setCurrentGuideId(guideKey);
        activity.recordGuideGenerated(
          (inputText.trim() || generated.guideTitle || "Study guide").slice(0, 500),
          null,
          guideKey
        );
      }
      // Finishing sections (objectives, cheat sheet, FAQ, final
      // review) now arrive in the background via /api/enrich — the
      // core guide above is already showing and saved, so a slow
      // finishing pass can no longer push the generation past the
      // 60s timeout. Fire-and-forget: enrichGuideInBackground
      // merges the sections in when they arrive and never throws.
      const generation = ++enrichmentTokenRef.current;
      void enrichGuideInBackground({
        notes,
        images,
        generated,
        savedId,
        generation,
      });
      // "Generating" popup: the finishing-sections pass has started in
      // the background. The popup closes with `loading` in the finally
      // below and the guide appears; the sections keep arriving with
      // their own inline status in the guide view.
      setGeneratingStage("finishing");
      setAnswers({});
      setPracticeProgress({ answered: 0, correct: 0 });
      setCheckpointByModule({});
      setBestScores({});
      setSection("generate");
      setResultView("guide");
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

  function openGuide(saved: GenerateResult, guideId?: string | null) {
    setResult(saved);
    setAnswers({});
    setPracticeProgress({ answered: 0, correct: 0 });
    setCheckpointByModule({});
    setBestScores({});
    setCollapsedModules({});
    setActiveInlineSection("overview");
    setSection("generate");
    setResultView("guide");
    setWorkspaceOpen(false);
    // The opened copy gets its own error-tracking key — the saved row id
    // when known, so your errors on it persist; a content hash otherwise.
    const guideKey = guideId
      ? `guide:${guideId}`
      : localGuideKey(saved.guideTitle ?? "Study guide", saved.studyGuide);
    setCurrentGuideId(guideKey);
    // A saved guide that never got its finishing sections (the
    // background enrichment failed when it was generated) gets them
    // now, from the guide's own text — in the background, so opening
    // the guide never waits on it.
    if (hasEnrichment(saved)) {
      setEnrichmentStatus("done");
    } else {
      const generation = ++enrichmentTokenRef.current;
      void enrichGuideInBackground({
        notes: saved.studyGuide,
        images: [],
        generated: saved,
        savedId: guideId ?? null,
        generation,
      });
    }
    activity.saveLastGuide({
      title: saved.guideTitle ?? "Study guide",
      guideId: guideId ?? null,
      guideKey,
      openedAt: new Date().toISOString(),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /** Opening a saved guide jumps to its own dedicated page — the guide
   *  as its own mini-site — instead of loading it into the Generate tab. */
  function openGuideDetail(id: string) {
    router.push(`/guide/${id}`);
  }

  function openGame(game: GameData, topic: string) {
    setSavedGame({ game, topic, key: Date.now() });
    setSection("arena");
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  /** Answering a quiz question records it in this user's error tracking
   *  for this guide copy — wrong answers become weak spots, correct ones
   *  count toward mastering a weak concept. */
  function pickQuizAnswer(qi: number, opt: string) {
    const q = quiz[qi];
    if (!q || answers[qi]) return;
    setAnswers((prev) => ({ ...prev, [qi]: opt }));
    recordAnswer({
      source: "quiz",
      moduleTitle: result?.guideTitle ?? "Practice Quiz",
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

  const modules = result?.modules ?? [];

  /** Honest thin-guide label (see lib/studyTime.ts thinGuideNote):
   *  null when the guide meets its session's depth floor. */
  const thinNote = result
    ? thinGuideNote(
        modules.length,
        modules.reduce((n, m) => n + (m.concepts?.length ?? 0), 0),
        result.studyHours
      )
    : null;

  // Sections for the in-guide nav bar (inline view): only the sections
  // this guide actually has, in document order.
  const inlineNavSections: GuideNavSection[] = result
    ? [
        ...(result.guideTitle || result.summary
          ? [{ id: "overview", label: "Overview" }]
          : []),
        ...(result.givenResources && result.givenResources.length > 0
          ? [{ id: "given-resources", label: "Given resources", shortLabel: "Resources" }]
          : []),
        ...(result.objectives && result.objectives.length > 0
          ? [{ id: "objectives", label: "What you'll learn", shortLabel: "Learn" }]
          : []),
        ...(result.keyTerms && result.keyTerms.length > 0
          ? [{ id: "glossary", label: "Glossary" }]
          : []),
        ...(result.cheatSheet
          ? [{ id: "cheat-sheet", label: "Cheat sheet" }]
          : []),
        ...modules.map((m) => ({
          id: `module-${m.moduleNumber}`,
          label: `Module ${m.moduleNumber}: ${m.title}`,
          shortLabel: `Module ${m.moduleNumber}`,
        })),
        ...(result.realWorldApplications &&
        result.realWorldApplications.length > 0
          ? [{ id: "applications", label: "Real life", shortLabel: "Real life" }]
          : []),
        ...(result.faq && result.faq.length > 0
          ? [{ id: "faq", label: "FAQ" }]
          : []),
        ...(result.finalReview && result.finalReview.questions.length > 0
          ? [{ id: "final-review", label: "Final review" }]
          : []),
        ...(result.keyConcepts.length > 0
          ? [{ id: "key-concepts", label: "Key concepts" }]
          : []),
        { id: "videos", label: "Videos" },
      ]
    : [];

  // Reading progress + scroll-spy for the inline guide view (mirrors GuideView).
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const max = el.scrollHeight - el.clientHeight;
      setInlineScrollProgress(
        max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0
      );
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
            setActiveInlineSection(
              entry.target.getAttribute("data-guide-section") ?? "overview"
            );
          }
        }
      },
      { rootMargin: "-15% 0px -70% 0px" }
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [result, resultView]);
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
    <div className="min-h-screen pb-24">
      {celebration && (
        <>
          <Confetti
            onDone={() => {
              setCelebration(null);
              activity.dismissMilestone();
            }}
          />
          <div className="fixed bottom-5 left-1/2 z-[75] -translate-x-1/2 whitespace-nowrap rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white shadow-lift">
            🎉 {celebration}
          </div>
        </>
      )}
      {/* Top navigation bar — the section navigation for the whole app */}
      <header className="sticky top-0 z-50 border-b border-ink-100/70 bg-white/90 backdrop-blur-lg">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => goToSection("generate")}
            aria-label="StudySMART home"
            className="flex shrink-0 items-center gap-2.5"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow sm:h-10 sm:w-10">
              <GraduationCap className="h-5 w-5 sm:h-6 sm:w-6" />
            </span>
            <span className="text-left max-[359px]:hidden">
              <span className="block text-lg font-extrabold leading-tight tracking-tight sm:text-xl">
                Study<span className="gradient-text">SMART</span>
              </span>
              <span className="hidden text-xs font-medium text-ink-400 lg:block">
                Learn anything, smarter — powered by AI.
              </span>
            </span>
          </button>

          <div className="ml-auto flex items-center gap-2">
            <div className="hidden sm:block">
              <StreakWidget
                streak={activity.streak}
                xp={activity.xp}
                todayAnswered={activity.today.questionsAnswered}
                todayCorrect={activity.today.questionsCorrect}
              />
            </div>
            {/* Command palette + style picker live in the header on
                tablet and desktop. On phones they are hidden to keep the
                header fitting — the palette is keyboard-first, and the
                style picker also lives in the Account modal. */}
            <div className="hidden md:block">
              <CommandPalette actions={paletteActions} shortcuts={SHORTCUTS} />
            </div>
            <div className="hidden lg:block">
              <ThemePicker
                style={style}
                onStyleChange={setStyle}
                userId={user?.id ?? null}
              />
            </div>
            <button
              type="button"
              onClick={toggleDark}
              aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-ink-200 bg-white p-2 text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
            >
              {darkMode ? (
                <Sun className="h-4 w-4" />
              ) : (
                <Moon className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={openSignIn}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-ink-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-600 shadow-sm transition hover:border-brand-300 hover:bg-brand-50/50 hover:text-brand-700"
            >
              <User className="h-3.5 w-3.5" />
              <span className="max-w-16 truncate sm:max-w-24">
                {user ? (profile?.display_name ?? "Account") : "Sign in"}
              </span>
            </button>
            {!user && (
              <button
                type="button"
                onClick={openSignUp}
                className="btn-primary hidden min-h-11 px-4 py-2 text-xs lg:inline-flex"
              >
                <UserPlus className="h-3.5 w-3.5" /> Make an account
              </button>
            )}
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              aria-expanded={menuOpen}
              className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full border border-ink-200 bg-white p-2 text-ink-600 shadow-sm transition hover:border-brand-300 hover:text-brand-700 lg:hidden"
            >
              {menuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>

        {/* Row 2 — section navigation. It lives on its own row because
            the 8 links (~974px) plus the header controls (~900px) could
            never fit on one row inside the 1024px container — the old
            single row overflowed the page by ~1,100px at every width
            from iPad portrait up. Shown where it fits (lg+); below that
            the hamburger menu is the navigation. Horizontally scrollable
            as a backstop so a few extra pixels never push the page
            sideways again. */}
        <nav
          aria-label="Sections"
          className="hidden border-t border-ink-100/80 lg:block"
        >
          <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-4 py-1.5 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {NAV_LINKS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => goToSection(id)}
                aria-current={section === id ? "page" : undefined}
                className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-2.5 text-sm font-semibold transition ${
                  section === id
                    ? "bg-brand-50 text-brand-700 ring-1 ring-inset ring-brand-100"
                    : "text-ink-500 hover:bg-ink-100/70 hover:text-ink-900"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
                {id === "review" && dueCount > 0 && (
                  <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {dueCount}
                  </span>
                )}
              </button>
            ))}
          </div>
        </nav>

        {menuOpen && (
          <nav
            aria-label="Sections"
            className="border-t border-ink-100 bg-white px-4 py-2 lg:hidden"
          >
            {!user && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  openSignUp();
                }}
                className="btn-primary mt-1 w-full justify-center"
              >
                <UserPlus className="h-4 w-4" /> Make an account
              </button>
            )}
            {NAV_LINKS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => goToSection(id)}
                aria-current={section === id ? "page" : undefined}
                className={`mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold transition ${
                  section === id
                    ? "bg-brand-50 text-brand-700"
                    : "text-ink-600 hover:bg-ink-100/70"
                }`}
              >
                <Icon className="h-4 w-4" /> {label}
                {id === "review" && dueCount > 0 && (
                  <span className="ml-auto rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                    {dueCount}
                  </span>
                )}
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setWelcomeOpen(true);
              }}
              className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold text-ink-600 transition hover:bg-ink-100/70"
            >
              <Sparkles className="h-4 w-4" /> How it works
            </button>
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                setFeedbackOpen(true);
              }}
              className="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold text-ink-600 transition hover:bg-ink-100/70"
            >
              <MessageSquareHeart className="h-4 w-4" /> Give feedback
            </button>
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6">

      {/* Hero */}
      {section === "generate" && !result && !loading && (
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
          {!user && (
            <div className="mt-6">
              <button
                type="button"
                onClick={openSignUp}
                className="btn-primary px-6 py-3 text-base"
              >
                <UserPlus className="h-4 w-4" /> Make an account
              </button>
              <p className="mt-2 text-sm font-medium text-ink-400">
                Free — save your guides, keep your streak, and play with
                friends.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Meet your bots — the three AI helpers, introduced up front on
          the Generate landing page, not buried in menus. */}
      {section === "generate" && !result && !loading && (
        <div className="mt-6">
          <MeetYourBots />
        </div>
      )}

      {/* Continue where you left off + first-run checklist — from real
          activity only. The checklist hides itself once all three steps
          are genuinely done. */}
      {section === "generate" && !result && !loading && (
        <div className="mt-6 space-y-4">
          {activity.state.lastGuide?.guideId && (
            <div className="card flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-400">
                  Continue where you left off
                </p>
                <p className="mt-1 truncate text-base font-bold text-ink-900">
                  {activity.state.lastGuide.title}
                </p>
                <p className="text-xs font-medium text-ink-400">
                  Last opened{" "}
                  {new Date(
                    activity.state.lastGuide.openedAt
                  ).toLocaleDateString(undefined, {
                    month: "short",
                    day: "numeric",
                  })}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  openGuideDetail(activity.state.lastGuide!.guideId!)
                }
                className="btn-primary"
              >
                <BookOpen className="h-4 w-4" /> Continue
              </button>
            </div>
          )}
          {!(
            activity.checklist.generatedGuide &&
            activity.checklist.answeredFive &&
            activity.checklist.triedArena
          ) && (
            <div className="card p-4 sm:p-5">
              <p className="text-sm font-bold tracking-tight text-ink-900">
                Your first steps
              </p>
              <ul className="mt-2.5 space-y-2">
                <li className="flex items-center gap-2.5 text-sm font-medium text-ink-700">
                  {activity.checklist.generatedGuide ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-ink-200 text-[11px] font-extrabold text-ink-400">
                      1
                    </span>
                  )}
                  <span
                    className={
                      activity.checklist.generatedGuide
                        ? "text-ink-400 line-through"
                        : ""
                    }
                  >
                    Generate your first guide
                  </span>
                </li>
                <li className="flex items-center gap-2.5 text-sm font-medium text-ink-700">
                  {activity.checklist.answeredFive ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-ink-200 text-[11px] font-extrabold text-ink-400">
                      2
                    </span>
                  )}
                  <span
                    className={
                      activity.checklist.answeredFive
                        ? "text-ink-400 line-through"
                        : ""
                    }
                  >
                    Answer 5 questions ({activity.totalQuestionsAnswered}{" "}
                    answered so far)
                  </span>
                </li>
                <li className="flex items-center gap-2.5 text-sm font-medium text-ink-700">
                  {activity.checklist.triedArena ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                  ) : (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-ink-200 text-[11px] font-extrabold text-ink-400">
                      3
                    </span>
                  )}
                  <span
                    className={
                      activity.checklist.triedArena
                        ? "text-ink-400 line-through"
                        : ""
                    }
                  >
                    Try Battle Arena
                  </span>
                  {!activity.checklist.triedArena && (
                    <button
                      type="button"
                      onClick={() => goToSection("arena")}
                      className="ml-auto rounded-full bg-brand-50 px-3 py-1 text-xs font-bold text-brand-700 ring-1 ring-inset ring-brand-100 transition hover:bg-brand-100"
                    >
                      Play now
                    </button>
                  )}
                </li>
              </ul>
            </div>
          )}
          <FocusTimer
            completedSessions={activity.totalFocusSessions}
            onFocusComplete={() => {
              activity.recordFocusSession();
              setCelebration("Focus session done — +25 XP");
            }}
          />
        </div>
      )}

      {/* Create / Input view */}
      {section === "generate" && (
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

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
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
            <div>
              <label
                htmlFor="study-hours"
                className="text-sm font-bold tracking-tight text-ink-900"
              >
                How long will you study?
              </label>
              <select
                id="study-hours"
                value={studyHours}
                onChange={(e) => setStudyHours(e.target.value)}
                className="input mt-1.5"
              >
                <option value="" disabled>
                  Choose your study time…
                </option>
                {STUDY_HOURS_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs leading-relaxed text-ink-400">
                Shorter sessions get a tighter guide; longer ones go deeper.
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
              multiple
              className="hidden"
              onChange={(e) => {
                void handleUploadFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="btn-secondary"
            >
              <FileUp className="h-4 w-4 text-brand-600" /> Upload files
            </button>
            <span className="text-xs font-medium text-ink-400">
              .pdf, .txt, .md, .csv, or images — text is read from your files
            </span>
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
              disabled={loading || (!combinedNotes && images.length === 0)}
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
                    className="absolute -right-1.5 -top-1.5 rounded-full bg-ink-900 p-2 text-white shadow-md transition hover:bg-rose-600"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {uploadedFiles.length > 0 && (
            <div className="mt-4 space-y-2">
              {uploadedFiles.map((f, i) => (
                <div
                  key={`${f.name}-${i}`}
                  className="flex items-center gap-3 rounded-xl border border-ink-100 bg-white px-3 py-2 text-sm shadow-sm"
                >
                  <FileUp className="h-4 w-4 shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink-800">
                    {f.name}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-ink-400">
                    {formatBytes(f.size)}
                    {f.kind === "text"
                      ? ` · ${(f.text?.length ?? 0).toLocaleString()} characters read`
                      : " · image"}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${f.name}`}
                    onClick={() => removeUploadedFile(i)}
                    className="rounded-full p-2 text-ink-400 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {fileTextChars > 0 && (
                <p className="text-xs font-medium text-ink-400">
                  {fileTextChars.toLocaleString()} characters read from your
                  files — they will be added to your notes when you generate.
                  Your files are never published.
                </p>
              )}
            </div>
          )}

          {fileNotice && (
            <p className="feedback-neutral mt-4">{fileNotice}</p>
          )}

          {error && (
            <div className="feedback-wrong mt-4 font-medium">{error}</div>
          )}
        </div>
      </section>
      )}

      {/* Loading state */}
      {section === "generate" && loading && (
        <div className="card animate-fade-up mt-6 flex flex-col items-center gap-3 py-14 text-center">
          <span className="flex h-16 w-16 animate-float items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-glow">
            <Brain className="h-8 w-8" />
          </span>
          <p className="text-lg font-bold tracking-tight">
            Building your study guide…
          </p>
          <p className="max-w-sm text-sm leading-relaxed text-ink-400">
            Reading your notes and building your complete guide — deep modules
            first, then the cheat sheet, FAQ, and final review. Nothing
            pre-made, everything fresh.
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

      {/* Results — Study Guide / Practice Quiz live inside the Generate
          section; the other destinations live in the top nav bar. */}
      {section === "generate" && !loading && (
        <section className="mt-8 animate-fade-up">
          {result && (
          <div className="flex flex-wrap gap-1.5 rounded-2xl bg-ink-100/70 p-1.5">
            <button
              type="button"
              onClick={() => setResultView("guide")}
              className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all sm:flex-none ${
                resultView === "guide"
                  ? "bg-white text-brand-700 shadow-soft"
                  : "text-ink-500 hover:text-ink-800"
              }`}
            >
              <BookOpen className="h-4 w-4" /> Study Guide
            </button>
            {quiz.length > 0 && (
              <button
                type="button"
                onClick={() => setResultView("quiz")}
                className={`inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all sm:flex-none ${
                  resultView === "quiz"
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
          </div>)}

          {!result && (
            <p className="card mt-6 p-5 text-sm leading-relaxed text-ink-500">
              Generate a study guide above and it will appear here.
            </p>
          )}

          {resultView === "guide" && result && (
            <div className="mt-6 space-y-5">
              {result.guideTitle && (
                <div
                  id="overview"
                  data-guide-section="overview"
                  className="scroll-mt-32"
                >
                  <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">
                    {result.guideTitle}
                  </h1>
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-ink-500">
                    {result.topicType && (
                      <span className="chip capitalize">
                        {result.topicType}
                      </span>
                    )}
                    {studyHoursLabel(result.studyHours) && (
                      <span className="chip">
                        Built for a {studyHoursLabel(result.studyHours)}
                      </span>
                    )}
                    {thinNote && (
                      <span className="chip-amber">{thinNote}</span>
                    )}
                  </p>
                </div>
              )}
              {!result.guideTitle && result.topicType && (
                <p>
                  <span className="chip capitalize">{result.topicType}</span>
                </p>
              )}

              {saveNote && (
                <p className="text-sm font-semibold text-emerald-700">
                  {saveNote}
                </p>
              )}

              {/* Builder Bot, unmissable, right after a guide is made:
                  a bright banner with one big button. It needs the saved
                  guide, so signed-out users get the sign-in nudge instead. */}
              {savedGuideId ? (
                <div className="rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 p-4 text-white shadow-lift sm:p-5">
                  <p className="flex items-center gap-2 text-base font-extrabold tracking-tight">
                    <Wrench className="h-5 w-5 shrink-0" /> Want this guide changed?
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-50">
                    Builder Bot edits this guide in plain words — just tell it
                    what to fix, add, shorten or simplify.
                  </p>
                  <button
                    type="button"
                    onClick={() => router.push(`/guide/${savedGuideId}?bot=1`)}
                    className="mt-3 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-extrabold text-amber-700 shadow-sm transition hover:bg-amber-50"
                  >
                    <Wrench className="h-4 w-4" /> Edit with Builder Bot
                  </button>
                </div>
              ) : (
                <div className="rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm leading-relaxed text-ink-700">
                  <strong className="font-bold">Want this guide changed?</strong>{" "}
                  Sign in to save it — then Builder Bot can edit it in plain
                  words, right from Your Study Guides.
                  <button
                    type="button"
                    onClick={openSignIn}
                    className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
                  >
                    Sign in
                  </button>
                </div>
              )}

              {/* Finishing sections (objectives, cheat sheet, FAQ,
                  final review) arrive in the background after the core
                  guide lands. While they are on their way the guide
                  shows a subtle line; if every retry failed it offers
                  a Retry button instead of silently leaving the
                  sections out (live re-test 2026-11-26). */}
              {enrichmentStatus === "pending" && (
                <p className="flex items-center gap-2 text-sm font-medium text-ink-500">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                  Adding finishing sections — objectives, cheat sheet, FAQ…
                </p>
              )}
              {enrichmentStatus === "failed" && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50/70 p-4 text-sm leading-relaxed text-ink-700">
                  <p className="flex-1">
                    <strong className="font-bold">
                      Finishing sections couldn&apos;t load.
                    </strong>{" "}
                    The guide is complete without them — objectives, cheat
                    sheet, FAQ and final review can be added now.
                  </p>
                  <button
                    type="button"
                    onClick={retryEnrichment}
                    className="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-amber-600"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Retry
                  </button>
                </div>
              )}

              {result && inlineNavSections.length > 0 && (
                <GuideNavBar
                  title={result.guideTitle ?? "Study Guide"}
                  backHref="/"
                  onBack={() => setSection("my-guides")}
                  sections={inlineNavSections}
                  activeSection={activeInlineSection}
                  progress={inlineScrollProgress}
                  onNavigate={(id) =>
                    document
                      .getElementById(id)
                      ?.scrollIntoView({ behavior: "smooth" })
                  }
                  stickyTopClass="top-[72px] lg:top-[130px]"
                />
              )}

              {/* Test yourself first — a short diagnostic from this guide's
                  own questions, before studying. See components/PreTest.tsx. */}
              <PreTest
                guideKey={
                  currentGuideId ??
                  localGuideKey(
                    result.guideTitle ?? "Study guide",
                    result.studyGuide
                  )
                }
                modules={modules}
                finalReviewQuestions={result.finalReview?.questions}
              />

              <MasterySummary records={guideErrors.records} totalConcepts={totalCards} />
              <StudyPlan testTiming={testTiming} modules={modules} studyHours={result.studyHours} />

              {result.summary && (
                <div className="card p-5 sm:p-6">
                  <h2 className="text-sm font-bold tracking-tight text-ink-900">
                    Summary
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">
                    {result.summary}
                  </p>
                </div>
              )}

              {result.objectives && result.objectives.length > 0 && (
                <div
                  id="objectives"
                  data-guide-section="objectives"
                  className="card scroll-mt-32 p-5 sm:p-6"
                >
                  <h2 className="text-sm font-bold tracking-tight text-ink-900">
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
              )}

              {result.keyTerms && result.keyTerms.length > 0 && (
                <div
                  id="glossary"
                  data-guide-section="glossary"
                  className="card scroll-mt-32 p-5 sm:p-6"
                >
                  <h2 className="text-sm font-bold tracking-tight text-ink-900">
                    Glossary
                  </h2>
                  <p className="mt-1 text-xs font-medium text-ink-400">
                    Key terms and definitions for this topic.
                  </p>
                  <dl className="mt-3 space-y-2">
                    {result.keyTerms.map((kt) => (
                      <div key={kt.term} className="text-sm leading-relaxed">
                        <dt className="inline font-bold text-ink-900">
                          {kt.term}:{" "}
                        </dt>
                        <dd className="inline text-ink-600">
                          {kt.definition}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {result.cheatSheet && (
                <div
                  id="cheat-sheet"
                  data-guide-section="cheat-sheet"
                  className="card scroll-mt-32 overflow-hidden"
                >
                  <div className="border-b border-ink-100 bg-gradient-to-r from-brand-50 to-accent-50 px-5 py-4 sm:px-6">
                    <h2 className="text-sm font-bold tracking-tight text-ink-900">
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
                            {concept.workedExample &&
                              concept.workedExample.steps.length >= 2 && (
                                <div className="mt-3 rounded-xl bg-sky-50/80 px-3.5 py-3 ring-1 ring-inset ring-sky-100">
                                  <p className="text-sm font-bold text-sky-900">
                                    Worked example
                                  </p>
                                  <p className="mt-1 text-sm leading-relaxed text-ink-700">
                                    {concept.workedExample.problem}
                                  </p>
                                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm leading-relaxed text-ink-600">
                                    {concept.workedExample.steps.map((step, si) => (
                                      <li key={si}>{step}</li>
                                    ))}
                                  </ol>
                                  <p className="mt-2 text-sm leading-relaxed text-ink-700">
                                    <strong className="font-bold text-ink-800">
                                      Answer:
                                    </strong>{" "}
                                    {concept.workedExample.answer}
                                  </p>
                                </div>
                              )}
                            {concept.explanation && (
                              <p className="mt-3 text-sm leading-relaxed text-ink-600">
                                <strong className="font-bold text-ink-800">
                                  How it works:
                                </strong>{" "}
                                {concept.explanation}
                              </p>
                            )}
                            {concept.commonMistake && (
                              <p className="mt-2 rounded-xl bg-rose-50/80 px-3 py-2 text-sm leading-relaxed text-rose-800 ring-1 ring-inset ring-rose-100">
                                <strong className="font-bold">
                                  Common mistake:
                                </strong>{" "}
                                {concept.commonMistake}
                              </p>
                            )}
                            {concept.tip && (
                              <p className="mt-2 rounded-xl bg-amber-50/80 px-3 py-2 text-sm leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-100">
                                <strong className="font-bold">
                                  Watch out:
                                </strong>{" "}
                                {concept.tip}
                              </p>
                            )}
                            {concept.memoryTip && (
                              <p className="mt-2 rounded-xl bg-emerald-50/80 px-3 py-2 text-sm leading-relaxed text-emerald-800 ring-1 ring-inset ring-emerald-100">
                                <strong className="font-bold">
                                  Remember it:
                                </strong>{" "}
                                {concept.memoryTip}
                              </p>
                            )}
                            <ExplainButtons
                              conceptTitle={concept.title}
                              definition={concept.formulaOrDefinition}
                              onExplain={explainConcept}
                            />
                            <div className="mt-2 flex flex-wrap gap-2">
                              <TeachBack
                                conceptTitle={concept.title}
                                definition={concept.formulaOrDefinition}
                                explanation={concept.explanation}
                                educationLevel={educationLevel}
                                onAnswer={(_strong, result) =>
                                  handleTeachBack(
                                    mod.title,
                                    concept.title,
                                    result
                                  )
                                }
                              />
                            </div>
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
                  const collapsed =
                    collapsedModules[mod.moduleNumber] ?? false;
                  return (
                    <section
                      key={mod.moduleNumber}
                      id={`module-${mod.moduleNumber}`}
                      data-module={mod.moduleNumber}
                      data-guide-section={`module-${mod.moduleNumber}`}
                      className="scroll-mt-36 space-y-5"
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
                              {isVocabulary && (
                                <span className="chip-amber">Spotlight</span>
                              )}
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
                          onProgress={(answered, correct) =>
                            setCheckpointByModule((prev) => ({
                              ...prev,
                              [mod.moduleNumber]: { answered, correct },
                            }))
                          }
                          onFinish={(score) => {
                            activity.recordSectionCompleted();
                            setBestScores((prev) => ({
                              ...prev,
                              [mod.moduleNumber]: Math.max(
                                prev[mod.moduleNumber] ?? 0,
                                score
                              ),
                            }));
                          }}
                        />
                      )}
                        </>
                      )}
                    </section>
                  );
                })}

              {modules.length > 0 && (
                <TargetedPractice
                  modules={modules}
                  onAskTutor={openPracticeTutor}
                  onAnswer={recordAnswer}
                  onProgress={(answered, correct) =>
                    setPracticeProgress({ answered, correct })
                  }
                />
              )}

              {/* Personalized practice from this user's own errors on this
                  guide copy — never from another user's data, and never
                  from a published or shared copy. */}
              <PersonalizedPractice
                guideKey={currentGuideId}
                guideTitle={result.guideTitle ?? "Study guide"}
                educationLevel={educationLevel}
                weak={guideErrors.weak}
                mastered={guideErrors.mastered}
                signedIn={Boolean(user)}
                onAnswer={recordAnswer}
                onClearErrors={guideErrors.clear}
              />

              {result.realWorldApplications &&
                result.realWorldApplications.length > 0 && (
                  <div
                    id="applications"
                    data-guide-section="applications"
                    className="card scroll-mt-32 p-5 sm:p-6"
                  >
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
                )}

              {result.faq && result.faq.length > 0 && (
                <div
                  id="faq"
                  data-guide-section="faq"
                  className="card scroll-mt-32 p-5 sm:p-6"
                >
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
                        <p className="mt-2 text-sm leading-relaxed text-ink-600">
                          {item.answer}
                        </p>
                      </details>
                    ))}
                  </div>
                </div>
              )}

              {result.finalReview && result.finalReview.questions.length > 0 && (
                <div
                  id="final-review"
                  data-guide-section="final-review"
                  className="scroll-mt-32"
                >
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
                    />
                  </div>
                </div>
              )}

              {result.keyConcepts.length > 0 && (
                <div
                  id="key-concepts"
                  data-guide-section="key-concepts"
                  className="card scroll-mt-32 p-5"
                >
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

              <GivenResources resources={result.givenResources} />

              <div
                id="videos"
                data-guide-section="videos"
                className="scroll-mt-32"
              >
                <GuideVideos
                  topic={result.guideTitle || "Study guide"}
                  moduleTitles={modules.map((m) => m.title)}
                  guideKey={`${result.guideTitle}::${result.studyGuide.length}`}
                />
              </div>

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

          {resultView === "quiz" && (
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
                        <WhyWrongList
                          whyWrong={q.whyWrong}
                          correctAnswer={q.correctAnswer}
                        />
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

      {/* Battle Arena — standalone, no guide needed */}
      {section === "arena" && (
        <section className="mt-8 animate-fade-up">
          <BattleArena
            guideTopic={result?.guideTitle}
            guideContent={result ? guideContentForGame : undefined}
            topicType={result?.topicType}
            user={user}
            initialGame={savedGame?.game}
            initialGameKey={savedGame?.key}
            onAnswer={activity.recordQuestion}
            onReviewMisses={handleArenaMisses}
            onGameFinished={(correct, answered) => {
              activity.recordArenaPlayed();
              // A win is a finished game at >= 70% accuracy — the app's
              // own win line (see lib/achievements.ts ARENA_WIN_ACCURACY).
              if (answered > 0 && correct / answered >= 0.7)
                activity.recordArenaWin();
            }}
          />
        </section>
      )}

      {/* Review queue — spaced repetition from your own mistakes */}
      {section === "review" && (
        <section className="mt-8 animate-fade-up">
          <ReviewQueue
            userId={user?.id ?? null}
            educationLevel={educationLevel}
            onActivity={activity.recordQuestion}
            onGenerate={() => goToSection("generate")}
          />
        </section>
      )}

      {/* My Progress — your real activity, accuracy, mastery, weekly
          goal and review forecast. See components/ProgressDashboard.tsx. */}
      {section === "progress" && (
        <section className="mt-8 animate-fade-up">
          <ProgressDashboard
            userId={user?.id ?? null}
            days={activity.state.days}
            streak={activity.streak}
            xp={activity.xp}
          />
        </section>
      )}

      {/* Your Study Guides — saved guides, Favorites, Shared with you */}
      {section === "my-guides" && (
        <section className="mt-8 animate-fade-up">
          <YourGuides
            user={user}
            profile={profile}
            friends={friends}
            onOpenGuide={openGuide}
            onOpenGuideDetail={openGuideDetail}
            onOpenGame={openGame}
            onTurnGuideIntoArena={(source: ArenaExportSource) => {
              writePendingArenaExport(source);
              goToSection("arena");
            }}
            onViewInBrowse={() => goToSection("browse")}
            onGenerate={() => goToSection("generate")}
          />
        </section>
      )}

      {/* Browse — public published guides and games */}
      {section === "browse" && (
        <section className="mt-8 animate-fade-up">
          <Browse
            user={user}
            onOpenGuide={openGuide}
            onOpenGuideDetail={openGuideDetail}
            onOpenGame={openGame}
            onGenerate={() => goToSection("generate")}
          />
        </section>
      )}

      {/* Friends — search, requests, friends list */}
      {section === "friends" && (
        <section className="mt-8 animate-fade-up">
          {user ? (
            <Friends user={user} onFriendsChanged={setFriends} />
          ) : (
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              headline="Friends live here"
              outcome="Sign in to find friends by username, accept friend requests, and send study guides to your friends."
              buttonLabel="Sign in"
              onAction={openSignIn}
            />
          )}
        </section>
      )}

      {/* Achievements — real-activity milestones + certificates */}
      {section === "achievements" && (
        <section className="mt-8 animate-fade-up">
          <Achievements
            stats={achievementStats}
            earned={achievements.earned}
            newlyUnlocked={achievements.newlyUnlocked}
            onDismissNew={achievements.dismissNewlyUnlocked}
            displayName={
              profile?.display_name ?? "StudySMART Learner"
            }
          />
        </section>
      )}

      {/* Empty state hint */}
      {section === "generate" && !result && !loading && (
        <div className="mt-6 flex items-start gap-3 rounded-2xl border border-dashed border-brand-300 bg-white/70 p-5 text-sm leading-relaxed text-ink-500">
          <Upload className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
          <p>
            Your study guide, quiz, and Battle Arena game will appear here once
            you generate them. Everything is created fresh from your own notes —
            nothing is pre-filled.
          </p>
        </div>
      )}

      </main>

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
        prefill={tutorPrefill}
      />

      <FeedbackModal
        open={feedbackOpen}
        onClose={() => setFeedbackOpen(false)}
        topic={result?.guideTitle ?? (inputText.trim() ? inputText.trim() : undefined)}
      />

      <WelcomeModal
        open={welcomeOpen}
        onClose={() => setWelcomeOpen(false)}
      />

      <AuthModal
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        initialMode={authInitialMode}
        user={user}
        profile={profile}
        onAuthChanged={refreshAuth}
        style={style}
        onStyleChange={setStyle}
      />

      {/* "Generating" popup: shown only while a guide is being built
          (loading) and not hidden. Hiding never cancels the request —
          the guide still appears when it is done. On failure `loading`
          goes false in generate()'s finally, so the popup closes and
          the existing error message shows exactly as before. */}
      {section === "generate" &&
        shouldShowGeneratingPopup({
          loading,
          hidden: generatingPopupHidden,
        }) && (
          <GeneratingPopup
            stage={generatingStage}
            elapsedMs={generatingElapsedMs}
            topic={inputText.trim() || undefined}
            onHide={() => setGeneratingPopupHidden(true)}
          />
        )}

      {/* Reopen pill while the popup is hidden and generation is still
          running — the visible status that brings the popup back. */}
      {section === "generate" &&
        shouldShowGeneratingPill({
          loading,
          hidden: generatingPopupHidden,
        }) && (
          <button
            type="button"
            onClick={() => setGeneratingPopupHidden(false)}
            className="fixed bottom-24 left-1/2 z-40 inline-flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-ink-900 px-4 py-2.5 text-sm font-bold text-white shadow-lift transition hover:bg-ink-800"
            aria-label={`Show generation progress, ${formatElapsed(generatingElapsedMs)} so far`}
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Building your guide… {formatElapsed(generatingElapsedMs)} — show
            progress
          </button>
        )}

      {showBackToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-5 left-5 z-40 inline-flex items-center gap-1.5 rounded-full border border-ink-200 bg-white px-4 py-2.5 text-sm font-bold text-ink-700 shadow-lift transition hover:border-brand-300 hover:text-brand-700"
        >
          <ChevronUp className="h-4 w-4" /> Back to top
        </button>
      )}
    </div>
  );
}
