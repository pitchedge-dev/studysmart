import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getModelsFor,
  isOverloadedError,
  isRetryableProviderError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
} from "@/lib/gemini";
import { schemaForModel } from "@/lib/strictSchema";
// The grading shape lives in lib/routeSchemas.ts (moved there so the
// strict-schema logic test can import the real definition).
import { CheckReasoningSchema } from "@/lib/routeSchemas";

export const maxDuration = 60;


/**
 * POST /api/check-reasoning
 *
 * The student writes their reasoning by hand (stylus on iPad, finger or
 * mouse elsewhere) and the AI reads the handwriting image with vision
 * (Gemini first, then Groq and OpenRouter as fallback) and grades it. The check scores TWO things: the WORK — is the
 * final answer right? — and the PROCESS — are the steps logical, in the
 * right order, complete, with the working shown? The result is a score
 * out of 10, pros, cons, and a hint. Unreadable handwriting is reported
 * plainly and never guessed at, and is never recorded as an error.
 * Everything is generated on demand; nothing is premade.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image, question, solution, explanation } = body as {
      image?: string;
      question?: string;
      solution?: string;
      explanation?: string;
    };

    if (
      typeof image !== "string" ||
      !image.startsWith("data:image/") ||
      image.length < 100
    ) {
      return NextResponse.json(
        { error: "Write your reasoning on the canvas first, then check it." },
        { status: 400 }
      );
    }
    // ~1.5 MB of base64 — a full canvas drawing is far smaller than this.
    if (image.length > 2_000_000) {
      return NextResponse.json(
        { error: "That drawing is too large to check. Clear the canvas and write a shorter answer." },
        { status: 400 }
      );
    }
    if (typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { error: "The reasoning question is missing." },
        { status: 400 }
      );
    }

    // Vision-capable models only: text-only fallback models cannot read
    // the handwriting image, so they are not in this list. Routes to the
    // reasoning category: Gemini vision first, then Groq, then OpenRouter.
    const models = getModelsFor("reasoning");
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const systemPrompt = `You are StudySMART, an expert tutor checking a student's handwritten reasoning. Look carefully at the handwritten work in the attached image and grade it against the question and the correct solution below.

Grade TWO things, and let both shape the score out of 10:
1. THE WORK — the final answer / result itself: is it correct?
2. THE PROCESS — the reasoning steps and method the student wrote out: are the steps logical, in the right order, complete, with the working actually shown? A correct final answer with no working shown, skipped steps, or a lucky guess scores lower than the same answer with clear steps. A good method with one small arithmetic slip scores higher than a wrong method with a wrong answer.

Scoring: about half the marks for the work, about half for the process. 9–10: fully correct answer AND clear, correct, complete steps. 5–8: partly right — for example the right method but a wrong final answer, or the right answer but missing/skipped steps. 0–4: mostly wrong, wrong method, or almost no working shown.

Transcribe exactly what the student wrote — do not add steps they did not write, and do not fix their mistakes in the transcription. If the handwriting is blank, too faint, too messy, or cropped so it cannot be read, set readable to false, transcription to an empty string, score to 0, pros to an empty list, cons to a single item saying the handwriting could not be read, and hint to advice to write bigger and clearer. NEVER guess at unreadable writing and NEVER invent what the student wrote.

List pros (what was done well: correct steps, good method, clear working) and cons (what was wrong or missing: skipped steps, wrong method, unclear working, arithmetic slip), each as short plain sentences, at most 5 each. End with one concrete hint for the student's next try.`;

    const userText = [
      `Reasoning question: ${question}`,
      solution ? `Correct solution: ${solution}` : "",
      explanation ? `Why the solution works: ${explanation}` : "",
      "Grade the handwritten work in the image against this question and solution.",
    ]
      .filter(Boolean)
      .join("\n\n");

    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const { object } = await generateObject({
          model,
          // Pollinations is not in the vision chain, but every
          // generateObject call goes through schemaForModel so a
          // future provider addition cannot reintroduce the strict-
          // schema rejection (see lib/strictSchema.ts).
          schema: schemaForModel(model, CheckReasoningSchema),
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: userText },
                { type: "image", image },
              ],
            },
          ],
          maxTokens: 1024,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(25000),
        });
        return NextResponse.json({
          readable: object.readable,
          transcription: object.transcription,
          score: object.score,
          pros: object.pros ?? [],
          cons: object.cons ?? [],
          hint: object.hint,
        });
      } catch (err) {
        lastErr = err;
        console.error("[/api/check-reasoning] attempt failed:", err);
        if (isRetryableProviderError(err)) continue;
        break;
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
    console.error("[/api/check-reasoning] error:", err);
    return NextResponse.json(
      {
        error: "The reasoning could not be checked. Please try again.",
      },
      { status: 500 }
    );
  }
}
