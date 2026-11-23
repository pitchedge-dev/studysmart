import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

/**
 * Supabase client for StudySMART accounts, saved guides, Browse, favorites,
 * friends, and sharing. Free tier only.
 *
 * If NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set
 * (Supabase project not created yet), getSupabase() returns null and every
 * helper below degrades gracefully — the app still builds and runs, sign-in
 * shows "accounts are not set up yet", and generation still works.
 * Never put a real key in the repo; .env.example only has empty placeholders.
 */

let client: SupabaseClient | null | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export function getSupabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  if (!isSupabaseConfigured()) {
    client = null;
    return null;
  }
  client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string
  );
  return client;
}

export type AppUser = User;

export type Profile = {
  user_id: string;
  username: string;
  display_name: string;
  created_at?: string;
};

export type StudyGuideRow = {
  id: string;
  user_id: string;
  topic: string;
  education_level?: string | null;
  test_timing?: string | null;
  guide: Record<string, unknown>;
  quiz?: unknown;
  kind: "guide" | "game";
  game?: Record<string, unknown> | null;
  is_public: boolean;
  published_at?: string | null;
  author_name: string;
  created_at: string;
};

export type FavoriteRow = {
  id: string;
  user_id: string;
  guide_id: string;
  created_at: string;
};

export type FriendshipRow = {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: "pending" | "accepted";
  created_at: string;
};

export type SharedGuideRow = {
  id: string;
  sender_id: string;
  recipient_id: string;
  guide_id?: string | null;
  guide_snapshot: Record<string, unknown>;
  created_at: string;
};

export type PublicItem = StudyGuideRow & { is_favorite?: boolean };

function displayNameOf(user: AppUser, profile?: Profile | null): string {
  const metaName =
    (user.user_metadata?.display_name as string | undefined) ||
    (user.user_metadata?.username as string | undefined);
  return (profile?.display_name || metaName || profile?.username || "Anonymous").trim() || "Anonymous";
}

export async function getMyProfile(userId: string): Promise<Profile | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("profiles")
    .select("user_id, username, display_name, created_at")
    .eq("user_id", userId)
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

export async function getProfileByUsername(
  username: string
): Promise<Profile | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb
    .from("profiles")
    .select("user_id, username, display_name, created_at")
    .eq("username", username.trim().toLowerCase())
    .maybeSingle();
  return (data as Profile | null) ?? null;
}

/** Save a generated guide (or game) to the signed-in user's account. */
export async function saveGuideToAccount(args: {
  user: AppUser;
  profile: Profile | null;
  topic: string;
  educationLevel: string;
  testTiming: string;
  guide: Record<string, unknown>;
  quiz?: unknown;
  kind?: "guide" | "game";
  game?: Record<string, unknown> | null;
}): Promise<StudyGuideRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("study_guides")
    .insert({
      user_id: args.user.id,
      topic: args.topic.slice(0, 500),
      education_level: args.educationLevel || null,
      test_timing: args.testTiming || null,
      guide: args.guide,
      quiz: args.quiz ?? null,
      kind: args.kind ?? "guide",
      game: args.game ?? null,
      author_name: displayNameOf(args.user, args.profile),
    })
    .select()
    .single();
  if (error) {
    console.error("[supabase] save guide failed:", error.message);
    return null;
  }
  return data as StudyGuideRow;
}

/** Fetch one saved guide by id — used by the dedicated guide page
 *  (/guide/[id]). Row-level security decides who may read it: public
 *  guides are readable by anyone, private ones only by their owner. */
export async function getGuideById(id: string): Promise<StudyGuideRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb
    .from("study_guides")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[supabase] get guide failed:", error.message);
    return null;
  }
  return (data as StudyGuideRow | null) ?? null;
}

export async function listMyGuides(userId: string): Promise<StudyGuideRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("study_guides")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[supabase] list guides failed:", error.message);
    return [];
  }
  return (data as StudyGuideRow[]) ?? [];
}

export async function deleteGuide(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("study_guides").delete().eq("id", id);
  if (error) console.error("[supabase] delete guide failed:", error.message);
  return !error;
}

export async function setGuidePublic(
  id: string,
  isPublic: boolean
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("study_guides")
    .update({
      is_public: isPublic,
      published_at: isPublic ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) console.error("[supabase] publish failed:", error.message);
  return !error;
}

export async function listPublicGuides(): Promise<StudyGuideRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("study_guides")
    .select("*")
    .eq("is_public", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[supabase] list public failed:", error.message);
    return [];
  }
  return (data as StudyGuideRow[]) ?? [];
}

export async function listMyFavorites(userId: string): Promise<StudyGuideRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("favorites")
    .select("guide_id, study_guides(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[supabase] list favorites failed:", error.message);
    return [];
  }
  return ((data ?? []) as unknown as Array<{ study_guides: StudyGuideRow | null }>)
    .map((row) => row.study_guides)
    .filter((g): g is StudyGuideRow => Boolean(g));
}

export async function listMyFavoriteIds(userId: string): Promise<Set<string>> {
  const sb = getSupabase();
  if (!sb) return new Set();
  const { data } = await sb
    .from("favorites")
    .select("guide_id")
    .eq("user_id", userId);
  return new Set(((data ?? []) as Array<{ guide_id: string }>).map((r) => r.guide_id));
}

export async function addFavorite(userId: string, guideId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("favorites")
    .insert({ user_id: userId, guide_id: guideId });
  if (error) console.error("[supabase] favorite failed:", error.message);
  return !error;
}

