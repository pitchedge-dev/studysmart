/**
 * "Test yourself first" — a short diagnostic before studying a guide.
 *
 * The pretesting effect (Richland, Kornell & Kao, Journal of
 * Experimental Psychology: Applied, 2009): students who tried to answer
 * questions about a passage BEFORE reading it remembered more on the
 * final test than students who spent the same time just reading — even
 * though they mostly failed the pretest. Trying (and failing) to
 * retrieve an answer primes the brain to notice and keep the right
 * answer when it appears. Kornell, Hays & Bjork (2009) found the same
 * with word pairs: ~10% better recall after a delay, from failed
 * retrieval attempts alone.
 *
 * The questions come ONLY from the guide itself — its own practice
 * problems and checkpoint questions, sampled round-robin across
 * modules so the diagnostic spans the whole guide. Nothing is
 * generated, nothing is premade, no AI call is made. Scores are stored
 * only in this browser (localStorage, per guide key): a before-score
 * and an after-score, so the student can see their own improvement.
 * Pretest answers are never recorded as errors and earn no XP — a
 * wrong guess before studying is not a mistake.
 */

import type {
  CheckpointQuestion,
  PracticeProblem,
  StudyModule,
} from "@/components/TargetedPractice";

export type DiagnosticQuestion = {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  conceptTitle: string;
  /** One entry per wrong option, saying why it is wrong. */
  whyWrong?: { option: string; reason: string }[];
};

export type PreTestResult = {
  score: number;
  total: number;
  at: string; // ISO timestamp
};

