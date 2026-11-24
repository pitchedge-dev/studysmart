import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * Cross-provider AI routing, PER CATEGORY.
 *
 * History: everything used to go through Google Gemini only, and the
 * Gemini free tier (~20 requests/day on Flash) kept getting exhausted,
 * which blocked the whole site. First we added one global fallback list
 * (Gemini → Groq → OpenRouter). Now each generation category routes to
 * the provider that is BEST for that job first, with the other two free
 * providers as backups — so the best API is always used, and any one
 * provider running out just falls through to the next.
 *
 * A provider with no key set is skipped silently, so the app works
 * exactly as before with only the Gemini key set.
 *
 * Research (limits as published Nov 2026, re-check the consoles before
 * relying on exact numbers):
 * ~/workspace/goals/studysmart-educational-web-app/hidden_files/multi-provider-research-2026-11-24.md
 *
 * Keys come ONLY from environment variables. Never hardcode, log, or
 * commit a key value. See .env.example for the names.
 */

export type GenerationCategory =
  | "guides"
  | "chat"
  | "games"
  | "practice"
  | "videos"
  | "reasoning";

// ---------------------------------------------------------------------------
// Gemini (primary for long/knowledge-heavy work — model list unchanged)
// ---------------------------------------------------------------------------

export const GEMINI_MODEL_ID = "gemini-3.8-flash";

export const GEMINI_MODEL_FALLBACKS = [
  "gemini-3.8-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.1-flash-lite",
] as const;

/** Lite-first order for the fast steps: the lightest models answer in a
 *  few seconds and have the largest free allowance. */
export const GEMINI_LITE_MODEL_FALLBACKS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.8-flash",
  "gemini-3.6-flash",
] as const;

// ---------------------------------------------------------------------------
// Groq (fastest inference — best for chat and games)
// Free plan, no card: gpt-oss-120b / gpt-oss-20b are 30 RPM, 1,000
// requests/day each; qwen3.8-27b is multimodal (vision) with the same caps.
// gpt-oss-20b runs at ~1,000 tokens/sec, gpt-oss-120b at ~500 tok/s.
// Strict json_schema structured outputs work on the gpt-oss models.
// Llama 4 Scout/Maverick are DEAD on Groq (shut down 2026-07-17) — never
// use those IDs.
// ---------------------------------------------------------------------------

export const GROQ_MODEL_FALLBACKS = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
] as const;

/** Fast Groq model for the lite-first steps. */
export const GROQ_LITE_MODEL = "openai/gpt-oss-20b";

/** Groq vision backup for /api/check-reasoning (multimodal + JSON mode). */
export const GROQ_VISION_MODEL = "qwen/qwen3.8-27b";

// ---------------------------------------------------------------------------
// OpenRouter (breadth — best free models behind one key)
// Free :free models, no card: 20 RPM, 50 requests/day with no purchase.
// The roster rotates every few weeks. Where a specific model is named
// below it is one verified answering reliably in Nov 2026 benchmarks
// (20/20 requests answered and passed), and `openrouter/free` (the router
// over whatever is free that day) always follows it as the last entry so
// a rotated-away model ID cannot strand the category.
// ---------------------------------------------------------------------------

export const OPENROUTER_MODEL = "openrouter/free";
/** Strongest free reasoning model, strict JSON 6/6 in Nov 2026 benchmarks. */
export const OPENROUTER_REASONING_MODEL =
  "nvidia/nemotron-3-ultra-550b-a55b:free";
/** Most reliable free model overall: 20/20 answered and passed, 106 tok/s,
 *  1M context, vision + JSON 7/7. */
export const OPENROUTER_VISION_MODEL = "nvidia/nemotron-3.5-super-vl:free";

// ---------------------------------------------------------------------------
// Per-category routing.
// Each category lists its models grouped by provider: the PRIMARY provider
// first (best for that job), then BACKUP 1, then BACKUP 2 — 3 providers
// per category, every time. The same provider appears in several
// categories. Within a provider, models are ordered best-first for the job.
// ---------------------------------------------------------------------------

type ProviderKind = "google" | "groq" | "openrouter";
type ModelSpec = readonly [ProviderKind, string];

