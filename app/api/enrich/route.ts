import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import {
  getLiteModels,
  isOverloadedError,
  MISSING_KEY_MESSAGE,
  modelLabel,
  OVERLOADED_MESSAGE,
} from "@/lib/gemini";
import { EnrichmentSchema, GenerateResultSchema } from "@/lib/guideSchema";
import { sanitizeGuide } from "@/lib/guideQuality";
import {
  attemptTimeoutMs,
  ENRICH_ATTEMPT_MS,
  ENRICH_WALL_CLOCK_MS,
  MIN_REMAINING_MS,
  remainingMs,
} from "@/lib/generationBudget";

// Finishing sections for a study guide — objectives, cheat sheet,
// real-world applications, FAQ, and the final review quiz. This used
// to run inside /api/generate, concurrently with the core pass, and
// that is what pushed full generations past Vercel's 60s function
// timeout (HTTP 504): an enrichment attempt started at ~44s ran its
// full 15s cap to ~59s while the core pass was still working. Now the
// client calls this route AFTER the core guide lands, so a slow
// finishing pass can no longer fail a generation the core already
// served. Best effort by design: when this fails, the client keeps
// the core guide and the sections simply stay absent.
export const maxDuration = 60;

function logError(tag: string, err: unknown) {
  if (err instanceof Error) {
    console.error(tag, {
      name: err.name,
      message: err.message,
      cause: (err as { cause?: unknown }).cause,
    });
  } else {
    console.error(tag, err);
  }
}

const ENRICHMENT_PROMPT = `You are StudySMART. A study guide is being generated from a student's notes below. Add the finishing sections for it, derived STRICTLY from the notes below — do not invent new facts, do not add topics that are not in the notes. The notes may be just a topic name: in that case write from your own knowledge of that topic. Never write that notes, content, or information is missing, and never return a blank or placeholder item — every objective and every real-life application must contain real content, or be left out entirely. Write 3 to 6 learning objectives (what the student will be able to do after studying this guide), a one-page cheat sheet in Markdown (only the essential definitions, formulas, and steps from the whole guide — the page a student glances at right before the test), 3 to 5 real-world applications (where this topic actually shows up in real life), 4 to 6 frequently asked questions a student would actually ask, with clear direct answers, and a final review quiz of 5 to 10 multiple-choice questions covering the whole guide, each with options, the correct answer, an explanation of why the correct answer works, and one whyWrong entry for EACH wrong option saying why that option is wrong.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, images } = body as {
      text?: string;
      images?: string[];
    };

    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasImages = Array.isArray(images) && images.length > 0;
    if (!hasText && !hasImages) {
      return NextResponse.json(
        { error: "Provide notes, text, or an image to enrich from." },
        { status: 400 }
      );
    }

    const liteModels = getLiteModels();
    if (liteModels.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

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

    // Walk the Lite fallback chain inside a 45s wall clock. Every
    // attempt's abort is cut to the wall clock remaining when the
    // attempt starts (see lib/generationBudget.ts), so this route
    // can never overrun its own 60s function timeout either.
    const startedAt = Date.now();
    let lastErr: unknown = null;
    for (const liteModel of liteModels) {
      if (remainingMs(startedAt, ENRICH_WALL_CLOCK_MS) < MIN_REMAINING_MS)
        break;
      try {
        const { object } = await generateObject({
          model: liteModel,
          schema: EnrichmentSchema,
          system: ENRICHMENT_PROMPT,
          messages: [{ role: "user", content }],
          maxTokens: 2048,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(
            attemptTimeoutMs(startedAt, ENRICH_WALL_CLOCK_MS, ENRICH_ATTEMPT_MS)
          ),
        });
        // Clean the finishing sections exactly as /api/generate
        // cleaned them — a blank objective or a refusal in the cheat
        // sheet is dropped rather than rendered. sanitizeGuide works
        // on a whole guide, so the enrichment fields ride along in a
        // minimal shell and are read back out afterwards.
        const cleaned = sanitizeGuide({
          topicType: "mixed",
          guideTitle: "",
          studyGuide: "",
          summary: "",
          keyTerms: [],
          keyConcepts: [],
          modules: [],
          ...object,
        } as unknown as z.infer<typeof GenerateResultSchema>);
        return NextResponse.json({
          objectives: cleaned.objectives ?? [],
          cheatSheet: cleaned.cheatSheet,
          realWorldApplications: cleaned.realWorldApplications ?? [],
          faq: cleaned.faq ?? [],
          finalReview: cleaned.finalReview,
        });
      } catch (enrichErr) {
        lastErr = enrichErr;
        logError(
          `[/api/enrich] attempt failed (${modelLabel(liteModel)}):`,
          enrichErr
        );
        continue;
      }
    }

    if (isOverloadedError(lastErr)) {
      return NextResponse.json(
        { error: OVERLOADED_MESSAGE },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: "Could not generate the finishing sections. Please try again." },
      { status: 500 }
    );
  } catch (err) {
    logError("[/api/enrich] error:", err);
    return NextResponse.json(
      { error: "Could not generate the finishing sections. Please try again." },
      { status: 500 }
    );
  }
}
