import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getLiteModels,
  getModels,
  isOverloadedError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
  safeErrorDetail,
} from "@/lib/gemini";

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
    } = body as {
      topicOrNotes?: string;
      playerCount?: number;
      questionCount?: number;
      topicType?: string;
      step?: string;
      chosenTemplate?: unknown;
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

    // ---- Step 1: fast template previews (lightest models first) ----
    if (step === "templates") {
      const models = getLiteModels();
      if (models.length === 0) {
        return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
      }

      let lastErr: unknown = null;
      for (const model of models) {
        try {
          const { object } = await generateObject({
            model,
            schema: TemplatesSchema,
            system: `You are StudySMART's Battle Arena game designer. ${topicHint}Dream up exactly 3 DIFFERENT game ideas for the supplied topic or notes — make the game types different from each other where the topic allows (for example trivia race, flashcards, matching, quiz showdown, timed speed drill). These are INCOMPLETE previews, not full games: for each idea give only a short title, the game type, one line describing how it plays, and 1–2 sample questions with four options and the correct answer, all taken strictly from the supplied material. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Keep every description to one short line.`,
            prompt: `Topic / notes to dream up game ideas from:\n\n${topicOrNotes}`,
            maxTokens: 1024,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(10000),
          });

          return NextResponse.json({ templates: object.templates });
        } catch (err) {
          lastErr = err;
          console.error("[/api/generate-game templates] attempt failed:", err);
          if (!isOverloadedError(err)) break;
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
    const models = getModels();
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
          if (!isOverloadedError(err)) break;
        }
      }
      throw batchErr;
    }

    const basePrompt = `Topic / notes to build the game from:\n\n${topicOrNotes}`;
    const baseSystem = `You are StudySMART's Battle Arena game generator. ${topicHint}${templateInstruction}First decide the game type that fits this topic — for example a timed speed drill for quantitative material, matching or flashcards for vocabulary material, or a quiz race for other material — then build that game strictly from the topic or notes the user supplies. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Vary the difficulty and assign points between 100 and 500 per question based on difficulty. When the chosen game type is timed, set seconds per question. When the chosen game type uses cards, also provide front/back cards taken from the supplied material.`;

    let merged: z.infer<typeof GameSchema> | null = null;
    let lastErr: unknown = null;
    try {
      for (let c = 0; c < chunkCount; c++) {
        const start = c * CHUNK;
        const wanted = Math.min(CHUNK, count - start);
        const prior = merged ? merged.questions.map((q) => q.question) : [];
        const system =
          chunkCount === 1
            ? `${baseSystem} Generate exactly ${count} questions for ${players} player(s).`
            : c === 0
              ? `${baseSystem} This is PART 1 of ${chunkCount} of one game — generate exactly ${wanted} questions (questions 1–${wanted} of ${count}) for ${players} player(s).`
              : `${baseSystem} This is PART ${c + 1} of ${chunkCount} of the SAME game you started in part 1 — keep the same title, game type, and style. Generate exactly ${wanted} NEW questions (questions ${start + 1}–${start + wanted} of ${count}) for ${players} player(s). Do not repeat or rephrase any of these earlier questions from this same game:\n${prior
                  .map((q, i) => `${i + 1}. ${q}`)
                  .join("\n")}\nDo not include cards — part 1 already has them.`;
        const part = await runBatch(
          system,
          basePrompt,
          chunkCount === 1 ? 20000 : 15000
        );
        if (!merged) {
          merged = part;
        } else {
          merged.questions = [...merged.questions, ...part.questions];
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
      questions: object.questions,
    });
  } catch (err) {
    console.error("[/api/generate-game] error:", err);
    return NextResponse.json(
      { error: "Failed to generate the game. Please try again.", detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}
