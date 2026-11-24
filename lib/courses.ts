/**
 * Courses for "Your Study Guides" — user-created labels (e.g. a school
 * course) that group saved guides. There is no premade course list:
 * a course only exists because a user typed its name, either when
 * creating it in the guides section or when assigning a guide to it.
 *
 * Storage: the course assigned to a guide lives on the study_guides
 * row in Supabase (column `course`, migration 0006). The list of
 * course names the user has created is derived from their guides,
 * plus names kept in this browser's localStorage so a course with no
 * guides yet still shows up. localStorage is only a convenience —
 * Supabase is the source of truth for which course a guide is in.
 */

/** Label shown for guides with no course assigned. */
export const UNCATEGORIZED = "Uncategorized";

/** Maximum length of a course name (longer names are trimmed). */
export const MAX_COURSE_NAME_LENGTH = 60;

/** Small palette of accent colors, assigned to courses automatically
 *  (styling only — never content). Each entry has a strong color for
 *  the dot and a soft background for the chip. */
export const COURSE_COLORS = [
  { dot: "#4f46e5", soft: "#eef2ff", text: "#3730a3" }, // indigo
  { dot: "#059669", soft: "#ecfdf5", text: "#065f46" }, // emerald
  { dot: "#d97706", soft: "#fffbeb", text: "#92400e" }, // amber
  { dot: "#db2777", soft: "#fdf2f8", text: "#9d174d" }, // pink
  { dot: "#0891b2", soft: "#ecfeff", text: "#155e75" }, // cyan
  { dot: "#7c3aed", soft: "#f5f3ff", text: "#5b21b6" }, // violet
  { dot: "#dc2626", soft: "#fef2f2", text: "#991b1b" }, // red
  { dot: "#65a30d", soft: "#f7fee7", text: "#3f6212" }, // lime
] as const;

export type CourseColor = {
  dot: string;
  soft: string;
  text: string;
};

/** Clean up a typed course name: trim, collapse inner whitespace, cap
 *  length. Returns "" when nothing usable remains. */
export function normalizeCourseName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ").slice(0, MAX_COURSE_NAME_LENGTH);
}

/** Deterministic color for a course name, so the same course always
 *  gets the same accent. Uncategorized gets a neutral gray. */
export function courseColor(name: string | null | undefined): CourseColor {
  if (!name) {
    return { dot: "#6b7280", soft: "#f3f4f6", text: "#374151" };
  }
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return COURSE_COLORS[hash % COURSE_COLORS.length];
}

/** The course label stored on a guide row, or null for Uncategorized. */
export function courseOf(
  row: { course?: string | null } | null | undefined
): string | null {
  const raw = row?.course?.trim();
  return raw ? raw : null;
}

/** Distinct course names across a set of guide rows, sorted A–Z
 *  (case-insensitive), keeping the first-seen casing of each name. */
export function distinctCourses(
  rows: Array<{ course?: string | null }>
): string[] {
  const seen = new Map<string, string>();
  for (const row of rows) {
    const name = courseOf(row);
    if (!name) continue;
    const key = name.toLowerCase();
    if (!seen.has(key)) seen.set(key, name);
  }
  return [...seen.values()].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );
}

// ---------------------------------------------------------------------------
// Known courses in this browser (localStorage convenience only).
// A course the user created but has not assigned any guide to yet
// still shows up as an empty group. Supabase remains the source of
// truth for guide assignments.
// ---------------------------------------------------------------------------

function knownCoursesKey(userId: string): string {
  return `studysmart-courses:${userId}`;
}

export function loadKnownCourses(userId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(knownCoursesKey(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const names = parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => normalizeCourseName(v))
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase())
    );
  } catch {
    return [];
  }
}

function storeKnownCourses(userId: string, names: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      knownCoursesKey(userId),
      JSON.stringify(names)
    );
  } catch {
    // Storage full or unavailable — the Supabase assignments still work.
  }
}

export function addKnownCourse(userId: string, name: string): string[] {
  const clean = normalizeCourseName(name);
  if (!clean) return loadKnownCourses(userId);
  const names = loadKnownCourses(userId);
  if (!names.some((n) => n.toLowerCase() === clean.toLowerCase())) {
    names.push(clean);
    names.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
    storeKnownCourses(userId, names);
  }
  return names;
}

export function removeKnownCourse(userId: string, name: string): string[] {
  const names = loadKnownCourses(userId).filter(
    (n) => n.toLowerCase() !== name.toLowerCase()
  );
  storeKnownCourses(userId, names);
  return names;
}

export function renameKnownCourse(
  userId: string,
  oldName: string,
  newName: string
): string[] {
  const clean = normalizeCourseName(newName);
  if (!clean) return loadKnownCourses(userId);
  const names = loadKnownCourses(userId).map((n) =>
    n.toLowerCase() === oldName.toLowerCase() ? clean : n
  );
  const deduped = [...new Set(names)];
  deduped.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  storeKnownCourses(userId, deduped);
  return deduped;
}