export async function removeFavorite(userId: string, guideId: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("favorites")
    .delete()
    .eq("user_id", userId)
    .eq("guide_id", guideId);
  if (error) console.error("[supabase] unfavorite failed:", error.message);
  return !error;
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------

export async function listFriendships(userId: string): Promise<FriendshipRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[supabase] list friendships failed:", error.message);
    return [];
  }
  return (data as FriendshipRow[]) ?? [];
}

export async function getProfilesByIds(ids: string[]): Promise<Profile[]> {
  const sb = getSupabase();
  if (!sb || ids.length === 0) return [];
  const { data } = await sb
    .from("profiles")
    .select("user_id, username, display_name, created_at")
    .in("user_id", ids);
  return (data as Profile[]) ?? [];
}

export async function sendFriendRequest(
  requesterId: string,
  addresseeId: string
): Promise<{ ok: boolean; message?: string }> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Accounts are not set up yet." };
  if (requesterId === addresseeId)
    return { ok: false, message: "You cannot friend yourself." };
  const { error } = await sb.from("friendships").insert({
    requester_id: requesterId,
    addressee_id: addresseeId,
    status: "pending",
  });
  if (error) {
    if (error.code === "23505")
      return { ok: false, message: "You are already friends or a request is pending." };
    console.error("[supabase] friend request failed:", error.message);
    return { ok: false, message: "Could not send the request. Try again." };
  }
  return { ok: true };
}

export async function respondToFriendRequest(
  id: string,
  accept: boolean
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  if (accept) {
    const { error } = await sb
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", id);
    if (error) console.error("[supabase] accept failed:", error.message);
    return !error;
  }
  const { error } = await sb.from("friendships").delete().eq("id", id);
  if (error) console.error("[supabase] decline failed:", error.message);
  return !error;
}

export async function removeFriend(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("friendships").delete().eq("id", id);
  if (error) console.error("[supabase] remove friend failed:", error.message);
  return !error;
}

// ---------------------------------------------------------------------------
// Sharing guides with friends (private, one friend at a time — never public)
// ---------------------------------------------------------------------------

export async function sendGuideToFriend(args: {
  senderId: string;
  recipientId: string;
  guideId: string | null;
  snapshot: Record<string, unknown>;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("shared_guides").insert({
    sender_id: args.senderId,
    recipient_id: args.recipientId,
    guide_id: args.guideId,
    guide_snapshot: args.snapshot,
  });
  if (error) console.error("[supabase] send guide failed:", error.message);
  return !error;
}

export async function listSharedWithMe(userId: string): Promise<SharedGuideRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("shared_guides")
    .select("*")
    .eq("recipient_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[supabase] list shared failed:", error.message);
    return [];
  }
  return (data as SharedGuideRow[]) ?? [];
}

export async function listSentByMe(userId: string): Promise<SharedGuideRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("shared_guides")
    .select("*")
    .eq("sender_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[supabase] list sent failed:", error.message);
    return [];
  }
  return (data as SharedGuideRow[]) ?? [];
}

export async function deleteSharedGuide(id: string): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb.from("shared_guides").delete().eq("id", id);
  if (error) console.error("[supabase] delete shared failed:", error.message);
  return !error;
}

// ---------------------------------------------------------------------------
// Per-user error tracking (guide_errors).
//
// Errors belong ONLY to the user who made them, on ONE copy of a guide.
// guide_key identifies that copy: "guide:<study_guides row id>" for a saved,
// published, or shared guide, or "local:<content hash>" for an unsaved
// in-session guide. RLS only ever returns the signed-in user's own rows,
// and error rows are never stored inside the guide JSON that gets
// published or shared — so another user opening the same published guide
// starts with a clean slate and never sees your errors.
// ---------------------------------------------------------------------------

export type GuideErrorRow = {
  id?: string;
  user_id: string;
  guide_key: string;
  concept_title: string;
  module_title: string;
  misses: number;
  correct_streak: number;
  total_attempts: number;
  last_question?: string | null;
  last_picked?: string | null;
  last_correct?: string | null;
  last_explanation?: string | null;
  updated_at?: string;
};

export async function listGuideErrors(
  userId: string,
  guideKey: string
): Promise<GuideErrorRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("guide_errors")
    .select("*")
    .eq("user_id", userId)
    .eq("guide_key", guideKey)
    .order("misses", { ascending: false });
  if (error) {
    console.error("[supabase] list guide errors failed:", error.message);
    return [];
  }
  return (data as GuideErrorRow[]) ?? [];
}

export async function upsertGuideErrors(
  userId: string,
  guideKey: string,
  records: GuideErrorRow[]
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  if (records.length === 0) return true;
  const { error } = await sb.from("guide_errors").upsert(
    records.map((r) => ({
      user_id: userId,
      guide_key: guideKey,
      concept_title: r.concept_title,
      module_title: r.module_title,
      misses: r.misses,
      correct_streak: r.correct_streak,
      total_attempts: r.total_attempts,
      last_question: r.last_question ?? null,
      last_picked: r.last_picked ?? null,
      last_correct: r.last_correct ?? null,
      last_explanation: r.last_explanation ?? null,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,guide_key,concept_title" }
  );
  if (error) {
    console.error("[supabase] save guide errors failed:", error.message);
    return false;
  }
  return true;
}

export async function deleteGuideErrors(
  userId: string,
  guideKey: string
): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const { error } = await sb
    .from("guide_errors")
    .delete()
    .eq("user_id", userId)
    .eq("guide_key", guideKey);
  if (error) {
    console.error("[supabase] delete guide errors failed:", error.message);
    return false;
  }
  return true;
}
