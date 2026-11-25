"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  CheckCircle2,
  Flame,
  Heart,
  Layers,
  LayoutTemplate,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Timer,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import TutorPanel from "./TutorPanel";
import { playArenaSound } from "@/lib/arenaSound";
import {
  fetchArenaBoard,
  fetchArenaTitles,
  fetchMyBest,
  fetchOverallBoard,
  fetchRank,
  getLocalBestForArena,
  getLocalBests,
  recordArenaScore,
  recordLocalResult,
  type LeaderboardEntry,
  type LocalArenaResult,
} from "@/lib/arenaScores";
import {
  getMyProfile,
  saveGuideToAccount,
  type AppUser,
} from "@/lib/supabase";

export type GameQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  points: number;
};

export type GameCard = { front: string; back: string };

export type GameData = {
  title: string;
  gameType?: string;
  gameDescription?: string;
  timedSecondsPerQuestion?: number;
  cards?: GameCard[];
  questions: GameQuestion[];
};

/** Step 1 of the two-step Arena flow: a fast, INCOMPLETE game idea — just a
 *  title, a game type, a one-line description, and 1–2 sample questions as a
 *  taste. The user picks one and the AI finishes the full game from it. */
export type GameTemplate = {
  title: string;
  gameType: string;
  description: string;
  sampleQuestions: {
    question: string;
    options: string[];
    correctAnswer: string;
  }[];
};

type Mode = "1 Player" | "2 Player Local" | "Multiplayer";
type PlayMode = "trivia" | "flashcards" | "matching";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Game length: Quick 10 / Standard 20 (default) / Marathon 30. */
type GameLength = 10 | 20 | 30;
const GAME_LENGTHS: { value: GameLength; label: string; hint: string }[] = [
  { value: 10, label: "Quick", hint: "10 questions" },
  { value: 20, label: "Standard", hint: "20 questions" },
  { value: 30, label: "Marathon", hint: "30 questions" },
];

type PlayerStats = {
  correct: number;
  answered: number;
  bestStreak: number;
  bonus: number;
};
const emptyStats = (n: number): PlayerStats[] =>
  Array.from({ length: n }, () => ({
    correct: 0,
    answered: 0,
    bestStreak: 0,
    bonus: 0,
  }));

/** Rank title for the results screen, from accuracy + best streak. */
function rankFor(accuracy: number, bestStreak: number): string {
  if (accuracy >= 0.9 && bestStreak >= 5) return "Arena Legend";
  if (accuracy >= 0.75) return "Arena Champion";
  if (accuracy >= 0.5) return "Rising Challenger";
  return "Brave Rookie";
}

const CONFETTI_COLORS = [
  "rgb(var(--brand-500))",
  "rgb(var(--accent-500))",
  "var(--success)",
  "#f43f5e",
  "rgb(var(--brand-400))",
  "rgb(var(--accent-400))",
];

