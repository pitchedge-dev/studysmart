/**
 * Battle Arena leaderboards — real scores only.
 *
 * Shared boards live in Supabase (`arena_scores`, migration 0007). A row is
 * written only when a real trivia game was actually played to the end, for
 * the signed-in account holder only (Player 1 in 2-player / multiplayer
 * local games — a local guest name must never appear as a leaderboard
 * identity). Nothing here ever invents, seeds, or samples a score.
 *
 * Signed-out play never touches the shared board: the best score stays on
 * the device only (localStorage), clearly labeled as local.
 *
 * Every helper degrades gracefully: if the migration has not been applied
 * live yet the table is missing (42P01) and callers get empty boards plus
 * `tableMissing: true` instead of a crash. A failed save never throws —
 * `recordArenaScore` returns null and the game carries on.
 */

import {
  getMyProfile,
  getSupabase,
  type AppUser,
} from "@/lib/supabase";

export type ArenaScoreRow = {
  id: string;
  user_id: string;
  username: string;
  display_name: string;
  game_title: string;
  game_type: string | null;
  topic: string | null;
  mode: string;
  score: number;
  accuracy: number;
  best_streak: number;
  correct: number;
  answered: number;
  question_count: number;
  played_at: string;
};

export type LeaderboardEntry = {
  rank: number;
  userId: string;
  username: string;
  displayName: string;
  score: number;
  accuracy: number;
  bestStreak: number;
  playedAt: string;
  /** True when this row belongs to the signed-in user viewing the board. */
  isMe: boolean;
};

/** A device-local result — never on the shared board. */
export type LocalArenaResult = {
  gameTitle: string;
  /** "You" (signed-out best) or "Player 2" / "Player 3" (local guests). */
  label: string;
  score: number;
  accuracy: number;
  playedAt: string;
};

const LOCAL_KEY = "studysmart-arena-local-best";
const LOCAL_MAX = 30;

/** Supabase "table does not exist" — the migration has not been applied yet. */
function isTableMissingError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "42P01") return true;
  return (
    typeof e.message === "string" &&
    e.message.includes("arena_scores") &&
    e.message.includes("does not exist")
  );
}

function rowToEntry(
  row: ArenaScoreRow,
  rank: number,
  myUserId?: string | null
): LeaderboardEntry {
  return {
    rank,
    userId: row.user_id,
    username: row.username || "Anonymous",
    displayName: row.display_name || row.username || "Anonymous",
    score: row.score,
    accuracy: Number(row.accuracy) || 0,
    bestStreak: row.best_streak,
    playedAt: row.played_at,
    isMe: !!myUserId && row.user_id === myUserId,
  };
}

/** Best score per player, from rows already sorted best-first. */
function bestPerPlayer(rows: ArenaScoreRow[]): ArenaScoreRow[] {
  const seen = new Set<string>();
  const out: ArenaScoreRow[] = [];
  for (const row of rows) {
    if (seen.has(row.user_id)) continue;
    seen.add(row.user_id);
    out.push(row);
  }
  return out;
}

async function fetchScoreRows(args: {
  gameTitle?: string | null;
  limit: number;
}): Promise<{ rows: ArenaScoreRow[]; tableMissing: boolean }> {
  const sb = getSupabase();
  if (!sb) return { rows: [], tableMissing: false };
  let q = sb
    .from("arena_scores")
    .select(
      "id, user_id, username, display_name, game_title, game_type, topic, mode, score, accuracy, best_streak, correct, answered, question_count, played_at"
    )
    .order("score", { ascending: false })
    .order("played_at", { ascending: false })
    .limit(args.limit);
  if (args.gameTitle) q = q.eq("game_title", args.gameTitle);
  const { data, error } = await q;
  if (error) {
    if (isTableMissingError(error)) return { rows: [], tableMissing: true };
    console.error("[arenaScores] board load failed:", error.message);
    return { rows: [], tableMissing: false };
  }
  return { rows: (data ?? []) as ArenaScoreRow[], tableMissing: false };
}

