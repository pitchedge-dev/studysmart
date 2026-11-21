import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel, MISSING_KEY_MESSAGE } from "@/lib/gemini";

const QuizQuestionSchema = z.object({
  question: z.string().describe("The quiz question text."),
  options: z
    .array(z.string())
    .length(4)
    .describe("Exactly four answer options."),
  correctAnswer: z
    .string()
    .describe("The exact text of the correct option, matching one of the options."),
  explanation: z
    .string()
    .describe("A detailed explanation of why the correct answer is right."),
});

const GenerateResultSchema = z.object({
  studyGuide: z
    .string()
    .describe(
      "A comprehensive study guide in Markdown with headers, bullet points, and clear explanations, based strictly on the supplied material."
    ),
  keyConcepts: z
    .array(z.string())
    .describe("The key concepts extracted from the supplied material."),
  quiz: z
    .array(QuizQuestionSchema)
    .optional()
    .describe("Multiple-choice practice questions, only when a quiz was requested."),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, images, includeQuiz, extractConcepts } = body as {
      text?: string;
      images?: string[];
      includeQuiz?: boolean;
      extractConcepts?: boolean;
    };

    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasImages = Array.isArray(images) && images.length > 0;
    if (!hasText && !hasImages) {
      return NextResponse.json(
        { error: "Provide notes, text, or an image to generate from." },
        { status: 400 }
      );
    }

    const model = getModel();
    if (!model) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const quizInstruction = includeQuiz
      ? "Also create 8 multiple-choice practice questions (exactly 4 options each) covering the material, each with the correct answer and a detailed explanation."
      : "Do not include a quiz.";
    const conceptsInstruction = extractConcepts
      ? "Extract the key concepts as a short list of concise terms or phrases."
      : "Return an empty keyConcepts list.";

    const systemPrompt = `You are StudySMART, an expert study assistant. Generate study material strictly from the material the user supplies below. Do not invent facts beyond what the supplied material supports, and do not add example topics of your own. ${quizInstruction} ${conceptsInstruction}`;

    const textPart = hasText
      ? `User-supplied material:\n\n${text}`
      : "User-supplied material: see the attached image(s) only.";

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: string }
    > = [{ type: "text", text: textPart }];
    if (hasImages) {
      for (const img of images as string[]) {
        content.push({ type: "image", image: img });
      }
    }

    const { object } = await generateObject({
      model,
      schema: GenerateResultSchema,
      system: systemPrompt,
      messages: [{ role: "user", content }],
    });

    return NextResponse.json({
      studyGuide: object.studyGuide,
      keyConcepts: object.keyConcepts ?? [],
      quiz: includeQuiz ? object.quiz ?? [] : undefined,
    });
  } catch (err) {
    console.error("[/api/generate] error:", err);
    return NextResponse.json(
      { error: "Failed to generate study material. Please try again." },
      { status: 500 }
    );
  }
}
