/**
 * Arena question hygiene — shared by /api/generate-game (server) and
 * BattleArena (client).
 *
 * The generator is a language model, and its `correctAnswer` field is
 * free text: nothing in the schema forces it to be exactly one of the
 * options. In the wild it comes back as a paraphrase, with different
 * punctuation/casing, or — worst — naming the wrong option while the
 * explanation describes the right one. That is how a player can pick
 * the factually correct answer and still be marked wrong.
 *
 * Everything here is a LOCAL text check — no AI call, no network.
 * The server repairs/drops bad questions at generation time; the
 * client applies the same checks defensively to any game it loads
 * (including games saved before this fix, and games from Browse).
 */

export type ArenaQuestionLike = {
  question: string;
  options: string[];
  correctAnswer: string;
  /** May be absent on template preview questions. */
  explanation?: string;
};

/** Words that carry no signal when comparing answers/explanations. */
const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "of", "to", "in", "on", "for", "with", "by", "and", "or", "as", "at",
  "from", "into", "that", "this", "it", "its", "which", "when", "where",
  "how", "what", "why", "who", "whom", "not", "no", "do", "does", "did",
  "can", "could", "will", "would", "should", "has", "have", "had", "per",
  "via", "than", "then", "also", "such", "one", "two", "more", "most",
  "other", "others", "each", "all", "any", "some", "about", "over",
  "under", "between", "through", "during", "after", "before",
]);

/**
 * Canonical form for comparing answer/question text: case, punctuation,
 * whitespace, and curly quotes/dashes no longer matter, so "Liquid
 * water changes to gas via solar energy" and "liquid water changes to
 * gas via solar energy." compare equal.
 */
export function normalizeAnswer(value: string): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalized-equality of two answers (never true for empty text). */
export function sameAnswer(a: string, b: string): boolean {
  const na = normalizeAnswer(a);
  const nb = normalizeAnswer(b);
  return na.length > 0 && na === nb;
}

/** Distinctive words of a text: normalized, stopwords and short words out. */
function contentWords(text: string): string[] {
  const words = normalizeAnswer(text).split(" ").filter(Boolean);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (w.length < 3 || STOPWORDS.has(w) || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
  }
  return out;
}

/**
 * How much of `shortText`'s distinctive words appear in `longText`
 * (0–1). Used to ask "does this explanation describe this option?":
 * the explanation is the long text, the option is the short one.
 */
function coverage(shortText: string, longText: string): number {
  const short = contentWords(shortText);
  if (short.length === 0) return 0;
  const long = new Set(contentWords(longText));
  let hits = 0;
  for (const w of short) if (long.has(w)) hits += 1;
  return hits / short.length;
}

/** Best explanation match among options (excluding one index, if given). */
function bestExplanationMatch(
  options: string[],
  explanation: string,
  excludeIdx: number
): { index: number; score: number } | null {
  if (!explanation || !explanation.trim()) return null;
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < options.length; i++) {
    if (i === excludeIdx) continue;
    const score = coverage(options[i], explanation);
    if (score > 0 && (!best || score > best.score)) best = { index: i, score };
  }
  return best;
}

/**
 * Best match of the stored correct-answer text against the options, by
 * shared distinctive words — catches a paraphrase ("Liquid water turns
 * into gas") of an option ("Liquid water changes to gas via solar
 * energy"). Score is the fraction of the stored answer's words that
 * appear in the option.
 */
function bestAnswerMatch(
  options: string[],
  correctAnswer: string
): { index: number; score: number } | null {
  const answerWords = contentWords(correctAnswer);
  if (answerWords.length === 0) return null;
  let best: { index: number; score: number } | null = null;
  for (let i = 0; i < options.length; i++) {
    const optionWords = new Set(contentWords(options[i]));
    let hits = 0;
    for (const w of answerWords) if (optionWords.has(w)) hits += 1;
    const score = hits / answerWords.length;
    if (score > 0 && (!best || score > best.score)) best = { index: i, score };
  }
  return best;
}

/**
 * Repair one generated question, or return null when it cannot be
 * trusted and must be dropped (the caller generates a replacement).
 *
 * 1. The stored correct answer matches an option (normalized)? Keep it
 *    — but if the explanation describes a DIFFERENT option far more
 *    strongly (≥0.3 better, ≥0.6 absolute) while barely supporting the
 *    stored one, the stored answer is the model's mistake and the
 *    explanation is the model's own definition: switch to the option
 *    the explanation describes.
 * 2. No option matches the stored answer? Trust the explanation: the
 *    option it describes (≥ half its distinctive words in it) is the
 *    answer.
 * 3. Otherwise trust the stored answer's own words, if they clearly
 *    point at one option (≥ 60% of its words).
 * 4. Otherwise the question is unanswerable — drop it.
 *
 * The correct answer is always rewritten to the EXACT text of the
 * option it names, so client-side exact matching can never disagree
 * with it.
 */
export function repairQuestion<T extends ArenaQuestionLike>(
  q: T
): T | null {
  const question = (q?.question ?? "").trim();
  if (!question) return null;
  const options = (q?.options ?? []).map((o) => (o ?? "").trim()).filter(Boolean);
  if (options.length < 2) return null;
  // Degenerate: two options that are the same answer in different
  // clothes — no fair way to grade it, so drop the question.
  const seenOptions = new Set<string>();
  for (const o of options) {
    const n = normalizeAnswer(o);
    if (!n || seenOptions.has(n)) return null;
    seenOptions.add(n);
  }
  const explanation = q?.explanation ?? "";

  let correctIdx = options.findIndex((o) => sameAnswer(o, q.correctAnswer));
  if (correctIdx >= 0) {
    const candidateScore = coverage(options[correctIdx], explanation);
    const other = bestExplanationMatch(options, explanation, correctIdx);
    if (
      other &&
      other.score >= 0.6 &&
      other.score - candidateScore >= 0.3
    ) {
      correctIdx = other.index;
    }
    return { ...q, options, correctAnswer: options[correctIdx] };
  }

  const byExplanation = bestExplanationMatch(options, explanation, -1);
  if (byExplanation && byExplanation.score >= 0.5) {
    return { ...q, options, correctAnswer: options[byExplanation.index] };
  }

  const byAnswer = bestAnswerMatch(options, q.correctAnswer);
  if (byAnswer && byAnswer.score >= 0.6) {
    return { ...q, options, correctAnswer: options[byAnswer.index] };
  }

  return null;
}

/**
 * Clean a batch of generated questions: drop exact duplicates by
 * normalized question text (case/whitespace/punctuation-insensitive,
 * keep the first), repair each surviving question, and drop any that
 * cannot be trusted. `seen` persists across batches of one game, so a
 * question repeated in a later batch is dropped too. Returns only
 * playable questions.
 */
export function cleanQuestions<T extends ArenaQuestionLike>(
  questions: T[],
  seen: Set<string> = new Set<string>()
): T[] {
  const out: T[] = [];
  for (const q of questions ?? []) {
    const key = normalizeAnswer(q?.question ?? "");
    if (!key || seen.has(key)) continue;
    const fixed = repairQuestion(q);
    if (!fixed) continue;
    seen.add(key);
    out.push(fixed);
  }
  return out;
}

/** Dedupe + repair one self-contained question list (single batch). */
export function dedupeQuestions<T extends ArenaQuestionLike>(
  questions: T[]
): T[] {
  return cleanQuestions(questions);
}
