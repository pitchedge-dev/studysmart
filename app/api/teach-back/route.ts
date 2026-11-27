import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  getModelsFor,
  isOverloadedError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
} from "@/lib/gemini";
import { generateObjectSafe } from "@/lib/safeGenerate";
// The grading shape lives in lib/routeSchemas.ts (moved there so the
// strict-schema logic test can import the real definition).
import { TeachBackSchema } from "@/lib/routeSchemas";

export const maxDuration = 60;


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
        const { object } = await generateObjectSafe({
          model,
// The wrapper applies schemaForModel internally (Pollinations gets
          // the strictified schema, others the zod schema unchanged) and
          // salvages a truncated response instead of failing the attempt
          // (see lib/safeGenerate.ts).
          zodSchema: TeachBackSchema,
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
        { error: OVERLOADED_MESSAGE },
        { status: 503 }
      );
    }
    throw lastErr;
  } catch (err) {
    console.error("[/api/teach-back] error:", err);
    return NextResponse.json(
      {
        error: "Could not grade your explanation. Please try again.",
      },
      { status: 500 }
    );
  }
}
