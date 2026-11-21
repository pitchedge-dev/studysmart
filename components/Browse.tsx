"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  Globe,
  Heart,
  Loader2,
  Play,
  Swords,
} from "lucide-react";
import {
  addFavorite,
  isSupabaseConfigured,
  listMyFavoriteIds,
  listPublicGuides,
  removeFavorite,
  type AppUser,
  type StudyGuideRow,
} from "@/lib/supabase";
import type { GameData } from "./BattleArena";
import type { GenerateResult } from "@/app/page";

function formatDate(value: string): string {
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

function titleOf(row: StudyGuideRow): string {
  const guide = row.guide as Record<string, unknown> | null;
  const title =
    (guide?.guideTitle as string | undefined) ||
    (guide?.title as string | undefined);
  return title || row.topic || (row.kind === "game" ? "Battle Arena game" : "Study guide");
}

export default function Browse({
  user,
  onOpenGuide,
  onOpenGame,
}: {
  user: AppUser | null;
  onOpenGuide: (result: GenerateResult) => void;
  onOpenGame: (game: GameData, topic: string) => void;
}) {
  const [items, setItems] = useState<StudyGuideRow[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    const [pub, favIds] = await Promise.all([
      listPublicGuides(),
      user ? listMyFavoriteIds(user.id) : Promise.resolve(new Set<string>()),
    ]);
    setItems(pub);
    setFavorites(favIds);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function openItem(row: StudyGuideRow) {
    if (row.kind === "game" && row.game) {
      onOpenGame(row.game as unknown as GameData, row.topic);
      return;
    }
    onOpenGuide(row.guide as unknown as GenerateResult);
  }

  async function toggleFavorite(row: StudyGuideRow) {
    if (!user) {
      setNotice("Sign in to favorite — it saves to your account.");
      return;
    }
    if (favorites.has(row.id)) {
      await removeFavorite(user.id, row.id);
      setFavorites((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    } else {
      await addFavorite(user.id, row.id);
      setFavorites((prev) => new Set(prev).add(row.id));
      setNotice("Added to your favorites — find it under Your Study Guides.");
    }
  }

  if (!isSupabaseConfigured()) {
    return (
      <div className="card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <Globe className="h-5 w-5 text-brand-600" /> Browse
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Browse is not set up yet — the StudySMART Supabase project still
          needs to be connected. Once it is, guides and games people publish
          will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
        <Globe className="h-5 w-5 text-brand-600" /> Browse
      </h2>
      <p className="mt-1 text-sm text-ink-400">
        Study guides and Battle Arena games people chose to publish. Anyone can
        view them — nothing appears here unless its author published it.
      </p>
      {notice && <p className="feedback-neutral mt-3">{notice}</p>}
      {loading && (
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      )}
      {!loading && items.length === 0 && (
        <p className="mt-4 text-sm leading-relaxed text-ink-500">
          Nothing published yet. Generate a guide or a game, save it to your
          account, and publish it to be the first one here.
        </p>
      )}
      <div className="mt-4 space-y-3">
        {items.map((row) => (
          <article
            key={row.id}
            className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm"
          >
            <p className="flex items-center gap-2 font-bold text-ink-900">
              {row.kind === "game" ? (
                <Swords className="h-4 w-4 shrink-0 text-brand-600" />
              ) : (
                <BookOpen className="h-4 w-4 shrink-0 text-brand-600" />
              )}
              <span className="truncate">{titleOf(row)}</span>
            </p>
            <p className="mt-1 text-xs font-medium text-ink-400">
              by {row.author_name} ·{" "}
              {row.kind === "game" ? "Battle Arena game" : "Study guide"}
              {row.education_level ? ` · ${row.education_level}` : ""}
              {row.published_at ? ` · ${formatDate(row.published_at)}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openItem(row)}
                className="btn-primary px-3 py-1.5 text-sm"
              >
                <Play className="h-4 w-4" />
                {row.kind === "game" ? "Play" : "View guide"}
              </button>
              <button
                type="button"
                onClick={() => toggleFavorite(row)}
                aria-label={favorites.has(row.id) ? "Unfavorite" : "Favorite"}
                className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-semibold shadow-sm transition ${
                  favorites.has(row.id)
                    ? "bg-rose-500 text-white"
                    : "border border-ink-200 bg-white text-ink-700 hover:border-rose-300 hover:text-rose-600"
                }`}
              >
                <Heart
                  className="h-4 w-4"
                  fill={favorites.has(row.id) ? "currentColor" : "none"}
                />
                {favorites.has(row.id) ? "Favorited" : "Favorite"}
              </button>
              {!user && (
                <span className="self-center text-xs font-medium text-ink-400">
                  Sign in to favorite
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
