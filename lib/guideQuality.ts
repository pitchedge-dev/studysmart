import type { GuideJson } from "./guideSchema";

/**
 * Guide-quality guardrails (no AI, no network — pure string checks).
 *
 * Why this file exists: on 2026-11-25 a fresh "Ocean tides" guide came
 * back with three quality failures the prompt alone did not prevent —
 * no step-by-step worked example, MCQ explanations that covered only
 * the correct answer, and a cheat sheet containing the model's own
 * refusal text ("Your note content is missing...") plus blank
 * objectives / real-life items. Two layers fix that:
 *
 *  1. `sanitizeGuide` — runs on EVERY generated guide before it is
 *     returned. It strips model refusal / error / placeholder text
 *     wherever it can appear, drops blank list items (a section with
 *     no real content is omitted, never rendered blank), drops broken
 *     questions (empty, too few options, correct answer not among the
 *     options), and removes exact-duplicate sentences across the
 *     summary and the study-guide Markdown.
 *  2. `qualityIssues` — the repair trigger. It names what is still
 *     wrong after sanitizing (no worked example, distractor
 *     explanations missing), so /api/generate can repair-regenerate
 *     once with a prompt naming exactly those problems.
 *
 * Nothing here invents content: it only removes what is broken, blank,
 * or repeated. A guide that comes back clean is returned untouched.
 */

/** Phrases a model writes when it thinks it has nothing to work from,
 *  or when it refuses — these must never reach a student as guide
 *  content. Kept narrow and anchored to refusal phrasing so real
 *  content (for example a concept about "missing data") is not
 *  caught: every pattern requires the model talking about itself,
 *  about notes/content being absent, or about being unable to do the
 *  job. */
const REFUSAL_PATTERNS: RegExp[] = [
  /your note content is missing/i,
  /note content is missing/i,
  /i (can't|cannot|am unable to) generate/i,
  /unable to generate/i,
  /without actual information/i,
  /without (any )?(notes?|information|content|material)/i,
  /no (notes?|information|content|material) (was|were|has been) provided/i,
  /i (don't|do not) have (enough|any) (information|notes?|content|material)/i,
  /as an ai( language model)?/i,
  /i'?m sorry,? i (can't|cannot|don'?t)/i,
  /content is missing/i,
  /information is missing/i,
  /cannot (create|provide|generate) .{0,40} without/i,
];

/** True when the text is (or contains) model refusal / error filler. */
export function containsRefusal(text: string): boolean {
  return REFUSAL_PATTERNS.some((re) => re.test(text));
}

/** Split text into sentences/lines and drop any that are refusal or
 *  placeholder filler. Returns the cleaned text (empty string when
 *  nothing real is left). */
function stripRefusalSentences(text: string): string {
  const lines = text.split(/\n/);
  const kept: string[] = [];
  for (const line of lines) {
    // A line can hold several sentences; drop only the refusal ones.
    const sentences = line.split(/(?<=[.!?])\s+/);
    const good = sentences.filter((s) => {
      const t = s.trim();
      if (!t) return false;
      return !containsRefusal(t);
    });
    if (good.length > 0) kept.push(good.join(" "));
  }
  return kept.join("\n").trim();
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!?]+$/, "");
}

/** Clean a list of short strings: trim, drop blanks, drop refusals. */
export function cleanStringList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    if (containsRefusal(t)) continue;
    out.push(t);
  }
  return out;
}

type WhyWrongLike = { option?: unknown; reason?: unknown };
type McqLike = {
  question?: unknown;
  options?: unknown;
  correctAnswer?: unknown;
  explanation?: unknown;
  whyWrong?: unknown;
};

/** A question is usable only if it has a real question, 3–4 options,
 *  and a correct answer that matches one of them. Anything else is
 *  dropped — an unscorable question is worse than no question. */
function isUsableMcq(q: McqLike): boolean {
  if (typeof q.question !== "string" || !q.question.trim()) return false;
  if (!Array.isArray(q.options) || q.options.length < 3) return false;
  if (q.options.some((o) => typeof o !== "string" || !o.trim())) return false;
  if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim())
    return false;
  return q.options.some((o) => o === q.correctAnswer);
}

