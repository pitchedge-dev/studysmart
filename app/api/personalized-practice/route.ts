import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateObjectSafe } from "@/lib/safeGenerate";
// The practice shape lives in lib/routeSchemas.ts (moved there so the
// strict-schema logic test can import the real definition).
import { PersonalizedPracticeSchema } from "@/lib/routeSchemas";
import {
  getModelsFor,
  isOverloadedError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
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
  /** The concept's mastery level (Khan Academy pattern) — drives the
   *  Bloom's difficulty of the fresh questions. */
  masteryLevel: z
    .enum(["Attempted", "Familiar", "Proficient", "Mastered"])
    .optional(),
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

    // Practice routes to the practice category: Gemini first (most
    // reliable structured output), then Groq (strict JSON), then OpenRouter.
    const models = getModelsFor("practice");
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const weakText = weak
      .map((w, i) => {
        // Adaptive difficulty (Bloom's taxonomy, matched to mastery):
        // a concept the student is still Attempting gets Recall
        // questions; as mastery grows, questions move to Apply and then
        // Analyse — practice stays at the edge of what they can do
        // (Vygotsky's zone of proximal development; Bloom's mastery
        // learning). The evidence for adaptive practice is mixed — one
        // large Dutch RCT found no average test-score effect — so this
        // is difficulty matching, not a promised gain.
        const difficultyHint =
          w.masteryLevel === "Mastered"
            ? " — mastery: Mastered, write Analyse questions (compare, explain why, break it apart)"
            : w.masteryLevel === "Proficient"
              ? " — mastery: Proficient, write Apply questions (use the idea in a new situation)"
              : w.masteryLevel === "Familiar"
                ? " — mastery: Familiar, mix one Recall and one Apply question"
                : " — mastery: Attempted, write Recall questions (remember and understand the idea)";
        const lines = [
          `${i + 1}. ${w.conceptTitle}${w.moduleTitle ? ` (module: ${w.moduleTitle})` : ""}${w.misses ? ` — missed ${w.misses} time${w.misses === 1 ? "" : "s"}` : ""}${difficultyHint}`,
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
        const { object } = await generateObjectSafe({
          model,
// The wrapper applies schemaForModel internally (Pollinations gets
          // the strictified schema, others the zod schema unchanged) and
          // salvages a truncated response instead of failing the attempt
          // (see lib/safeGenerate.ts).
          zodSchema: PersonalizedPracticeSchema,
          system: `You are StudySMART's personalized practice tutor. ${titleHint}${levelHint}The student got these concepts wrong on their own copy of this study guide — build fresh practice that targets exactly those weak spots. Write NEW questions (never reuse the question they already missed), two per weak concept, up to six total. Make the questions directly test the misunderstanding shown by their wrong answer, and explain in each answer why the right answer is right and why their previous wrong answer was wrong. For EVERY question, add one whyWrong entry for EACH wrong option, saying why that option is wrong — never explain only the correct answer. Match each question's difficulty to the mastery note on its concept (Recall / Apply / Analyse) and tag it with that difficulty. Keep every question and explanation short and at the right level. Do not invent topics beyond these concepts.`,
          prompt: `The student's weak concepts:\n\n${weakText}`,
          maxTokens: 4096,
          maxRetries: 2,
          abortSignal: AbortSignal.timeout(25000),
        });

        // Normalize: the correct answer MUST match one of the options,
        // or the frontend cannot score the question. Fix up near-misses
        // (extra spaces / case) and drop questions that still do not
        // match — a dropped question is better than an unscorable one.
        // whyWrong entries are kept only when they name a real wrong
        // option with a real reason.
        const questions = object.questions
          .map((qq) => {
            const options = (qq.options ?? []).map((o) => String(o));
            const correct = String(qq.correctAnswer ?? "");
            const exact = options.find((o) => o === correct);
            if (exact) {
              const whyWrong = (qq.whyWrong ?? [])
                .filter(
                  (w) =>
                    typeof w?.option === "string" &&
                    options.includes(w.option) &&
                    w.option !== exact &&
                    typeof w?.reason === "string" &&
                    w.reason.trim().length > 0
                )
                .map((w) => ({ option: w.option, reason: w.reason.trim() }));
              return { ...qq, options, correctAnswer: exact, whyWrong };
            }
            const loose = options.find(
              (o) => o.trim().toLowerCase() === correct.trim().toLowerCase()
            );
            if (loose) return { ...qq, options, correctAnswer: loose };
            return null;
          })
          .filter((qq): qq is NonNullable<typeof qq> => qq !== null);
        if (questions.length === 0) {
          // Nothing usable — try the next model in the chain.
          throw new Error(
            "Model returned practice questions whose answers did not match their options."
          );
        }
        return NextResponse.json({ questions });
      } catch (err) {
        lastErr = err;
        console.error("[/api/personalized-practice] attempt failed:", err);
        // Keep walking the fallback chain on ANY failure (including schema
        // mismatches) — stopping after the first model wastes the chain.
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
    console.error("[/api/personalized-practice] error:", err);
    return NextResponse.json(
      {
        error: "Failed to generate personalized practice. Please try again.",
      },
      { status: 500 }
    );
  }
}
