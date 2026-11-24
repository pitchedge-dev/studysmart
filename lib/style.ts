/**
 * Site styles (themes): 5 complete looks for the whole site.
 *
 * A style is a `data-style` attribute on <html> (see app/layout.tsx, which
 * applies the saved style before first paint so there is no flash).
 * Palettes live as CSS variables in app/globals.css; Tailwind's brand /
 * accent / ink scales are wired to those variables in tailwind.config.js,
 * so every existing class (bg-brand-600, text-accent-500, border-ink-200
 * ...) follows the active style automatically — in light AND dark mode.
 *
 * The choice persists in localStorage (key below). When signed in, it is
 * also synced best-effort to the user's Supabase profile (style column,
 * migration 0005) so the style follows them across devices — the sync
 * never blocks and never fails the page if it errors or the column is
 * not applied live yet.
 */

import { getSupabase } from "@/lib/supabase";

export const STYLE_KEY = "studysmart-style";

export type StyleId = "indigo" | "midnight" | "forest" | "sunset" | "ocean";

export type SiteStyle = {
  id: StyleId;
  name: string;
  tagline: string;
  /** Swatch colors shown in the picker (hex). */
  swatches: [string, string, string, string];
  /** Meta theme-color used for the browser chrome. */
  themeColor: string;
};

export const STYLES: SiteStyle[] = [
  {
    id: "indigo",
    name: "Indigo Classic",
    tagline: "The original — calm indigo with warm amber.",
    swatches: ["#4f46e5", "#f59e0b", "#f6f6fb", "#17152b"],
    themeColor: "#4f46e5",
  },
  {
    id: "midnight",
    name: "Midnight",
    tagline: "Dark-first violet and cyan glow for late-night study.",
    swatches: ["#7c3aed", "#22d3ee", "#050510", "#a78bfa"],
    themeColor: "#7c3aed",
  },
  {
    id: "forest",
    name: "Forest",
    tagline: "Deep greens and warm cream — calm and focused.",
    swatches: ["#16a34a", "#d97706", "#f3f6ef", "#14532d"],
    themeColor: "#16a34a",
  },
  {
    id: "sunset",
    name: "Sunset",
    tagline: "Warm corals, oranges and deep plum — bold and energetic.",
    swatches: ["#ea580c", "#c026d3", "#fff6f1", "#7c2d12"],
    themeColor: "#ea580c",
  },
  {
    id: "ocean",
    name: "Ocean",
    tagline: "Teal, deep blue and sand — clean and fresh.",
    swatches: ["#0d9488", "#2563eb", "#eff7f7", "#134e4a"],
    themeColor: "#0d9488",
  },
];

export const DEFAULT_STYLE: StyleId = "indigo";

export function isStyleId(value: unknown): value is StyleId {
  return (
    typeof value === "string" &&
    (STYLES as { id: string }[]).some((s) => s.id === value)
  );
}

export function getStyle(): StyleId {
  try {
    const saved = window.localStorage.getItem(STYLE_KEY);
    return isStyleId(saved) ? saved : DEFAULT_STYLE;
  } catch {
    return DEFAULT_STYLE;
  }
}

/** Apply a style instantly (no reload): sets data-style on <html>, persists,
 *  updates the browser chrome color, and syncs to the profile in the
 *  background when signed in. Returns the applied id. */
export function applyStyle(id: StyleId, userId?: string | null): StyleId {
  const next = isStyleId(id) ? id : DEFAULT_STYLE;
  try {
    window.localStorage.setItem(STYLE_KEY, next);
  } catch {
    // Storage unavailable — the style just won't persist.
  }
  document.documentElement.dataset.style = next;
  const meta = document.querySelector('meta[name="theme-color"]');
  const style = STYLES.find((s) => s.id === next);
  if (meta && style) meta.setAttribute("content", style.themeColor);
  if (userId) void saveStyleToProfile(userId, next);
  return next;
}

/** Best-effort: save the style to the user's profile. Never throws. */
export async function saveStyleToProfile(
  userId: string,
  style: StyleId
): Promise<void> {
  try {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from("profiles").update({ style }).eq("user_id", userId);
  } catch {
    // Sync is a bonus — a missing column or network error must not
    // surface to the user. localStorage already holds the choice.
  }
}

/** Best-effort: read the style from the user's profile. Null on any miss. */
export async function loadStyleFromProfile(
  userId: string
): Promise<StyleId | null> {
  try {
    const sb = getSupabase();
    if (!sb) return null;
    const { data } = await sb
      .from("profiles")
      .select("style")
      .eq("user_id", userId)
      .maybeSingle();
    const value = (data as { style?: unknown } | null)?.style;
    return isStyleId(value) ? value : null;
  } catch {
    return null;
  }
}