function cleanMcq<T extends McqLike>(q: T): T | null {
  if (!isUsableMcq(q)) return null;
  const out: Record<string, unknown> = { ...q };
  if (typeof q.explanation === "string") {
    const cleaned = stripRefusalSentences(q.explanation);
    if (!cleaned) return null;
    out.explanation = cleaned;
  }
  if (Array.isArray(q.whyWrong)) {
    const kept = (q.whyWrong as WhyWrongLike[]).filter(
      (w): w is { option: string; reason: string } =>
        typeof w?.option === "string" &&
        w.option.trim().length > 0 &&
        typeof w?.reason === "string" &&
        w.reason.trim().length > 0 &&
        !containsRefusal(w.reason) &&
        w.option !== q.correctAnswer
    );
    out.whyWrong = kept;
  }
  return out as T;
}

function cleanMcqList(list: unknown): McqLike[] {
  if (!Array.isArray(list)) return [];
  const out: McqLike[] = [];
  for (const q of list as McqLike[]) {
    const cleaned = cleanMcq(q);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Remove exact-duplicate sentences from the study-guide Markdown:
 *  sentences already said in the summary are dropped from the guide,
 *  and a sentence repeated twice inside the guide keeps only its
 *  first occurrence. Only exact matches (normalized, at least 25
 *  characters) are dropped — short shared phrases and headers are
 *  left alone. Markdown headings and bullets are preserved line by
 *  line; only plain sentence lines are compared. */
function dedupeGuideText(studyGuide: string, summary: string): string {
  const seen = new Set<string>();
  const mark = (s: string) => {
    const n = norm(s);
    if (n.length >= 25) seen.add(n);
  };
  for (const s of summary.split(/(?<=[.!?])\s+/)) mark(s);
  const lines = studyGuide.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    // Only compare plain prose lines — never headings, bullets,
    // code, tables, or list items.
    if (
      trimmed.startsWith("#") ||
      trimmed.startsWith("-") ||
      trimmed.startsWith("*") ||
      /^\d+[.)]\s/.test(trimmed) ||
      trimmed.startsWith("|") ||
      trimmed.startsWith("```")
    ) {
      out.push(line);
      continue;
    }
    const sentences = line.split(/(?<=[.!?])\s+/);
    const kept = sentences.filter((s) => {
      const n = norm(s);
      if (n.length < 25 || !seen.has(n)) {
        if (n.length >= 25) seen.add(n);
        return true;
      }
      return false;
    });
    if (kept.length > 0) out.push(kept.join(" "));
  }
  return out.join("\n").trim();
}

/**
 * Clean a generated guide in place-safe fashion (returns a new object):
 * strips refusal/error/placeholder text, drops blank list items and
 * broken questions, and de-duplicates repeated sentences. Sections
 * left with no real content come back empty — the UI omits them
 * instead of rendering blanks.
 */
