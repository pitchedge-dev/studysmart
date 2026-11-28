// Group chats for friends — create a group with your accepted friends,
// chat together, and share guides with the whole group at once.
//
// Privacy: groups are in-app only (no emails, no notifications). A group
// can only ever contain the creator's ACCEPTED friends — strangers and
// pending requests are rejected in the app code AND by the row-level
// policies in migration 0010. Only members can read a group, its
// members, or its messages. Messages are plain text (max 1000 chars)
// or a shared guide (one message carrying the guide snapshot, visible
// to every member — the guide is NOT copied into shared_guides once
// per member).
//
// Data access follows the friends pattern: direct Supabase calls from
// this lib, no API route. When migration 0010 has not been applied live
// yet, every helper degrades gracefully (empty lists / ok:false with
// needsMigration:true) instead of throwing.

import {
  getProfilesByIds,
  getSupabase,
  listFriendships,
  saveGuideToAccount,
  type AppUser,
  type FriendshipRow,
  type Profile,
  type StudyGuideRow,
} from "@/lib/supabase";

export const MAX_GROUP_NAME_LENGTH = 80;
export const MAX_MESSAGE_LENGTH = 1000;
export const MIN_GROUP_MEMBERS = 1; // friends picked, besides the creator

export type GroupChatRow = {
  id: string;
  name: string;
  created_by: string;
  created_at: string;
};

export type GroupChatMemberRow = {
  group_id: string;
  user_id: string;
  joined_at: string;
};

export type GroupChatMessageRow = {
  id: string;
  group_id: string;
  sender_id: string;
  message_type: "text" | "guide";
  content: string;
  guide_id?: string | null;
  guide_snapshot?: Record<string, unknown> | null;
  created_at: string;
};

/** One row of the group list: the group, who is in it, and the latest message. */
export type GroupChatSummary = {
  group: GroupChatRow;
  memberCount: number;
  memberIds: string[];
  lastMessage: GroupChatMessageRow | null;
};

export type GroupWriteResult = {
  ok: boolean;
  /** True when the write failed only because migration 0010 is not
   *  applied live yet. Nothing was created or changed. */
  needsMigration?: boolean;
  message?: string;
  groupId?: string;
  /** leaveGroup only: true when the leaver was the last member, so
   *  the group itself was deleted instead of left empty. */
  groupDeleted?: boolean;
  /** leaveGroup only: user id of the member who became the new
   *  creator when the old creator left with members remaining. */
  transferredTo?: string;
};

/** "relation does not exist" — the 0010 tables are not applied live yet. */
export function isMissingRelation(error: {
  code?: string;
  message?: string;
}): boolean {
  return (
    error.code === "42P01" ||
    /relation .* does not exist/i.test(error.message ?? "")
  );
}

// ---------------------------------------------------------------------------
// Pure rules — no network, fully unit-testable.
// ---------------------------------------------------------------------------

/** Group name: 1–80 characters after trimming. Returns an error or null. */
export function validateGroupName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give your group a name.";
  if (trimmed.length > MAX_GROUP_NAME_LENGTH)
    return `Keep the name under ${MAX_GROUP_NAME_LENGTH} characters.`;
  return null;
}

/** Plain-text message: 1–1000 characters after trimming. Error or null. */
export function validateMessageContent(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.length === 0) return "Write a message first.";
  if (trimmed.length > MAX_MESSAGE_LENGTH)
    return `Keep messages under ${MAX_MESSAGE_LENGTH} characters.`;
  return null;
}

/** True when a and b have an ACCEPTED friendship row (either direction). */
export function isAcceptedFriend(
  rows: FriendshipRow[],
  a: string,
  b: string
): boolean {
  if (a === b) return false;
  return rows.some(
    (r) =>
      r.status === "accepted" &&
      ((r.requester_id === a && r.addressee_id === b) ||
        (r.requester_id === b && r.addressee_id === a))
  );
}

/**
 * New-group member list: at least one friend besides the creator, no
 * duplicates, nobody twice, and every pick must be an accepted friend
 * of the creator. Returns an error or null.
 */
