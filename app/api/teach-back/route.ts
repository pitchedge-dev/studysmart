import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getModelsFor,
  isOverloadedError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
  safeErrorDetail,
} from "@/lib/gemini";

export const maxDuration = 60;

const TeachBackSchema = z.object({
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

/**
 * POST /api/teach-back
 *
 * Feynman / "teach it back" grading: the student explains a concept in
 * their own words with their notes closed, and the AI grades the
 * explanation against the guide's OWN definition and explanation — never
 * against invented material. Everything is generated on demand from the
 * student's own guide and their own words; nothing is premade.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      conceptTitle,
      definition,
      explanation,
      studentExplanation,
      educationLevel,
    } = body as {
      conceptTitle?: string;
      definition?: string;
      explanation?: string;
      studentExplanation?: string;
      educationLevel?: string;
    };

    if (
      typeof conceptTitle !== "string" ||
      !conceptTitle.trim() ||
      typeof studentExplanation !== "string" ||
      studentExplanation.trim().length < 10
    ) {
      return NextResponse.json(
        {
          error:
            "Write your explanation first — at least a sentence or two, in your own words, without looking at your notes.",
        },
        { status: 400 }
      );
    }

    // Teach-back grades with a structured schema, so it routes to the
    // practice category: Gemini first (most reliable structured output),
    // then Groq (strict JSON), then OpenRouter.
    const models = getModelsFor("practice");
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const levelHint =
      typeof educationLevel === "string" && educationLevel.trim()
        ? ` The student is at ${educationLevel.trim()} level — judge the explanation at that level.`
        : "";
    const sourceMaterial = [
      `Definition from the student's own study guide: "${(definition ?? "").trim() || "Not given."}"`,
      explanation?.trim()
        ? `How it works, from the same guide: "${explanation.trim()}"`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const { object } = await generateObject({
          model,
          schema: TeachBackSchema,
          system: `You are StudySMART's teach-back grader. A student just tried to explain a concept from memory, as if teaching a beginner, with their notes closed. Grade ONLY against the source material from their own study guide below — never invent facts, and never mark the student down for missing something that is not in the source material. Score generously but honestly: 9-10 means every key point covered in plain words with nothing wrong; 7-8 means the core idea is right with a small gap; 4-6 means partly right with real gaps; 0-3 means the explanation is mostly wrong or empty. Name misconceptions plainly when the student said something incorrect. Keep every list short and every sentence plain.${levelHint}`,
          prompt: `Concept: "${conceptTitle.trim()}"\n\n${sourceMaterial}\n\nThe student's explanation (written from memory):\n"${studentExplanation.trim()}"`,
          maxTokens: 2048,
          maxRetries: 2,
          abortSignal: AbortSignal.timeout(25000),
        });
        return NextResponse.json({ result: object });
      } catch (err) {
        lastErr = err;
        console.error("[/api/teach-back] attempt failed:", err);
        // Keep walking the fallback chain on ANY failure.
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
    console.error("[/api/teach-back] error:", err);
    return NextResponse.json(
      {
        error: "Could not grade your explanation. Please try again.",
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
