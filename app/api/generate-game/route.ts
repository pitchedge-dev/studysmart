import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getModelsFor,
  isOverloadedError,
  isRetryableProviderError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
  safeErrorDetail,
} from "@/lib/gemini";
import { cleanQuestions, repairQuestion } from "@/lib/arenaQuestions";

export const maxDuration = 60;

const GameQuestionSchema = z.object({
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

const GameCardSchema = z.object({
  front: z.string().describe("The front of a flashcard or matching card, taken from the supplied material."),
  back: z.string().describe("The back of the card — the match for the front, taken from the supplied material."),
});

const GameSchema = z.object({
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
const TemplateSampleQuestionSchema = z.object({
  question: z.string().describe("A sample question for this game idea, from the supplied material."),
  options: z
    .array(z.string())
    .length(4)
    .describe("Exactly four answer options for the sample question."),
  correctAnswer: z
    .string()
    .describe("The exact text of the correct option, matching one of the options."),
});

const GameTemplateSchema = z.object({
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

const TemplatesSchema = z.object({
  templates: z
    .array(GameTemplateSchema)
    .length(3)
    .describe("Exactly three different game ideas for the supplied topic, each a different game type where possible."),
});

const ChosenTemplateSchema = z.object({
  title: z.string(),
  gameType: z.string(),
  description: z.string(),
  sampleQuestions: z
    .array(
      z.object({
        question: z.string(),
        options: z.array(z.string()),
        correctAnswer: z.string(),
      })
    )
    .optional(),
});

/** Education level → difficulty and vocabulary of the game. Empty when
 *  the player did not pick a level (the game is then written for a
 *  general student). */
function educationGuidance(level?: string): string {
  switch (level) {
    case "Elementary School":
      return "The player is in Elementary School: use simple words, short questions, and basic facts only — nothing that needs high-school knowledge.";
    case "Middle School":
      return "The player is in Middle School: keep the language clear and direct, and test the core ideas of the topic, not obscure details.";
    case "High School":
      return "The player is in High School: make the game challenging and curriculum-level, with questions that test real understanding, not just recall.";
    case "College / University":
      return "The player is in College / University: make the game advanced — application and analysis questions, precise terminology, and distractors that catch shallow understanding.";
    case "Adult learning":
      return "The player is an adult learner: use plain language and practical, real-world framing — test what is useful, not what is academic.";
    default:
      return "";
  }
}

/** Test timing → how the game focuses. Empty when not picked. */
function testTimingGuidance(timing?: string): string {
  switch (timing) {
    case "Today":
    case "Tomorrow":
      return "The player's test is very soon: focus on the highest-yield facts and quick recall — rapid-fire, no side topics.";
    case "In 2–3 days":
    case "In a week":
      return "The player's test is coming up: cover the core material thoroughly, in the order it will be tested.";
    case "In 2+ weeks":
      return "The player's test is a while away: go broader than the bare essentials and include interesting angles that build real understanding.";
    case "No test — just learning":
      return "There is no test — the player is just learning: make the game fun and broad, with surprising facts alongside the essentials.";
    default:
      return "";
  }
}

/** Study time → pace and depth of the game. A 30-minute session gets a
 *  fast, punchy game; a 4+ hour session gets the deepest, hardest one.
 *  Empty when not picked. */
function studyHoursGameGuidance(hours?: string): string {
  switch (hours) {
    case "30 minutes":
      return "The player has 30 minutes: keep the game fast and punchy — short questions, quick rounds, the most important points only.";
    case "1 hour":
      return "The player has 1 hour: keep the game focused — the core material, no filler, questions that move quickly.";
    case "2 hours":
      return "The player has 2 hours: a standard-depth game — full coverage of the material at a steady pace.";
    case "3 hours":
      return "The player has 3 hours: go deep — harder, more detailed questions that test the tricky parts of the material.";
    case "4+ hours":
      return "The player has 4 or more hours: the fullest, hardest game the material supports — deep questions, subtle distractors, full coverage.";
    default:
      return "";
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      topicOrNotes,
      playerCount,
      questionCount,
      topicType,
      step,
      chosenTemplate,
      educationLevel,
      testTiming,
      studyHours,
      includeQuiz,
      includeConcepts,
    } = body as {
      topicOrNotes?: string;
      playerCount?: number;
      questionCount?: number;
      topicType?: string;
      step?: string;
      chosenTemplate?: unknown;
      educationLevel?: string;
      testTiming?: string;
      studyHours?: string;
      includeQuiz?: boolean;
      includeConcepts?: boolean;
    };

    if (typeof topicOrNotes !== "string" || topicOrNotes.trim().length === 0) {
      return NextResponse.json(
        { error: "Provide a topic or notes to generate a game from." },
        { status: 400 }
      );
    }

    const topicHint =
      typeof topicType === "string" && topicType.trim()
        ? `The supplied material was classified as: ${topicType.trim()}. `
        : "";

    // ---- Arena generation options — the SAME options as the study-guide
    // form (education level, test timing, study time, and the two
    // toggles), passed through by BattleArena. Each one genuinely
    // changes the game; an option the user did not pick adds nothing.
    // The two toggles are the guide form's toggles translated to the
    // Arena: "Include Practice Quiz" = trivia questions on/off,
    // "Extract Key Concepts" = flashcard/matching cards on/off. At
    // least one stays on — a game with neither questions nor cards is
    // not a game.
    const useQuiz = includeQuiz !== false || includeConcepts === false;
    const useConcepts = includeConcepts !== false || includeQuiz === false;
    const optionGuidance = [
      educationGuidance(educationLevel),
      testTimingGuidance(testTiming),
      studyHoursGameGuidance(studyHours),
      useQuiz
        ? ""
        : "Do NOT include trivia-style questions — build the game from flashcards and matching cards only.",
      useConcepts
        ? ""
        : "Do NOT include front/back cards — build a trivia-only game with questions only.",
    ]
      .filter(Boolean)
      .join(" ");

    // ---- Step 1: fast template previews (games category: Groq first,
    // fastest) ----
    if (step === "templates") {
      const models = getModelsFor("games");
      if (models.length === 0) {
        return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
      }

      let lastErr: unknown = null;
      for (const model of models) {
        try {
          const { object } = await generateObject({
            model,
            schema: TemplatesSchema,
            system: `You are StudySMART's Battle Arena game designer. ${topicHint}${optionGuidance ? `${optionGuidance} ` : ""}Dream up exactly 3 DIFFERENT game ideas for the supplied topic or notes — make the game types different from each other where the topic allows (for example trivia race, flashcards, matching, quiz showdown, timed speed drill). These are INCOMPLETE previews, not full games: for each idea give only a short title, the game type, one line describing how it plays, and 1–2 sample questions with four options and the correct answer, all taken strictly from the supplied material. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Keep every description to one short line.`,
            prompt: `Topic / notes to dream up game ideas from:\n\n${topicOrNotes}`,
            maxTokens: 1024,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(10000),
          });

          // Template previews are only a taste, but their highlighted
          // correct answer still has to be one of the options — repair
          // any sample whose stored answer is a paraphrase (local text
          // check, no extra AI call); drop one that cannot be trusted.
          const templates = object.templates.map((t) => ({
            ...t,
            sampleQuestions: (t.sampleQuestions ?? [])
              .map((q) => repairQuestion(q))
              .filter((q): q is NonNullable<typeof q> => q !== null),
          }));
          return NextResponse.json({ templates });
        } catch (err) {
          lastErr = err;
          console.error("[/api/generate-game templates] attempt failed:", err);
          if (!isRetryableProviderError(err)) break;
        }
      }

      if (isOverloadedError(lastErr)) {
        return NextResponse.json(
          { error: OVERLOADED_MESSAGE, detail: safeErrorDetail(lastErr) },
          { status: 503 }
        );
      }
      throw lastErr;
    }

    // ---- Step 2: full game (from a chosen template, or the old direct way) ----
    const models = getModelsFor("games");
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const count =
      typeof questionCount === "number" && questionCount > 0
        ? Math.min(Math.max(Math.floor(questionCount), 1), 30)
        : 20;

    const players =
      typeof playerCount === "number" && playerCount > 0
        ? Math.min(Math.floor(playerCount), 8)
        : 1;

    let templateInstruction = "";
    const parsedTemplate = ChosenTemplateSchema.safeParse(chosenTemplate);
    if (parsedTemplate.success) {
      const t = parsedTemplate.data;
      const sampleText = (t.sampleQuestions ?? [])
        .map(
          (q, i) =>
            `Sample ${i + 1}: "${q.question}" (options: ${q.options.join("; ")}; correct: ${q.correctAnswer})`
        )
        .join("\n");
      templateInstruction = `The user chose this game template — build the FULL game from it, keeping its title, game type, and style: title "${t.title}", game type "${t.gameType}", how it plays: "${t.description}".${sampleText ? `\nSample questions to match in style and difficulty:\n${sampleText}` : ""} Expand it into the full game below; do not switch to a different game type. `;
    }

    // Build the full game. Short games (10 questions) are generated in one
    // call; longer games (20–30) are built in sequential 10-question
    // batches behind the one loading state, so a long game cannot time out
    // the 60s function. Each batch after the first is told the earlier
    // questions so it does not repeat them, and keeps the same title, game
    // type, and style. Cards come from the first batch only.
    const CHUNK = 10;
    const chunkCount = Math.ceil(count / CHUNK);

    async function runBatch(
      system: string,
      prompt: string,
      abortMs: number
    ): Promise<z.infer<typeof GameSchema>> {
      let batchErr: unknown = null;
      for (const model of models) {
        try {
          const { object } = await generateObject({
            model,
            schema: GameSchema,
            system,
            prompt,
            maxTokens: 3072,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(abortMs),
          });
          return object;
        } catch (err) {
          batchErr = err;
          console.error("[/api/generate-game batch] attempt failed:", err);
          if (!isRetryableProviderError(err)) break;
        }
      }
      throw batchErr;
    }

    const basePrompt = `Topic / notes to build the game from:\n\n${topicOrNotes}`;
    const baseSystem = `You are StudySMART's Battle Arena game generator. ${topicHint}${templateInstruction}${optionGuidance ? `${optionGuidance} ` : ""}First decide the game type that fits this topic — for example a timed speed drill for quantitative material, matching or flashcards for vocabulary material, or a quiz race for other material — then build that game strictly from the topic or notes the user supplies. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Vary the difficulty and assign points between 100 and 500 per question based on difficulty. When the chosen game type is timed, set seconds per question. When the chosen game type uses cards, also provide front/back cards taken from the supplied material.`;

    let merged: z.infer<typeof GameSchema> | null = null;
    let lastErr: unknown = null;
    // Questions already accepted into this game, by normalized text —
    // shared across batches so a question repeated in a later batch is
    // dropped too. Every batch is cleaned (duplicates dropped, broken
    // correct answers repaired or dropped) before it is merged, and a
    // batch that lost questions asks for replacements in the next one,
    // so the game still reaches the requested count.
    const acceptedQuestions = new Set<string>();
    const cleanBatch = (
      questions: z.infer<typeof GameQuestionSchema>[]
    ) => cleanQuestions(questions, acceptedQuestions);
    try {
      for (let c = 0; c < chunkCount; c++) {
        const have = merged ? merged.questions.length : 0;
        // Bring the total up to this batch's planned slice (or the full
        // count on the last batch), including replacements for any
        // questions dropped from earlier batches.
        const planned = Math.min(count, (c + 1) * CHUNK);
        const wanted = Math.max(0, planned - have);
        if (wanted === 0) continue;
        const prior = merged ? merged.questions.map((q) => q.question) : [];
        const system =
          chunkCount === 1
            ? `${baseSystem} Generate exactly ${wanted} questions for ${players} player(s).`
            : c === 0
              ? `${baseSystem} This is PART 1 of ${chunkCount} of one game — generate exactly ${wanted} questions (questions 1–${wanted} of ${count}) for ${players} player(s).`
              : `${baseSystem} This is PART ${c + 1} of ${chunkCount} of the SAME game you started in part 1 — keep the same title, game type, and style. Generate exactly ${wanted} NEW questions for ${players} player(s). The full game needs ${count} questions; ${have} have been written so far. Do not repeat or rephrase any of these earlier questions from this same game:\n${prior
                  .map((q, i) => `${i + 1}. ${q}`)
                  .join("\n")}\nDo not include cards — part 1 already has them.`;
        const part = await runBatch(
          system,
          basePrompt,
          chunkCount === 1 ? 20000 : 15000
        );
        const cleaned = cleanBatch(part.questions);
        if (!merged) {
          merged = { ...part, questions: cleaned };
        } else {
          merged.questions = [...merged.questions, ...cleaned];
        }
      }

      // Still short after the planned batches (duplicates or broken
      // questions were dropped, or a batch came back short)? Top up
      // with at most two extra batches, each asking for exactly the
      // missing questions — same batch mechanism, no separate pass. If
      // a top-up fails, serve the shorter game rather than failing the
      // whole build.
      let topUps = 0;
      while (
        merged &&
        merged.questions.length < count &&
        topUps < 2
      ) {
        topUps += 1;
        const missing = count - merged.questions.length;
        const prior = merged.questions.map((q) => q.question);
        try {
          const part = await runBatch(
            `${baseSystem} This is a TOP-UP for the SAME game you started — keep the same title, game type, and style. Generate exactly ${missing} NEW questions for ${players} player(s). The full game needs ${count} questions; ${merged.questions.length} are done. Do not repeat or rephrase any of these earlier questions from this same game:\n${prior
              .map((q, i) => `${i + 1}. ${q}`)
              .join("\n")}\nDo not include cards — part 1 already has them.`,
            basePrompt,
            15000
          );
          const cleaned = cleanBatch(part.questions);
          if (cleaned.length === 0) break;
          merged.questions = [...merged.questions, ...cleaned];
        } catch (err) {
          console.error("[/api/generate-game top-up] attempt failed:", err);
          break;
        }
      }
    } catch (err) {
      lastErr = err;
      if (isOverloadedError(lastErr)) {
        return NextResponse.json(
          { error: OVERLOADED_MESSAGE, detail: safeErrorDetail(lastErr) },
          { status: 503 }
        );
      }
      throw lastErr;
    }

    if (!merged) {
      throw new Error("Game generation returned no content.");
    }
    const object = merged;
    return NextResponse.json({
      title: object.title,
      gameType: object.gameType,
      gameDescription: object.gameDescription,
      timedSecondsPerQuestion: object.timedSecondsPerQuestion,
      cards: object.cards ?? [],
      // Cleaned at every batch, so no duplicates and no unanswerable
      // questions; sliced to the requested count in case a batch
      // over-delivered.
      questions: object.questions.slice(0, count),
    });
  } catch (err) {
    console.error("[/api/generate-game] error:", err);
    return NextResponse.json(
      { error: "Failed to generate the game. Please try again.", detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}
