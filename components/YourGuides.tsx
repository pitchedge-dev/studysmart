"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Globe,
  Heart,
  Loader2,
  Pencil,
  Plus,
  Search,
  Send,
  Swords,
  Trash2,
  Users,
  Wrench,
} from "lucide-react";
import {
  addKnownCourse,
  courseColor,
  courseOf,
  distinctCourses,
  loadKnownCourses,
  normalizeCourseName,
  removeKnownCourse,
  renameKnownCourse,
  UNCATEGORIZED,
} from "@/lib/courses";
import {
  clearCourseGuides,
  deleteGuide,
  deleteSharedGuide,
  getProfilesByIds,
  listMyFavorites,
  listMyGuides,
  listSentByMe,
  listSharedWithMe,
  removeFavorite,
  renameCourseGuides,
  sendGuideToFriend,
  setGuideCourse,
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
import EmptyState from "./EmptyState";

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

/** Small colored chip showing a guide's course (styling only — the
 *  colors come from the course name, nothing is hardcoded per course). */
function CourseChip({ course }: { course: string | null }) {
  const c = courseColor(course);
  return (
    <span
      className="ml-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ backgroundColor: c.soft, color: c.text }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: c.dot }}
      />
      {course ?? UNCATEGORIZED}
    </span>
  );
}

export default function YourGuides({
  user,
  profile,
  friends,
  onOpenGuide,
  onOpenGuideDetail,
  onOpenGame,
  onGenerate,
}: {
  user: AppUser | null;
  profile: Profile | null;
  friends: Friend[];
  /** The optional guideId keys this copy for per-user error tracking. */
  onOpenGuide: (result: GenerateResult, guideId?: string | null) => void;
  /** Open a saved guide on its own dedicated page (/guide/[id]). */
  onOpenGuideDetail?: (id: string) => void;
  onOpenGame: (game: GameData, topic: string) => void;
  /** Sends the user to Generate (empty-state button). */
  onGenerate?: () => void;
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

  // --- Courses -----------------------------------------------------------
  const [knownCourses, setKnownCourses] = useState<string[]>([]);
  const [filterCourse, setFilterCourse] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newCourseName, setNewCourseName] = useState("");
  const [courseMenuFor, setCourseMenuFor] = useState<string | null>(null);
  const [courseMenuNew, setCourseMenuNew] = useState(false);
  const [courseMenuNewName, setCourseMenuNewName] = useState("");
  const [renamingCourse, setRenamingCourse] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [confirmDeleteCourse, setConfirmDeleteCourse] = useState<string | null>(null);

  /** Every course the user has: named on a guide, or created and waiting
   *  for its first guide. Sorted A–Z, first-seen casing kept. */
  const allCourses: string[] = (() => {
    const seen = new Map<string, string>();
    for (const name of [...knownCourses, ...distinctCourses(guides)]) {
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, name);
    }
    return [...seen.values()].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  })();

  /** Canonical casing for a course name: reuse the existing course when
   *  one differs only by case, so "Biology" and "biology" never split. */
  function canonicalCourseName(name: string): string {
    const clean = normalizeCourseName(name);
    if (!clean) return clean;
    return (
      allCourses.find((c) => c.toLowerCase() === clean.toLowerCase()) ?? clean
    );
  }

  const query = search.trim().toLowerCase();
  const visibleGuides = guides.filter((row) => {
    if (filterCourse && courseOf(row) !== filterCourse) return false;
    if (!query) return true;
    return `${titleOf(row)} ${row.topic}`.toLowerCase().includes(query);
  });

  /** Guides grouped by course (courses A–Z, Uncategorized last). Empty
   *  known courses stay visible so a new course can receive its first
   *  guide; while searching, only groups with matches show. */
  const visibleGroups: {
    key: string;
    name: string | null;
    rows: StudyGuideRow[];
  }[] = (() => {
    const groups: {
      key: string;
      name: string | null;
      rows: StudyGuideRow[];
    }[] = [];
    for (const name of allCourses) {
      if (filterCourse && filterCourse !== name) continue;
      groups.push({
        key: name,
        name,
        rows: visibleGuides.filter((r) => courseOf(r) === name),
      });
    }
    if (!filterCourse) {
      groups.push({
        key: UNCATEGORIZED,
        name: null,
        rows: visibleGuides.filter((r) => !courseOf(r)),
      });
    }
    return groups.filter((g) => {
      if (g.rows.length > 0) return true;
      if (query) return false;
      if (filterCourse) return g.key === filterCourse;
      return g.name !== null;
    });
  })();

  function isGroupCollapsed(key: string): boolean {
    if (query) return false;
    return Boolean(collapsed[key]);
  }

  function toggleGroup(key: string): void {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function assignCourse(
    row: StudyGuideRow,
    courseName: string | null
  ): Promise<void> {
    const finalName = courseName ? canonicalCourseName(courseName) : null;
    const res = await setGuideCourse(row.id, finalName);
    if (res.needsMigration) {
      setNotice(
        "Courses need a small database update that hasn't been applied yet — your guides are safe and stay under Uncategorized until then."
      );
      return;
    }
    if (!res.ok) {
      setNotice("Could not change the course. Try again.");
      return;
    }
    if (finalName && user) setKnownCourses(addKnownCourse(user.id, finalName));
    setCourseMenuFor(null);
    setCourseMenuNew(false);
    setCourseMenuNewName("");
    refresh();
  }

  function createCourse(): void {
    if (!user) return;
    const finalName = canonicalCourseName(newCourseName);
    if (!finalName) return;
    setKnownCourses(addKnownCourse(user.id, finalName));
    setNewCourseName("");
    setFilterCourse(finalName);
    setNotice(
      `Course "${finalName}" created — move guides into it from each guide's Course menu.`
    );
  }

  async function doRenameCourse(oldName: string): Promise<void> {
    if (!user) return;
    const finalName = canonicalCourseName(renameDraft);
    if (!finalName || finalName.toLowerCase() === oldName.toLowerCase()) {
      setRenamingCourse(null);
      return;
    }
    const res = await renameCourseGuides(user.id, oldName, finalName);
    if (res.needsMigration) {
      // No course column live yet, so the name only exists in this
      // browser — rename it there.
      setKnownCourses(renameKnownCourse(user.id, oldName, finalName));
    } else if (!res.ok) {
      setNotice("Could not rename that course. Try again.");
      return;
    } else {
      setKnownCourses(renameKnownCourse(user.id, oldName, finalName));
    }
    setRenamingCourse(null);
    if (filterCourse === oldName) setFilterCourse(finalName);
    refresh();
  }

  async function doDeleteCourse(name: string): Promise<void> {
    if (!user) return;
    const res = await clearCourseGuides(user.id, name);
    if (res.needsMigration) {
      // No course column live yet, so the name only exists in this
      // browser — drop it there. No guides can be in the course.
      setKnownCourses(removeKnownCourse(user.id, name));
    } else if (!res.ok) {
      setNotice("Could not delete that course. Try again.");
      return;
    } else {
      setKnownCourses(removeKnownCourse(user.id, name));
      setNotice(
        `Course "${name}" deleted — its guides moved to Uncategorized.`
      );
    }
    setConfirmDeleteCourse(null);
    if (filterCourse === name) setFilterCourse(null);
    refresh();
  }

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
    setKnownCourses(user ? loadKnownCourses(user.id) : []);
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
          <div className="mt-4">
            <EmptyState
              icon={<BookOpen className="h-6 w-6" />}
              headline="Your study guides will live here"
              outcome="Generate a study guide or a Battle Arena game and it is saved here automatically — open it anytime, publish it, or send it to a friend."
              buttonLabel="Generate your first guide"
              onAction={() => onGenerate?.()}
            />
          </div>
        )}
        {/* Organize by course: create, search, filter */}
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newCourseName}
              onChange={(e) => setNewCourseName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") createCourse();
              }}
              placeholder="New course name"
              aria-label="New course name"
              className="input max-w-xs"
            />
            <button
              type="button"
              onClick={createCourse}
              disabled={!normalizeCourseName(newCourseName)}
              className="btn-secondary px-3 py-1.5 text-sm"
            >
              <Plus className="h-4 w-4" /> New course
            </button>
          </div>
          <p className="text-xs leading-relaxed text-ink-400">
            Courses are labels you create — type a name to make one, then
            move guides into it from each guide&apos;s Course menu. Deleting
            a course never deletes its guides.
          </p>
          {guides.length > 0 && (
            <>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search your guides…"
                  aria-label="Search your guides"
                  className="input pl-9"
                />
              </div>
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label="Filter by course"
              >
                <button
                  type="button"
                  onClick={() => setFilterCourse(null)}
                  className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                  style={
                    filterCourse === null
                      ? { backgroundColor: "#4f46e5", color: "#ffffff" }
                      : { backgroundColor: "#ffffff", color: "#475569" }
                  }
                >
                  All ({guides.length})
                </button>
                {allCourses.map((c) => {
                  const col = courseColor(c);
                  const count = guides.filter(
                    (g) => courseOf(g) === c
                  ).length;
                  const active = filterCourse === c;
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setFilterCourse(active ? null : c)
                      }
                      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold"
                      style={
                        active
                          ? { backgroundColor: "#4f46e5", color: "#ffffff" }
                          : { backgroundColor: "#ffffff", color: "#475569" }
                      }
                    >
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: active ? "#ffffff" : col.dot,
                        }}
                      />
                      {c} ({count})
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
        {guides.length > 0 && visibleGroups.length === 0 && (
          <p className="mt-4 text-sm text-ink-500">
            No guides match that search or filter.{" "}
            <button
              type="button"
              onClick={() => {
                setSearch("");
                setFilterCourse(null);
              }}
              className="font-bold text-brand-600 underline"
            >
              Show everything
            </button>
          </p>
        )}
        <div className="mt-4 space-y-5">
          {visibleGroups.map((group) => (
            <section key={group.key} aria-label={group.name ?? UNCATEGORIZED}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex min-w-0 items-center gap-2 text-left font-extrabold tracking-tight text-ink-900"
                  aria-expanded={!isGroupCollapsed(group.key)}
                >
                  {isGroupCollapsed(group.key) ? (
                    <ChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-ink-400" />
                  )}
                  <span
                    className="h-3 w-3 shrink-0 rounded-full"
                    style={{
                      backgroundColor: courseColor(group.name).dot,
                    }}
                  />
                  <span className="truncate">{group.name ?? UNCATEGORIZED}</span>
                  <span className="text-xs font-medium text-ink-400">
                    ({group.rows.length})
                  </span>
                </button>
                {group.name !== null && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {renamingCourse === group.name ? (
                      <>
                        <input
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              doRenameCourse(group.name as string);
                            if (e.key === "Escape") setRenamingCourse(null);
                          }}
                          aria-label="New course name"
                          className="input max-w-44 py-1 text-sm"
                          autoFocus
                        />
                        <button
                          type="button"
                          onClick={() =>
                            doRenameCourse(group.name as string)
                          }
                          className="btn-primary px-2 py-1 text-xs"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={() => setRenamingCourse(null)}
                          className="btn-ghost px-2 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </>
                    ) : confirmDeleteCourse === group.name ? (
                      <>
                        <span className="text-xs font-semibold text-rose-700">
                          Delete this course? Its guides move to
                          Uncategorized.
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            doDeleteCourse(group.name as string)
                          }
                          className="rounded-xl px-2 py-1 text-xs font-bold text-white"
                          style={{ backgroundColor: "#dc2626" }}
                        >
                          Yes, delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteCourse(null)}
                          className="btn-ghost px-2 py-1 text-xs"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingCourse(group.name as string);
                            setRenameDraft(group.name as string);
                          }}
                          className="btn-ghost px-2 py-1 text-xs"
                        >
                          <Pencil className="h-3.5 w-3.5" /> Rename
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmDeleteCourse(group.name as string)
                          }
                          className="btn-ghost px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Delete
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {!isGroupCollapsed(group.key) && (
                <div className="mt-3 space-y-3">
                  {group.rows.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-ink-100 bg-white/70 p-4 text-sm text-ink-500">
                      No guides in this course yet — move a guide here from
                      its Course menu.
                    </p>
                  ) : (
                    group.rows.map((row) => (
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
                    <CourseChip course={courseOf(row)} />
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
                {row.kind !== "game" && (
                  <Link
                    href={`/guide/${row.id}?bot=1`}
                    className="btn-secondary px-3 py-1.5 text-sm"
                    title="Builder Bot: ask for changes to this guide in plain words"
                  >
                    <Wrench className="h-4 w-4" /> Builder Bot
                  </Link>
                )}
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
                  onClick={() => {
                    setCourseMenuFor(
                      courseMenuFor === row.id ? null : row.id
                    );
                    setCourseMenuNew(false);
                    setCourseMenuNewName("");
                  }}
                  className="btn-secondary px-3 py-1.5 text-sm"
                  aria-expanded={courseMenuFor === row.id}
                >
                  <Folder className="h-4 w-4" /> Course
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
              {courseMenuFor === row.id && (
                <div className="mt-3 rounded-xl bg-brand-50/70 p-3 ring-1 ring-inset ring-brand-100">
                  <p className="text-sm font-bold text-ink-900">
                    Move to a course
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <select
                      value={courseOf(row) ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === "__new__") {
                          setCourseMenuNew(true);
                          return;
                        }
                        assignCourse(row, v === "" ? null : v);
                      }}
                      className="input max-w-xs"
                      aria-label="Move this guide to a course"
                    >
                      <option value="">Uncategorized</option>
                      {allCourses.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                      <option value="__new__">＋ New course…</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        setCourseMenuFor(null);
                        setCourseMenuNew(false);
                        setCourseMenuNewName("");
                      }}
                      className="btn-ghost"
                    >
                      Cancel
                    </button>
                  </div>
                  {courseMenuNew && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <input
                        value={courseMenuNewName}
                        onChange={(e) => setCourseMenuNewName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const clean =
                              normalizeCourseName(courseMenuNewName);
                            if (clean) assignCourse(row, clean);
                          }
                        }}
                        placeholder="New course name"
                        aria-label="New course name"
                        className="input max-w-xs"
                        autoFocus
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const clean =
                            normalizeCourseName(courseMenuNewName);
                          if (clean) assignCourse(row, clean);
                        }}
                        disabled={!normalizeCourseName(courseMenuNewName)}
                        className="btn-primary px-3 py-1.5 text-sm"
                      >
                        <Plus className="h-4 w-4" /> Create &amp; move
                      </button>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-ink-400">
                    Courses are just labels — moving a guide never changes
                    its content.
                  </p>
                </div>
              )}
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
          )))}
        </div>
      )}
    </section>
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
                  <CourseChip course={courseOf(row)} />
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
