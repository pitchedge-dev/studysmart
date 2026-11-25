/**
 * Guide → Battle Arena export ("Turn into Battle Arena").
 *
 * A saved study guide carries everything a game needs — its topic,
 * modules, concepts, key facts, and the options it was made with
 * (education level, test timing, study time). This module turns a guide
 * into an `ArenaExportSource`: the exact material the Arena builds its
 * game templates from. Nothing is invented: the content is the guide's
 * own words, and the options are the ones stored on the guide (or
 * nothing, when the guide was made without them).
 *
 * Two ways the source reaches the Arena:
 * 1. Direct handoff — Your Study Guides calls the existing `onOpenGame`
 *    callback with a GameData-shaped marker whose `exportSource` field
 *    carries the source. BattleArena sees the marker, skips loading it
 *    as a playable game, and builds templates from the guide instead.
 *    One tap, no new plumbing, no page changes.
 * 2. Pending export — the standalone guide page (/guide/[id]) has no
 *    `onOpenGame` callback, so it stores the source in localStorage and
 *    the Arena picks it up (and consumes it) the next time it mounts.
 *    A pending export is used once and then deleted.
 */

import type { GenerateResult } from "@/app/page";
import type { StudyGuideRow } from "./supabase";

/** Everything the Arena needs to build a game from a guide. */
export type ArenaExportSource = {
  /** Game topic — the guide's title. */
  topic: string;
  /** The guide's real content: Markdown + modules + concepts + key
   *  facts, as plain text for the game generator. */
  content: string;
  /** Options the guide was made with, when known. */
  educationLevel?: string;
  testTiming?: string;
  studyHours?: string;
  topicType?: string;
  /** The saved guide's row id, when the source came from a saved guide. */
  guideId?: string;
};

/** The game generator gets a bounded chunk — a very long guide is
 *  trimmed to its first 12,000 characters (title + Markdown first, so
 *  the core material always survives). */
const MAX_EXPORT_CHARS = 12000;

/** The guide's own words, flattened to plain text for the generator. */
function contentFromResult(result: GenerateResult): string {
  const parts: string[] = [];
  if (result.guideTitle) parts.push(`# ${result.guideTitle}`);
  if (result.studyGuide) parts.push(result.studyGuide);
  for (const m of result.modules ?? []) {
    parts.push(`Module ${m.moduleNumber}: ${m.title}`);
    if (m.intro) parts.push(m.intro);
    for (const idea of m.coreIdeas ?? []) parts.push(`- ${idea}`);
    for (const c of m.concepts) {
      parts.push(
        `${c.title}: ${c.formulaOrDefinition}. Example: ${c.example}`
      );
      if (c.explanation) parts.push(`  ${c.explanation}`);
      if (c.commonMistake) parts.push(`  Common mistake: ${c.commonMistake}`);
    }
  }
  if (result.keyConcepts.length > 0) {
    parts.push(`Key concepts: ${result.keyConcepts.join("; ")}`);
  }
  for (const f of result.faq ?? []) {
    parts.push(`Q: ${f.question}\nA: ${f.answer}`);
  }
  return parts.join("\n");
}

export function buildArenaExportSourceFromResult(
  result: GenerateResult,
  meta?: { educationLevel?: string; testTiming?: string },
  guideId?: string,
  topicFallback?: string
): ArenaExportSource {
  const guide = result as unknown as Record<string, unknown>;
  return {
    topic: result.guideTitle || topicFallback || "Study guide",
    content: contentFromResult(result).slice(0, MAX_EXPORT_CHARS),
    educationLevel: meta?.educationLevel || undefined,
    testTiming: meta?.testTiming || undefined,
    studyHours: (guide.studyHours as string | undefined) || undefined,
    topicType: result.topicType || undefined,
    guideId,
  };
}

export function buildArenaExportSourceFromRow(
  row: StudyGuideRow
): ArenaExportSource {
  const guide = row.guide as unknown as GenerateResult;
  return buildArenaExportSourceFromResult(
    guide,
    {
      educationLevel: row.education_level ?? undefined,
      testTiming: row.test_timing ?? undefined,
    },
    row.id,
    row.topic
  );
}

/**
 * Study time → suggested game length, the same mapping the Arena form
 * uses when a study time is picked: a 30-minute session gets a Quick
 * game, 2 hours the Standard game, 3+ hours the Marathon. Null means
 * "no set time" — the length stays exactly as the user left it.
 */
export function lengthForStudyHours(
  studyHours?: string
): 10 | 20 | 30 | null {
  switch (studyHours) {
    case "30 minutes":
      return 10;
    case "1 hour":
      return 10;
    case "2 hours":
      return 20;
    case "3 hours":
      return 30;
    case "4+ hours":
      return 30;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Pending export (localStorage bridge for the standalone guide page).
// ---------------------------------------------------------------------------

const PENDING_KEY = "studysmart-arena-export";

export function writePendingArenaExport(source: ArenaExportSource): void {
  try {
    window.localStorage.setItem(
      PENDING_KEY,
      JSON.stringify({ ...source, savedAt: Date.now() })
    );
  } catch {
    // Storage unavailable — the export just won't be waiting in the Arena.
  }
}

/** Read the pending export and delete it — a pending export is used once. */
export function readPendingArenaExport(): ArenaExportSource | null {
  try {
    const raw = window.localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    window.localStorage.removeItem(PENDING_KEY);
    const parsed = JSON.parse(raw) as Partial<ArenaExportSource>;
    if (
      typeof parsed.topic !== "string" ||
      typeof parsed.content !== "string" ||
      !parsed.content.trim()
    ) {
      return null;
    }
    return {
      topic: parsed.topic,
      content: parsed.content,
      educationLevel:
        typeof parsed.educationLevel === "string"
          ? parsed.educationLevel
          : undefined,
      testTiming:
        typeof parsed.testTiming === "string" ? parsed.testTiming : undefined,
      studyHours:
        typeof parsed.studyHours === "string" ? parsed.studyHours : undefined,
      topicType:
        typeof parsed.topicType === "string" ? parsed.topicType : undefined,
      guideId:
        typeof parsed.guideId === "string" ? parsed.guideId : undefined,
    };
  } catch {
    return null;
  }
}