export type PreTestState = {
  pre: PreTestResult | null;
  post: PreTestResult | null;
};

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Phrases that are NOT an explanation — the model writing about the
 * material instead of explaining the answer. Live 2026-11-27 volcano
 * guide: pretest explanations said "The material does not cover
 * this." — a non-explanation that tells the student nothing about
 * why the correct answer is right. These patterns are the model
 * talking about coverage, not teaching: every one requires the
 * sentence to be about the material/notes/content being absent or
 * not covering something, so a real explanation that happens to
 * mention "not covered" in passing (e.g. "unlike lava, which is
 * not covered by the crust...") is not caught — the patterns are
 * anchored to "the material / the notes / this topic / it" as the
 * subject, or to the whole text being one of these short evasions.
 */
const GENERIC_EXPLANATION_PATTERNS: RegExp[] = [
  /^the material does not cover/i,
  /^the (material|notes?|content|topic|passage) (does not|doesn't|do not|don't) (cover|discuss|mention|include|explain|address)/i,
  /(material|notes?|content|topic) (does not|doesn't|do not|don't) cover/i,
  /not covered (in|by) (the|this)/i,
  /not (discussed|mentioned|covered|included|provided|given) (in|by)/i,
  /no information (is )?(provided|given|available)/i,
  /information (is )?(not (provided|given|available)|missing)/i,
  /cannot (be )?determined from/i,
  /insufficient information/i,
  /not enough information/i,
  /^this (is )?not (covered|discussed|mentioned)/i,
];

/** True when an explanation string is a generic non-explanation
 *  (see above) or empty — nothing a student can learn from. */
export function isGenericExplanation(text: string | null | undefined): boolean {
  if (!text) return true;
  const t = text.trim();
  if (!t) return true;
  return GENERIC_EXPLANATION_PATTERNS.some((re) => re.test(t));
}

/** The explanation to show, or "" when there is no substantive one.
 *  Callers render the correct answer on its own when this is "" —
 *  never a fake explanation. Nothing is invented here: a generic
 *  explanation is dropped, never replaced with model-written words. */
export function substantiveExplanation(
  text: string | null | undefined
): string {
  if (!text) return "";
  const t = text.trim();
  if (isGenericExplanation(t)) return "";
  return t;
}

function usable(
  q: {
    question: string;
    options?: string[];
    correctAnswer: string;
    explanation: string;
    whyWrong?: { option: string; reason: string }[];
  },
  conceptTitle: string
): DiagnosticQuestion | null {
  const options = (q.options ?? []).map((o) => String(o).trim()).filter(Boolean);
  if (!q.question?.trim() || options.length < 2) return null;
  if (!options.some((o) => o === q.correctAnswer.trim())) return null;
  return {
    question: q.question.trim(),
    options,
    correctAnswer: q.correctAnswer.trim(),
    // A generic non-explanation ("The material does not cover
    // this.") is dropped to "" — the pretest view shows the correct
    // answer on its own rather than a fake explanation. Never
    // invented, never replaced.
    explanation: substantiveExplanation(q.explanation),
    conceptTitle,
    whyWrong: (q.whyWrong ?? []).filter(
      (w) =>
        typeof w?.option === "string" &&
        options.includes(w.option) &&
        w.option !== q.correctAnswer.trim() &&
        typeof w?.reason === "string" &&
        w.reason.trim().length > 0 &&
        !isGenericExplanation(w.reason)
    ),
  };
}

/**
 * Sample up to `count` questions from the guide itself, round-robin
 * across modules (one per module per round) so the diagnostic covers
 * the whole guide instead of clustering in module 1. Practice problems
 * first, then checkpoint questions, then the final review. Duplicates
 * (same question text) are dropped. Returns the questions and how many
 * usable ones the guide had in total.
 */
export function extractDiagnosticQuestions(
  modules: StudyModule[],
  finalReviewQuestions?: CheckpointQuestion[],
  count = 3
): { questions: DiagnosticQuestion[]; totalAvailable: number } {
  // Dedupe by question text, keeping the FIRST occurrence — EXCEPT
  // when a later copy of the same question carries a substantive
  // explanation and the kept one has none (e.g. the practice problem
  // says "The material does not cover this." while the final review
  // explains the same question properly): then the substantive copy
  // replaces the empty one in place, so the student sees the real
  // explanation instead of nothing. Position is kept — only the
  // explanation (and whyWrong) improves.
  const byQuestion = new Map<
    string,
    { list: DiagnosticQuestion[]; index: number }
  >();
  function add(list: DiagnosticQuestion[], d: DiagnosticQuestion): void {
    const key = norm(d.question);
    const existing = byQuestion.get(key);
    if (!existing) {
      byQuestion.set(key, { list, index: list.length });
      list.push(d);
      return;
    }
    const kept = existing.list[existing.index];
    if (!kept.explanation && d.explanation) {
      existing.list[existing.index] = d;
    } else if (
      !kept.explanation &&
      !d.explanation &&
      (kept.whyWrong?.length ?? 0) === 0 &&
      (d.whyWrong?.length ?? 0) > 0
    ) {
      existing.list[existing.index] = d;
    }
  }

  const perModule: DiagnosticQuestion[][] = modules.map((m) => {
    const list: DiagnosticQuestion[] = [];
    for (const g of m.practice ?? []) {
      for (const p of g.problems ?? []) {
        const d = usable(p as PracticeProblem, g.conceptTitle);
        if (d) add(list, d);
      }
    }
    for (const q of m.checkpoint?.questions ?? []) {
      const d = usable(q, m.title);
      if (d) add(list, d);
    }
    return list;
  });
  const finalReview: DiagnosticQuestion[] = [];
  for (const q of finalReviewQuestions ?? []) {
    const d = usable(q, "Final review");
    if (d) add(finalReview, d);
  }

  const totalAvailable =
    perModule.reduce((n, l) => n + l.length, 0) + finalReview.length;
  const out: DiagnosticQuestion[] = [];
  let round = 0;
  while (out.length < count) {
    let added = false;
    for (const list of perModule) {
      if (out.length >= count) break;
      const q = list[round];
      if (q) {
        out.push(q);
        added = true;
      }
    }
    if (out.length < count) {
      const q = finalReview[round];
      if (q) {
        out.push(q);
        added = true;
      }
    }
    if (!added) break;
    round += 1;
  }
  return { questions: out, totalAvailable };
}

function storageKey(guideKey: string): string {
  return `studysmart-pretest:${guideKey}`;
}

export function loadPreTest(guideKey: string | null): PreTestState {
  const empty: PreTestState = { pre: null, post: null };
  if (!guideKey) return empty;
  try {
    const raw = window.localStorage.getItem(storageKey(guideKey));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<PreTestState>;
    return {
      pre: parsed.pre ?? null,
      post: parsed.post ?? null,
    };
  } catch {
    return empty;
  }
}

export function savePreTest(
  guideKey: string | null,
  state: PreTestState
): void {
  if (!guideKey) return;
  try {
    window.localStorage.setItem(storageKey(guideKey), JSON.stringify(state));
  } catch {
    // Storage unavailable — the pretest still works for this session.
  }
}