/**
 * Record one finished game on the shared board. Only call this for a game
 * that was actually played to the end. Never throws — returns the saved row
 * id, or null when the save did not happen (signed out, no Supabase, table
 * missing, RLS/network failure).
 */
export async function recordArenaScore(args: {
  user: AppUser;
  gameTitle: string;
  gameType?: string;
  topic?: string | null;
  mode: string;
  score: number;
  accuracy: number;
  bestStreak: number;
  correct: number;
  answered: number;
  questionCount: number;
}): Promise<string | null> {
  try {
    const sb = getSupabase();
    if (!sb || !args.user) return null;
    // A game with no answered questions is not a played game.
    if (args.answered <= 0 || args.questionCount <= 0) return null;
    const profile = await getMyProfile(args.user.id).catch(() => null);
    const username =
      profile?.username ||
      (args.user.user_metadata?.username as string | undefined) ||
      "Anonymous";
    const displayName =
      profile?.display_name ||
      (args.user.user_metadata?.display_name as string | undefined) ||
      username;
    const { data, error } = await sb
      .from("arena_scores")
      .insert({
        user_id: args.user.id,
        username: username.slice(0, 100),
        display_name: displayName.slice(0, 100),
        game_title: args.gameTitle.slice(0, 200),
        game_type: args.gameType?.slice(0, 100) ?? null,
        topic: args.topic?.slice(0, 500) ?? null,
        mode: args.mode,
        score: Math.max(0, Math.round(args.score)),
        accuracy: Math.min(1, Math.max(0, args.accuracy)),
        best_streak: Math.max(0, args.bestStreak),
        correct: Math.max(0, args.correct),
        answered: Math.max(0, args.answered),
        question_count: Math.max(0, args.questionCount),
      })
      .select("id")
      .single();
    if (error || !data) {
      if (error) console.error("[arenaScores] save failed:", error.message);
      return null;
    }
    return (data as { id: string }).id;
  } catch (err) {
    console.error("[arenaScores] save failed:", err);
    return null;
  }
}

/** Overall board: each player's single best score, all-time, best first. */
export async function fetchOverallBoard(
  limit = 10,
  myUserId?: string | null
): Promise<{ entries: LeaderboardEntry[]; tableMissing: boolean }> {
  const { rows, tableMissing } = await fetchScoreRows({ limit: 100 });
  if (tableMissing) return { entries: [], tableMissing: true };
  return {
    entries: bestPerPlayer(rows)
      .slice(0, limit)
      .map((row, i) => rowToEntry(row, i + 1, myUserId)),
    tableMissing: false,
  };
}

/** One arena's board: each player's best score on that game title. */
export async function fetchArenaBoard(
  gameTitle: string,
  limit = 10,
  myUserId?: string | null
): Promise<{ entries: LeaderboardEntry[]; tableMissing: boolean }> {
  const { rows, tableMissing } = await fetchScoreRows({
    gameTitle,
    limit: 100,
  });
  if (tableMissing) return { entries: [], tableMissing: true };
  return {
    entries: bestPerPlayer(rows)
      .slice(0, limit)
      .map((row, i) => rowToEntry(row, i + 1, myUserId)),
    tableMissing: false,
  };
}

/** The signed-in user's best row in a scope (whole board, or one arena). */
export async function fetchMyBest(
  userId: string,
  gameTitle: string | null
): Promise<LeaderboardEntry | null> {
  const sb = getSupabase();
  if (!sb) return null;
  let q = sb
    .from("arena_scores")
    .select(
      "id, user_id, username, display_name, game_title, game_type, topic, mode, score, accuracy, best_streak, correct, answered, question_count, played_at"
    )
    .eq("user_id", userId)
    .order("score", { ascending: false })
    .order("played_at", { ascending: false })
    .limit(1);
  if (gameTitle) q = q.eq("game_title", gameTitle);
  const { data, error } = await q;
  if (error) {
    if (isTableMissingError(error)) return null;
    console.error("[arenaScores] my best failed:", error.message);
    return null;
  }
  const row = (data ?? [])[0] as ArenaScoreRow | undefined;
  if (!row) return null;
  return rowToEntry(row, 0, userId);
}