export function sanitizeGuide<T extends GuideJson>(guide: T): T {
  const g = JSON.parse(JSON.stringify(guide)) as GuideJson & Record<
    string,
    unknown
  >;

  if (typeof g.studyGuide === "string") {
    g.studyGuide = stripRefusalSentences(g.studyGuide);
    if (typeof g.summary === "string" && g.summary.trim()) {
      g.summary = stripRefusalSentences(g.summary);
      g.studyGuide = dedupeGuideText(g.studyGuide, g.summary);
    }
  }
  if (typeof g.summary === "string") {
    g.summary = stripRefusalSentences(g.summary);
  }

  g.objectives = cleanStringList(g.objectives);
  g.realWorldApplications = cleanStringList(g.realWorldApplications);
  g.keyConcepts = cleanStringList(g.keyConcepts);

  if (Array.isArray(g.keyTerms)) {
    g.keyTerms = g.keyTerms.filter(
      (t) =>
        typeof t?.term === "string" &&
        t.term.trim() &&
        typeof t?.definition === "string" &&
        t.definition.trim() &&
        !containsRefusal(t.term) &&
        !containsRefusal(t.definition)
    );
  }

  if (Array.isArray(g.faq)) {
    g.faq = g.faq.filter(
      (f) =>
        typeof f?.question === "string" &&
        f.question.trim() &&
        typeof f?.answer === "string" &&
        f.answer.trim() &&
        !containsRefusal(f.question) &&
        !containsRefusal(f.answer)
    );
  }

  if (typeof g.cheatSheet === "string") {
    if (containsRefusal(g.cheatSheet)) {
      // A cheat sheet that IS a refusal is dropped whole — better
      // absent than an error message dressed up as a study aid.
      g.cheatSheet = undefined;
    } else {
      const cleaned = stripRefusalSentences(g.cheatSheet);
      g.cheatSheet = cleaned || undefined;
    }
  }

  if (Array.isArray(g.modules)) {
    for (const m of g.modules as Record<string, unknown>[]) {
      if (!m || typeof m !== "object") continue;
      if (Array.isArray(m.coreIdeas)) {
        m.coreIdeas = cleanStringList(m.coreIdeas);
      }
      if (m.reasoningExample && typeof m.reasoningExample === "object") {
        const r = m.reasoningExample as Record<string, unknown>;
        for (const k of ["question", "solution", "explanation"]) {
          if (typeof r[k] === "string") r[k] = stripRefusalSentences(r[k]);
        }
      }
      if (m.checkpoint && typeof m.checkpoint === "object") {
        const c = m.checkpoint as Record<string, unknown>;
        c.questions = cleanMcqList(c.questions);
      }
      if (Array.isArray(m.concepts)) {
        for (const c of m.concepts as Record<string, unknown>[]) {
          if (!c || typeof c !== "object") continue;
          for (const k of [
            "example",
            "explanation",
            "commonMistake",
            "memoryTip",
            "tip",
            "formulaOrDefinition",
          ]) {
            if (typeof c[k] === "string") {
              c[k] = stripRefusalSentences(c[k] as string);
            }
          }
          if (c.workedExample && typeof c.workedExample === "object") {
            const w = c.workedExample as Record<string, unknown>;
            if (typeof w.problem === "string")
              w.problem = stripRefusalSentences(w.problem);
            if (typeof w.answer === "string")
              w.answer = stripRefusalSentences(w.answer);
            if (Array.isArray(w.steps)) {
              w.steps = (w.steps as unknown[])
                .filter(
                  (s): s is string =>
                    typeof s === "string" && s.trim().length > 0
                )
                .map((s) => stripRefusalSentences(s))
                .filter((s) => s.length > 0);
            }
          }
        }
      }
      if (Array.isArray(m.practice)) {
        for (const grp of m.practice as Record<string, unknown>[]) {
          if (!grp || typeof grp !== "object") continue;
          if (Array.isArray(grp.problems)) {
            const cleaned: Record<string, unknown>[] = [];
            for (const p of grp.problems as McqLike[]) {
              if (typeof p !== "object" || p === null) continue;
              const hasOptions =
                Array.isArray(p.options) && p.options.length >= 3;
              if (hasOptions) {
                const c = cleanMcq(p);
                if (c) cleaned.push(c as Record<string, unknown>);
              } else if (Array.isArray(p.options) && p.options.length > 0) {
                // Options present but too few (or a correct answer
                // that is not among them): a broken multiple-choice
                // question, not a short-answer one — drop it.
                continue;
              } else {
                // Short-answer / reasoning problem: keep it when it has
                // a real question and answer, with refusal text stripped.
                if (
                  typeof p.question === "string" &&
                  p.question.trim() &&
                  typeof p.correctAnswer === "string" &&
                  p.correctAnswer.trim()
                ) {
                  const copy = { ...p } as Record<string, unknown>;
                  if (typeof copy.explanation === "string") {
                    copy.explanation = stripRefusalSentences(
                      copy.explanation as string
                    );
                  }
                  cleaned.push(copy);
                }
              }
            }
            grp.problems = cleaned;
          }
        }
        m.practice = (m.practice as Record<string, unknown>[]).filter(
          (grp) => Array.isArray(grp.problems) && grp.problems.length > 0
        );
      }
    }
  }

  if (Array.isArray(g.quiz)) {
    g.quiz = cleanMcqList(g.quiz) as never;
  }
  if (g.finalReview && typeof g.finalReview === "object") {
    const fr = g.finalReview as Record<string, unknown>;
    fr.questions = cleanMcqList(fr.questions);
  }

  return g as T;
}

