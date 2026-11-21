import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini model used by every StudySMART route.
 *
 * NOTE: gemini-1.5-flash was retired by Google, and gemini-2.5-flash is
 * no longer available to new users — the live API itself (Nov 2026)
 * directs callers to gemini-3.8-flash. If this model is ever retired,
 * the /api/* 500 responses now include the provider's own guidance in
 * their `detail` field, so the replacement model name is visible.
 * Returns null when no key is set.
 */
export const GEMINI_MODEL_ID = "gemini-3.8-flash";

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
