import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topicOrNotes, playerCount, questionCount, topicType } = body as {
      topicOrNotes?: string;
      playerCount?: number;
      questionCount?: number;
      topicType?: string;
    };

    if (typeof topicOrNotes !== "string" || topicOrNotes.trim().length === 0) {
      return NextResponse.json(
        { error: "Provide a topic or notes to generate a game from." },
        { status: 400 }
      );
    }

    const models = getModels();
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const count =
      typeof questionCount === "number" && questionCount > 0
        ? Math.min(Math.max(Math.floor(questionCount), 1), 20)
        : 10;

    const players =
      typeof playerCount === "number" && playerCount > 0
        ? Math.min(Math.floor(playerCount), 8)
        : 1;

    const topicHint =
      typeof topicType === "string" && topicType.trim()
        ? `The supplied material was classified as: ${topicType.trim()}. `
        : "";

    // Walk the model fallback chain — each model tried at most once, so an
    // overloaded model does not burn its free quota on retries.
    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const { object } = await generateObject({
          model,
          schema: GameSchema,
          system: `You are StudySMART's Battle Arena game generator. ${topicHint}First decide the game type that fits this topic — for example a timed speed drill for quantitative material, matching or flashcards for vocabulary material, or a quiz race for other material — then build that game strictly from the topic or notes the user supplies. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Generate exactly ${count} questions for ${players} player(s). Vary the difficulty and assign points between 100 and 500 per question based on difficulty. When the chosen game type is timed, set seconds per question. When the chosen game type uses cards, also provide front/back cards taken from the supplied material.`,
          prompt: `Topic / notes to build the game from:\n\n${topicOrNotes}`,
          maxTokens: 4096,
          maxRetries: 0,
        });

        return NextResponse.json({
          title: object.title,
          gameType: object.gameType,
          gameDescription: object.gameDescription,
          timedSecondsPerQuestion: object.timedSecondsPerQuestion,
          cards: object.cards ?? [],
          questions: object.questions,
        });
      } catch (err) {
        lastErr = err;
        console.error("[/api/generate-game] attempt failed:", err);
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
  } catch (err) {
    console.error("[/api/generate-game] error:", err);
    return NextResponse.json(
      { error: "Failed to generate the game. Please try again.", detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}
