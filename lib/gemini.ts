/**
 * Backwards-compatible re-export shim.
 *
 * The model fallback logic moved to lib/providers.ts, which now routes
 * EACH generation category to the provider best for that job first
 * (Gemini, Groq, OpenRouter — 3 providers per category). Every existing
 * import from "@/lib/gemini" keeps working unchanged — getModels(),
 * getLiteModels(), isOverloadedError(), OVERLOADED_MESSAGE,
 * MISSING_KEY_MESSAGE and safeErrorDetail all come from the provider
 * module. New code should import from "@/lib/providers" directly and use
 * getModelsFor(category).
 */
export {
  GEMINI_MODEL_ID,
  GEMINI_MODEL_FALLBACKS,
  GEMINI_LITE_MODEL_FALLBACKS,
  GROQ_MODEL_FALLBACKS,
  GROQ_LITE_MODEL,
  GROQ_VISION_MODEL,
  OPENROUTER_MODEL,
  OPENROUTER_REASONING_MODEL,
  OPENROUTER_VISION_MODEL,
  CATEGORY_SPECS,
  CATEGORY_ROUTING,
  getModel,
  getModels,
  getModelsFor,
  getLiteModels,
  getVisionModels,
  isOverloadedError,
  isRetryableProviderError,
  MISSING_KEY_MESSAGE,
  modelLabel,
  OVERLOADED_MESSAGE,
  safeErrorDetail,
} from "./providers";
export type { GenerationCategory } from "./providers";
