import { createGoogleGenerativeAI } from "@ai-sdk/google";

/** Gemini 1.5 Flash model, wired to the env key. Returns null when no key is set. */
export function getModel() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  const google = createGoogleGenerativeAI({ apiKey });
  return google("gemini-1.5-flash");
}

export const MISSING_KEY_MESSAGE =
  "GOOGLE_GENERATIVE_AI_API_KEY is not configured. Add your free Google AI Studio key to the environment to generate content.";