// ---------------------------------------------------------------------------
// Quality checks — what the repair pass looks for after sanitizing.
// ---------------------------------------------------------------------------

type WorkedExampleLike = {
  steps?: unknown;
  problem?: unknown;
  answer?: unknown;
};

/** True when the guide has at least one real step-by-step worked
 *  example: a structured workedExample with 2+ steps, a reasoning
 *  example with a substantial solution, or a long worked example
 *  (200+ characters with a real number in it) written into the
 *  concept's example field. One-line "Example:" lines do not count. */
function hasWorkedExample(guide: GuideJson): boolean {
  for (const m of guide.modules ?? []) {
    if (
      m.reasoningExample &&
      typeof m.reasoningExample.solution === "string" &&
      m.reasoningExample.solution.trim().length >= 80
    ) {
      return true;
    }
    for (const c of m.concepts ?? []) {
      const w = (c as { workedExample?: WorkedExampleLike }).workedExample;
      if (
        w &&
        Array.isArray(w.steps) &&
        w.steps.filter(
          (s): s is string => typeof s === "string" && s.trim().length > 0
        ).length >= 2
      ) {
        return true;
      }
      // Credit a genuinely worked example written into the plain
      // example field: long, with a real number in it.
      if (
        typeof c.example === "string" &&
        c.example.trim().length >= 200 &&
        /\d/.test(c.example)
      ) {
        return true;
      }
    }
  }
  return false;
}

/** Count multiple-choice questions whose explanations do not cover
 *  every wrong option (missing whyWrong entries, or entries that do
 *  not name each non-correct option). */
function countMcqWithoutDistractorReasons(
  guide: GuideJson,
  opts: { includeQuiz: boolean }
): number {
  const mcqs: McqLike[] = [];
  for (const m of guide.modules ?? []) {
    for (const grp of m.practice ?? []) {
      for (const p of grp.problems ?? []) {
        if (Array.isArray(p.options) && p.options.length >= 3) mcqs.push(p);
      }
    }
    if (m.checkpoint) {
      for (const q of m.checkpoint.questions ?? []) mcqs.push(q);
    }
  }
  if (opts.includeQuiz) {
    for (const q of guide.quiz ?? []) mcqs.push(q);
  }
  if (guide.finalReview) {
    for (const q of guide.finalReview.questions ?? []) mcqs.push(q);
  }

  let bad = 0;
  for (const q of mcqs) {
    const options = (q.options ?? []) as string[];
    const wrong = options.filter((o) => o !== q.correctAnswer);
    const entries = Array.isArray(q.whyWrong)
      ? (q.whyWrong as WhyWrongLike[])
      : [];
    const missing = wrong.filter(
      (o) =>
        !entries.some(
          (w) =>
            typeof w?.option === "string" &&
            norm(w.option) === norm(o) &&
            typeof w?.reason === "string" &&
            w.reason.trim().length > 0
        )
    );
    if (missing.length > 0) bad += 1;
  }
  return bad;
}

/**
 * What is still wrong with this guide after sanitizing, as short
 * issue strings for the repair prompt. Empty means the guide meets
 * the quality rules. Only checks that the model can actually fix in
 * a repair pass — blank sections are handled by sanitizing (omit),
 * not by regenerating.
 */
export function qualityIssues(
  guide: GuideJson,
  opts: { includeQuiz: boolean }
): string[] {
  const issues: string[] = [];
  if (!hasWorkedExample(guide)) {
    issues.push(
      "no step-by-step worked example with real numbers or a concrete case (add a workedExample with at least 2 steps to at least one concept, or a full reasoning example)"
    );
  }
  const badMcq = countMcqWithoutDistractorReasons(guide, opts);
  if (badMcq > 0) {
    issues.push(
      `${badMcq} multiple-choice question${badMcq === 1 ? "" : "s"} explain only the correct answer — every wrong option needs a whyWrong entry saying why it is wrong`
    );
  }
  return issues;
}
