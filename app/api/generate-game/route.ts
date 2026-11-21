import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel, MISSING_KEY_MESSAGE } from "@/lib/gemini";

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

const GameSchema = z.object({
  title: z.string().describe("A short, engaging title for this trivia game, derived from the supplied topic/notes."),
  questions: z.array(GameQuestionSchema).describe("The trivia questions."),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { topicOrNotes, playerCount, questionCount } = body as {
      topicOrNotes?: string;
      playerCount?: number;
      questionCount?: number;
    };

    if (typeof topicOrNotes !== "string" || topicOrNotes.trim().length === 0) {
      return NextResponse.json(
        { error: "Provide a topic or notes to generate a game from." },
        { status: 400 }
      );
    }

    const model = getModel();
    if (!model) {
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

    const { object } = await generateObject({
      model,
      schema: GameSchema,
      system: `You are StudySMART's Battle Arena game generator. Create a fun, fair trivia game strictly from the topic or notes the user supplies. Do not invent facts beyond what the supplied material supports, and do not add example topics of your own. Generate exactly ${count} questions for ${players} player(s). Vary the difficulty and assign points between 100 and 500 per question based on difficulty.`,
      prompt: `Topic / notes to build the trivia game from:\n\n${topicOrNotes}`,
    });

    return NextResponse.json({
      title: object.title,
      questions: object.questions,
    });
  } catch (err) {
    console.error("[/api/generate-game] error:", err);
    return NextResponse.json(
      { error: "Failed to generate the game. Please try again." },
      { status: 500 }
    );
  }
}
