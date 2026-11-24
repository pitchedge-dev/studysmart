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
  removeFriend,
  respondToFriendRequest,
  sendFriendRequest,
  type AppUser,
  type FriendshipRow,
  type Profile,
} from "@/lib/supabase";

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
  const [searchResult, setSearchResult] = useState<Profile | null>(null);
  const [searchMessage, setSearchMessage] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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

  async function doSearch() {
    const name = search.trim().toLowerCase();
    if (!name) return;
    setSearching(true);
    setSearchMessage(null);
    setSearchResult(null);
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
    setSearchResult(found);
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
      {searchMessage && (
        <p className="feedback-neutral mt-3">{searchMessage}</p>
      )}
      {searchResult && (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-4 shadow-sm">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-ink-900">
              {searchResult.display_name}
            </p>
            <p className="text-xs font-medium text-ink-400">
              @{searchResult.username}
            </p>
          </div>
          <button
            type="button"
            onClick={async () => {
              const res = await sendFriendRequest(user.id, searchResult.user_id);
              setNotice(
                res.ok
                  ? `Friend request sent to @${searchResult.username}.`
                  : res.message ?? "Could not send the request."
              );
              if (res.ok) {
                setSearchResult(null);
                setSearch("");
                refresh();
              }
            }}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            <UserPlus className="h-4 w-4" /> Add friend
          </button>
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
                    className="btn-primary px-3 py-1.5 text-sm"
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