export const CATEGORY_SPECS: Record<GenerationCategory, readonly ModelSpec[]> =
  {
    // Long structured output (guide Markdown + quiz JSON, big schema).
    // Primary Gemini: proven in this app, 1M context, strong structured
    // output. Backup Groq 120b: strict json_schema, 500 tok/s, 1,000/day.
    // Backup OpenRouter Nemotron 3 Ultra: strongest free reasoning, JSON 6/6.
    guides: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["openrouter", "openrouter/free"],
    ],
    // Conversational tutor, short replies — latency is what matters.
    // Primary Groq 20b: ~1,000 tok/s, first token ~0.24s. Backup Gemini
    // Lite: fast with the biggest allowance. Backup OpenRouter Super VL:
    // 20/20 passed, 106 tok/s.
    chat: [
      ["groq", "openai/gpt-oss-20b"],
      ["groq", "openai/gpt-oss-120b"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["google", "gemini-3.8-flash"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
    ],
    // Battle Arena games — short trivia, templates must return in seconds.
    // Primary Groq 20b: fastest by far. Backup Gemini Lite: fast + big
    // allowance. Backup OpenRouter Super VL: reliable JSON, 106 tok/s.
    games: [
      ["groq", "openai/gpt-oss-20b"],
      ["groq", "openai/gpt-oss-120b"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["google", "gemini-3.8-flash"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
    ],
    // Small structured question sets — schema reliability matters most
    // (this route failed on a schema mismatch before). Primary Gemini
    // 3.8: proven structured output here. Backup Groq 120b: STRICT
    // json_schema guarantees. Backup OpenRouter Super VL: JSON 7/7.
    practice: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
    ],
    // Suggesting real YouTube video IDs — knowledge-heavy.
    // Primary Gemini 3.8: broadest knowledge, proven for video IDs here.
    // Backup Groq 120b: 120B, broad knowledge, JSON mode. Backup
    // OpenRouter Nemotron 3 Ultra: strongest free reasoning/knowledge.
    videos: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.5-flash-lite"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["openrouter", "openrouter/free"],
    ],
    // Vision: reads a handwriting PNG and grades work + process.
    // Text-only models are NOT in this list — sending them an image would
    // just error. Primary Gemini: proven vision here. Backup Groq
    // qwen3.8-27b: multimodal + JSON mode, 450 tok/s. Backup OpenRouter
    // Super VL: vision, 20/20 passed, 106 tok/s. (The openrouter/free
    // router is deliberately NOT here — it can pick a text-only model.)
    reasoning: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["groq", "qwen/qwen3.8-27b"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
    ],
  } as const;

/** Human-readable routing per category (primary → backup 1 → backup 2),
 *  for docs and debugging. */
export const CATEGORY_ROUTING: Record<
  GenerationCategory,
  { primary: string; backup1: string; backup2: string }
> = {
  guides: {
    primary: "Gemini (3.8-flash)",
    backup1: "Groq (gpt-oss-120b)",
    backup2: "OpenRouter (Nemotron 3 Ultra)",
  },
  chat: {
    primary: "Groq (gpt-oss-20b)",
    backup1: "Gemini (3.5-flash-lite)",
    backup2: "OpenRouter (Nemotron 3.5 Super VL)",
  },
  games: {
    primary: "Groq (gpt-oss-20b)",
    backup1: "Gemini (3.5-flash-lite)",
    backup2: "OpenRouter (Nemotron 3.5 Super VL)",
  },
  practice: {
    primary: "Gemini (3.8-flash)",
    backup1: "Groq (gpt-oss-120b, strict JSON)",
    backup2: "OpenRouter (Nemotron 3.5 Super VL)",
  },
  videos: {
    primary: "Gemini (3.8-flash)",
    backup1: "Groq (gpt-oss-120b)",
    backup2: "OpenRouter (Nemotron 3 Ultra)",
  },
  reasoning: {
    primary: "Gemini (3.8-flash, vision)",
    backup1: "Groq (qwen3.8-27b, vision)",
    backup2: "OpenRouter (Nemotron 3.5 Super VL, vision)",
  },
};

// ---------------------------------------------------------------------------
// Provider construction (null when that provider's key is not set)
// ---------------------------------------------------------------------------

function createGoogle() {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return null;
  return createGoogleGenerativeAI({ apiKey });
}

function createGroqProvider() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return createGroq({ apiKey });
}

function createOpenRouterProvider() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return createOpenRouter({ apiKey });
}

