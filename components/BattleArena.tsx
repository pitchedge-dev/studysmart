"use client";

import { useState } from "react";
import {
  Brain,
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
  Sparkles,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import TutorPanel from "./TutorPanel";

export type GameQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  points: number;
};

export type GameData = {
  title: string;
  questions: GameQuestion[];
};

type Mode = "1 Player" | "2 Player Local" | "Multiplayer";

export default function BattleArena() {
  const [topic, setTopic] = useState("");
  const [mode, setMode] = useState<Mode>("1 Player");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [game, setGame] = useState<GameData | null>(null);
  const [current, setCurrent] = useState(0);
  const [scores, setScores] = useState<number[]>([0]);
  const [turn, setTurn] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [tutorContext, setTutorContext] = useState<string | undefined>(undefined);

  const playerCount =
    mode === "1 Player" ? 1 : mode === "2 Player Local" ? 2 : 4;

  async function generateGame() {
    if (!topic.trim() || loading) return;
    setError(null);
    setLoading(true);
    setGame(null);
    setFinished(false);
    try {
      const res = await fetch("/api/generate-game", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topicOrNotes: topic.trim(),
          playerCount,
          questionCount: 10,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate the game.");
      setGame(data as GameData);
      setCurrent(0);
      setScores(Array(playerCount).fill(0));
      setTurn(0);
      setSelected(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  function pick(option: string) {
    if (selected || !game) return;
    const q = game.questions[current];
    setSelected(option);
    if (option === q.correctAnswer) {
      setScores((prev) => {
        const next = [...prev];
        next[turn] += q.points;
        return next;
      });
    }
  }

  function nextQuestion() {
    if (!game) return;
    if (current + 1 >= game.questions.length) {
      setFinished(true);
    } else {
      setCurrent(current + 1);
      setSelected(null);
      setTurn((t) => (t + 1) % playerCount);
    }
  }

  function restart() {
    setGame(null);
    setCurrent(0);
    setScores([0]);
    setTurn(0);
    setSelected(null);
    setFinished(false);
  }

  const question = game?.questions[current];

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 text-amber-600">
          <Trophy className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-lg font-bold">Battle Arena</h2>
          <p className="text-sm text-slate-500">
            Turn any topic or notes into a live trivia battle.
          </p>
        </div>
      </div>

      {!game && !loading && (
        <div className="mt-4 space-y-3">
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            placeholder="Enter a topic or paste notes to build a game from…"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
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
                      ? "bg-brand-600 text-white"
                      : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                  }`}
                >
                  <Users className="h-4 w-4" /> {m}
                </button>
              )
            )}
            <button
              type="button"
              onClick={generateGame}
              disabled={!topic.trim()}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              <Play className="h-4 w-4" /> Generate Game
            </button>
          </div>
          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}

      {loading && (
        <div className="mt-6 flex flex-col items-center gap-4 py-10 text-center">
          <Brain className="h-12 w-12 text-brand-600" />
          <div>
            <p className="text-lg font-semibold">Brainstorming…</p>
            <p className="text-sm text-slate-500">
              Building your trivia questions from your topic.
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

      {game && !finished && question && (
        <div className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{game.title}</h3>
            <span className="text-sm text-slate-500">
              Question {current + 1} of {game.questions.length}
            </span>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full bg-brand-500 transition-all"
              style={{
                width: `${((current + 1) / game.questions.length) * 100}%`,
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {scores.map((s, i) => (
              <span
                key={i}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  i === turn
                    ? "bg-brand-600 text-white"
                    : "bg-slate-100 text-slate-700"
                }`}
              >
                Player {i + 1}: {s} pts
              </span>
            ))}
          </div>
          <p className="mt-4 text-base font-medium leading-relaxed">
            {question.question}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {question.options.map((opt) => {
              const isCorrect = opt === question.correctAnswer;
              const isPicked = opt === selected;
              let cls = "border-slate-200 bg-white hover:border-brand-400";
              if (selected) {
                if (isCorrect) cls = "border-green-500 bg-green-50 text-green-800";
                else if (isPicked) cls = "border-red-500 bg-red-50 text-red-800";
                else cls = "border-slate-200 bg-slate-50 text-slate-400";
              }
              return (
                <button
                  key={opt}
                  type="button"
                  onClick={() => pick(opt)}
                  disabled={!!selected}
                  className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-3 text-left text-sm font-medium transition ${cls}`}
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
            <div className="mt-4 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              <p>
                <strong>Explanation:</strong> {question.explanation}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Worth {question.points} points ·{" "}
                {selected === question.correctAnswer
                  ? "Correct — nice work!"
                  : "Not quite — the correct answer is highlighted above."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={nextQuestion}
                  className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
                >
                  {current + 1 >= game.questions.length
                    ? "See Results"
                    : "Next Question"}
                </button>
                {selected !== question.correctAnswer && (
                  <button
                    type="button"
                    onClick={() => {
                      setTutorContext(
                        `In a Battle Arena game titled "${game.title}", the question was: "${question.question}". The options were: ${question.options.join("; ")}. The correct answer is "${question.correctAnswer}" but the player chose "${selected}". Explain why the chosen answer is wrong and why the correct answer is right.`
                      );
                      setTutorOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Sparkles className="h-4 w-4 text-brand-600" /> Ask AI Tutor
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {game && finished && (
        <div className="mt-6 text-center">
          <Trophy className="mx-auto h-12 w-12 text-amber-500" />
          <h3 className="mt-2 text-xl font-bold">Game Over!</h3>
          <p className="text-sm text-slate-500">{game.title}</p>
          <div className="mx-auto mt-4 max-w-sm space-y-2">
            {scores
              .map((s, i) => ({ player: i + 1, score: s }))
              .sort((a, b) => b.score - a.score)
              .map((row, rank) => (
                <div
                  key={row.player}
                  className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-2 text-sm"
                >
                  <span className="font-medium">
                    {rank === 0 ? "Winner — " : ""}Player {row.player}
                  </span>
                  <span className="font-bold">{row.score} pts</span>
                </div>
              ))}
          </div>
          <div className="mt-4 flex justify-center gap-2">
            <button
              type="button"
              onClick={restart}
              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              <RotateCcw className="h-4 w-4" /> Play Again
            </button>
          </div>
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
