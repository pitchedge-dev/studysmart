import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import {
  getModelsFor,
  isOverloadedError,
  isRetryableProviderError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
  safeErrorDetail,
} from "@/lib/gemini";

export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { messages, studyGuide, context, hintMode } = body as {
      messages?: ChatMessage[];
      studyGuide?: string;
      context?: string;
      hintMode?: boolean;
    };

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Provide at least one message." },
        { status: 400 }
      );
    }

    // Chat routes to the chat category: Groq first (fastest replies),
    // then Gemini Lite, then OpenRouter.
    const models = getModelsFor("chat");
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const guideContext =
      typeof studyGuide === "string" && studyGuide.trim().length > 0
        ? `Here is the student's current study guide. Use it as the context for your answers, rewrites, and explanations:\n\n${studyGuide}`
        : "No study guide has been generated yet. Answer from the conversation and any extra context provided.";

    const extraContext =
      typeof context === "string" && context.trim().length > 0
        ? `\n\nAdditional context for this question (for example, the quiz question and the answer the student picked):\n${context}`
        : "";

    const system = `You are StudySMART's AI Tutor, a patient and encouraging study assistant. ${guideContext}${extraContext} Answer clearly and accurately, grounded in the study guide and supplied context above. When asked to rewrite a section, return the rewritten section in Markdown. When explaining a wrong quiz answer, explain why the chosen answer is incorrect and why the correct answer is right, without simply restating the answer. Never invent study material or topics beyond what the user has supplied.${hintMode ? ` HINT MODE IS ON — be Socratic, never give the answer straight away: first ask what the student has already tried and what they think the first step is, then give exactly ONE small hint at a time and wait for the student to try it. Only reveal the full answer after the student has attempted it, or after they ask for it directly.` : ""}`;

    // Walk the model fallback chain — each model tried at most once.
    let lastErr: unknown = null;
    for (const model of models) {
      try {
        const { text } = await generateText({
          model,
          system,
          messages: messages.map((m) => ({
            role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
            content: m.content,
          })),
          maxTokens: 2048,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(20000),
        });
        return NextResponse.json({ reply: text });
      } catch (err) {
        lastErr = err;
        console.error("[/api/chat] attempt failed:", err);
        if (!isRetryableProviderError(err)) break;
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
    console.error("[/api/chat] error:", err);
    return NextResponse.json(
      { error: "The tutor could not respond. Please try again.", detail: safeErrorDetail(err) },
      { status: 500 }
    );
  }
}
