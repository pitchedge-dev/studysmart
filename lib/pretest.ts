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

function usable(
  q: { question: string; options?: string[]; correctAnswer: string; explanation: string },
  conceptTitle: string
): DiagnosticQuestion | null {
  const options = (q.options ?? []).map((o) => String(o).trim()).filter(Boolean);
  if (!q.question?.trim() || options.length < 2) return null;
  if (!options.some((o) => o === q.correctAnswer.trim())) return null;
  return {
    question: q.question.trim(),
    options,
    correctAnswer: q.correctAnswer.trim(),
    explanation: q.explanation?.trim() ?? "",
    conceptTitle,
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
  const seen = new Set<string>();
  const perModule: DiagnosticQuestion[][] = modules.map((m) => {
    const list: DiagnosticQuestion[] = [];
    for (const g of m.practice ?? []) {
      for (const p of g.problems ?? []) {
        const d = usable(p as PracticeProblem, g.conceptTitle);
        if (d && !seen.has(norm(d.question))) {
          seen.add(norm(d.question));
          list.push(d);
        }
      }
    }
    for (const q of m.checkpoint?.questions ?? []) {
      const d = usable(q, m.title);
      if (d && !seen.has(norm(d.question))) {
        seen.add(norm(d.question));
        list.push(d);
      }
    }
    return list;
  });
  const finalReview: DiagnosticQuestion[] = (finalReviewQuestions ?? [])
    .map((q) => usable(q, "Final review"))
    .filter((d): d is DiagnosticQuestion => d !== null && !seen.has(norm(d.question)));
  for (const d of finalReview) seen.add(norm(d.question));

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