export function validateNewMembers(
  selectedIds: string[],
  acceptedFriendIds: string[],
  creatorId: string
): string | null {
  const unique = [...new Set(selectedIds.filter(Boolean))];
  if (unique.length < MIN_GROUP_MEMBERS)
    return "Pick at least one friend for the group.";
  if (unique.includes(creatorId))
    return "You are already in the group — pick your friends.";
  const accepted = new Set(acceptedFriendIds);
  if (unique.some((id) => !accepted.has(id)))
    return "Only accepted friends can join a group.";
  return null;
}

/** Same check for adding members to an existing group. */
export function validateAddedMembers(
  newIds: string[],
  acceptedFriendIds: string[],
  existingMemberIds: string[],
  creatorId: string
): string | null {
  const unique = [...new Set(newIds.filter(Boolean))];
  if (unique.length === 0) return "Pick at least one friend to add.";
  const accepted = new Set(acceptedFriendIds);
  if (unique.some((id) => !accepted.has(id) || id === creatorId))
    return "Only accepted friends can join a group.";
  if (unique.some((id) => existingMemberIds.includes(id)))
    return "That friend is already in the group.";
  return null;
}

export function isGroupMember(
  memberIds: string[],
  userId: string | null | undefined
): boolean {
  return Boolean(userId) && memberIds.includes(userId as string);
}

export function isGroupCreator(
  group: GroupChatRow,
  userId: string | null | undefined
): boolean {
  return group.created_by === userId;
}

/** Only a member can post in a group (the RLS policy enforces this too). */
export function canSendMessage(
  memberIds: string[],
  userId: string | null | undefined
): boolean {
  return isGroupMember(memberIds, userId);
}

/** Only the creator can rename or delete the group. */
export function canManageGroup(
  group: GroupChatRow,
  userId: string | null | undefined
): boolean {
  return isGroupCreator(group, userId);
}

/**
 * Removing a member: the creator can remove anyone; anyone can remove
 * themselves (leave). Nobody else can remove anyone.
 */
export function canRemoveMember(
  group: GroupChatRow,
  actorId: string | null | undefined,
  targetId: string
): boolean {
  if (!actorId) return false;
  return actorId === targetId || isGroupCreator(group, actorId);
}

/**
 * Merge a freshly polled batch into the messages already shown: dedupe
 * by id, keep chronological order (oldest first). Pure — the polling
 * loop in the chat view calls this, never the network.
 */
