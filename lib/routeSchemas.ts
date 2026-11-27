import { z } from "zod";
import {
  ConceptSchema,
  PracticeGroupSchema,
  QuizQuestionSchema,
  WhyWrongSchema,
} from "./guideSchema";

/**
 * Zod schemas for the shapes the API routes send to the models via
 * generateObject — moved here from the route files (where they lived
 * inline) for one reason: Next.js route files may not export anything
 * but route fields, so a schema that lives in a route file cannot be
 * imported by a test. These definitions are VERBATIM copies of what
 * the routes had — same fields, same bounds, same descriptions — so
 * moving them changes nothing at runtime. The routes import them
 * from here; the strict-schema logic test (lib/strictSchema.ts)
 * imports them from here too, which is what lets it prove the REAL
 * schemas pass Pollinations' strict rule instead of copies.
 *
 * Schemas that are only ever parsed locally (never sent to a model)
 * stay in their route files: WeakConceptSchema in
 * app/api/personalized-practice (request input) and
 * ChosenTemplateSchema in app/api/generate-game (safeParse of a
 * client-chosen template).
 */

// ---------------------------------------------------------------------------
// app/api/generate — simplified fallback shape, used once if the full
// shape fails to validate: concepts + targeted practice only, no
// checkpoint / reasoning / core ideas. It still returns a real,
// complete guide — never mock content.
// ---------------------------------------------------------------------------

export const SimpleModuleSchema = z.object({
  moduleNumber: z.number(),
  title: z.string(),
  intro: z.string(),
  format: z.string().optional(),
  concepts: z.array(ConceptSchema).min(1).max(4),
  practice: z.array(PracticeGroupSchema),
});

export const SimpleGenerateResultSchema = z.object({
  topicType: z.string(),
  guideTitle: z.string(),
  studyGuide: z.string(),
  summary: z.string().optional(),
  keyTerms: z
    .array(z.object({ term: z.string(), definition: z.string() }))
    .max(12)
    .optional(),
  keyConcepts: z.array(z.string()),
  languageCode: z.string().optional(),
  modules: z.array(SimpleModuleSchema).min(1).max(3),
  quiz: z.array(QuizQuestionSchema).max(6).optional(),
});

// ---------------------------------------------------------------------------
// app/api/generate-game — Battle Arena games and template previews.
// ---------------------------------------------------------------------------

export const GameQuestionSchema = z.object({
  question: z.string().describe("The trivia question text."),
  options: z
    .array(z.string())
    .length(4)
    .describe("Exactly four answer options."),
  correctAnswer: z
    .string()
    .describe("The exact text of the correct option, matching one of the options."),
  explanation: z
    .string()
    .describe("A short explanation of the correct answer."),
  points: z
    .number()
    .int()
    .describe("Points awarded for a correct answer (100-500 based on difficulty)."),
});

export const GameCardSchema = z.object({
  front: z.string().describe("The front of a flashcard or matching card, taken from the supplied material."),
  back: z.string().describe("The back of the card — the match for the front, taken from the supplied material."),
});

export const GameSchema = z.object({
  title: z.string().describe("A short, engaging title for this game, derived from the supplied topic/notes."),
  gameType: z
    .string()
    .describe(
      "The game type chosen for this topic, derived from the supplied material: for example a timed speed drill, a matching game, flashcards, or a quiz race. Choose the type that fits the topic."
    ),
  gameDescription: z
    .string()
    .describe("One line describing how this game is played, derived from the supplied material."),
  timedSecondsPerQuestion: z
    .number()
    .int()
    .optional()
    .describe("Seconds allowed per question, only when the chosen game type is timed. Omit otherwise."),
  cards: z
    .array(GameCardSchema)
    .optional()
    .describe(
      "Front/back cards for matching or flashcard games, taken from the supplied material. Include only when the chosen game type uses cards."
    ),
  questions: z.array(GameQuestionSchema).describe("The game questions."),
});

/**
 * Step 1 of the two-step Arena flow: fast, INCOMPLETE template previews.
 * Three different game ideas for the topic — just a title, a game type, a
 * one-line description, and 1–2 sample questions as a taste. The user picks
 * one, and only then does the AI build the full game. Everything is
 * generated on demand from the user's topic; nothing is premade.
 */
export const TemplateSampleQuestionSchema = z.object({
  question: z.string().describe("A sample question for this game idea, from the supplied material."),
  options: z
    .array(z.string())
    .length(4)
    .describe("Exactly four answer options for the sample question."),
  correctAnswer: z
    .string()
    .describe("The exact text of the correct option, matching one of the options."),
});

export const GameTemplateSchema = z.object({
  title: z.string().describe("A short, engaging name for this game idea, derived from the supplied topic/notes."),
  gameType: z
    .string()
    .describe(
      "The game type for this idea — for example trivia race, flashcards, matching, quiz showdown, or timed speed drill. Pick a type that fits the topic."
    ),
  description: z
    .string()
    .describe("One line describing how this game is played."),
  sampleQuestions: z
    .array(TemplateSampleQuestionSchema)
    .min(1)
    .max(2)
    .describe("One or two sample questions as a taste of this game idea — no more."),
});

