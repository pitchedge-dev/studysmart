"use client";

import { useEffect, useState } from "react";
import {
  Check,
  Loader2,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  getProfileByUsername,
  getProfilesByIds,
  listFriendships,
  listMyFavorites,
  listSharedWithMe,
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  type AppUser,
  type FriendshipRow,
  type Profile,
} from "@/lib/supabase";
import {
  initialsFor,
  loadOpenedAuthorIds,
  searchProfilesByUsername,
} from "@/lib/friends";

export type FriendEntry = {
  friendshipId: string;
  profile: Profile | null;
};

export default function Friends({
  user,
  onFriendsChanged,
}: {
  user: AppUser;
  onFriendsChanged: (friends: FriendEntry[]) => void;
}) {
  const [rows, setRows] = useState<FriendshipRow[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  /** Live partial-search matches (up to 8) — not just one exact hit. */
  const [results, setResults] = useState<Profile[]>([]);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /** People you may know: { profile, reason } — never built from emails. */
  const [suggestions, setSuggestions] = useState<
    { profile: Profile; reason: string }[]
  >([]);
  /** User ids a request was just sent to (shows "Request sent"). */
  const [sentIds, setSentIds] = useState<Set<string>>(new Set());

  async function refresh() {
    setLoading(true);
    const list = await listFriendships(user.id);
    setRows(list);
    const ids = list.flatMap((r) => [r.requester_id, r.addressee_id]);
    const found = await getProfilesByIds([...new Set(ids)]);
    const byId: Record<string, Profile> = {};
    for (const p of found) byId[p.user_id] = p;
    setProfiles(byId);
    const accepted = list
      .filter((r) => r.status === "accepted")
      .map((r) => ({
        friendshipId: r.id,
        profile:
          byId[r.requester_id === user.id ? r.addressee_id : r.requester_id] ??
          null,
      }));
    onFriendsChanged(accepted);
    setLoading(false);
    void loadSuggestions(list);
  }

  /**
   * "People you may know" — built only from things you already did in
   * the app: authors of guides you favorited, people who shared a guide
   * with you, and authors of published guides you opened. Never email,
   * never strangers at random. People you already friended (or already
   * have a pending request with) are left out.
   */
  async function loadSuggestions(list: FriendshipRow[]) {
    const known = new Set<string>([user.id]);
    for (const r of list) {
      known.add(r.requester_id);
      known.add(r.addressee_id);
    }
    const [favs, withMe] = await Promise.all([
      listMyFavorites(user.id),
      listSharedWithMe(user.id),
    ]);
    const reasonById = new Map<string, string>();
    for (const s of withMe) {
      if (!known.has(s.sender_id))
        reasonById.set(s.sender_id, "Shared a guide with you");
    }
    for (const f of favs) {
      if (!known.has(f.user_id) && !reasonById.has(f.user_id))
        reasonById.set(f.user_id, "You favorited their guide");
    }
    for (const id of loadOpenedAuthorIds()) {
      if (!known.has(id) && !reasonById.has(id))
        reasonById.set(id, "You opened their guide");
    }
    const ids = [...reasonById.keys()].slice(0, 6);
    if (ids.length === 0) {
      setSuggestions([]);
      return;
    }
    const found = await getProfilesByIds(ids);
    setSuggestions(
      found.map((p) => ({
        profile: p,
        reason: reasonById.get(p.user_id) ?? "",
      }))
    );
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  const incoming = rows.filter(
    (r) => r.status === "pending" && r.addressee_id === user.id
  );
  const outgoing = rows.filter(
    (r) => r.status === "pending" && r.requester_id === user.id
  );
  const accepted = rows.filter((r) => r.status === "accepted");

  function otherProfile(row: FriendshipRow): Profile | null {
    const otherId =
      row.requester_id === user.id ? row.addressee_id : row.requester_id;
    return profiles[otherId] ?? null;
  }

  /** One-tap add from any result/suggestion row. Requests still need
   *  the other person to accept — this only makes finding them easy. */
  async function addFriend(profile: Profile) {
    const res = await sendFriendRequest(user.id, profile.user_id);
    if (res.ok) {
      setNotice(`Friend request sent to @${profile.username}.`);
      setSentIds((prev) => new Set(prev).add(profile.user_id));
      setResults((prev) => prev.filter((p) => p.user_id !== profile.user_id));
      setSuggestions((prev) =>
        prev.filter((s) => s.profile.user_id !== profile.user_id)
      );
      refresh();
    } else {
      setNotice(res.message ?? "Could not send the request.");
    }
  }

  /** Live partial search: type a few letters, get matching usernames. */
  async function runSearch(query: string) {
    const name = query.trim().toLowerCase();
    if (name.length < 2) {
      setResults([]);
      setSearchMessage(
        name.length === 1 ? "Type at least 2 letters to search." : null
      );
      return;
    }
    setSearching(true);
    const found = await searchProfilesByUsername(name);
    setSearching(false);
    setResults(found);
    setSearchMessage(
      found.length === 0 ? `No usernames matching "${name}".` : null
    );
  }

  // Debounced live search while typing (exact lookup kept as a
  // fallback for the rare case the partial list misses someone).
  useEffect(() => {
    const t = setTimeout(() => void runSearch(search), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function statusOf(profile: Profile): "self" | "friend" | "pending" | "add" {
    if (profile.user_id === user.id) return "self";
    const row = rows.find(
      (r) =>
        (r.requester_id === profile.user_id &&
          r.addressee_id === user.id) ||
        (r.addressee_id === profile.user_id && r.requester_id === user.id)
    );
    if (!row) return "add";
    return row.status === "accepted" ? "friend" : "pending";
  }

  async function doSearch() {
    const name = search.trim().toLowerCase();
    if (!name) return;
    setSearching(true);
    setSearchMessage(null);
    setResults([]);
    const found = await getProfileByUsername(name);
    setSearching(false);
    if (!found) {
      setSearchMessage(`No account found for @${name}.`);
      return;
    }
    if (found.user_id === user.id) {
      setSearchMessage("That is your own account.");
      return;
    }
    setResults([found]);
  }

  return (
    <div className="card p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
        <Users className="h-5 w-5 text-brand-600" /> Friends
      </h2>
      <p className="mt-1 text-sm text-ink-400">
        Find friends by username — emails are never shown. Only accepted
        friends can receive guides from you.
      </p>
      {notice && <p className="feedback-neutral mt-3">{notice}</p>}

      <div className="mt-4 flex flex-wrap gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") doSearch();
            }}
            placeholder="Search by username…"
            className="input pl-9"
          />
        </div>
        <button
          type="button"
          onClick={doSearch}
          disabled={searching || !search.trim()}
          className="btn-primary px-4"
        >
          {searching && <Loader2 className="h-4 w-4 animate-spin" />}
          Search
        </button>
      </div>
      {searching && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </p>
      )}
      {searchMessage && (
        <p className="feedback-neutral mt-3">{searchMessage}</p>
      )}
      {results.length > 0 && (
        <div className="mt-3 space-y-2">
          {results.map((profile) => {
            const status = statusOf(profile);
            const sent = sentIds.has(profile.user_id);
            return (
              <div
                key={profile.user_id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3 shadow-sm"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-extrabold text-brand-700"
                >
                  {initialsFor(profile.display_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink-900">
                    {profile.display_name}
                  </p>
                  <p className="text-xs font-medium text-ink-400">
                    @{profile.username}
                  </p>
                </div>
                {status === "self" ? (
                  <span className="text-xs font-semibold text-ink-400">
                    That&apos;s you
                  </span>
                ) : status === "friend" ? (
                  <span className="text-xs font-semibold text-emerald-600">
                    Already friends
                  </span>
                ) : status === "pending" || sent ? (
                  <span className="text-xs font-semibold text-ink-400">
                    Request sent
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void addFriend(profile)}
                    className="btn-primary px-3 py-2 text-sm"
                  >
                    <UserPlus className="h-4 w-4" /> Add friend
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-bold tracking-tight">
            People you may know
          </h3>
          <p className="mt-0.5 text-xs text-ink-400">
            From guides you favorited, guides shared with you, and guides you
            opened — never from email.
          </p>
          <div className="mt-2 space-y-2">
            {suggestions.map(({ profile, reason }) => (
              <div
                key={profile.user_id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3 shadow-sm"
              >
                <span
                  aria-hidden
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-extrabold text-brand-700"
                >
                  {initialsFor(profile.display_name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold text-ink-900">
                    {profile.display_name}{" "}
                    <span className="font-medium text-ink-400">
                      (@{profile.username})
                    </span>
                  </p>
                  <p className="text-xs font-medium text-ink-400">{reason}</p>
                </div>
                {sentIds.has(profile.user_id) ? (
                  <span className="text-xs font-semibold text-ink-400">
                    Request sent
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void addFriend(profile)}
                    className="btn-primary px-3 py-2 text-sm"
                  >
                    <UserPlus className="h-4 w-4" /> Add friend
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {incoming.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-bold tracking-tight">
            Friend requests for you
          </h3>
          <div className="mt-2 space-y-2">
            {incoming.map((row) => {
              const p = otherProfile(row);
              return (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3 shadow-sm"
                >
                  <p className="min-w-0 flex-1 text-sm font-semibold text-ink-900">
                    {p?.display_name ?? "Someone"}
                    {p?.username ? ` (@${p.username})` : ""} wants to be
                    friends.
                  </p>
                  <button
                    type="button"
                    onClick={async () => {
                      await respondToFriendRequest(row.id, true);
                      setNotice("Friend request accepted.");
                      refresh();
                    }}
                    className="btn-primary px-3 py-2 text-sm"
                  >
                    <Check className="h-4 w-4" /> Accept
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      await respondToFriendRequest(row.id, false);
                      refresh();
                    }}
                    className="btn-ghost"
                  >
                    <X className="h-4 w-4" /> Decline
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {outgoing.length > 0 && (
        <div className="mt-5">
          <h3 className="text-sm font-bold tracking-tight">
            Requests you sent
          </h3>
          <div className="mt-2 space-y-2">
            {outgoing.map((row) => {
              const p = otherProfile(row);
              return (
                <p key={row.id} className="text-sm text-ink-600">
                  Waiting for {p?.display_name ?? "someone"}
                  {p?.username ? ` (@${p.username})` : ""} to accept.
                </p>
              );
            })}
          </div>
        </div>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-bold tracking-tight">
          Your friends ({accepted.length})
        </h3>
        {loading && (
          <p className="mt-2 flex items-center gap-2 text-sm text-ink-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        )}
        {!loading && accepted.length === 0 && (
          <div className="mt-2 rounded-2xl border border-dashed border-brand-300 bg-white/70 p-5 text-center">
            <p className="text-sm font-bold text-ink-900">
              No friends yet — your study crew will live here
            </p>
            <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
              Search for a username above to add a friend. Once you are
              friends, you can send each other study guides.
            </p>
          </div>
        )}
        <div className="mt-2 space-y-2">
          {accepted.map((row) => {
            const p = otherProfile(row);
            return (
              <div
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3 shadow-sm"
              >
                <p className="min-w-0 flex-1 text-sm font-semibold text-ink-900">
                  {p?.display_name ?? "Friend"}
                  {p?.username ? (
                    <span className="text-ink-400"> (@{p.username})</span>
                  ) : (
                    ""
                  )}
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    await removeFriend(row.id);
                    setNotice("Friend removed.");
                    refresh();
                  }}
                  className="btn-ghost text-rose-600 hover:bg-rose-50"
                >
                  <X className="h-4 w-4" /> Remove
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
