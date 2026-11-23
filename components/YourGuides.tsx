"use client";

import { useEffect, useState } from "react";
import {
  BookOpen,
  Eye,
  EyeOff,
  Globe,
  Heart,
  Loader2,
  Send,
  Swords,
  Trash2,
  Users,
} from "lucide-react";
import {
  deleteGuide,
  deleteSharedGuide,
  getProfilesByIds,
  listMyFavorites,
  listMyGuides,
  listSentByMe,
  listSharedWithMe,
  removeFavorite,
  sendGuideToFriend,
  setGuidePublic,
  type AppUser,
  type FavoriteRow,
  type Profile,
  type SharedGuideRow,
  type StudyGuideRow,
} from "@/lib/supabase";
import type { GameData } from "./BattleArena";
import type { FriendEntry } from "./Friends";
import type { GenerateResult } from "@/app/page";

type Friend = FriendEntry;

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

export default function YourGuides({
  user,
  profile,
  friends,
  onOpenGuide,
  onOpenGuideDetail,
  onOpenGame,
}: {
  user: AppUser | null;
  profile: Profile | null;
  friends: Friend[];
  /** The optional guideId keys this copy for per-user error tracking. */
  onOpenGuide: (result: GenerateResult, guideId?: string | null) => void;
  /** Open a saved guide on its own dedicated page (/guide/[id]). */
  onOpenGuideDetail?: (id: string) => void;
  onOpenGame: (game: GameData, topic: string) => void;
}) {
  const [guides, setGuides] = useState<StudyGuideRow[]>([]);
  const [favorites, setFavorites] = useState<StudyGuideRow[]>([]);
  const [shared, setShared] = useState<SharedGuideRow[]>([]);
  const [sent, setSent] = useState<SharedGuideRow[]>([]);
  const [senderProfiles, setSenderProfiles] = useState<Record<string, Profile>>({});
  const [recipientProfiles, setRecipientProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmPublish, setConfirmPublish] = useState<string | null>(null);
  const [sendFor, setSendFor] = useState<StudyGuideRow | null>(null);
  const [sendTo, setSendTo] = useState("");
  const [sending, setSending] = useState(false);

  async function refresh() {
    if (!user) {
      setGuides([]);
      setFavorites([]);
      setShared([]);
      setSent([]);
      return;
    }
    setLoading(true);
    const [mine, favs, withMe, byMe] = await Promise.all([
      listMyGuides(user.id),
      listMyFavorites(user.id),
      listSharedWithMe(user.id),
      listSentByMe(user.id),
    ]);
    setGuides(mine);
    setFavorites(favs);
    setShared(withMe);
    setSent(byMe);
    const ids = [
      ...withMe.map((s) => s.sender_id),
      ...byMe.map((s) => s.recipient_id),
    ];
    const profiles = await getProfilesByIds([...new Set(ids)]);
    const byId: Record<string, Profile> = {};
    for (const p of profiles) byId[p.user_id] = p;
    setSenderProfiles(byId);
    setRecipientProfiles(byId);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  if (!user) {
    return (
      <div className="card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <BookOpen className="h-5 w-5 text-brand-600" /> Your Study Guides
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Sign in to save your guides — every guide you generate is
          automatically saved to your account, and you can open it again any
          time.
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-500">
          Without an account, your guides only live in this session.
        </p>
      </div>
    );
  }

  function openGuide(row: StudyGuideRow) {
    if (row.kind === "game" && row.game) {
      onOpenGame(row.game as unknown as GameData, row.topic);
      return;
    }
    // Saved guides open on their own dedicated page.
    if (onOpenGuideDetail) {
      onOpenGuideDetail(row.id);
      return;
    }
    onOpenGuide(row.guide as unknown as GenerateResult, row.id);
  }

  function openShared(row: SharedGuideRow) {
    const snap = row.guide_snapshot as Record<string, unknown>;
    if (snap.kind === "game" && snap.game) {
      onOpenGame(snap.game as unknown as GameData, (snap.topic as string) || "Shared game");
      return;
    }
    // A shared guide that still exists as a saved guide opens on its own page.
    if (row.guide_id && onOpenGuideDetail) {
      onOpenGuideDetail(row.guide_id);
      return;
    }
    onOpenGuide((snap.guide ?? snap) as unknown as GenerateResult, row.guide_id ?? null);
  }

  async function saveSharedToMine(row: SharedGuideRow) {
    if (!user) return;
    const { saveGuideToAccount } = await import("@/lib/supabase");
    const snap = row.guide_snapshot as Record<string, unknown>;
    const saved = await saveGuideToAccount({
      user,
      profile,
      topic: (snap.topic as string) || "Shared guide",
      educationLevel: (snap.education_level as string) || "",
      testTiming: (snap.test_timing as string) || "",
      guide: (snap.guide ?? snap) as Record<string, unknown>,
      quiz: snap.quiz,
      kind: (snap.kind as "guide" | "game") || "guide",
      game: (snap.game as Record<string, unknown> | null) ?? null,
    });
    setNotice(
      saved
        ? "Saved to your study guides."
        : "Could not save that guide. Try again."
    );
    if (saved) refresh();
  }

  async function doSend() {
    if (!sendFor || !sendTo || !user) return;
    setSending(true);
    const ok = await sendGuideToFriend({
      senderId: user.id,
      recipientId: sendTo,
      guideId: sendFor.id,
      snapshot: {
        topic: sendFor.topic,
        education_level: sendFor.education_level,
        test_timing: sendFor.test_timing,
        guide: sendFor.guide,
        quiz: sendFor.quiz,
        kind: sendFor.kind,
        game: sendFor.game,
        author_name: sendFor.author_name,
      },
    });
    setSending(false);
    if (ok) {
      setNotice("Guide sent to your friend — only they can see it.");
      setSendFor(null);
      setSendTo("");
      refresh();
    } else {
      setNotice("Could not send that guide. Try again.");
    }
  }

  return (
    <div className="space-y-5">
      <div className="card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <BookOpen className="h-5 w-5 text-brand-600" /> Your Study Guides
        </h2>
        <p className="mt-1 text-sm text-ink-400">
          Signed in as {profile?.display_name ?? user.email}
          {profile?.username ? ` (@${profile.username})` : ""} — guides you
          generate are saved here automatically.
        </p>
        {notice && <p className="feedback-neutral mt-3">{notice}</p>}
        {loading && (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading your guides…
          </p>
        )}
        {!loading && guides.length === 0 && (
          <p className="mt-4 text-sm leading-relaxed text-ink-500">
            No saved guides yet. Generate a study guide or a Battle Arena game
            and it will appear here.
          </p>
        )}
        <div className="mt-4 space-y-3">
          {guides.map((row) => (
            <article
              key={row.id}
              className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-bold text-ink-900">
                    {row.kind === "game" ? (
                      <Swords className="h-4 w-4 shrink-0 text-brand-600" />
                    ) : (
                      <BookOpen className="h-4 w-4 shrink-0 text-brand-600" />
                    )}
                    <span className="truncate">{titleOf(row)}</span>
                  </p>
                  <p className="mt-1 text-xs font-medium text-ink-400">
                    {row.kind === "game" ? "Battle Arena game" : "Study guide"}
                    {row.education_level ? ` · ${row.education_level}` : ""}
                    {row.test_timing ? ` · Test: ${row.test_timing}` : ""}
                    {` · ${formatDate(row.created_at)}`}
                    {row.is_public && (
                      <span className="chip-amber ml-2">
                        <Globe className="h-3 w-3" /> Public
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => openGuide(row)}
                  className="btn-primary px-3 py-1.5 text-sm"
                >
                  <Eye className="h-4 w-4" /> Open
                </button>
                {confirmPublish === row.id ? (
                  <>
                    <span className="inline-flex items-center rounded-xl bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-200">
                      This will be public — anyone can view it. Don&apos;t
                      publish anything with personal information in it.
                    </span>
                    <button
                      type="button"
                      onClick={async () => {
                        await setGuidePublic(row.id, true);
                        setConfirmPublish(null);
                        setNotice("Published — it now appears in Browse.");
                        refresh();
                      }}
                      className="btn-primary px-3 py-1.5 text-sm"
                    >
                      <Globe className="h-4 w-4" /> Yes, publish it
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmPublish(null)}
                      className="btn-ghost"
                    >
                      Cancel
                    </button>
                  </>
                ) : row.is_public ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await setGuidePublic(row.id, false);
                      setNotice("Unpublished — it is private again.");
                      refresh();
                    }}
                    className="btn-secondary px-3 py-1.5 text-sm"
                  >
                    <EyeOff className="h-4 w-4" /> Unpublish
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmPublish(row.id)}
                    className="btn-secondary px-3 py-1.5 text-sm"
                  >
                    <Globe className="h-4 w-4" /> Publish
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setSendFor(row);
                    setSendTo("");
                  }}
                  className="btn-secondary px-3 py-1.5 text-sm"
                >
                  <Send className="h-4 w-4" /> Send to friend
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await deleteGuide(row.id);
                    refresh();
                  }}
                  className="btn-ghost text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete
                </button>
              </div>
              {sendFor?.id === row.id && (
                <div className="mt-3 rounded-xl bg-brand-50/70 p-3 ring-1 ring-inset ring-brand-100">
                  <p className="text-sm font-bold text-ink-900">
                    Send to a friend
                  </p>
                  {friends.length === 0 ? (
                    <p className="mt-1 text-sm text-ink-500">
                      You have no accepted friends yet — add friends below to
                      send them guides.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <select
                        value={sendTo}
                        onChange={(e) => setSendTo(e.target.value)}
                        className="input max-w-xs"
                      >
                        <option value="" disabled>
                          Choose a friend…
                        </option>
                        {friends.map((f) => (
                          <option key={f.friendshipId} value={f.profile?.user_id}>
                            {f.profile?.display_name ?? "Friend"} (@
                            {f.profile?.username ?? "?"})
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={doSend}
                        disabled={!sendTo || sending}
                        className="btn-primary px-3 py-1.5 text-sm"
                      >
                        {sending && (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        )}
                        <Send className="h-4 w-4" /> Send
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendFor(null)}
                        className="btn-ghost"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-ink-400">
                    Private — only that one friend receives it. It is not
                    published to Browse.
                  </p>
                </div>
              )}
            </article>
          ))}
        </div>
      </div>

      {/* Favorites — right below Your Study Guides */}
      <div className="card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <Heart className="h-5 w-5 text-rose-500" /> Favorites
        </h2>
        {favorites.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            No favorites yet. Heart a published guide or game in Browse and it
            will appear here.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {favorites.map((row) => (
              <article
                key={row.id}
                className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm"
              >
                <p className="font-bold text-ink-900">{titleOf(row)}</p>
                <p className="mt-1 text-xs font-medium text-ink-400">
                  by {row.author_name} ·{" "}
                  {row.kind === "game" ? "Battle Arena game" : "Study guide"}
                  {` · ${formatDate(row.created_at)}`}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => openGuide(row)}
                    className="btn-primary px-3 py-1.5 text-sm"
                  >
                    <Eye className="h-4 w-4" /> Open
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await removeFavorite(user.id, row.id);
                      refresh();
                    }}
                    className="btn-secondary px-3 py-1.5 text-sm"
                  >
                    <Heart className="h-4 w-4" /> Unfavorite
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Shared with you */}
      <div className="card p-5 sm:p-6">
        <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
          <Users className="h-5 w-5 text-brand-600" /> Shared with you
        </h2>
        {shared.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-ink-500">
            No guides shared with you yet. When a friend sends you a guide, it
            will appear here.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            {shared.map((row) => {
              const snap = row.guide_snapshot as Record<string, unknown>;
              const title =
                ((snap.guide as Record<string, unknown> | undefined)
                  ?.guideTitle as string | undefined) ||
                (snap.topic as string | undefined) ||
                "Shared guide";
              const sender = senderProfiles[row.sender_id];
              return (
                <article
                  key={row.id}
                  className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm"
                >
                  <p className="font-bold text-ink-900">{title}</p>
                  <p className="mt-1 text-xs font-medium text-ink-400">
                    from {sender?.display_name ?? "a friend"}
                    {sender?.username ? ` (@${sender.username})` : ""}
                    {` · ${formatDate(row.created_at)}`}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openShared(row)}
                      className="btn-primary px-3 py-1.5 text-sm"
                    >
                      <Eye className="h-4 w-4" /> Open
                    </button>
                    <button
                      type="button"
                      onClick={() => saveSharedToMine(row)}
                      className="btn-secondary px-3 py-1.5 text-sm"
                    >
                      <BookOpen className="h-4 w-4" /> Save to my guides
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteSharedGuide(row.id);
                        refresh();
                      }}
                      className="btn-ghost text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-4 w-4" /> Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Sent by you */}
      {sent.length > 0 && (
        <div className="card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <Send className="h-5 w-5 text-brand-600" /> Sent by you
          </h2>
          <div className="mt-3 space-y-2">
            {sent.map((row) => {
              const snap = row.guide_snapshot as Record<string, unknown>;
              const title =
                ((snap.guide as Record<string, unknown> | undefined)
                  ?.guideTitle as string | undefined) ||
                (snap.topic as string | undefined) ||
                "Shared guide";
              const recipient = recipientProfiles[row.recipient_id];
              return (
                <p key={row.id} className="text-sm text-ink-600">
                  <strong>{title}</strong> →{" "}
                  {recipient?.display_name ?? "a friend"}
                  {recipient?.username ? ` (@${recipient.username})` : ""}
                  {` · ${formatDate(row.created_at)}`}
                </p>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
