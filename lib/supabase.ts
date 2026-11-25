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
  /** Optional course label (migration 0006). Null = Uncategorized.
   *  Undefined when the column has not been applied live yet. */
  course?: string | null;
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
  /** Optional course label (migration 0006). Null = Uncategorized. */
  course?: string | null;
}): Promise<StudyGuideRow | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const insertRow: Record<string, unknown> = {
    user_id: args.user.id,
    topic: args.topic.slice(0, 500),
    education_level: args.educationLevel || null,
    test_timing: args.testTiming || null,
    guide: args.guide,
    quiz: args.quiz ?? null,
    kind: args.kind ?? "guide",
    game: args.game ?? null,
    author_name: displayNameOf(args.user, args.profile),
  };
  if (args.course) insertRow.course = args.course;
  const { data, error } = await sb
    .from("study_guides")
    .insert(insertRow)
    .select()
    .single();
  if (!error) return data as StudyGuideRow;
  // The course column comes from migration 0006, which may not be
  // applied live yet. If the insert failed because the column does not
  // exist, retry without it — the guide still gets saved.
  if (isMissingCourseColumn(error)) {
    delete insertRow.course;
    const retry = await sb
      .from("study_guides")
      .insert(insertRow)
      .select()
      .single();
    if (retry.error) {
      console.error("[supabase] save guide failed:", retry.error.message);
      return null;
    }
    return retry.data as StudyGuideRow;
  }
  console.error("[supabase] save guide failed:", error.message);
  return null;
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

/**
 * Update the saved content of a guide — used by Builder Bot after the
 * student asks for a change. Owner-only: the update matches BOTH the
 * guide id AND the signed-in user's id (and row-level security enforces
 * the same), so a bot can never edit another user's guide, and a
 * published guide can only be edited by its owner. The `quiz` column
 * is updated alongside the guide JSON when the edit touched it.
 */
export async function updateGuideContent(args: {
  id: string;
  userId: string;
  guide: Record<string, unknown>;
  quiz?: unknown;
}): Promise<boolean> {
  const sb = getSupabase();
  if (!sb) return false;
  const patch: Record<string, unknown> = { guide: args.guide };
  if (args.quiz !== undefined) patch.quiz = args.quiz;
  const { error } = await sb
    .from("study_guides")
    .update(patch)
    .eq("id", args.id)
    .eq("user_id", args.userId);
  if (error) {
    console.error("[supabase] update guide failed:", error.message);
    return false;
  }
  return true;
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

// ---------------------------------------------------------------------------
// Courses (study_guides.course, migration 0006).
//
// A course is a user-typed label on a guide — there is no courses table
// and no premade list. The helpers below return needsMigration: true
// when the write failed only because the course column has not been
// applied live yet, so the UI can say so plainly instead of failing
// silently. Guides are never deleted by any course operation.
// ---------------------------------------------------------------------------

export type CourseWriteResult = {
  ok: boolean;
  /** True when the write failed only because migration 0006 is not
   *  applied live yet. The guides themselves are untouched. */
  needsMigration?: boolean;
};

function isMissingCourseColumn(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "42703" || /column .*course/i.test(error.message ?? "")
  );
}

/** Move one guide into a course (null = Uncategorized). */
export async function setGuideCourse(
  id: string,
  course: string | null
): Promise<CourseWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const { error } = await sb
    .from("study_guides")
    .update({ course: course || null })
    .eq("id", id);
  if (!error) return { ok: true };
  if (isMissingCourseColumn(error)) return { ok: false, needsMigration: true };
  console.error("[supabase] set guide course failed:", error.message);
  return { ok: false };
}

/** Rename a course: every one of the user's guides in the old course
 *  moves to the new name. Guides are never deleted. */
export async function renameCourseGuides(
  userId: string,
  oldName: string,
  newName: string
): Promise<CourseWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const { error } = await sb
    .from("study_guides")
    .update({ course: newName })
    .eq("user_id", userId)
    .eq("course", oldName);
  if (!error) return { ok: true };
  if (isMissingCourseColumn(error)) return { ok: false, needsMigration: true };
  console.error("[supabase] rename course failed:", error.message);
  return { ok: false };
}

/** Delete a course: its guides move to Uncategorized (course = NULL).
 *  The guides themselves are never deleted. */
export async function clearCourseGuides(
  userId: string,
  courseName: string
): Promise<CourseWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const { error } = await sb
    .from("study_guides")
    .update({ course: null })
    .eq("user_id", userId)
    .eq("course", courseName);
  if (!error) return { ok: true };
  if (isMissingCourseColumn(error)) return { ok: false, needsMigration: true };
  console.error("[supabase] clear course failed:", error.message);
  return { ok: false };
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
  /** Spaced-repetition schedule (migration 0004). Null until set. */
  next_review_at?: string | null;
  review_interval_days?: number | null;
  /** SM-2 scheduler state (migration 0008). Null on old rows — the
   *  app falls back to the SM-2 defaults (ease 2.5, 0 reps). */
  ease_factor?: number | null;
  review_reps?: number | null;
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

/** All of one user's error rows, across every guide copy — the raw
 *  material for the spaced-repetition Review queue. Returns [] when
 *  Supabase is not configured or the table is unreachable. */
export async function listAllGuideErrors(
  userId: string
): Promise<GuideErrorRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("guide_errors")
    .select("*")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) {
    console.error("[supabase] list all guide errors failed:", error.message);
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
  const rows = records.map((r) => ({
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
    next_review_at: r.next_review_at ?? null,
    review_interval_days: r.review_interval_days ?? null,
    ease_factor: r.ease_factor ?? null,
    review_reps: r.review_reps ?? null,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await sb
    .from("guide_errors")
    .upsert(rows, { onConflict: "user_id,guide_key,concept_title" });
  if (!error) return true;
  // The spaced-repetition columns come from migrations 0004 (schedule)
  // and 0008 (SM-2 ease/reps), which may not be applied live yet. If the
  // upsert failed because those columns do not exist, retry without
  // them — the errors still get saved.
  const missingColumn =
    error.code === "42703" ||
    /next_review_at|review_interval_days|ease_factor|review_reps/i.test(
      error.message
    );
  if (!missingColumn) {
    console.error("[supabase] save guide errors failed:", error.message);
    return false;
  }
  const legacyRows = rows.map(
    ({
      next_review_at: _n,
      review_interval_days: _i,
      ease_factor: _e,
      review_reps: _r,
      ...rest
    }) => rest
  );
  const retry = await sb
    .from("guide_errors")
    .upsert(legacyRows, { onConflict: "user_id,guide_key,concept_title" });
  if (retry.error) {
    console.error("[supabase] save guide errors failed:", retry.error.message);
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
