// Friend finding + sharing helpers — finding people and sending guides
// should be one tap, never a hunt for an exact username.
//
// Privacy: profiles carry NO email address (the profiles table has none),
// so every helper here can only ever surface a username + display name.
// Nothing here auto-adds anyone — sending a request still needs the other
// person to accept.

import { getSupabase, type Profile } from "@/lib/supabase";

const SAFE_PROFILE_COLUMNS = "user_id, username, display_name, created_at";

/** Escape LIKE wildcards so a search term is matched literally. */
function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

/**
 * Partial, case-insensitive username search (prefix or substring).
 * Returns at most `limit` profiles, excluding `excludeIds` (yourself,
 * people you are already friends with, people with a pending request).
 * Needs at least 2 characters — a 1-letter search would match everyone.
 */
export async function searchProfilesByUsername(
  query: string,
  excludeIds: string[] = [],
  limit = 8
): Promise<Profile[]> {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from("profiles")
    .select(SAFE_PROFILE_COLUMNS)
    .ilike("username", `%${escapeLike(q)}%`)
    .order("username", { ascending: true })
    .limit(limit + excludeIds.length);
  if (error) {
    console.error("[friends] username search failed:", error.message);
    return [];
  }
  const excluded = new Set(excludeIds);
  return ((data as Profile[]) ?? [])
    .filter((p) => !excluded.has(p.user_id))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Recently opened authors (local only — no table, no server call).
// When you open someone's published guide in Browse, their author id is
// remembered here so Friends can suggest "people whose guides you opened".
// Only user ids are stored — no names, no emails.
// ---------------------------------------------------------------------------

const OPENED_AUTHORS_KEY = "studysmart-opened-authors";
const MAX_OPENED_AUTHORS = 10;

export function recordOpenedAuthor(authorId: string): void {
  try {
    if (typeof window === "undefined" || !authorId) return;
    const prev = loadOpenedAuthorIds().filter((id) => id !== authorId);
    const next = [authorId, ...prev].slice(0, MAX_OPENED_AUTHORS);
    window.localStorage.setItem(OPENED_AUTHORS_KEY, JSON.stringify(next));
  } catch {
    // localStorage unavailable — suggestions just lose this signal.
  }
}

export function loadOpenedAuthorIds(): string[] {
  try {
    if (typeof window === "undefined") return [];
    const raw = window.localStorage.getItem(OPENED_AUTHORS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

/** Avatar initials from a display name ("Ada Lovelace" -> "AL"). */
export function initialsFor(displayName: string | null | undefined): string {
  const parts = (displayName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
