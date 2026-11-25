"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  Globe,
  Heart,
  Loader2,
  Play,
  Swords,
  UserPlus,
} from "lucide-react";
import {
  addFavorite,
  isSupabaseConfigured,
  listFriendships,
  listMyFavoriteIds,
  listPublicGuides,
  removeFavorite,
  sendFriendRequest,
  type AppUser,
  type StudyGuideRow,
} from "@/lib/supabase";
import { recordOpenedAuthor } from "@/lib/friends";
import type { GameData } from "./BattleArena";
import type { GenerateResult } from "@/app/page";
import EmptyState from "./EmptyState";

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
  onOpenGuideDetail,
  onOpenGame,
  onGenerate,
}: {
  user: AppUser | null;
  /** The optional guideId keys this copy for per-user error tracking. */
  onOpenGuide: (result: GenerateResult, guideId?: string | null) => void;
  /** Open a published guide on its own dedicated page (/guide/[id]). */
  onOpenGuideDetail?: (id: string) => void;
  onOpenGame: (game: GameData, topic: string) => void;
  /** Sends the user to Generate (empty-state button). */
  onGenerate?: () => void;
}) {
  const [items, setItems] = useState<StudyGuideRow[]>([]);
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** Author id -> relationship, so each card can offer one-tap Add. */
  const [friendStatus, setFriendStatus] = useState<
    Record<string, "friend" | "pending">
  >({});
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    const [pub, favIds, friendships] = await Promise.all([
      listPublicGuides(),
      user ? listMyFavoriteIds(user.id) : Promise.resolve(new Set<string>()),
      user ? listFriendships(user.id) : Promise.resolve([]),
    ]);
    setItems(pub);
    setFavorites(favIds);
    if (user) {
      const byId: Record<string, "friend" | "pending"> = {};
      for (const r of friendships) {
        const other =
          r.requester_id === user.id ? r.addressee_id : r.requester_id;
        byId[other] = r.status === "accepted" ? "friend" : "pending";
      }
      setFriendStatus(byId);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function openItem(row: StudyGuideRow) {
    // Remember the author (id only) so Friends can suggest people
    // whose published guides you actually opened.
    recordOpenedAuthor(row.user_id);
    if (row.kind === "game" && row.game) {
      onOpenGame(row.game as unknown as GameData, row.topic);
      return;
    }
    // Published guides open on their own dedicated page.
    if (onOpenGuideDetail) {
      onOpenGuideDetail(row.id);
      return;
    }
    onOpenGuide(row.guide as unknown as GenerateResult, row.id);
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
        <div className="mt-4">
          <EmptyState
            icon={<Globe className="h-6 w-6" />}
            headline="Nothing published yet"
            outcome="Guides and games people choose to publish will appear here. Generate a guide or a game, save it to your account, and publish it to be the first one here."
            buttonLabel="Generate a study guide"
            onAction={() => onGenerate?.()}
          />
        </div>
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
              {user &&
                row.user_id !== user.id &&
                friendStatus[row.user_id] !== "friend" &&
                (friendStatus[row.user_id] === "pending" ||
                sentIds.has(row.user_id) ? (
                  <span className="self-center text-xs font-semibold text-ink-400">
                    Friend request sent
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await sendFriendRequest(
                        user.id,
                        row.user_id
                      );
                      if (res.ok) {
                        setSentIds((prev) => new Set(prev).add(row.user_id));
                        setNotice(
                          `Friend request sent to ${row.author_name}.`
                        );
                      } else {
                        setNotice(
                          res.message ?? "Could not send the request."
                        );
                      }
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-ink-200 bg-white px-3 py-1.5 text-sm font-semibold text-ink-700 shadow-sm transition hover:border-brand-300 hover:text-brand-700"
                  >
                    <UserPlus className="h-4 w-4" /> Add friend
                  </button>
                ))}
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
