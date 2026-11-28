"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Loader2,
  LogOut,
  MessageCircle,
  Pencil,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  getMyProfile,
  getProfilesByIds,
  listMyGuides,
  type AppUser,
  type Profile,
  type StudyGuideRow,
} from "@/lib/supabase";
import {
  addGroupMembers,
  buildGroupGuideSnapshot,
  canManageGroup,
  canRemoveMember,
  createGroup,
  deleteGroup,
  getGroupMembers,
  isGroupCreator,
  leaveGroup,
  listGroupMessages,
  listMyGroups,
  mergeMessages,
  messagePreview,
  messageTime,
  removeGroupMember,
  renameGroup,
  saveGroupSharedGuideToMine,
  sendGroupMessage,
  shareGuideToGroup,
  validateGroupName,
  validateMessageContent,
  type GroupChatMessageRow,
  type GroupChatSummary,
} from "@/lib/groupChats";
import { initialsFor } from "@/lib/friends";
import type { FriendEntry } from "./Friends";

const POLL_MS = 5000;

/**
 * Group chats — inside the Friends section. Pick from your ACCEPTED
 * friends only (never strangers, never pending requests), name the
 * group, and chat together. Guides shared here go to the whole group
 * as one message carrying the guide snapshot.
 */
export default function GroupChats({
  user,
  friends,
}: {
  user: AppUser;
  friends: FriendEntry[];
}) {
  const [summaries, setSummaries] = useState<GroupChatSummary[]>([]);
  const [senderProfiles, setSenderProfiles] = useState<Record<string, Profile>>({});
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Create-group form.
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [creatingBusy, setCreatingBusy] = useState(false);

  // Open chat.
  const [openId, setOpenId] = useState<string | null>(null);
  const [members, setMembers] = useState<Profile[]>([]);
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [messages, setMessages] = useState<GroupChatMessageRow[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [savedMessageIds, setSavedMessageIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);

  // Share-a-guide picker inside the chat.
  const [shareOpen, setShareOpen] = useState(false);
  const [myGuides, setMyGuides] = useState<StudyGuideRow[] | null>(null);
  const [sharingId, setSharingId] = useState<string | null>(null);

  // Manage (creator-only): rename, add members, delete. Leave for everyone.
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [adding, setAdding] = useState(false);
  const [addPicked, setAddPicked] = useState<Set<string>>(new Set());
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [managingBusy, setManagingBusy] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const acceptedFriends = friends.filter(
    (f): f is FriendEntry & { profile: Profile } => Boolean(f.profile)
  );
  const openSummary = summaries.find((s) => s.group.id === openId) ?? null;
  const amCreator = openSummary ? isGroupCreator(openSummary.group, user.id) : false;

  async function refreshList() {
    setLoading(true);
    const list = await listMyGroups(user.id);
    setSummaries(list);
    const senderIds = [
      ...new Set(
        list
          .map((s) => s.lastMessage?.sender_id)
          .filter((id): id is string => Boolean(id))
      ),
    ];
    if (senderIds.length > 0) {
      const found = await getProfilesByIds(senderIds);
      const byId: Record<string, Profile> = {};
      for (const p of found) byId[p.user_id] = p;
      setSenderProfiles(byId);
    }
    setLoading(false);
  }

  useEffect(() => {
    refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]);

  function profileOf(userId: string): Profile | null {
    return (
      members.find((m) => m.user_id === userId) ??
      senderProfiles[userId] ??
      null
    );
  }

  function displayNameOf(userId: string): string {
    if (userId === user.id) return "You";
    return profileOf(userId)?.display_name ?? "Someone";
  }

  async function openChat(summary: GroupChatSummary) {
    setOpenId(summary.group.id);
    setMessages([]);
    setMembers([]);
    setMemberIds(summary.memberIds);
    setShareOpen(false);
    setMyGuides(null);
    setConfirmDelete(false);
    setConfirmLeave(false);
    setRenaming(false);
    setAdding(false);
    setChatLoading(true);
    const [mem, msgs] = await Promise.all([
      getGroupMembers(summary.group.id),
      listGroupMessages(summary.group.id),
    ]);
    setMembers(mem);
    setMemberIds(mem.map((m) => m.user_id));
    setMessages(msgs);
    setChatLoading(false);
  }

  function closeChat() {
    setOpenId(null);
    setMessages([]);
    setMembers([]);
    setShareOpen(false);
    refreshList();
  }

  /** Poll for new messages while a chat is open (every 5s, plus a
   *  manual refresh). Merges by id — nothing already shown is ever
   *  duplicated or lost. */
  async function pollMessages() {
    if (!openId) return;
    const last = messages[messages.length - 1];
    const incoming = await listGroupMessages(
      openId,
      last ? last.created_at : undefined
    );
    if (incoming.length > 0) setMessages((prev) => mergeMessages(prev, incoming));
  }

  useEffect(() => {
    if (!openId) return;
    const t = setInterval(() => void pollMessages(), POLL_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, messages.length]);

  async function refreshChat() {
    if (!openId) return;
    setRefreshing(true);
    const [mem, msgs] = await Promise.all([
      getGroupMembers(openId),
      listGroupMessages(openId),
    ]);
    setMembers(mem);
    setMemberIds(mem.map((m) => m.user_id));
    setMessages((prev) => mergeMessages(prev, msgs));
    setRefreshing(false);
  }

  // Keep the newest message in view.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages.length, openId]);

  function togglePicked(id: string, set: React.Dispatch<React.SetStateAction<Set<string>>>) {
    set((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function doCreate() {
    const nameError = validateGroupName(newName);
    if (nameError) {
      setNotice(nameError);
      return;
    }
    if (picked.size === 0) {
      setNotice("Pick at least one friend for the group.");
      return;
    }
    setCreatingBusy(true);
    const res = await createGroup({
      creatorId: user.id,
      name: newName,
      memberIds: [...picked],
    });
    setCreatingBusy(false);
    if (!res.ok) {
      setNotice(res.message ?? "Could not create the group. Try again.");
      return;
    }
    setNotice(
      res.message ??
        `Group "${newName.trim()}" created — say hi to your group.`
    );
    setCreating(false);
    setNewName("");
    setPicked(new Set());
    await refreshList();
    if (res.groupId) {
      const created = (await listMyGroups(user.id)).find(
        (s) => s.group.id === res.groupId
      );
      if (created) void openChat(created);
    }
  }

  async function doSend() {
    if (!openId) return;
    const error = validateMessageContent(draft);
    if (error) {
      setNotice(error);
      return;
    }
    setSending(true);
    const res = await sendGroupMessage({
      groupId: openId,
      senderId: user.id,
      content: draft,
    });
    setSending(false);
    if (!res.ok) {
      setNotice(res.message ?? "Could not send that message. Try again.");
      return;
    }
    setDraft("");
    await pollMessages();
  }

  async function doShareGuide(row: StudyGuideRow) {
    if (!openId) return;
    setSharingId(row.id);
    const res = await shareGuideToGroup({
      groupId: openId,
      senderId: user.id,
      guideId: row.id,
      snapshot: buildGroupGuideSnapshot(row),
    });
    setSharingId(null);
    if (!res.ok) {
      setNotice(res.message ?? "Could not share that guide. Try again.");
      return;
    }
    setNotice(`Shared "${row.topic}" with the group.`);
    setShareOpen(false);
    await pollMessages();
  }

  async function doSaveShared(message: GroupChatMessageRow) {
    setSavingId(message.id);
    const profile = await getMyProfile(user.id);
    const res = await saveGroupSharedGuideToMine({ user, profile, message });
    setSavingId(null);
    if (!res.ok) {
      setNotice(res.message ?? "Could not save that guide. Try again.");
      return;
    }
    setSavedMessageIds((prev) => new Set(prev).add(message.id));
    setNotice("Saved to your study guides — open it from there.");
  }

  async function doLeave() {
    if (!openId) return;
    setManagingBusy(true);
    const res = await leaveGroup(openId, user.id);
    setManagingBusy(false);
    if (!res.ok) {
      setNotice(res.message ?? "Could not leave the group. Try again.");
      return;
    }
    setNotice("You left the group.");
    closeChat();
  }

  async function doRemoveMember(targetId: string) {
    if (!openId || !openSummary) return;
    if (!canRemoveMember(openSummary.group, user.id, targetId)) return;
    setManagingBusy(true);
    const res = await removeGroupMember({
      groupId: openId,
      actorId: user.id,
      targetId,
    });
    setManagingBusy(false);
    setConfirmRemoveId(null);
    if (!res.ok) {
      setNotice(res.message ?? "Could not remove that member. Try again.");
      return;
    }
    setNotice("Member removed.");
    await refreshChat();
    await refreshList();
  }

  async function doAddMembers() {
    if (!openId) return;
    if (addPicked.size === 0) {
      setNotice("Pick at least one friend to add.");
      return;
    }
    setManagingBusy(true);
    const res = await addGroupMembers({
      groupId: openId,
      actorId: user.id,
      memberIds: [...addPicked],
    });
    setManagingBusy(false);
    if (!res.ok) {
      setNotice(res.message ?? "Could not add those friends. Try again.");
      return;
    }
    setNotice("Friends added to the group.");
    setAdding(false);
    setAddPicked(new Set());
    await refreshChat();
    await refreshList();
  }

  async function doRename() {
    if (!openId) return;
    const nameError = validateGroupName(renameValue);
    if (nameError) {
      setNotice(nameError);
      return;
    }
    setManagingBusy(true);
    const res = await renameGroup({
      groupId: openId,
      actorId: user.id,
      name: renameValue,
    });
    setManagingBusy(false);
    if (!res.ok) {
      setNotice(res.message ?? "Could not rename the group. Try again.");
      return;
    }
    setNotice("Group renamed.");
    setRenaming(false);
    await refreshChat();
    await refreshList();
  }

  async function doDeleteGroup() {
    if (!openId) return;
    setManagingBusy(true);
    const res = await deleteGroup({ groupId: openId, actorId: user.id });
    setManagingBusy(false);
    if (!res.ok) {
      setNotice(res.message ?? "Could not delete the group. Try again.");
      return;
    }
    setNotice("Group deleted.");
    closeChat();
  }

  // -- Render: open chat -------------------------------------------------
  if (openSummary) {
    const group = openSummary.group;
    const addable = acceptedFriends.filter(
      (f) => f.profile && !memberIds.includes(f.profile.user_id)
    );
    return (
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={closeChat} className="btn-ghost">
            <ArrowLeft className="h-4 w-4" /> Groups
          </button>
          <h3 className="min-w-0 flex-1 truncate text-base font-extrabold tracking-tight">
            {group.name}
          </h3>
          <span className="text-xs font-semibold text-ink-400">
            {memberIds.length} member{memberIds.length === 1 ? "" : "s"}
          </span>
          <button
            type="button"
            onClick={() => void refreshChat()}
            disabled={refreshing}
            className="btn-ghost"
            aria-label="Refresh messages"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        {notice && <p className="feedback-neutral mt-3">{notice}</p>}

        <div className="mt-3 flex flex-wrap gap-2">
          {members.map((m) => {
            const isCreator = m.user_id === group.created_by;
            const isMe = m.user_id === user.id;
            return (
              <span
                key={m.user_id}
                className="inline-flex items-center gap-1.5 rounded-full border border-ink-100 bg-white py-1 pl-1 pr-2 text-xs font-semibold text-ink-800"
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-100 text-[10px] font-extrabold text-brand-700"
                >
                  {initialsFor(m.display_name)}
                </span>
                {isMe ? "You" : m.display_name}
                {isCreator && <span className="text-ink-400">(creator)</span>}
                {amCreator && !isMe && (
                  <>
                    {confirmRemoveId === m.user_id ? (
                      <>
                        <button
                          type="button"
                          disabled={managingBusy}
                          onClick={() => void doRemoveMember(m.user_id)}
                          className="font-bold text-rose-600"
                        >
                          Remove?
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          className="text-ink-400"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(m.user_id)}
                        className="text-ink-400 hover:text-rose-600"
                        aria-label={`Remove ${m.display_name}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </>
                )}
              </span>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {amCreator && (
            <>
              <button
                type="button"
                onClick={() => {
                  setRenaming((v) => !v);
                  setRenameValue(group.name);
                  setAdding(false);
                }}
                className="btn-ghost text-sm"
              >
                <Pencil className="h-4 w-4" /> Rename
              </button>
              <button
                type="button"
                onClick={() => {
                  setAdding((v) => !v);
                  setAddPicked(new Set());
                  setRenaming(false);
                }}
                className="btn-ghost text-sm"
              >
                <UserPlus className="h-4 w-4" /> Add friends
              </button>
              {confirmDelete ? (
                <>
                  <button
                    type="button"
                    disabled={managingBusy}
                    onClick={() => void doDeleteGroup()}
                    className="btn-ghost text-sm text-rose-600 hover:bg-rose-50"
                  >
                    <Trash2 className="h-4 w-4" /> Yes, delete the group
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="btn-ghost text-sm"
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="btn-ghost text-sm text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" /> Delete group
                </button>
              )}
            </>
          )}
          {confirmLeave ? (
            <>
              <button
                type="button"
                disabled={managingBusy}
                onClick={() => void doLeave()}
                className="btn-ghost text-sm text-rose-600 hover:bg-rose-50"
              >
                <LogOut className="h-4 w-4" /> Yes, leave
              </button>
              <button
                type="button"
                onClick={() => setConfirmLeave(false)}
                className="btn-ghost text-sm"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmLeave(true)}
              className="btn-ghost text-sm"
            >
              <LogOut className="h-4 w-4" /> Leave group
            </button>
          )}
        </div>

        {renaming && (
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={80}
              aria-label="Group name"
              className="input max-w-xs"
            />
            <button
              type="button"
              disabled={managingBusy}
              onClick={() => void doRename()}
              className="btn-primary px-3 py-2 text-sm"
            >
              <Check className="h-4 w-4" /> Save name
            </button>
            <button
              type="button"
              onClick={() => setRenaming(false)}
              className="btn-ghost"
            >
              Cancel
            </button>
          </div>
        )}

        {adding && (
          <div className="mt-3 rounded-xl bg-brand-50/70 p-3 ring-1 ring-inset ring-brand-100">
            <p className="text-sm font-bold text-ink-900">
              Add friends to the group
            </p>
            {addable.length === 0 ? (
              <p className="mt-1 text-sm text-ink-500">
                All of your accepted friends are already in this group.
              </p>
            ) : (
              <>
                <div className="mt-2 space-y-2">
                  {addable.map((f) => (
                    <label
                      key={f.friendshipId}
                      className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink-800"
                    >
                      <input
                        type="checkbox"
                        checked={addPicked.has(f.profile!.user_id)}
                        onChange={() =>
                          togglePicked(f.profile!.user_id, setAddPicked)
                        }
                        className="h-4 w-4 accent-brand-600"
                      />
                      {f.profile!.display_name} (@{f.profile!.username})
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={managingBusy || addPicked.size === 0}
                  onClick={() => void doAddMembers()}
                  className="btn-primary mt-3 px-3 py-2 text-sm"
                >
                  <UserPlus className="h-4 w-4" /> Add to group
                </button>
              </>
            )}
          </div>
        )}

        <div className="mt-4 flex max-h-[420px] flex-col gap-2 overflow-y-auto rounded-2xl border border-ink-100 bg-ink-50/40 p-3">
          {chatLoading ? (
            <p className="flex items-center gap-2 text-sm text-ink-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading messages…
            </p>
          ) : messages.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-500">
              No messages yet — say hi to your group.
            </p>
          ) : (
            messages.map((m) => {
              const mine = m.sender_id === user.id;
              const snap = m.guide_snapshot ?? {};
              const isGame = snap.kind === "game";
              const canOpenDirect =
                m.guide_id &&
                (snap.is_public === true || mine);
              const saved = savedMessageIds.has(m.id);
              return (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-2xl border p-3 shadow-sm ${
                    mine
                      ? "self-end border-brand-100 bg-brand-50"
                      : "self-start border-ink-100 bg-white"
                  }`}
                >
                  <p className="text-xs font-semibold text-ink-400">
                    {displayNameOf(m.sender_id)} · {messageTime(m.created_at)}
                  </p>
                  {m.message_type === "guide" ? (
                    <div className="mt-1">
                      <p className="flex items-center gap-1.5 text-sm font-bold text-ink-900">
                        <BookOpen className="h-4 w-4 text-brand-600" />
                        Shared a {isGame ? "game" : "guide"}:{" "}
                        {(snap.topic as string) || "Shared guide"}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-500">
                        by {displayNameOf(m.sender_id)}
                        {snap.author_name
                          ? ` · ${String(snap.author_name)}`
                          : ""}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {canOpenDirect && (
                          <a
                            href={`/guide/${m.guide_id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-primary px-3 py-1.5 text-sm"
                          >
                            Open
                          </a>
                        )}
                        <button
                          type="button"
                          disabled={savingId === m.id || saved}
                          onClick={() => void doSaveShared(m)}
                          className="btn-ghost text-sm"
                        >
                          {savingId === m.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : saved ? (
                            <Check className="h-4 w-4" />
                          ) : (
                            <Plus className="h-4 w-4" />
                          )}
                          {saved
                            ? "Saved to my guides"
                            : "Save to my guides"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-900">
                      {m.content}
                    </p>
                  )}
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="mt-3">
          <button
            type="button"
            onClick={async () => {
              setShareOpen((v) => !v);
              if (!shareOpen && myGuides === null) {
                setMyGuides(await listMyGuides(user.id));
              }
            }}
            className="btn-ghost text-sm"
          >
            <BookOpen className="h-4 w-4" /> Share a guide with the group
          </button>
          {shareOpen && (
            <div className="mt-2 max-h-56 space-y-2 overflow-y-auto rounded-xl border border-ink-100 bg-white p-3">
              {myGuides === null ? (
                <p className="flex items-center gap-2 text-sm text-ink-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading your guides…
                </p>
              ) : myGuides.length === 0 ? (
                <p className="text-sm text-ink-500">
                  You have no saved guides yet — generate one first, then
                  share it here.
                </p>
              ) : (
                myGuides.map((g) => (
                  <div
                    key={g.id}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">
                      {g.topic}
                      <span className="text-ink-400">
                        {" "}
                        · {g.kind === "game" ? "game" : "guide"}
                      </span>
                    </p>
                    <button
                      type="button"
                      disabled={sharingId === g.id}
                      onClick={() => void doShareGuide(g)}
                      className="btn-primary px-3 py-1.5 text-sm"
                    >
                      {sharingId === g.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      Share
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void doSend();
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={1000}
            placeholder="Message your group…"
            aria-label="Message your group"
            className="input flex-1"
          />
          <button
            type="submit"
            disabled={sending || !draft.trim()}
            className="btn-primary px-4"
          >
            {sending && <Loader2 className="h-4 w-4 animate-spin" />}
            <Send className="h-4 w-4" /> Send
          </button>
        </form>
        {draft.length > 900 && (
          <p className="mt-1 text-right text-xs text-ink-400">
            {draft.length}/1000
          </p>
        )}
      </div>
    );
  }

  // -- Render: group list + create ---------------------------------------
  return (
    <div>
      <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
        <MessageCircle className="h-5 w-5 text-brand-600" /> Group chats
      </h3>
      <p className="mt-1 text-sm text-ink-400">
        Chat with a group of your friends — and share guides with all of
        them at once. Only accepted friends can be in a group.
      </p>
      {notice && <p className="feedback-neutral mt-3">{notice}</p>}

      {loading ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your groups…
        </p>
      ) : summaries.length === 0 ? (
        <div className="mt-3 rounded-2xl border border-dashed border-brand-300 bg-white/70 p-5 text-center">
          <p className="text-sm font-bold text-ink-900">
            No group chats yet — create one with your friends
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm leading-relaxed text-ink-500">
            Pick your friends, give the group a name, and start chatting.
            Anything you share goes to everyone in the group.
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          {summaries.map((s) => (
            <button
              key={s.group.id}
              type="button"
              onClick={() => void openChat(s)}
              className="flex w-full flex-wrap items-center gap-3 rounded-2xl border border-ink-100 bg-white p-3 text-left shadow-sm transition hover:border-brand-300"
            >
              <span
                aria-hidden
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-extrabold text-brand-700"
              >
                <Users className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold text-ink-900">
                  {s.group.name}
                </span>
                <span className="block truncate text-xs text-ink-400">
                  {s.memberCount} member{s.memberCount === 1 ? "" : "s"}
                  {" · "}
                  {messagePreview(
                    s.lastMessage,
                    s.lastMessage
                      ? displayNameOf(s.lastMessage.sender_id)
                      : null
                  )}
                </span>
              </span>
              {s.lastMessage && (
                <span className="shrink-0 text-xs font-medium text-ink-400">
                  {messageTime(s.lastMessage.created_at)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        {creating ? (
          <div className="rounded-xl bg-brand-50/70 p-3 ring-1 ring-inset ring-brand-100">
            <p className="text-sm font-bold text-ink-900">Create a group chat</p>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              maxLength={80}
              placeholder="Group name — e.g. Biology crew"
              aria-label="Group name"
              className="input mt-2"
            />
            {acceptedFriends.length === 0 ? (
              <p className="mt-2 text-sm text-ink-500">
                You have no accepted friends yet — add friends above first.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                {acceptedFriends.map((f) => (
                  <label
                    key={f.friendshipId}
                    className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink-800"
                  >
                    <input
                      type="checkbox"
                      checked={picked.has(f.profile!.user_id)}
                      onChange={() =>
                        togglePicked(f.profile!.user_id, setPicked)
                      }
                      className="h-4 w-4 accent-brand-600"
                    />
                    {f.profile!.display_name} (@{f.profile!.username})
                  </label>
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={creatingBusy}
                onClick={() => void doCreate()}
                className="btn-primary px-3 py-2 text-sm"
              >
                {creatingBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                <Users className="h-4 w-4" /> Create group
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName("");
                  setPicked(new Set());
                }}
                className="btn-ghost"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="btn-primary px-3 py-2 text-sm"
          >
            <Plus className="h-4 w-4" /> New group chat
          </button>
        )}
      </div>
    </div>
  );
}