/**
 * Rank of a score among players in a scope: 1 + the number of OTHER
 * players with a score above it. Ties share a rank. `excludeUserId` keeps
 * the player's own earlier, higher scores from pushing a new score's
 * placement down (used for the "You placed #N" message on the results
 * screen). Returns null when the rank cannot be computed.
 */
export async function fetchRank(args: {
  gameTitle: string | null;
  score: number;
  excludeUserId?: string | null;
}): Promise<number | null> {
  const sb = getSupabase();
  if (!sb) return null;
  let q = sb
    .from("arena_scores")
    .select("user_id, score")
    .gt("score", Math.round(args.score))
    .limit(1000);
  if (args.gameTitle) q = q.eq("game_title", args.gameTitle);
  const { data, error } = await q;
  if (error) {
    if (isTableMissingError(error)) return null;
    console.error("[arenaScores] rank failed:", error.message);
    return null;
  }
  const above = new Set<string>();
  for (const row of (data ?? []) as Array<{
    user_id: string;
    score: number;
  }>) {
    if (args.excludeUserId && row.user_id === args.excludeUserId) continue;
    above.add(row.user_id);
  }
  return above.size + 1;
}

/** Arena titles that have at least one score, most recently played first. */
export async function fetchArenaTitles(): Promise<{
  titles: string[];
  tableMissing: boolean;
}> {
  const sb = getSupabase();
  if (!sb) return { titles: [], tableMissing: false };
  const { data, error } = await sb
    .from("arena_scores")
    .select("game_title, played_at")
    .order("played_at", { ascending: false })
    .limit(200);
  if (error) {
    if (isTableMissingError(error)) return { titles: [], tableMissing: true };
    console.error("[arenaScores] titles failed:", error.message);
    return { titles: [], tableMissing: false };
  }
  const seen = new Set<string>();
  const titles: string[] = [];
  for (const row of (data ?? []) as Array<{ game_title: string }>) {
    const t = (row.game_title || "").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    titles.push(t);
  }
  return { titles, tableMissing: false };
}

/* ---- Device-local results (signed-out play, local guest players) ---- */

function readLocal(): LocalArenaResult[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as LocalArenaResult[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Save a result on this device only — never on the shared board. */
export function recordLocalResult(entry: {
  gameTitle: string;
  label: string;
  score: number;
  accuracy: number;
}): void {
  try {
    if (typeof window === "undefined") return;
    const next = [
      {
        gameTitle: entry.gameTitle.slice(0, 200),
        label: entry.label.slice(0, 50),
        score: Math.max(0, Math.round(entry.score)),
        accuracy: Math.min(1, Math.max(0, entry.accuracy)),
        playedAt: new Date().toISOString(),
      },
      ...readLocal(),
    ].slice(0, LOCAL_MAX);
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable — the local result just won't persist.
  }
}

/** Device-local results, newest first (optionally only for one arena). */
export function getLocalBests(gameTitle?: string | null): LocalArenaResult[] {
  const all = readLocal();
  if (!gameTitle) return all;
  return all.filter((r) => r.gameTitle === gameTitle);
}

/** Best device-local score for one arena (signed-out player's own best). */
export function getLocalBestForArena(
  gameTitle: string
): LocalArenaResult | null {
  const rows = getLocalBests(gameTitle).filter((r) => r.label === "You");
  if (rows.length === 0) return null;
  return rows.reduce((best, r) => (r.score > best.score ? r : best), rows[0]);
}