type ProviderInstances = {
  google: ReturnType<typeof createGoogle>;
  groq: ReturnType<typeof createGroqProvider>;
  openrouter: ReturnType<typeof createOpenRouterProvider>;
};

function buildProviders(): ProviderInstances {
  return {
    google: createGoogle(),
    groq: createGroqProvider(),
    openrouter: createOpenRouterProvider(),
  };
}

function resolveSpecs(
  specs: readonly ModelSpec[],
  providers: ProviderInstances
): LanguageModel[] {
  const out: LanguageModel[] = [];
  for (const [kind, id] of specs) {
    const provider = providers[kind];
    if (!provider) continue; // no key set for this provider — skip silently
    out.push(provider(id));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Model lists
// ---------------------------------------------------------------------------

/** The primary Gemini model, wired to the env key. Returns null when no key is set. */
export function getModel() {
  const google = createGoogle();
  if (!google) return null;
  return google(GEMINI_MODEL_ID);
}

/** Models for one category, in priority order (primary provider first,
 *  then its two backups). Empty when no provider key is set. */
export function getModelsFor(category: GenerationCategory): LanguageModel[] {
  return resolveSpecs(CATEGORY_SPECS[category], buildProviders());
}

/** All models in the fallback chain, in priority order. Defaults to the
 *  guide category. Empty when no provider key is set. Kept so existing
 *  callers keep working. */
export function getModels(): LanguageModel[] {
  return getModelsFor("guides");
}

/** Fast models first — for the short steps that must return in seconds
 *  (guide enrichment). Groq 20b leads on raw speed, then the Gemini Lite
 *  models, then OpenRouter's most reliable free model + router. */
export function getLiteModels(): LanguageModel[] {
  return resolveSpecs(
    [
      ["groq", "openai/gpt-oss-20b"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
    ],
    buildProviders()
  );
}

/** Vision-capable models only, in priority order — for /api/check-reasoning.
 *  Same as getModelsFor("reasoning"). */
export function getVisionModels(): LanguageModel[] {
  return getModelsFor("reasoning");
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function errorText(err: unknown): string {
  return (
    err instanceof Error
      ? `${err.name} ${err.message} ${JSON.stringify(
          (err as { cause?: unknown }).cause ?? ""
        )}`
      : String(err)
  ).toLowerCase();
}

/** True when an error means the providers are overloaded / rate-limited /
 *  out of free quota — the cases where the user-facing message should say
 *  all providers are exhausted. Used only for the final 503 response. */
export function isOverloadedError(err: unknown): boolean {
  const text = errorText(err);
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

/** True when a failure on one model is worth trying the NEXT model for.
 *  This is broader than isOverloadedError: a wrong key (401), a retired
 *  model ID (404), or a model that returned malformed JSON are all
 *  provider-specific failures — another provider in the chain may well
 *  succeed, so the loop must not stop at the first provider. Only a
 *  failure that is clearly about OUR request (bad input, bad schema of
 *  our own making) should stop the chain, and those do not match any
 *  pattern here. */
export function isRetryableProviderError(err: unknown): boolean {
  if (isOverloadedError(err)) return true;
  const text = errorText(err);
  return (
    text.includes("401") ||
    text.includes("402") ||
    text.includes("404") ||
    text.includes("unauthorized") ||
    text.includes("invalid api key") ||
    text.includes("invalid_api_key") ||
    text.includes("authentication") ||
    text.includes("payment required") ||
    text.includes("not_found") ||
    text.includes("model_not_found") ||
    text.includes("model not found") ||
    text.includes("no object generated") ||
    text.includes("did not match schema") ||
    text.includes("failed to parse")
  );
}

export const MISSING_KEY_MESSAGE =
  "No AI provider key is configured. Add a free key (Google AI Studio, Groq, or OpenRouter) to the environment to generate content.";

export const OVERLOADED_MESSAGE =
  "All AI providers are busy / out of free calls right now — try again later";

/** Safe one-line error detail for API responses: the provider's message,
 *  truncated, with anything resembling an API key stripped out. */
export function safeErrorDetail(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg
    .replace(/AIza[0-9A-Za-z_-]{10,}/g, "[key]")
    .replace(/gsk_[0-9A-Za-z]{10,}/g, "[key]")
    .replace(/sk-or-v1-[0-9A-Za-z]{10,}/g, "[key]")
    .slice(0, 300);
}
