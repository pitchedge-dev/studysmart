/**
 * "How long will you study?" — the Generate form asks this, and the
 * answer scales how deep the generated guide is. Nothing is pre-selected
 * in the form: no choice means standard depth.
 *
 * The values are plain strings, the same pattern as education level and
 * test timing, so they travel through the /api/generate request body and
 * are stored on the saved guide (inside the guide JSON) unchanged.
 */

/** The choices offered in the Generate form, in order. */
export const STUDY_HOURS_OPTIONS = [
  "30 minutes",
  "1 hour",
  "2 hours",
  "3 hours",
  "4+ hours",
  "No set time",
] as const;

export type StudyHours = (typeof STUDY_HOURS_OPTIONS)[number];

/** True only for the real durations — "No set time" is not a duration. */
export function isRealStudyHours(value: string | undefined): boolean {
  return (
    value === "30 minutes" ||
    value === "1 hour" ||
    value === "2 hours" ||
    value === "3 hours" ||
    value === "4+ hours"
  );
}

export function isValidStudyHours(value: string | undefined): boolean {
  return (
    typeof value === "string" &&
    (STUDY_HOURS_OPTIONS as readonly string[]).includes(value)
  );
}

/** Total minutes for a real duration, or null for "No set time". */
export function studyHoursMinutes(value: string | undefined): number | null {
  switch (value) {
    case "30 minutes":
      return 30;
    case "1 hour":
      return 60;
    case "2 hours":
      return 120;
    case "3 hours":
      return 180;
    case "4+ hours":
      return 240;
    default:
      return null;
  }
}

/** Short label for display, e.g. "2-hour session". Null when no real
 *  duration was chosen, so nothing is shown for "No set time". */
export function studyHoursLabel(value: string | undefined): string | null {
  switch (value) {
    case "30 minutes":
      return "30-minute session";
    case "1 hour":
      return "1-hour session";
    case "2 hours":
      return "2-hour session";
    case "3 hours":
      return "3-hour session";
    case "4+ hours":
      return "4+ hour session";
    default:
      return null;
  }
}

/**
 * Depth guidance for the /api/generate prompt. Short sessions get a
 * tight but COMPLETE guide (never a stub — the material is still fully
 * covered, just concisely); long sessions get the full depth. No choice
 * (or "No set time") means standard depth, exactly as before.
 *
 * Every duration states a FLOOR as well as a ceiling ("at least N
 * modules with at least M concepts each"). The old text said only
 * "up to 6 modules with up to 6 concepts each", and the model read
 * that as permission to stop at 1 module with 2 concepts — two live
 * guides in a row came back that thin (2026-11-26), one for a
 * 2-hour session. A floor tied to the session length keeps short
 * guides tight without letting a long session come back as a stub.
 */
export function studyTimeGuidance(value: string | undefined): string {
  switch (value) {
    case "30 minutes":
      return "The student will study for 30 minutes: keep this guide tight — at least 1 module with at least 2 concepts, at most 2 modules with at most 3 concepts each, one practice problem per concept, explanations of one or two sentences. It must still be a COMPLETE guide covering the material — just concise, with the most important points first.";
    case "1 hour":
      return "The student will study for 1 hour: keep this guide focused — at least 2 modules with at least 2 concepts each, at most 3 modules with at most 4 concepts each, one or two practice problems per concept, and concise explanations. It must still be a COMPLETE guide covering the material.";
    case "2 hours":
      return "The student will study for 2 hours: give a standard-depth guide — at least 3 modules with at least 3 concepts each (9 or more concepts in total), up to 6 modules with up to 6 concepts each, two practice problems per concept, and full explanations.";
    case "3 hours":
      return "The student will study for 3 hours: go deep — at least 4 modules with at least 3 concepts each, up to 6 modules with up to 6 concepts each, two practice problems per concept, extra worked examples, and full explanations.";
    case "4+ hours":
      return "The student will study for 4 or more hours: go as deep as the material supports — at least 4 modules with at least 3 concepts each, up to 6 modules with up to 6 concepts each, extra worked examples, and full practice (two problems per concept). This is the fullest version of the guide.";
    default:
      return "";
  }
}

/** Minimum modules for the thin-guide repair pass, so a short-session
 *  guide is not "repaired" into a long one. */
export function repairMinModules(value: string | undefined): number {
  if (value === "30 minutes") return 1;
  if (value === "1 hour") return 2;
  return 3;
}

/**
 * Depth floor for the self-check in /api/generate (see missingParts):
 * the fewest modules and concepts a guide for this study time may
 * have before it counts as thin and gets one repair attempt. The
 * concept floor is at least 3 even for a 30-minute session — a guide
 * with 1–2 concepts is a stub at any length.
 */
export function depthFloor(value: string | undefined): {
  minModules: number;
  minConcepts: number;
} {
  const minModules = repairMinModules(value);
  return { minModules, minConcepts: Math.max(3, minModules * 2) };
}
