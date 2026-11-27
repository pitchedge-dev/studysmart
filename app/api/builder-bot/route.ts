import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import {
  BuilderBotEditResultSchema,
  type GuideJson,
} from "@/lib/guideSchema";
import { diffGuideEdit, isAdditiveRequest, restoreRemovedContent } from "@/lib/builderBot";
import { sanitizeGuide } from "@/lib/guideQuality";
import { schemaForModel } from "@/lib/strictSchema";
import {
  getModelsFor,
  isOverloadedError,
  isRetryableProviderError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
} from "@/lib/gemini";

// Vercel Hobby functions are killed after a short default timeout; allow the
// full 60s so a real edit can finish instead of dying mid-stream.
export const maxDuration = 60;

const MAX_INSTRUCTION_CHARS = 2000;
const MAX_HISTORY_MESSAGES = 10;

type HistoryMessage = { role: "user" | "assistant"; content: string };

function isGuideShape(value: unknown): value is GuideJson {
  if (typeof value !== "object" || value === null) return false;
  const g = value as Record<string, unknown>;
  return typeof g.studyGuide === "string" && Array.isArray(g.modules);
}

/** Keep the guide JSON sent to the model compact: the model needs the
 *  whole guide to edit it accurately, but long example/explanation
 *  strings bloat the prompt. Cap each free-text field at a generous
 *  length so a very long guide still fits comfortably. */
function compactGuide(guide: GuideJson): GuideJson {
  const cap = (s: unknown, n = 2000): unknown =>
    typeof s === "string" && s.length > n ? s.slice(0, n) : s;
  return {
    ...guide,
    studyGuide: cap(guide.studyGuide, 12000) as string,
    summary: cap(guide.summary, 1000) as string,
    cheatSheet: cap(guide.cheatSheet, 4000) as string | undefined,
  };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { guideId, instruction, guide, history } = body as {
      guideId?: unknown;
      instruction?: unknown;
      guide?: unknown;
      history?: unknown;
    };

    if (typeof guideId !== "string" || guideId.trim().length === 0) {
      return NextResponse.json(
        { error: "A guide id is required." },
        { status: 400 }
      );
    }
    if (typeof instruction !== "string" || instruction.trim().length === 0) {
      return NextResponse.json(
        { error: "Tell Builder Bot what to change." },
        { status: 400 }
      );
    }
    if (instruction.trim().length > MAX_INSTRUCTION_CHARS) {
      return NextResponse.json(
        { error: "Keep the change request under 2,000 characters." },
        { status: 400 }
      );
    }
    if (!isGuideShape(guide)) {
      return NextResponse.json(
        { error: "A valid study guide is required." },
        { status: 400 }
      );
    }

    const cleanHistory: HistoryMessage[] = Array.isArray(history)
      ? (history as HistoryMessage[])
          .filter(
            (m) =>
              m &&
              (m.role === "user" || m.role === "assistant") &&
              typeof m.content === "string"
          )
          .slice(-MAX_HISTORY_MESSAGES)
      : [];

    // Edits route to the guides category: Gemini first (proven
    // structured output here), then Groq, then OpenRouter.
    const models = getModelsFor("guides");
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const guideJson = JSON.stringify(compactGuide(guide), null, 1);
    const historyText =
      cleanHistory.length > 0
        ? `\n\nEarlier edits in this conversation (most recent last):\n${cleanHistory
            .map((m) => `${m.role === "user" ? "Student" : "Builder Bot"}: ${m.content}`)
            .join("\n")}`
        : "";

    const system = `You are Builder Bot, the editing assistant inside StudySMART. The student is asking you to change ONE of their own study guides. The full current guide is below, as JSON.

YOUR JOB: return the COMPLETE updated guide with the requested change applied. Every field must be present, including everything that did not change. Never return a partial guide or a patch.

RULES — follow all of them:
1. Make ONLY the change the student asked for. Keep everything else — module numbers, concept titles, wording — exactly as it is unless the request says to change it.
1b. ADDITIVE BY DEFAULT: when the student asks to ADD something — more questions, a new concept, another module, extra examples — ONLY add. Never remove, shorten, replace, or drop any existing content to make room for the addition. Every existing module, concept, practice problem, quiz question, checkpoint question, and final review question stays exactly as it is unless the student explicitly asks to remove or replace it. If the guide is getting long, add the new content anyway and say so in your summary — never silently delete existing work to fit.
2. Base ALL new content on the guide's own material and topic. Do not invent facts, and NEVER invent a study, citation, statistic, date, or quote that is not already in the guide. If the request needs facts the guide does not contain, add only what the guide supports and say plainly in your summary what is missing.
3. Keep every correct answer matching one of its options, and keep practice problems tied to the concept they belong to. For every multiple-choice question you add, explain why the correct answer is right and why EACH wrong option is wrong (one whyWrong entry per wrong option).
4. If the request is vague or would delete most of the guide, do the smallest sensible version of it and say so in your summary.
5. If the student asks for something you cannot do (for example, adding a whole new subject that is not in the guide), say so in your summary and return the guide unchanged.

CURRENT GUIDE (JSON):
${guideJson}${historyText}`;

    const prompt = `Change request: ${instruction.trim()}

Return the summary, the change list, and the complete updated guide.`;

    // Walk the model fallback chain — each model tried at most once.
    // Retries + a higher token budget + the loosened edit schema (see
    // lib/guideSchema.ts) are what keep a slightly-over-bounds edit
    // from failing the whole request with a 500.
    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const { object } = await generateObject({
          model,
          // Pollinations enforces strict JSON Schema (see
          // lib/strictSchema.ts) — it gets the strictified schema.
          schema: schemaForModel(model, BuilderBotEditResultSchema),
          system,
          prompt,
          maxTokens: 8192,
          maxRetries: 2,
          abortSignal: AbortSignal.timeout(55000),
        });
        const updatedGuide = object.updatedGuide as unknown as GuideJson;
        // Additive requests must not silently drop existing content:
        // if the model removed anything while adding, put it back
        // before the diff is computed, so what the student sees — and
        // what gets saved — is purely additive. The change list below
        // is then computed from the final guide, not the model's
        // self-report and not the pre-restore draft.
        let finalGuide = updatedGuide;
        let restoredNote: string | null = null;
        if (isAdditiveRequest(instruction)) {
          const restored = restoreRemovedContent(guide, updatedGuide);
          if (restored.restored.length > 0) {
            finalGuide = restored.guide;
            restoredNote = `Nothing was removed — kept ${restored.restored.join(", ")}.`;
          }
        }
        // Clean the edited guide the same way a fresh generation is
        // cleaned: no refusal / blank / broken content can sneak in
        // through an edit.
        finalGuide = sanitizeGuide(finalGuide);
        const diff = diffGuideEdit(guide, finalGuide);
        return NextResponse.json({
          updatedGuide: finalGuide,
          summary: restoredNote
            ? `${object.summary} ${restoredNote}`
            : object.summary,
          changes: diff.changes,
          destructive: diff.destructive,
          destructiveDetail: diff.destructiveDetail ?? null,
        });
      } catch (err) {
        lastErr = err;
        console.error("[/api/builder-bot] attempt failed:", err);
        if (!isRetryableProviderError(err)) break;
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
    console.error("[/api/builder-bot] error:", err);
    return NextResponse.json(
      { error: "Builder Bot could not make that change. Please try again." },
      { status: 500 }
    );
  }
}