export default function BattleArena({
  guideTopic,
  guideContent,
  topicType,
  user,
  initialGame,
  initialGameKey,
  /** Called for every answered trivia question (drives XP + streak). */
  onAnswer,
  /** Called with the game's missed questions when the player asks to
   *  review them — the parent sends them into the Review queue. */
  onReviewMisses,
  /** Called once when a trivia game finishes, with total correct/answered. */
  onGameFinished,
}: {
  guideTopic?: string;
  guideContent?: string;
  topicType?: string;
  /** Signed-in user: generated games are auto-saved to their account. */
  user?: AppUser | null;
  /** A saved or published game to load (from Your Study Guides / Browse). */
  initialGame?: GameData | null;
  /** Change this to re-load initialGame. */
  initialGameKey?: number;
  onAnswer?: (correct: boolean) => void;
  onReviewMisses?: (
    misses: Array<{
      question: string;
      picked: string;
      correctAnswer: string;
      explanation: string;
    }>
  ) => void;
  onGameFinished?: (correct: number, answered: number) => void;
} = {}) {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<Mode>("1 Player");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<GameData | null>(null);
  const [gameSavedNote, setGameSavedNote] = useState<string | null>(null);
  // Two-step flow state: fast template previews, then the finished game.
  const [templates, setTemplates] = useState<GameTemplate[] | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [templatesSource, setTemplatesSource] = useState("");
  const [chosenTemplate, setChosenTemplate] = useState<GameTemplate | null>(null);
  const [playMode, setPlayMode] = useState<PlayMode>("trivia");
  const [current, setCurrent] = useState(0);
  const [scores, setScores] = useState<number[]>([0]);
  const [turn, setTurn] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorContext, setTutorContext] = useState<string | undefined>(undefined);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [timedOut, setTimedOut] = useState(false);

  // Bigger, more immersive games: length choice, sound, lives, streaks.
  const [gameLength, setGameLength] = useState<GameLength>(20);
  const [muted, setMuted] = useState<boolean>(
    () =>
      typeof window !== "undefined" &&
      window.localStorage.getItem("studysmart-arena-muted") === "1"
  );
  const [lives, setLives] = useState(3);
  const [streaks, setStreaks] = useState<number[]>([0]);
  const [playerStats, setPlayerStats] = useState<PlayerStats[]>(emptyStats(1));
  const [lastAward, setLastAward] = useState<{
    base: number;
    speed: number;
    combo: number;
    total: number;
  } | null>(null);
  // Missed trivia questions this game, for the post-game
  // "Review your misses" button (they go into the Review queue).
  const [misses, setMisses] = useState<
    Array<{
      question: string;
      picked: string;
      correctAnswer: string;
      explanation: string;
    }>
  >([]);

  // Leaderboards: the shared boards live in Supabase (arena_scores); the
  // device-local list lives in localStorage for signed-out play and local
  // guest players. Nothing here ever invents a score.
  const [placement, setPlacement] = useState<{
    rank: number;
    gameTitle: string;
  } | null>(null);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [boardTab, setBoardTab] = useState<"overall" | "arena">("overall");
  const [boardEntries, setBoardEntries] = useState<LeaderboardEntry[]>([]);
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardNote, setBoardNote] = useState<string | null>(null);
  const [boardTableMissing, setBoardTableMissing] = useState(false);
  const [arenaTitles, setArenaTitles] = useState<string[]>([]);
  const [boardGameTitle, setBoardGameTitle] = useState<string | null>(null);
  const [myBoardRank, setMyBoardRank] = useState<number | null>(null);
  const [myBoardBest, setMyBoardBest] = useState<LeaderboardEntry | null>(
    null
  );
  const [localBests, setLocalBests] = useState<LocalArenaResult[]>([]);
  // One play-through = one leaderboard row at most, even if the finish
  // path is somehow reached twice.
  const playIdRef = useRef(0);
  const recordedPlayRef = useRef(-1);

  // Flashcards state
  const [cardIndex, setCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [knownCount, setKnownCount] = useState(0);

  // Matching state
  const [matched, setMatched] = useState<Set<number>>(new Set());
  const [pickedFront, setPickedFront] = useState<number | null>(null);
  const [pickedBack, setPickedBack] = useState<number | null>(null);
  const [matchMessage, setMatchMessage] = useState<string | null>(null);
  const [matchScore, setMatchScore] = useState(0);
  const shuffledBacks = useMemo(
    () =>
      game?.cards
        ? shuffle(game.cards.map((c, i) => ({ back: c.back, index: i })))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game]
  );

  const playerCount =
    mode === "1 Player" ? 1 : mode === "2 Player Local" ? 2 : 4;

  const hasCards = !!game?.cards && game.cards.length > 0;
  const timedSeconds = game?.timedSecondsPerQuestion;

  // Confetti pieces for the results screen — deterministic positions, so
  // every render shows the same celebration (CSS animation only).
  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 36 }, (_, i) => ({
        left: (i * 37 + 11) % 100,
        delay: ((i * 13) % 10) / 10,
        duration: 2.2 + ((i * 7) % 10) / 10,
        size: 6 + ((i * 5) % 8),
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        round: i % 3 === 0,
      })),
    []
  );

  // Persist the mute preference.
  useEffect(() => {
    try {
      window.localStorage.setItem(
        "studysmart-arena-muted",
        muted ? "1" : "0"
      );
    } catch {
      // Storage unavailable — the preference just won't persist.
    }
  }, [muted]);

  // Device-local results (signed-out play, local guest players).
  useEffect(() => {
    setLocalBests(getLocalBests());
  }, []);

  // Reset everything about a play-through (scores, lives, streaks, stats).
  function resetPlayState(playerN: number) {
    playIdRef.current += 1;
    setPlacement(null);
    setPlacementBusy(false);
    setCurrent(0);
    setScores(Array(playerN).fill(0));
    setTurn(0);
    setSelected(null);
    setFinished(false);
    setLives(3);
    setStreaks(Array(playerN).fill(0));
    setPlayerStats(emptyStats(playerN));
    setLastAward(null);
    setTimedOut(false);
    setCardIndex(0);
    setFlipped(false);
    setKnownCount(0);
    setMatched(new Set());
    setPickedFront(null);
    setPickedBack(null);
    setMatchScore(0);
    setMatchMessage(null);
    setMisses([]);
  }

  // Load a saved / published game passed in from Your Study Guides or Browse.
  useEffect(() => {
    if (!initialGame) return;
    const g = initialGame;
    setGame(g);
    setPlayMode("trivia");
    resetPlayState(playerCount);
    setTimeLeft(g.timedSecondsPerQuestion ?? null);
    setTemplates(null);
    setChosenTemplate(null);
    setTemplatesError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGameKey]);

  async function saveGameToAccount(g: GameData, source: string) {
    if (!user) return;
    const profile = await getMyProfile(user.id);
    const saved = await saveGuideToAccount({
      user,
      profile,
      topic: (guideTopic || source).slice(0, 500),
      educationLevel: "",
      testTiming: "",
      guide: { guideTitle: g.title, gameTitle: g.title } as Record<string, unknown>,
      quiz: g.questions,
      kind: "game",
      game: g as unknown as Record<string, unknown>,
    });
    setGameSavedNote(
      saved ? "Game saved to your study guides." : null
    );
  }

  // Step 1: fast, incomplete template previews — three game ideas in a few
  // seconds, generated on demand from the topic (lightest model first).
  async function generateTemplates(source: string) {
    if (!source.trim() || templatesLoading || loading) return;
    setError(null);
    setTemplatesError(null);
    setTemplatesLoading(true);
    setGame(null);
    setFinished(false);
    setTemplates(null);
    setChosenTemplate(null);
    setTemplatesSource(source.trim());
    try {
      const res = await fetch("/api/generate-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicOrNotes: source.trim(),
          step: "templates",
          topicType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to dream up game ideas.");
      const list = data.templates as GameTemplate[];
      if (!Array.isArray(list) || list.length === 0) {
        throw new Error("No game ideas came back — try again.");
      }
      setTemplates(list);
    } catch (e) {
      setTemplatesError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setTemplatesLoading(false);
    }
  }

  // Step 2: the user picked a template — the AI finishes the full game
  // from it (full question set, answers, cards where the type uses them).
  async function chooseTemplate(template: GameTemplate) {
    if (loading) return;
    setError(null);
    setLoading(true);
    setGame(null);
    setFinished(false);
    setChosenTemplate(template);
    try {
      const res = await fetch("/api/generate-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicOrNotes: templatesSource,
          step: "full",
          chosenTemplate: template,
          playerCount,
          questionCount: gameLength,
          topicType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate the game.");
      const g = data as GameData;
      setGame(g);
      setPlayMode("trivia");
      resetPlayState(playerCount);
      setTimeLeft(g.timedSecondsPerQuestion ?? null);
      // Signed in? Save the game to the account automatically.
      void saveGameToAccount(g, templatesSource);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  // Go back to the template choices to pick a different one instead.
  function backToTemplates() {
    setGame(null);
    setFinished(false);
    setError(null);
  }

  // Open a leaderboard: overall (every player's best, all-time) or one
  // arena's board. Loads on demand; a failed refresh never clears the
  // board we already have — it just adds a quiet note.
  async function openBoard(
    tab: "overall" | "arena",
    gameTitle?: string | null
  ) {
    const title = gameTitle ?? boardGameTitle ?? game?.title ?? null;
    setBoardOpen(true);
    setBoardTab(tab);
    if (title) setBoardGameTitle(title);
    setBoardLoading(true);
    setBoardNote(null);
    setBoardTableMissing(false);
    try {
      const titles = await fetchArenaTitles();
      setArenaTitles(titles.titles);
      if (titles.tableMissing) setBoardTableMissing(true);
      if (tab === "overall") {
        const res = await fetchOverallBoard(10, user?.id ?? null);
        setBoardEntries(res.entries);
        if (res.tableMissing) setBoardTableMissing(true);
        if (user) {
          const mine = await fetchMyBest(user.id, null);
          setMyBoardBest(mine);
          setMyBoardRank(
            mine
              ? await fetchRank({ gameTitle: null, score: mine.score })
              : null
          );
        } else {
          setMyBoardBest(null);
          setMyBoardRank(null);
        }
      } else {
        const t = title ?? titles.titles[0] ?? null;
        if (!t) {
          setBoardEntries([]);
          setMyBoardBest(null);
          setMyBoardRank(null);
          return;
        }
        setBoardGameTitle(t);
        const res = await fetchArenaBoard(t, 10, user?.id ?? null);
        setBoardEntries(res.entries);
        if (res.tableMissing) setBoardTableMissing(true);
        if (user) {
          const mine = await fetchMyBest(user.id, t);
          setMyBoardBest(mine);
          setMyBoardRank(
            mine
              ? await fetchRank({ gameTitle: t, score: mine.score })
              : null
          );
        } else {
          setMyBoardBest(null);
          setMyBoardRank(null);
        }
      }
    } catch {
      setBoardNote(
        "Couldn't refresh the leaderboard — showing the last board we have."
      );
    } finally {
      setBoardLoading(false);
    }
  }

  // Timer for timed games (trivia mode only): counts down once per second.
  useEffect(() => {
    if (!game || playMode !== "trivia" || !timedSeconds || selected || finished) return;
    setTimeLeft(timedSeconds);
    const id = setInterval(() => {
      setTimeLeft((prev) => (prev === null ? prev : Math.max(0, prev - 1)));
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, playMode, current, finished]);

  // Time ran out on this question: counts as a miss — streak lost, a life lost.
  useEffect(() => {
    if (timeLeft !== 0 || selected || !game || playMode !== "trivia" || finished)
      return;
    setTimedOut(true);
    setSelected("__timeout__");
    setLastAward(null);
    if (game) {
      const q = game.questions[current];
      setMisses((prev) => [
        ...prev,
        {
          question: q.question,
          picked: "(time ran out)",
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
        },
      ]);
    }
    onAnswer?.(false);
    setStreaks((prev) => {
      const next = [...prev];
      next[turn] = 0;
      return next;
    });
    setPlayerStats((prev) =>
      prev.map((s, i) => (i === turn ? { ...s, answered: s.answered + 1 } : s))
    );
    setLives((prev) => Math.max(0, prev - 1));
    playArenaSound("wrong", muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  // Urgency tick when the timer is almost out.
  useEffect(() => {
    if (
      timeLeft !== null &&
      timeLeft <= 5 &&
      timeLeft > 0 &&
      !selected &&
      game &&
      playMode === "trivia" &&
      !finished
    ) {
      playArenaSound("tick", muted);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft]);

  // Win fanfare when the game ends on a strong performance.
  useEffect(() => {
    if (!finished || !game) return;
    const top = playerStats.reduce(
      (best, s) => Math.max(best, s.answered ? s.correct / s.answered : 0),
      0
    );
    if (top >= 0.7) playArenaSound("win", muted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function pick(option: string) {
    if (selected || !game) return;
    const q = game.questions[current];
    setSelected(option);
    if (option === q.correctAnswer) {
      onAnswer?.(true);
      // Points scale with speed (up to +50% of the base for a fast answer)
      // and streaks pay a combo bonus: 3 in a row = +25, 4 = +50, and so on.
      const speedBonus =
        timedSeconds && timeLeft !== null
          ? Math.round(q.points * 0.5 * (timeLeft / timedSeconds))
          : 0;
      const newStreak = (streaks[turn] ?? 0) + 1;
      const comboBonus = newStreak >= 3 ? 25 * (newStreak - 2) : 0;
      const total = q.points + speedBonus + comboBonus;
      setLastAward({ base: q.points, speed: speedBonus, combo: comboBonus, total });
      setScores((prev) => {
        const next = [...prev];
        next[turn] += total;
        return next;
      });
      setStreaks((prev) => {
        const next = [...prev];
        next[turn] = newStreak;
        return next;
      });
      setPlayerStats((prev) =>
        prev.map((s, i) =>
          i === turn
            ? {
                ...s,
                correct: s.correct + 1,
                answered: s.answered + 1,
                bestStreak: Math.max(s.bestStreak, newStreak),
                bonus: s.bonus + speedBonus + comboBonus,
              }
            : s
        )
      );
      playArenaSound("correct", muted);
    } else {
      // A miss breaks the streak and costs a life.
      onAnswer?.(false);
      setMisses((prev) => [
        ...prev,
        {
          question: q.question,
          picked: option,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
        },
      ]);
      setLastAward(null);
      setStreaks((prev) => {
        const next = [...prev];
        next[turn] = 0;
        return next;
      });
      setPlayerStats((prev) =>
        prev.map((s, i) =>
          i === turn ? { ...s, answered: s.answered + 1 } : s
        )
      );
      setLives((prev) => Math.max(0, prev - 1));
      playArenaSound("wrong", muted);
    }
  }

  function nextQuestion() {
    if (!game) return;
    setTimedOut(false);
    setLastAward(null);
    if (current + 1 >= game.questions.length || lives <= 0) {
      setFinished(true);
      onGameFinished?.(
        playerStats.reduce((n, s) => n + s.correct, 0),
        playerStats.reduce((n, s) => n + s.answered, 0)
      );
      // Leaderboard: Player 1 is the signed-in account holder (in 1 Player,
      // the only player). Record once per play-through, in the background —
      // a failed save never blocks the results screen.
      const myStats = playerStats[0] ?? {
        correct: 0,
        answered: 0,
        bestStreak: 0,
        bonus: 0,
      };
      const myScore = scores[0] ?? 0;
      const title = (game.title || "Battle Arena").slice(0, 200);
      const topic = (templatesSource || guideTopic || "").slice(0, 500);
      if (
        myStats.answered > 0 &&
        game.questions.length > 0 &&
        recordedPlayRef.current !== playIdRef.current
      ) {
        recordedPlayRef.current = playIdRef.current;
        const accuracy = myStats.correct / myStats.answered;
        if (user) {
          setPlacementBusy(true);
          void recordArenaScore({
            user,
            gameTitle: title,
            gameType: game.gameType,
            topic: topic || null,
            mode,
            score: myScore,
            accuracy,
            bestStreak: myStats.bestStreak,
            correct: myStats.correct,
            answered: myStats.answered,
            questionCount: game.questions.length,
          }).then(async (saved) => {
            if (!saved) {
              setPlacementBusy(false);
              return;
            }
            const rank = await fetchRank({
              gameTitle: title,
              score: myScore,
              excludeUserId: user.id,
            });
            if (rank !== null) setPlacement({ rank, gameTitle: title });
            setPlacementBusy(false);
          });
        } else {
          // Signed out: the best score stays on this device only.
          recordLocalResult({
            gameTitle: title,
            label: "You",
            score: myScore,
            accuracy,
          });
          setLocalBests(getLocalBests());
        }
        // 2-player / multiplayer: the other local players' scores stay on
        // this device only — a guest name must never appear on the shared
        // board.
        if (playerCount > 1) {
          playerStats.forEach((s, i) => {
            if (i === 0 || s.answered === 0) return;
            recordLocalResult({
              gameTitle: title,
              label: `Player ${i + 1}`,
              score: scores[i] ?? 0,
              accuracy: s.correct / s.answered,
            });
          });
          setLocalBests(getLocalBests());
        }
      }
    } else {
      setCurrent(current + 1);
      setSelected(null);
      setTurn((t) => (t + 1) % playerCount);
    }
  }

  function replayGame() {
    if (!game) return;
    resetPlayState(playerCount);
    setTimeLeft(game.timedSecondsPerQuestion ?? null);
  }

  function restart() {
    setGame(null);
    setTemplates(null);
    setChosenTemplate(null);
    setTemplatesError(null);
    setError(null);
    setGameSavedNote(null);
    resetPlayState(1);
    setTimeLeft(null);
  }

  function pickMatch(frontIdx: number | null, backIdx: number | null) {
    if (!game?.cards) return;
    if (frontIdx !== null) setPickedFront(frontIdx);
    if (backIdx !== null) setPickedBack(backIdx);
    const f = frontIdx !== null ? frontIdx : pickedFront;
    const b = backIdx !== null ? backIdx : pickedBack;
    if (f === null || b === null) return;
    const backEntry = shuffledBacks[b];
    if (backEntry && backEntry.index === f) {
      setMatched((prev) => new Set([...prev, f]));
      setMatchScore((s) => s + 100);
      setMatchMessage("Match! Nice work.");
      playArenaSound("match", muted);
    } else {
      setMatchMessage("Not a match — try again.");
      playArenaSound("wrong", muted);
    }
    setPickedFront(null);
    setPickedBack(null);
  }

  const question = game?.questions[current];
  const cards = game?.cards ?? [];
  const matchDone = cards.length > 0 && matched.size === cards.length;
  const rankedPlayers = playerStats
    .map((s, i) => ({
      player: i + 1,
      score: scores[i] ?? 0,
      ...s,
      accuracy: s.answered ? s.correct / s.answered : 0,
    }))
    .sort((a, b) => b.score - a.score);
  const showConfetti = finished && (rankedPlayers[0]?.accuracy ?? 0) >= 0.7;
  // Signed-out player's best on this device for the arena being viewed.
  const signedOutArenaBest =
    !user && boardTab === "arena" && boardGameTitle
      ? getLocalBestForArena(boardGameTitle)
      : null;

  return (
    <div className="card p-5 sm:p-6">
      <div className="flex items-center gap-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-glow">
          <Trophy className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-extrabold tracking-tight">Battle Arena</h2>
          <p className="text-sm leading-relaxed text-ink-400">
            Pick a game style from a few quick ideas — then the AI finishes
            the full game for you.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMuted((m) => !m)}
          className="btn-ghost ml-auto"
          aria-label={muted ? "Turn sound on" : "Mute sound"}
          title={muted ? "Turn sound on" : "Mute sound"}
        >
          {muted ? (
            <VolumeX className="h-4 w-4" />
          ) : (
            <Volume2 className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{muted ? "Muted" : "Sound"}</span>
        </button>
      </div>

      {!game && !loading && !templates && !templatesLoading && (
        <div className="mt-4 space-y-3">
          {guideContent && (
            <div className="rounded-2xl bg-gradient-to-br from-brand-50 to-accent-50 p-4 ring-1 ring-inset ring-brand-100">
              <p className="text-sm font-bold text-brand-800">
                Play a game from this study guide
                {guideTopic ? ` — ${guideTopic}` : ""}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-brand-700">
                First you&apos;ll get a few quick game ideas to choose from —
                then the AI builds the full game from the one you pick.
              </p>
              <button
                type="button"
                onClick={() => generateTemplates(guideContent)}
                className="btn-primary mt-3"
              >
                <Play className="h-4 w-4" /> Generate Guide Game
              </button>
            </div>
          )}
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            placeholder="Or enter a topic or paste notes to build a game from…"
            className="input"
          />
          <div className="flex flex-wrap items-center gap-2">
            {(["1 Player", "2 Player Local", "Multiplayer"] as Mode[]).map(
              (m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
                    mode === m
                      ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200"
                  }`}
                >
                  <Users className="h-4 w-4" /> {m}
                </button>
              )
            )}
            <button
              type="button"
              onClick={() => generateTemplates(topic)}
              disabled={!topic.trim()}
              className="btn-primary ml-auto"
            >
              <Play className="h-4 w-4" /> Generate Game
            </button>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
              Game length
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {GAME_LENGTHS.map((l) => (
                <button
                  key={l.value}
                  type="button"
                  onClick={() => setGameLength(l.value)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
                    gameLength === l.value
                      ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200"
                  }`}
                >
                  {l.label} · {l.hint}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-400">
              Standard is 20 questions. Marathon builds in two parts and can
              take a little longer.
            </p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => openBoard("overall")}
              className="btn-secondary"
            >
              <Trophy className="h-4 w-4" /> Leaderboards
            </button>
            {!user && (
              <p className="text-xs text-ink-400">
                Sign in to put your scores on the shared board — you can
                still play and see the boards.
              </p>
            )}
          </div>
          {(error || templatesError) && (
            <div className="feedback-wrong mt-3 font-medium">
              {error || templatesError}
            </div>
          )}
        </div>
      )}

      {/* Step 1 result: three incomplete template previews to choose from */}
      {!game && !loading && templates && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-extrabold tracking-tight">
                Pick a game style
              </h3>
              <p className="text-sm text-ink-400">
                Three quick ideas for your topic — choose one and the AI will
                finish the full {gameLength}-question game.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => generateTemplates(templatesSource)}
                disabled={templatesLoading}
                className="btn-secondary"
              >
                <RefreshCw className="h-4 w-4" /> Regenerate templates
              </button>
              <button
                type="button"
                onClick={() => {
                  setTemplates(null);
                  setChosenTemplate(null);
                  setTemplatesError(null);
                }}
                className="btn-secondary"
              >
                <ArrowLeft className="h-4 w-4" /> Change topic
              </button>
            </div>
          </div>

          {templatesError && (
            <div className="feedback-wrong font-medium">{templatesError}</div>
          )}

          <div className="grid gap-3 md:grid-cols-3">
            {templates.map((t, i) => (
              <article
                key={`${t.title}-${i}`}
                className="card flex flex-col p-4"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-glow">
                  <LayoutTemplate className="h-5 w-5" />
                </span>
                <h4 className="mt-3 text-base font-extrabold leading-snug tracking-tight">
                  {t.title}
                </h4>
                <span className="chip mt-2 self-start">{t.gameType}</span>
                <p className="mt-2 text-sm leading-relaxed text-ink-400">
                  {t.description}
                </p>
                {t.sampleQuestions?.length > 0 && (
                  <div className="mt-3 space-y-3 border-t border-ink-100 pt-3">
                    <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                      A taste
                    </p>
                    {t.sampleQuestions.map((q, qi) => (
                      <div key={qi}>
                        <p className="text-sm font-semibold leading-relaxed text-ink-900">
                          {q.question}
                        </p>
                        <ul className="mt-1 space-y-1">
                          {q.options.map((opt) => (
                            <li
                              key={opt}
                              className={`flex items-center gap-1.5 text-sm ${
                                opt === q.correctAnswer
                                  ? "font-semibold text-emerald-700"
                                  : "text-ink-400"
                              }`}
                            >
                              {opt === q.correctAnswer && (
                                <CheckCircle2 className="h-4 w-4 shrink-0" />
                              )}
                              <span>{opt}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => chooseTemplate(t)}
                  disabled={loading}
                  className="btn-primary mt-4 w-full justify-center"
                >
                  <Play className="h-4 w-4" /> Choose this one
                </button>
              </article>
            ))}
          </div>

          {error && (
            <div className="feedback-wrong font-medium">{error}</div>
          )}
        </div>
      )}

      {templatesLoading && (
        <div className="mt-6 flex flex-col items-center gap-4 py-10 text-center">
          <Brain className="h-12 w-12 text-brand-600" />
          <div>
            <p className="text-lg font-semibold">Dreaming up game ideas…</p>
            <p className="text-sm text-ink-400">
              A few quick game styles for your topic — just a few seconds.
            </p>
          </div>
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

      {loading && (
        <div className="mt-6 flex flex-col items-center gap-4 py-10 text-center">
          <Brain className="h-12 w-12 text-brand-600" />
          <div>
            <p className="text-lg font-semibold">
              Building your {gameLength}-question game
              {chosenTemplate ? ` — ${chosenTemplate.title}` : ""}…
            </p>
            <p className="text-sm text-ink-400">
              Finishing the full game from the style you picked.
              {gameLength > 10
                ? " Longer games build in parts — sit tight."
                : ""}
            </p>
          </div>
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

      {game && !finished && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-lg font-extrabold tracking-tight">{game.title}</h3>
            <span className="chip">
              {game.gameType ? `${game.gameType} · ` : ""}
              {playMode === "trivia"
                ? `Question ${current + 1} of ${game.questions.length}`
                : playMode === "flashcards"
                  ? `Card ${cardIndex + 1} of ${cards.length}`
                  : `${matched.size} of ${cards.length} matched`}
            </span>
          </div>
          {game.gameDescription && (
            <p className="mt-1 text-sm leading-relaxed text-ink-400">{game.gameDescription}</p>
          )}
          {gameSavedNote && (
            <p className="mt-1 text-xs font-semibold text-emerald-700">
              {gameSavedNote}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {(["trivia", ...(hasCards ? (["flashcards", "matching"] as PlayMode[]) : [])] as PlayMode[]).map(
              (pm) => (
                <button
                  key={pm}
                  type="button"
                  onClick={() => setPlayMode(pm)}
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium capitalize ${
                    playMode === pm
                      ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                      : "bg-ink-100 text-ink-700 hover:bg-ink-200"
                  }`}
                >
                  <Layers className="h-4 w-4" /> {pm}
                </button>
              )
            )}
          </div>

          {playMode === "trivia" && question && (
            <div key={current} className="arena-slide-in mt-4">
              <div className="progress-track mt-3">
                <div
                  className="progress-fill"
                  style={{
                    width: `${((current + 1) / game.questions.length) * 100}%`,
                  }}
                />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {scores.map((s, i) => (
                  <span
                    key={i}
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      i === turn
                        ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                        : "bg-ink-100 text-ink-700"
                    }`}
                  >
                    Player {i + 1}: {s} pts
                  </span>
                ))}
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-100"
                  title="Wrong answers and time-outs cost a life"
                >
                  {[0, 1, 2].map((i) => (
                    <Heart
                      key={i}
                      className={`h-3.5 w-3.5 ${
                        i < lives
                          ? "fill-rose-500 text-rose-500"
                          : "text-rose-200"
                      }`}
                    />
                  ))}
                  {lives} {lives === 1 ? "life" : "lives"}
                </span>
                {streaks[turn] >= 2 && (
                  <span className="chip-amber">
                    <Flame className="h-3.5 w-3.5" /> {streaks[turn]} in a
                    row — combo bonus!
                  </span>
                )}
                {timedSeconds && timeLeft !== null && (
                  <span
                    className={
                      timeLeft <= 5
                        ? "inline-flex animate-pulse items-center gap-1 rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-700 ring-1 ring-inset ring-rose-200"
                        : "chip-amber"
                    }
                  >
                    <Timer className="h-3.5 w-3.5" /> {timeLeft}s left
                  </span>
                )}
              </div>
              <p className="mt-4 text-base font-bold leading-relaxed text-ink-900">
                {question.question}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {question.options.map((opt) => {
                  const isCorrect = opt === question.correctAnswer;
                  const isPicked = opt === selected;
                  let cls = "";
                  if (selected) {
                    if (isCorrect) cls = "option-correct arena-flash";
                    else if (isPicked) cls = "option-wrong arena-shake";
                    else cls = "option-dimmed";
                  }
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => pick(opt)}
                      disabled={!!selected}
                      className={`option-btn ${cls}`}
                    >
                      <span>{opt}</span>
                      {selected && isCorrect && (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
                      )}
                      {selected && isPicked && !isCorrect && (
                        <XCircle className="h-5 w-5 shrink-0 text-red-600" />
                      )}
                    </button>
                  );
                })}
              </div>
              {selected && (
                <div className="feedback-neutral mt-4">
                  {timedOut && (
                    <p className="font-semibold text-amber-700">
                      Time ran out — the correct answer is: {question.correctAnswer}
                    </p>
                  )}
                  <p>
                    <strong>Explanation:</strong> {question.explanation}
                  </p>
                  {timedOut ? (
                    <p className="mt-1.5 text-xs font-medium text-ink-400">
                      A life is lost — answer faster next time!
                    </p>
                  ) : selected === question.correctAnswer && lastAward ? (
                    <p className="mt-1.5 text-xs font-medium text-ink-400">
                      +{lastAward.base} base
                      {lastAward.speed > 0
                        ? ` · +${lastAward.speed} speed bonus`
                        : ""}
                      {lastAward.combo > 0
                        ? ` · +${lastAward.combo} streak bonus`
                        : ""}{" "}
                      = +{lastAward.total} points — correct, nice work!
                    </p>
                  ) : (
                    <p className="mt-1.5 text-xs font-medium text-ink-400">
                      Not quite — the correct answer is highlighted above. A
                      life is lost.
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={nextQuestion}
                      className="btn-primary"
                    >
                      {current + 1 >= game.questions.length || lives <= 0
                        ? "See Results"
                        : "Next Question"}
                    </button>
                    {selected !== question.correctAnswer && selected !== "__timeout__" && (
                      <button
                        type="button"
                        onClick={() => {
                          setTutorContext(
                            `In a Battle Arena game titled "${game.title}", the question was: "${question.question}". The options were: ${question.options.join("; ")}. The correct answer is "${question.correctAnswer}" but the player chose "${selected}". Explain why the chosen answer is wrong and why the correct answer is right.`
                          );
                          setTutorOpen(true);
                        }}
                        className="btn-secondary"
                      >
                        <Sparkles className="h-4 w-4 text-brand-600" /> Ask AI Tutor
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {playMode === "flashcards" && cards.length > 0 && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => setFlipped((v) => !v)}
                className="card card-hover mx-auto flex min-h-44 w-full max-w-md cursor-pointer flex-col items-center justify-center bg-gradient-to-br from-brand-50 to-white p-6 text-lg font-bold text-ink-900"
              >
                {flipped ? cards[cardIndex].back : cards[cardIndex].front}
                <span className="mt-2 text-xs font-medium text-ink-400">
                  Tap to flip
                </span>
              </button>
              <p className="mt-2 text-sm font-medium text-ink-400">
                {knownCount} marked as known
              </p>
              <div className="mt-3 flex justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFlipped(false);
                    setCardIndex((i) => Math.max(0, i - 1));
                  }}
                  disabled={cardIndex === 0}
                  className="btn-secondary"
                >
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => setKnownCount((c) => c + 1)}
                  className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
                >
                  I knew it
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFlipped(false);
                    setCardIndex((i) => Math.min(cards.length - 1, i + 1));
                  }}
                  disabled={cardIndex >= cards.length - 1}
                  className="btn-primary"
                >
                  Next
                </button>
              </div>
            </div>
          )}

          {playMode === "matching" && cards.length > 0 && (
            <div className="mt-4">
              <p className="text-sm leading-relaxed text-ink-400">
                Tap one card on each side to make a pair. Score: {matchScore} pts
                · {matched.size} of {cards.length} matched.
              </p>
              {matchMessage && (
                <p className="mt-2 text-sm font-bold text-ink-700">{matchMessage}</p>
              )}
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  {cards.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      disabled={matched.has(i)}
                      onClick={() => pickMatch(i, null)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm font-medium ${
                        matched.has(i)
                          ? "option-correct"
                          : pickedFront === i
                            ? "border-brand-600 bg-brand-50"
                            : ""
                      }`}
                    >
                      {c.front}
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  {shuffledBacks.map((entry, bi) => (
                    <button
                      key={bi}
                      type="button"
                      disabled={matched.has(entry.index)}
                      onClick={() => pickMatch(null, bi)}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left text-sm font-medium ${
                        matched.has(entry.index)
                          ? "option-correct"
                          : pickedBack === bi
                            ? "border-brand-600 bg-brand-50"
                            : ""
                      }`}
                    >
                      {entry.back}
                    </button>
                  ))}
                </div>
              </div>
              {matchDone && (
                <p className="mt-3 text-center font-semibold text-green-700">
                  All matched! Final score: {matchScore} pts
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {game && finished && playMode === "trivia" && (
        <div className="arena-pop relative mt-6 overflow-hidden rounded-2xl border border-ink-100 bg-white p-6 text-center shadow-card">
          {showConfetti && (
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-hidden"
            >
              {confettiPieces.map((p, i) => (
                <span
                  key={i}
                  className="arena-confetti absolute top-0"
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
          )}
          <Trophy className="mx-auto h-12 w-12 text-amber-500" />
          <h3 className="mt-2 text-2xl font-extrabold tracking-tight">
            {lives <= 0 ? "Out of Lives!" : "Game Over!"}
          </h3>
          <p className="text-sm font-medium text-ink-400">{game.title}</p>
          {rankedPlayers[0] && (
            <p className="mt-2">
              <span className="chip-amber">
                <Sparkles className="h-3.5 w-3.5" /> Player{" "}
                {rankedPlayers[0].player}:{" "}
                {rankFor(
                  rankedPlayers[0].accuracy,
                  rankedPlayers[0].bestStreak
                )}
              </span>
            </p>
          )}
          <div className="mx-auto mt-4 max-w-md space-y-2 text-left">
            {rankedPlayers.map((row, rank) => (
              <div
                key={row.player}
                className="rounded-xl border border-ink-100 bg-white px-4 py-3 text-sm shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold">
                    {rank === 0 ? "Winner — " : ""}Player {row.player}
                  </span>
                  <span className="font-extrabold">{row.score} pts</span>
                </div>
                <p className="mt-1 text-xs font-medium text-ink-400">
                  {row.correct} of {row.answered} correct ·{" "}
                  {Math.round(row.accuracy * 100)}% accuracy · best streak{" "}
                  {row.bestStreak}
                  {row.bonus > 0 ? ` · +${row.bonus} bonus pts` : ""}
                </p>
              </div>
            ))}
          </div>
          {placementBusy && (
            <p className="mt-3 text-sm font-medium text-ink-400">
              Saving your score to the leaderboard…
            </p>
          )}
          {placement && (
            <p className="mt-3">
              <span className="chip-amber">
                <Trophy className="h-3.5 w-3.5" /> You placed #
                {placement.rank} on the {placement.gameTitle} board!
              </span>
            </p>
          )}
          {!user && !placementBusy && (
            <p className="mx-auto mt-3 max-w-md text-xs leading-relaxed text-ink-400">
              Sign in to put your scores on the shared leaderboard — for now
              your best score is saved on this device only.
            </p>
          )}
          {user && playerCount > 1 && (
            <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-400">
              Only Player 1&apos;s score goes on the shared board
              (that&apos;s you, the signed-in player) — the other
              players&apos; scores stay on this device.
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button type="button" onClick={replayGame} className="btn-primary">
              <RotateCcw className="h-4 w-4" /> Replay this game
            </button>
            <button
              type="button"
              onClick={() => openBoard("arena", game.title)}
              className="btn-secondary"
            >
              <Trophy className="h-4 w-4" /> View leaderboard
            </button>
            {misses.length > 0 && onReviewMisses && (
              <button
                type="button"
                onClick={() => onReviewMisses(misses)}
                className="btn-secondary"
                title="Send the questions you missed into your Review queue for spaced practice"
              >
                <BookOpen className="h-4 w-4 text-brand-600" /> Review your
                misses ({misses.length})
              </button>
            )}
            <button type="button" onClick={restart} className="btn-secondary">
              <Play className="h-4 w-4" /> New Game
            </button>
          </div>
        </div>
      )}

      {game && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {templates && templates.length > 0 && (
            <button
              type="button"
              onClick={backToTemplates}
              className="btn-secondary"
            >
              <ArrowLeft className="h-4 w-4" /> Back to templates
            </button>
          )}
          <button
            type="button"
            onClick={restart}
            className="btn-secondary"
          >
            <RotateCcw className="h-4 w-4" /> New Game
          </button>
        </div>
      )}

      {boardOpen && (
        <div className="mt-4 rounded-2xl border border-ink-100 bg-white p-5 shadow-card">
          <div className="flex items-center gap-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-glow">
              <Trophy className="h-5 w-5" />
            </span>
            <div>
              <h3 className="text-lg font-extrabold tracking-tight">
                Leaderboards
              </h3>
              <p className="text-sm text-ink-400">
                Real scores from real finished games — nothing here is made
                up.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBoardOpen(false)}
              className="btn-ghost ml-auto"
              aria-label="Close leaderboards"
            >
              <XCircle className="h-4 w-4" />
              <span className="hidden sm:inline">Close</span>
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {(["overall", "arena"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => openBoard(t)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium ${
                  boardTab === t
                    ? "bg-gradient-to-b from-brand-500 to-brand-600 text-white shadow-glow"
                    : "bg-ink-100 text-ink-700 hover:bg-ink-200"
                }`}
              >
                {t === "overall" ? "Overall" : "By arena"}
              </button>
            ))}
            {boardTab === "arena" && arenaTitles.length > 0 && (
              <select
                value={boardGameTitle ?? ""}
                onChange={(e) => openBoard("arena", e.target.value)}
                className="input w-auto"
                aria-label="Choose an arena"
              >
                {arenaTitles.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}
          </div>

          {boardTableMissing && (
            <p className="feedback-neutral mt-3">
              Leaderboards need a quick database update before scores can
              appear — your games still save locally.
            </p>
          )}
          {boardNote && (
            <p className="feedback-neutral mt-3">{boardNote}</p>
          )}

          {boardLoading ? (
            <p className="mt-4 flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading the
              board…
            </p>
          ) : boardEntries.length === 0 ? (
            <p className="mt-4 text-sm font-medium text-ink-400">
              No scores yet — finish a game to be the first on the board!
            </p>
          ) : (
            <ol className="mt-4 space-y-2">
              {boardEntries.map((row) => (
                <li
                  key={`${row.userId}-${row.playedAt}`}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-sm ${
                    row.isMe
                      ? "border-amber-300 bg-amber-50"
                      : "border-ink-100 bg-white"
                  }`}
                >
                  <span className="w-8 shrink-0 text-center font-extrabold">
                    #{row.rank}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {row.displayName}
                      {row.isMe ? " (you)" : ""}
                    </span>
                    <span className="block truncate text-xs text-ink-400">
                      @{row.username} · {Math.round(row.accuracy * 100)}%
                      accuracy · best streak {row.bestStreak}
                    </span>
                  </span>
                  <span className="shrink-0 font-extrabold">
                    {row.score} pts
                  </span>
                </li>
              ))}
            </ol>
          )}

          {user && myBoardBest && myBoardRank !== null && (
            <p className="mt-3 text-sm font-semibold">
              You are #{myBoardRank} — your best: {myBoardBest.score} pts (
              {Math.round(myBoardBest.accuracy * 100)}% accuracy)
            </p>
          )}
          {user && !myBoardBest && !boardLoading && !boardTableMissing && (
            <p className="mt-3 text-sm text-ink-400">
              You haven&apos;t played a ranked game yet — finish one to get
              on the board.
            </p>
          )}
          {signedOutArenaBest && (
            <p className="mt-3 text-sm font-semibold">
              Your best on this device for {boardGameTitle}:{" "}
              {signedOutArenaBest.score} pts (
              {Math.round(signedOutArenaBest.accuracy * 100)}% accuracy)
            </p>
          )}

          {localBests.length > 0 && (
            <div className="mt-4 border-t border-ink-100 pt-3">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                On this device only — not on the shared board
              </p>
              <ul className="mt-2 space-y-1.5">
                {localBests.slice(0, 5).map((r, i) => (
                  <li
                    key={`${r.gameTitle}-${r.playedAt}-${i}`}
                    className="flex items-center justify-between gap-2 text-sm"
                  >
                    <span className="truncate">
                      {r.label} · {r.gameTitle}
                    </span>
                    <span className="shrink-0 font-bold">
                      {r.score} pts · {Math.round(r.accuracy * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <TutorPanel
        open={tutorOpen}
        onClose={() => setTutorOpen(false)}
        context={tutorContext}
        title="Battle Arena Tutor"
      />
    </div>
  );
}
