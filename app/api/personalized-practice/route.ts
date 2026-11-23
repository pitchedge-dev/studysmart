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

const WeakConceptSchema = z.object({
  conceptTitle: z.string(),
  moduleTitle: z.string().optional(),
  misses: z.number().int().optional(),
  lastQuestion: z.string().optional(),
  lastPicked: z.string().optional(),
  lastCorrect: z.string().optional(),
  lastExplanation: z.string().optional(),
});

const PersonalizedQuestionSchema = z.object({
  conceptTitle: z
    .string()
    .describe("The weak concept this question practices — must match one of the supplied weak concepts."),
  question: z.string().describe("A fresh practice question on the weak concept. Do not reuse the question the student already missed."),
  options: z
    .array(z.string())
    .length(4)
    .describe("Exactly four answer options."),
  correctAnswer: z
    .string()
    .describe("The exact text of the correct option, matching one of the options."),
  explanation: z
    .string()
    .describe("A short explanation of why the correct answer is right — and, where the student picked a wrong answer before, why that wrong answer is wrong."),
});

const PersonalizedPracticeSchema = z.object({
  questions: z
    .array(PersonalizedQuestionSchema)
    .min(3)
    .max(6)
    .describe("Fresh targeted practice questions for the student's weak concepts — two per weak concept, up to six total."),
});

/**
 * POST /api/personalized-practice
 *
 * Generates fresh practice for exactly the concepts THIS user got wrong on
 * THIS copy of a guide. The weak concepts (with the question they missed
 * and the wrong answer they picked) come from the user's own error records
 * — never from another user's data, and never from a published/shared copy.
 * Everything is generated on demand; nothing is premade.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { guideTitle, educationLevel, weakConcepts } = body as {
      guideTitle?: string;
      educationLevel?: string;
      weakConcepts?: unknown;
    };

    const parsed = z.array(WeakConceptSchema).min(1).max(3).safeParse(weakConcepts);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Provide 1–3 weak concepts to generate practice for." },
        { status: 400 }
      );
    }
    const weak = parsed.data;

    const models = getModels();
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const weakText = weak
      .map((w, i) => {
        const lines = [
          `${i + 1}. ${w.conceptTitle}${w.moduleTitle ? ` (module: ${w.moduleTitle})` : ""}${w.misses ? ` — missed ${w.misses} time${w.misses === 1 ? "" : "s"}` : ""}`,
        ];
        if (w.lastQuestion) lines.push(`   Last missed question: "${w.lastQuestion}"`);
        if (w.lastPicked) lines.push(`   The student answered: "${w.lastPicked}"`);
        if (w.lastCorrect) lines.push(`   The correct answer was: "${w.lastCorrect}"`);
        if (w.lastExplanation) lines.push(`   Why: ${w.lastExplanation}`);
        return lines.join("\n");
      })
      .join("\n");

    const levelHint =
      typeof educationLevel === "string" && educationLevel.trim()
        ? `Write at the ${educationLevel.trim()} level. `
        : "";
    const titleHint =
      typeof guideTitle === "string" && guideTitle.trim()
        ? `The study guide is titled "${guideTitle.trim()}". `
        : "";

    // Walk the model fallback chain — each model tried at most once.
    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const { object } = await generateObject({
          model,
          schema: PersonalizedPracticeSchema,
          system: `You are StudySMART's personalized practice tutor. ${titleHint}${levelHint}The student got these concepts wrong on their own copy of this study guide — build fresh practice that targets exactly those weak spots. Write NEW questions (never reuse the question they already missed), two per weak concept, up to six total. Make the questions directly test the misunderstanding shown by their wrong answer, and explain in each answer why the right answer is right and why their previous wrong answer was wrong. Keep every question and explanation short and at the right level. Do not invent topics beyond these concepts.`,
          prompt: `The student's weak concepts:\n\n${weakText}`,
          maxTokens: 2048,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(20000),
        });

        return NextResponse.json({ questions: object.questions });
      } catch (err) {
        lastErr = err;
        console.error("[/api/personalized-practice] attempt failed:", err);
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
    console.error("[/api/personalized-practice] error:", err);
    return NextResponse.json(
      {
        error: "Failed to generate personalized practice. Please try again.",
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
