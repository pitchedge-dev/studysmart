import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini model used by every StudySMART route.
 *
 * NOTE: gemini-1.5-flash was retired by Google and its API calls fail,
 * which made live generation return 500 for every request. gemini-2.5-flash
 * is the current fast model on the free tier and supports structured output.
 * Returns null when no key is set.
 */
export const GEMINI_MODEL_ID = "gemini-2.5-flash";

export function getModel() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  const google = createGoogleGenerativeAI({ apiKey });
  return google(GEMINI_MODEL_ID);
}

export const MISSING_KEY_MESSAGE =
  "GOOGLE_GENERATIVE_AI_API_KEY is not configured. Add your free Google AI Studio key to the environment to generate content.";

/** Safe one-line error detail for API responses: the provider's message,
 *  truncated, with anything resembling an API key stripped out. */
export function safeErrorDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]").slice(0, 300);
}