export function mergeMessages(
  existing: GroupChatMessageRow[],
  incoming: GroupChatMessageRow[]
): GroupChatMessageRow[] {
  const byId = new Map<string, GroupChatMessageRow>();
  for (const m of existing) byId.set(m.id, m);
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort((a, b) => {
    const t = a.created_at.localeCompare(b.created_at);
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

/**
 * The incremental-poll rule, mirrored from listGroupMessages for
 * tests: a message counts as new when its created_at is AT OR AFTER
 * the last message shown. INCLUSIVE on purpose — two messages can
 * share a timestamp (Postgres now() is per-transaction, and two fast
 * sends can land in the same microsecond), so a strict `>` would
 * silently drop the second one. The >= overlap re-fetches the
 * boundary message, and mergeMessages dedupes by id, so nothing is
 * ever shown twice.
 */
export function isNewSincePoll(
  message: GroupChatMessageRow,
  lastSeen: GroupChatMessageRow | null
): boolean {
  if (!lastSeen) return true;
  return message.created_at.localeCompare(lastSeen.created_at) >= 0;
}

export type LeaveOutcome =
  | { action: "delete-group" }
  | { action: "transfer"; newCreatorId: string }
  | { action: "nothing" };

/**
 * What a leave means for the group, decided from the members left
 * AFTER the leaver is removed. Pure — leaveGroup calls this, never
 * the network.
 * - Nobody left: the group is deleted instead of left empty.
 * - The creator left with members remaining: the longest-standing
 *   remaining member (earliest joined_at, user id breaks ties so the
 *   pick is deterministic) becomes the new creator, so rename,
 *   delete, and add-members stay reachable.
 * - Anyone else leaves: nothing changes — the creator and the group
 *   both stay.
 */
export function resolveLeaveOutcome(args: {
  leaverId: string;
  currentCreatorId: string;
  remainingMembers: GroupChatMemberRow[];
}): LeaveOutcome {
  if (args.remainingMembers.length === 0) return { action: "delete-group" };
  if (args.leaverId !== args.currentCreatorId) return { action: "nothing" };
  const sorted = [...args.remainingMembers].sort((a, b) => {
    const t = a.joined_at.localeCompare(b.joined_at);
    return t !== 0 ? t : a.user_id.localeCompare(b.user_id);
  });
  return { action: "transfer", newCreatorId: sorted[0].user_id };
}

/** One-line preview for the group list. */
export function messagePreview(
  message: GroupChatMessageRow | null,
  senderName: string | null
): string {
  if (!message) return "No messages yet";
  const who = senderName ? `${senderName}: ` : "";
  if (message.message_type === "guide") {
    const title = guideTitleOf(message.guide_snapshot);
    return `${who}Shared a guide: ${title}`;
  }
  const text = message.content.trim().replace(/\s+/g, " ");
  return `${who}${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
}

/** Defensive title for a shared-guide snapshot (never invented). */
export function guideTitleOf(
  snapshot: Record<string, unknown> | null | undefined
): string {
  if (!snapshot) return "Shared guide";
  const topic = snapshot.topic;
  if (typeof topic === "string" && topic.trim()) return topic.trim();
  const title = snapshot.guideTitle;
  if (typeof title === "string" && title.trim()) return title.trim();
  return "Shared guide";
}

/** Short clock time for a message ("3:42 PM") or a date for older ones. */
export function messageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay)
    return d.toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * The guide snapshot stored on a group message — the same shape
 * YourGuides uses for shared_guides (topic, guide, quiz, kind, game,
 * author), plus is_public so the chat knows whether members can open
 * it directly at /guide/[id].
 */
export function buildGroupGuideSnapshot(row: StudyGuideRow): Record<string, unknown> {
  return {
    topic: row.topic,
    education_level: row.education_level,
    test_timing: row.test_timing,
    guide: row.guide,
    quiz: row.quiz,
    kind: row.kind,
    game: row.game,
    author_name: row.author_name,
    is_public: row.is_public,
  };
}

// ---------------------------------------------------------------------------
// Supabase data access (direct calls, like the friends helpers).
// ---------------------------------------------------------------------------

/** Groups I belong to, most recently active first, with member counts
 *  and the latest message each. Returns [] when the tables are not
 *  applied live yet (the UI then shows the honest empty state). */
export async function listMyGroups(
  userId: string
): Promise<GroupChatSummary[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: memberships, error: memberError } = await sb
    .from("group_chat_members")
    .select("group_id")
    .eq("user_id", userId);
  if (memberError) {
    if (!isMissingRelation(memberError))
      console.error("[groupChats] list memberships failed:", memberError.message);
    return [];
  }
  const groupIds = [...new Set(((memberships ?? []) as Array<{ group_id: string }>).map((m) => m.group_id))];
  if (groupIds.length === 0) return [];
  const [{ data: groups, error: groupError }, { data: allMembers }, { data: recent }] =
    await Promise.all([
      sb
        .from("group_chats")
        .select("*")
        .in("id", groupIds)
        .order("created_at", { ascending: false }),
      sb
        .from("group_chat_members")
        .select("group_id, user_id")
        .in("group_id", groupIds),
      sb
        .from("group_chat_messages")
        .select("*")
        .in("group_id", groupIds)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);
  if (groupError) {
    console.error("[groupChats] list groups failed:", groupError.message);
    return [];
  }
  const membersByGroup = new Map<string, string[]>();
  for (const m of (allMembers ?? []) as Array<{ group_id: string; user_id: string }>) {
    const list = membersByGroup.get(m.group_id) ?? [];
    list.push(m.user_id);
    membersByGroup.set(m.group_id, list);
  }
  const lastByGroup = new Map<string, GroupChatMessageRow>();
  for (const m of (recent ?? []) as GroupChatMessageRow[]) {
    if (!lastByGroup.has(m.group_id)) lastByGroup.set(m.group_id, m);
  }
  return ((groups ?? []) as GroupChatRow[])
    .map((group) => ({
      group,
      memberCount: membersByGroup.get(group.id)?.length ?? 0,
      memberIds: membersByGroup.get(group.id) ?? [],
      lastMessage: lastByGroup.get(group.id) ?? null,
    }))
    .sort((a, b) => {
      const at = a.lastMessage?.created_at ?? a.group.created_at;
      const bt = b.lastMessage?.created_at ?? b.group.created_at;
      return bt.localeCompare(at);
    });
}

/** Profiles of a group's members (for names and avatars). */
export async function getGroupMembers(groupId: string): Promise<Profile[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("group_chat_members")
    .select("user_id")
    .eq("group_id", groupId);
  if (error) {
    if (!isMissingRelation(error))
      console.error("[groupChats] list group members failed:", error.message);
    return [];
  }
  return getProfilesByIds(
    ((data ?? []) as Array<{ user_id: string }>).map((m) => m.user_id)
  );
}

/** Messages of a group, oldest first. With `after`, only messages at
 *  or after that timestamp — the polling loop uses this. INCLUSIVE
 *  (>=, not >): two messages can share a created_at, and a strict
 *  `>` would silently drop the second one. The overlap is safe
 *  because the chat view merges by id (mergeMessages dedupes). The
 *  id tiebreak keeps the order stable when timestamps are equal. */
export async function listGroupMessages(
  groupId: string,
  after?: string
): Promise<GroupChatMessageRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  let query = sb
    .from("group_chat_messages")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });
  if (after) query = query.gte("created_at", after);
  const { data, error } = await query;
  if (error) {
    if (!isMissingRelation(error))
      console.error("[groupChats] list messages failed:", error.message);
    return [];
  }
  return (data as GroupChatMessageRow[]) ?? [];
}

/**
 * Create a group: the creator names it and picks accepted friends.
 * The friendship check runs here (and again in RLS) — a stranger or a
 * pending request can never be added, even from another client.
 */
export async function createGroup(args: {
  creatorId: string;
  name: string;
  memberIds: string[];
}): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Accounts are not set up yet." };
  const nameError = validateGroupName(args.name);
  if (nameError) return { ok: false, message: nameError };
  const friendships = await listFriendships(args.creatorId);
  const acceptedIds = friendships
    .filter((r) => r.status === "accepted")
    .map((r) =>
      r.requester_id === args.creatorId ? r.addressee_id : r.requester_id
    );
  const memberError = validateNewMembers(args.memberIds, acceptedIds, args.creatorId);
  if (memberError) return { ok: false, message: memberError };
  const unique = [...new Set(args.memberIds)];
  const { data: group, error: groupError } = await sb
    .from("group_chats")
    .insert({ name: args.name.trim(), created_by: args.creatorId })
    .select()
    .single();
  if (groupError) {
    if (isMissingRelation(groupError))
      return {
        ok: false,
        needsMigration: true,
        message: "Group chats are not set up yet.",
      };
    console.error("[groupChats] create group failed:", groupError.message);
    return { ok: false, message: "Could not create the group. Try again." };
  }
  const rows = [{ group_id: group.id, user_id: args.creatorId }, ...unique.map((id) => ({ group_id: group.id, user_id: id }))];
  const { error: memberError2 } = await sb
    .from("group_chat_members")
    .insert(rows);
  if (memberError2) {
    console.error("[groupChats] add members failed:", memberError2.message);
    return {
      ok: false,
      message:
        "The group was created but some friends could not be added. Open it and add them again.",
      groupId: group.id,
    };
  }
  return { ok: true, groupId: group.id };
}

/** Send a plain-text message to a group (members only, RLS-enforced). */
export async function sendGroupMessage(args: {
  groupId: string;
  senderId: string;
  content: string;
}): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Accounts are not set up yet." };
  const error = validateMessageContent(args.content);
  if (error) return { ok: false, message: error };
  const { error: insertError } = await sb.from("group_chat_messages").insert({
    group_id: args.groupId,
    sender_id: args.senderId,
    message_type: "text",
    content: args.content.trim(),
  });
  if (insertError) {
    if (isMissingRelation(insertError))
      return { ok: false, needsMigration: true, message: "Group chats are not set up yet." };
    console.error("[groupChats] send message failed:", insertError.message);
    return { ok: false, message: "Could not send that message. Try again." };
  }
  return { ok: true };
}

/**
 * Share a guide with a group: one message carrying the guide snapshot,
 * visible to every member. The guide is NOT copied into shared_guides
 * per member — the single group message is the shared copy.
 */
export async function shareGuideToGroup(args: {
  groupId: string;
  senderId: string;
  guideId: string | null;
  snapshot: Record<string, unknown>;
}): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false, message: "Accounts are not set up yet." };
  const { error } = await sb.from("group_chat_messages").insert({
    group_id: args.groupId,
    sender_id: args.senderId,
    message_type: "guide",
    content: "",
    guide_id: args.guideId,
    guide_snapshot: args.snapshot,
  });
  if (error) {
    if (isMissingRelation(error))
      return { ok: false, needsMigration: true, message: "Group chats are not set up yet." };
    console.error("[groupChats] share guide failed:", error.message);
    return { ok: false, message: "Could not share that guide. Try again." };
  }
  return { ok: true };
}

/**
 * Leave a group — any member can leave at any time.
 *
 * Order matters, and it is load-bearing for RLS:
 * 1. Transfer FIRST (when the creator leaves with members remaining):
 *    the update policy's with-check only lets the current creator hand
 *    the role to someone who is already a member, and the check can
 *    only see member rows while the caller is still a member — so the
 *    transfer must run before the leaver's own member row is deleted.
 *    If the transfer fails, nothing has changed and the leave fails
 *    cleanly; if the member-row delete then fails, the group still has
 *    a valid creator and the leaver can simply try again.
 * 2. Last member leaving: delete the GROUP itself instead of the
 *    member row — the cascade removes the member row and the messages,
 *    so no empty ownerless group is ever left behind.
 */
export async function leaveGroup(
  groupId: string,
  userId: string
): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const { data: group, error: groupError } = await sb
    .from("group_chats")
    .select("created_by")
    .eq("id", groupId)
    .maybeSingle();
  if (groupError) {
    if (isMissingRelation(groupError))
      return { ok: false, needsMigration: true };
    console.error("[groupChats] leave group failed:", groupError.message);
    return { ok: false, message: "Could not leave the group. Try again." };
  }
  if (!group)
    return { ok: false, message: "That group no longer exists." };
  const { data: memberRows, error: memberError } = await sb
    .from("group_chat_members")
    .select("user_id, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true })
    .order("user_id", { ascending: true });
  if (memberError) {
    if (isMissingRelation(memberError))
      return { ok: false, needsMigration: true };
    console.error("[groupChats] leave group failed:", memberError.message);
    return { ok: false, message: "Could not leave the group. Try again." };
  }
  const remaining = ((memberRows ?? []) as GroupChatMemberRow[]).filter(
    (m) => m.user_id !== userId
  );
  const outcome = resolveLeaveOutcome({
    leaverId: userId,
    currentCreatorId: (group as { created_by: string }).created_by,
    remainingMembers: remaining,
  });
  if (outcome.action === "delete-group") {
    const { error: deleteError } = await sb
      .from("group_chats")
      .delete()
      .eq("id", groupId);
    if (deleteError) {
      console.error("[groupChats] leave group failed:", deleteError.message);
      return { ok: false, message: "Could not leave the group. Try again." };
    }
    return { ok: true, groupDeleted: true };
  }
  if (outcome.action === "transfer") {
    const { error: transferError } = await sb
      .from("group_chats")
      .update({ created_by: outcome.newCreatorId })
      .eq("id", groupId);
    if (transferError) {
      console.error("[groupChats] transfer creator failed:", transferError.message);
      return { ok: false, message: "Could not leave the group. Try again." };
    }
  }
  const { error } = await sb
    .from("group_chat_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) {
    if (isMissingRelation(error))
      return { ok: false, needsMigration: true };
    console.error("[groupChats] leave group failed:", error.message);
    return { ok: false, message: "Could not leave the group. Try again." };
  }
  return {
    ok: true,
    transferredTo:
      outcome.action === "transfer" ? outcome.newCreatorId : undefined,
  };
}

/** Remove a member — only the creator. */
export async function removeGroupMember(args: {
  groupId: string;
  actorId: string;
  targetId: string;
}): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  if (args.actorId === args.targetId)
    return leaveGroup(args.groupId, args.actorId);
  const { data: group } = await sb
    .from("group_chats")
    .select("created_by")
    .eq("id", args.groupId)
    .maybeSingle();
  if (!group || (group as { created_by: string }).created_by !== args.actorId)
    return { ok: false, message: "Only the group creator can remove members." };
  const { error } = await sb
    .from("group_chat_members")
    .delete()
    .eq("group_id", args.groupId)
    .eq("user_id", args.targetId);
  if (error) {
    console.error("[groupChats] remove member failed:", error.message);
    return { ok: false, message: "Could not remove that member. Try again." };
  }
  return { ok: true };
}

/** Add more accepted friends later — only the creator. */
export async function addGroupMembers(args: {
  groupId: string;
  actorId: string;
  memberIds: string[];
}): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const { data: group } = await sb
    .from("group_chats")
    .select("created_by")
    .eq("id", args.groupId)
    .maybeSingle();
  if (!group || (group as { created_by: string }).created_by !== args.actorId)
    return { ok: false, message: "Only the group creator can add members." };
  const friendships = await listFriendships(args.actorId);
  const acceptedIds = friendships
    .filter((r) => r.status === "accepted")
    .map((r) =>
      r.requester_id === args.actorId ? r.addressee_id : r.requester_id
    );
  const members = await getGroupMembers(args.groupId);
  const error = validateAddedMembers(
    args.memberIds,
    acceptedIds,
    members.map((m) => m.user_id),
    args.actorId
  );
  if (error) return { ok: false, message: error };
  const { error: insertError } = await sb
    .from("group_chat_members")
    .insert(
      [...new Set(args.memberIds)].map((id) => ({
        group_id: args.groupId,
        user_id: id,
      }))
    );
  if (insertError) {
    if (isMissingRelation(insertError))
      return { ok: false, needsMigration: true };
    console.error("[groupChats] add members failed:", insertError.message);
    return { ok: false, message: "Could not add those friends. Try again." };
  }
  return { ok: true };
}

/** Rename a group — only the creator. */
export async function renameGroup(args: {
  groupId: string;
  actorId: string;
  name: string;
}): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const nameError = validateGroupName(args.name);
  if (nameError) return { ok: false, message: nameError };
  const { data: group } = await sb
    .from("group_chats")
    .select("created_by")
    .eq("id", args.groupId)
    .maybeSingle();
  if (!group || (group as { created_by: string }).created_by !== args.actorId)
    return { ok: false, message: "Only the group creator can rename it." };
  const { error } = await sb
    .from("group_chats")
    .update({ name: args.name.trim() })
    .eq("id", args.groupId);
  if (error) {
    console.error("[groupChats] rename group failed:", error.message);
    return { ok: false, message: "Could not rename the group. Try again." };
  }
  return { ok: true };
}

/** Delete the whole group — only the creator (members + messages cascade). */
export async function deleteGroup(args: {
  groupId: string;
  actorId: string;
}): Promise<GroupWriteResult> {
  const sb = getSupabase();
  if (!sb) return { ok: false };
  const { data: group } = await sb
    .from("group_chats")
    .select("created_by")
    .eq("id", args.groupId)
    .maybeSingle();
  if (!group || (group as { created_by: string }).created_by !== args.actorId)
    return { ok: false, message: "Only the group creator can delete it." };
  const { error } = await sb.from("group_chats").delete().eq("id", args.groupId);
  if (error) {
    console.error("[groupChats] delete group failed:", error.message);
    return { ok: false, message: "Could not delete the group. Try again." };
  }
  return { ok: true };
}

/**
 * Save a guide shared in a group chat to my own study guides — the same
 * copy-your-own-version step the "Shared with you" list uses. A private
 * guide shared in a group cannot be opened at /guide/[id] by members
 * (study_guides RLS: public-or-owner only), so this copy is how a
 * member gets their own openable version of it.
 */
export async function saveGroupSharedGuideToMine(args: {
  user: AppUser;
  profile: Profile | null;
  message: GroupChatMessageRow;
}): Promise<{ ok: boolean; message?: string }> {
  const snap = args.message.guide_snapshot ?? {};
  const saved = await saveGuideToAccount({
    user: args.user,
    profile: args.profile,
    topic: (snap.topic as string) || "Shared guide",
    educationLevel: (snap.education_level as string) || "",
    testTiming: (snap.test_timing as string) || "",
    guide: (snap.guide ?? snap) as Record<string, unknown>,
    quiz: snap.quiz,
    kind: (snap.kind as "guide" | "game") || "guide",
    game: (snap.game as Record<string, unknown> | null) ?? null,
  });
  if (!saved) return { ok: false, message: "Could not save that guide. Try again." };
  return { ok: true };
}