export const TemplatesSchema = z.object({
  templates: z
    .array(GameTemplateSchema)
    .length(3)
    .describe("Exactly three different game ideas for the supplied topic, each a different game type where possible."),
});

// ---------------------------------------------------------------------------
// app/api/personalized-practice — fresh questions for weak concepts.
// ---------------------------------------------------------------------------

export const PersonalizedQuestionSchema = z.object({
  conceptTitle: z
    .string()
    .describe("The weak concept this question practices — must match one of the supplied weak concepts."),
  question: z.string().describe("A fresh practice question on the weak concept. Do not reuse the question the student already missed."),
  options: z
    .array(z.string())
    .min(3)
    .max(4)
    .describe("Three or four answer options (four preferred)."),
  correctAnswer: z
    .string()
    .describe("The exact text of the correct option, matching one of the options."),
  explanation: z
    .string()
    .describe("A short explanation of why the correct answer is right — and, where the student picked a wrong answer before, why that wrong answer is wrong."),
  whyWrong: z
    .array(WhyWrongSchema)
    .optional()
    .describe(
      "One entry for EACH wrong option, saying why that option is wrong — drawn from the common mistakes on this concept. Never explain only the correct answer."
    ),
  difficulty: z
    .enum(["Recall", "Apply", "Analyse"])
    .describe("Bloom's level this question targets: Recall (remember/understand the idea), Apply (use it in a new situation), or Analyse (compare, explain why, break it apart). Match it to the concept's mastery — Recall for Attempted/Familiar, Apply for Proficient, Analyse for Mastered."),
});

export const PersonalizedPracticeSchema = z.object({
  questions: z
    .array(PersonalizedQuestionSchema)
    .min(1)
    .max(6)
    .describe("Fresh targeted practice questions for the student's weak concepts — two per weak concept, up to six total."),
});

// ---------------------------------------------------------------------------
// app/api/videos — YouTube candidate suggestions (verified with oEmbed
// before anything is shown, so a hallucinated ID just costs one
// retry, never a fake video).
// ---------------------------------------------------------------------------

export const CandidateSchema = z.object({
  candidates: z
    .array(
      z.object({
        videoId: z.string().describe("The exact 11-character YouTube video ID."),
        title: z.string().describe("The video's title, as best you know it."),
        channelTitle: z.string().describe("The channel that published the video."),
      })
    )
    .describe("3 to 6 candidate videos you are confident really exist on YouTube."),
});

// ---------------------------------------------------------------------------
// app/api/check-reasoning — handwritten reasoning grading (vision).
// ---------------------------------------------------------------------------

export const CheckReasoningSchema = z.object({
  readable: z
    .boolean()
    .describe(
      "Whether the handwriting in the image can actually be read. False when it is blank, too faint, too messy, or cropped — never guess at unreadable writing."
    ),
  transcription: z
    .string()
    .describe(
      "Exactly what the student wrote, transcribed from the handwriting. Empty when it cannot be read."
    ),
  score: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "Score out of 10 for the reasoning as a whole. About half the marks are for the WORK — is the final answer/result correct? About half are for the PROCESS — are the steps logical, in the right order, complete, with the working shown? 9–10 means fully correct work and process; 5–8 means partly right; 0–4 means mostly wrong or missing. 0 when the handwriting cannot be read."
    ),
  pros: z
    .array(z.string())
    .max(5)
    .describe(
      "What the student did well — correct steps, good method, clear working, correct final answer. Empty when nothing was done well or the writing cannot be read."
    ),
  cons: z
    .array(z.string())
    .max(5)
    .describe(
      "What was wrong or missing — skipped steps, wrong method, unclear working, arithmetic slip, wrong final answer. When the handwriting cannot be read, a single item saying so."
    ),
  hint: z
    .string()
    .describe(
      "One concrete hint for the student's next try — what to fix or show next time. When the handwriting cannot be read, advice to write bigger and clearer."
    ),
});

// ---------------------------------------------------------------------------
// app/api/teach-back — Feynman / "teach it back" grading.
// ---------------------------------------------------------------------------

export const TeachBackSchema = z.object({
  score: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe("Score out of 10 for how well the student explained the concept from memory."),
  keyPointsCovered: z
    .array(z.string())
    .describe("The key points from the guide's definition that the student's explanation actually covered."),
  missingPoints: z
    .array(z.string())
    .describe("Important points from the guide's definition that the student left out or got vague about."),
  misconceptions: z
    .array(z.string())
    .describe("Things the student said that are wrong or misleading. Empty when nothing was wrong."),
  feedback: z
    .string()
    .describe("Two or three sentences of encouraging, specific feedback: what was strong, and the single most important thing to fix."),
  followUpQuestion: z
    .string()
    .describe("One short question that tests the biggest gap in the student's explanation."),
});
