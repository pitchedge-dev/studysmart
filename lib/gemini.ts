import { createGoogleGenerativeAI } from "@ai-sdk/google";

/**
 * Gemini model fallback chain.
 *
 * History: gemini-1.5-flash was retired by Google, and gemini-2.5-flash is
 * no longer available to new users — the live API itself (Nov 2026) directs
 * callers to gemini-3.8-flash. The 3.8-flash free tier is very tight
 * (reported ~5 requests/minute, ~20 requests/day), so on 503 / overloaded /
 * quota errors we fall back to the Lite models, which have a much larger
 * free allowance (reported ~500 requests/day). Never retry the same model
 * more than once — a retry on the same overloaded model just burns quota.
 */
export const GEMINI_MODEL_ID = "gemini-3.8-flash";

export const GEMINI_MODEL_FALLBACKS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
] as const;

function createProvider() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  return createGoogleGenerativeAI({ apiKey });
}

/** The primary Gemini model, wired to the env key. Returns null when no key is set. */
export function getModel() {
  const google = createProvider();
  if (!google) return null;
  return google(GEMINI_MODEL_ID);
}

/** All models in the fallback chain, in priority order. Empty when no key is set. */
export function getModels() {
  const google = createProvider();
  if (!google) return [];
  return GEMINI_MODEL_FALLBACKS.map((id) => google(id));
}

/** True when an error means the model is overloaded / rate-limited / out of
 *  free quota — the cases where trying the next model in the chain helps. */
export function isOverloadedError(err: unknown): boolean {
  const text = (
    err instanceof Error
      ? `${err.name} ${err.message} ${JSON.stringify((err as { cause?: unknown }).cause ?? "")}`
      : String(err)
  ).toLowerCase();
  return (
    text.includes("503") ||
    text.includes("429") ||
    text.includes("overloaded") ||
    text.includes("quota") ||
    text.includes("rate limit") ||
    text.includes("rate_limit") ||
    text.includes("resource exhausted") ||
    text.includes("high demand") ||
    text.includes("too many requests") ||
    text.includes("unavailable") ||
    text.includes("abort") ||
    text.includes("timed out") ||
    text.includes("timeout")
  );
}

export const MISSING_KEY_MESSAGE =
  "GOOGLE_GENERATIVE_AI_API_KEY is not configured. Add your free Google AI Studio key to the environment to generate content.";

export const OVERLOADED_MESSAGE =
  "Gemini is busy / daily free limit reached — try again later";

/** Safe one-line error detail for API responses: the provider's message,
 *  truncated, with anything resembling an API key stripped out. */
export function safeErrorDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]").slice(0, 300);
}
