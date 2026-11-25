import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * Cross-provider AI routing, PER CATEGORY — 10 providers.
 *
 * History: everything used to go through Google Gemini only, and the
 * Gemini free tier (~20 requests/day on Flash) kept getting exhausted,
 * which blocked the whole site. First we added one global fallback list
 * (Gemini → Groq → OpenRouter). Then each category routed to the provider
 * best for that job first, with the other two free providers as backups.
 * Now every category routes through TEN free providers (primary + up to
 * 10 backups), so generation never hits a dead end when one provider's
 * free quota runs out.
 *
 * A provider with no key set is skipped silently, so the app works
 * exactly as before with only the Gemini key set. Keys come ONLY from
 * environment variables. Never hardcode, log, or commit a key value.
 * See .env.example for the names.
 *
 * The 10 providers (all free to start, no card — limits as published
 * Nov 2026, re-check the consoles before relying on exact numbers):
 *  1. Google Gemini — AI Studio free tier (~20 req/day Flash).
 *  2. Groq — free, no card: 30 RPM, 1,000 req/day per model.
 *  3. OpenRouter — free :free models, no card: 20 RPM, 50 req/day.
 *  4. Cerebras — free, no card: 1M tokens/day, 30 RPM, 60K TPM.
 *     FREE-TIER CAVEAT: context capped at 8,192 tokens, so it sits
 *     LOW in the guides chain (long output) and HIGH in the short ones.
 *  5. NVIDIA NIM — free, no card: 40 RPM, 10,000 req/day.
 *     CAVEAT: some sign-ups reportedly ask for phone verification.
 *     If it does, skip it — the chain works without it.
 *  6. SambaNova — free, no card: 20 RPM, 20 req/day per model,
 *     200K tokens/day per model.
 *  7. Cohere — trial key free, no card: 1,000 calls/month, 20 RPM.
 *     Trial keys are evaluation-only.
 *  8. Cloudflare Workers AI — free, no card: 10,000 Neurons/day,
 *     300 RPM. Needs TWO env vars: API token + account ID.
 *  9. DeepSeek — 5M free tokens on signup, no card, VALID 30 DAYS.
 *     NOT an ongoing free tier — it expires, so it sits last-but-one.
 * 10. Novita AI — $1 one-time signup credit, no card. Tiny and
 *     one-time, so it sits LAST. Once it is spent, it is paid-only.
 *
 * REJECTED (do not add): Mistral (phone verification required),
 * Together AI (no free tier, $15 min purchase), Fireworks AI (no free
 * plan), Hugging Face Inference (free serverless API gone, pay-as-you-go
 * only), Chutes AI (free tier ended 2026-03-15), GitHub Models (retired
 * July 2026), DeepInfra (no free tier — card or pre-pay required before
 * any request succeeds).
 *
 * Research:
 * ~/workspace/goals/studysmart-educational-web-app/hidden_files/multi-provider-research-2026-11-24.md
 * ~/workspace/goals/studysmart-educational-web-app/hidden_files/ten-backup-providers-research-2026-11-24.md
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
// Cerebras (fastest inference of the new providers — best for short jobs)
// Free, no card: 1M tokens/day, 30 requests/min, 60K tokens/min.
// Models: gpt-oss-120b, qwen-3-235b-a22b-instruct-2507 (strongest),
// llama-3.1-8b, gemma-4-31b (vision). FREE-TIER CAVEAT: context is
// capped at 8,192 tokens, so long guide generations may exceed it —
// Cerebras sits low in the guides chain and high in the short ones.
// ---------------------------------------------------------------------------

export const CEREBRAS_TEXT_MODELS = [
  "gpt-oss-120b",
  "qwen-3-235b-a22b-instruct-2507",
] as const;

/** Cerebras vision model for /api/check-reasoning (Gemma 4 is multimodal). */
export const CEREBRAS_VISION_MODEL = "gemma-4-31b";

// ---------------------------------------------------------------------------
// NVIDIA NIM (strongest free models after Groq — Nemotron 3 Ultra 550B)
// Free, no card: 40 RPM, 10,000 requests/day. Models are namespaced
// (nvidia/…, openai/…, meta/…). Vision: llama-3.2-90b-vision-instruct
// and nemotron-3.5-super-vl-120b-a12b. CAVEAT: sign-up sometimes asks
// for phone verification — if it does, skip this provider.
// ---------------------------------------------------------------------------

export const NVIDIA_TEXT_MODELS = [
  "nvidia/nemotron-3-ultra-550b-a55b",
  "openai/gpt-oss-120b",
] as const;

export const NVIDIA_VISION_MODELS = [
  "meta/llama-3.2-90b-vision-instruct",
  "nvidia/nemotron-3.5-super-vl-120b-a12b",
] as const;

// ---------------------------------------------------------------------------
// SambaNova (free, no card: 20 RPM, 20 requests/day per model,
// 200K tokens/day per model). Models: gpt-oss-120b, Meta-Llama-3.3-70B-
// Instruct, gemma-4-31B-it (vision — Gemma 4 is multimodal).
// ---------------------------------------------------------------------------

export const SAMBANOVA_TEXT_MODELS = [
  "gpt-oss-120b",
  "Meta-Llama-3.3-70B-Instruct",
] as const;

/** SambaNova vision model for /api/check-reasoning. */
export const SAMBANOVA_VISION_MODEL = "gemma-4-31B-it";

// ---------------------------------------------------------------------------
// Cohere (trial key free, no card: 1,000 API calls/month, 20 chat RPM).
// Reached through Cohere's OpenAI-compatibility endpoint, so no extra
// SDK is needed. Models: command-a-03-2025 (text), command-a-vision-
// 07-2025 (vision). Trial keys are evaluation-only.
// ---------------------------------------------------------------------------

export const COHERE_TEXT_MODEL = "command-a-03-2025";
export const COHERE_VISION_MODEL = "command-a-vision-07-2025";

// ---------------------------------------------------------------------------
// Cloudflare Workers AI (free, no card: 10,000 Neurons/day, 300 RPM).
// Reached through the account-scoped OpenAI-compatibility endpoint, so
// it needs TWO env vars: CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
// Models are namespaced with @cf/…. Vision: llama-3.2-11b-vision-instruct.
// ---------------------------------------------------------------------------

export const CLOUDFLARE_TEXT_MODELS = [
  "@cf/openai/gpt-oss-120b",
  "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
] as const;

export const CLOUDFLARE_VISION_MODEL =
  "@cf/meta/llama-3.2-11b-vision-instruct";

// ---------------------------------------------------------------------------
// DeepSeek (5M free tokens on signup, no card — VALID 30 DAYS ONLY).
// NOT an ongoing free tier: after 30 days / 5M tokens it is pay-as-you-go,
// so it sits near the end of every chain. Model: deepseek-chat (V3.2).
// Text-only — no vision model, so it is NOT in the reasoning chain.
// ---------------------------------------------------------------------------

export const DEEPSEEK_TEXT_MODEL = "deepseek-chat";

// ---------------------------------------------------------------------------
// Novita AI ($1 one-time signup credit, no card — tiny and one-time).
// Once the $1 is spent it is paid-only, so it sits LAST in every chain.
// Model: openai/gpt-oss-120b. Text-only — not in the reasoning chain.
// ---------------------------------------------------------------------------

export const NOVITA_TEXT_MODEL = "openai/gpt-oss-120b";

// ---------------------------------------------------------------------------
// Per-category routing.
// Each category lists its models grouped by provider: the PRIMARY provider
// first (best for that job), then backups in priority order — 10 providers
// per category (primary + up to 10 backups). The same provider appears in
// several categories. Within a provider, models are ordered best-first
// for the job. Cerebras sits low for guides (8K free-tier context cap)
// and high for short jobs (fastest). DeepSeek and Novita sit last
// everywhere (their free access expires / is one-time).
// ---------------------------------------------------------------------------

type ProviderKind =
  | "google"
  | "groq"
  | "openrouter"
  | "cerebras"
  | "nvidia"
  | "sambanova"
  | "cohere"
  | "cloudflare"
  | "deepseek"
  | "novita";
type ModelSpec = readonly [ProviderKind, string];

export const CATEGORY_SPECS: Record<GenerationCategory, readonly ModelSpec[]> =
  {
    // Long structured output (guide Markdown + quiz JSON, big schema).
    // Primary Gemini: proven in this app, 1M context, strong structured
    // output. Then Groq 120b (strict json_schema, 500 tok/s, 1,000/day),
    // OpenRouter Nemotron 3 Ultra (strongest free reasoning, JSON 6/6),
    // NVIDIA Nemotron 3 Ultra, SambaNova, Cohere, Cloudflare, Cerebras
    // (last among ongoing — 8K context cap), DeepSeek, Novita.
    guides: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["openrouter", "openrouter/free"],
      ["nvidia", "nvidia/nemotron-3-ultra-550b-a55b"],
      ["sambanova", "gpt-oss-120b"],
      ["cohere", "command-a-03-2025"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["cerebras", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Conversational tutor, short replies — latency is what matters.
    // Primary Groq 20b: ~1,000 tok/s, first token ~0.24s. Then Gemini
    // Lite, OpenRouter Super VL, Cerebras (fastest of the new providers,
    // 1M tokens/day), NVIDIA, SambaNova, Cohere, Cloudflare, DeepSeek,
    // Novita.
    chat: [
      ["groq", "openai/gpt-oss-20b"],
      ["groq", "openai/gpt-oss-120b"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["google", "gemini-3.8-flash"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["cerebras", "gpt-oss-120b"],
      ["cerebras", "qwen-3-235b-a22b-instruct-2507"],
      ["nvidia", "openai/gpt-oss-120b"],
      ["sambanova", "gpt-oss-120b"],
      ["cohere", "command-a-03-2025"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Battle Arena games — short trivia, templates must return in seconds.
    // Primary Groq 20b: fastest by far. Then Gemini Lite, OpenRouter
    // Super VL, Cerebras, NVIDIA, SambaNova, Cohere, Cloudflare,
    // DeepSeek, Novita.
    games: [
      ["groq", "openai/gpt-oss-20b"],
      ["groq", "openai/gpt-oss-120b"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["google", "gemini-3.8-flash"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["cerebras", "gpt-oss-120b"],
      ["nvidia", "openai/gpt-oss-120b"],
      ["sambanova", "gpt-oss-120b"],
      ["cohere", "command-a-03-2025"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Small structured question sets — schema reliability matters most
    // (this route failed on a schema mismatch before). Primary Gemini
    // 3.8: proven structured output here. Then Groq 120b (STRICT
    // json_schema guarantees), OpenRouter Super VL (JSON 7/7), NVIDIA
    // Nemotron 3 Ultra, SambaNova, Cohere, Cloudflare, Cerebras,
    // DeepSeek, Novita.
    practice: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["nvidia", "nvidia/nemotron-3-ultra-550b-a55b"],
      ["sambanova", "gpt-oss-120b"],
      ["cohere", "command-a-03-2025"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["cerebras", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Suggesting real YouTube video IDs — knowledge-heavy.
    // Primary Gemini 3.8: broadest knowledge, proven for video IDs here.
    // Then Groq 120b, OpenRouter Nemotron 3 Ultra, NVIDIA Nemotron 3
    // Ultra, SambaNova, Cohere, Cloudflare, Cerebras (Qwen 3 235B),
    // DeepSeek, Novita.
    videos: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.5-flash-lite"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["openrouter", "openrouter/free"],
      ["nvidia", "nvidia/nemotron-3-ultra-550b-a55b"],
      ["sambanova", "gpt-oss-120b"],
      ["cohere", "command-a-03-2025"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["cerebras", "qwen-3-235b-a22b-instruct-2507"],
      ["deepseek", "deepseek-chat"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Vision: reads a handwriting PNG and grades work + process.
    // Text-only models are NOT in this list — sending them an image would
    // just error. Primary Gemini: proven vision here. Then Groq
    // qwen3.8-27b (multimodal + JSON mode, 450 tok/s), OpenRouter Super
    // VL (vision, 20/20 passed, 106 tok/s), NVIDIA Llama 3.2 90B Vision
    // + Nemotron 3.5 Super VL, Cerebras Gemma 4 31B, SambaNova Gemma 4
    // 31B, Cohere Command A Vision, Cloudflare Llama 3.2 11B Vision.
    // (DeepSeek and Novita have no reliable vision model, so they are
    // not in this chain — 8 vision providers, 10 models.)
    reasoning: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["groq", "qwen/qwen3.8-27b"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["nvidia", "meta/llama-3.2-90b-vision-instruct"],
      ["nvidia", "nvidia/nemotron-3.5-super-vl-120b-a12b"],
      ["cerebras", "gemma-4-31b"],
      ["sambanova", "gemma-4-31B-it"],
      ["cohere", "command-a-vision-07-2025"],
      ["cloudflare", "@cf/meta/llama-3.2-11b-vision-instruct"],
    ],
  } as const;

/** Human-readable routing per category: the primary provider, then the
 *  backups in order. For docs and debugging. */
export const CATEGORY_ROUTING: Record<
  GenerationCategory,
  { primary: string; backups: string[] }
> = {
  guides: {
    primary: "Gemini (3.8-flash)",
    backups: [
      "Groq (gpt-oss-120b)",
      "OpenRouter (Nemotron 3 Ultra)",
      "NVIDIA NIM (Nemotron 3 Ultra)",
      "SambaNova (gpt-oss-120b)",
      "Cohere (Command A)",
      "Cloudflare (gpt-oss-120b)",
      "Cerebras (gpt-oss-120b, 8K context cap)",
      "DeepSeek (deepseek-chat, 30-day grant)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  chat: {
    primary: "Groq (gpt-oss-20b)",
    backups: [
      "Gemini (3.5-flash-lite)",
      "OpenRouter (Nemotron 3.5 Super VL)",
      "Cerebras (gpt-oss-120b)",
      "NVIDIA NIM (gpt-oss-120b)",
      "SambaNova (gpt-oss-120b)",
      "Cohere (Command A)",
      "Cloudflare (gpt-oss-120b)",
      "DeepSeek (deepseek-chat, 30-day grant)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  games: {
    primary: "Groq (gpt-oss-20b)",
    backups: [
      "Gemini (3.5-flash-lite)",
      "OpenRouter (Nemotron 3.5 Super VL)",
      "Cerebras (gpt-oss-120b)",
      "NVIDIA NIM (gpt-oss-120b)",
      "SambaNova (gpt-oss-120b)",
      "Cohere (Command A)",
      "Cloudflare (gpt-oss-120b)",
      "DeepSeek (deepseek-chat, 30-day grant)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  practice: {
    primary: "Gemini (3.8-flash)",
    backups: [
      "Groq (gpt-oss-120b, strict JSON)",
      "OpenRouter (Nemotron 3.5 Super VL)",
      "NVIDIA NIM (Nemotron 3 Ultra)",
      "SambaNova (gpt-oss-120b)",
      "Cohere (Command A)",
      "Cloudflare (gpt-oss-120b)",
      "Cerebras (gpt-oss-120b)",
      "DeepSeek (deepseek-chat, 30-day grant)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  videos: {
    primary: "Gemini (3.8-flash)",
    backups: [
      "Groq (gpt-oss-120b)",
      "OpenRouter (Nemotron 3 Ultra)",
      "NVIDIA NIM (Nemotron 3 Ultra)",
      "SambaNova (gpt-oss-120b)",
      "Cohere (Command A)",
      "Cloudflare (gpt-oss-120b)",
      "Cerebras (Qwen 3 235B)",
      "DeepSeek (deepseek-chat, 30-day grant)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  reasoning: {
    primary: "Gemini (3.8-flash, vision)",
    backups: [
      "Groq (qwen3.8-27b, vision)",
      "OpenRouter (Nemotron 3.5 Super VL, vision)",
      "NVIDIA NIM (Llama 3.2 90B Vision / Nemotron 3.5 Super VL)",
      "Cerebras (Gemma 4 31B, vision)",
      "SambaNova (Gemma 4 31B, vision)",
      "Cohere (Command A Vision)",
      "Cloudflare (Llama 3.2 11B Vision)",
    ],
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

function createCerebrasProvider() {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.cerebras.ai/v1",
  });
}

function createNvidiaProvider() {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });
}

function createSambaNovaProvider() {
  const apiKey = process.env.SAMBANOVA_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.sambanova.ai/v1",
  });
}

function createCohereProvider() {
  const apiKey = process.env.COHERE_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.cohere.ai/compatibility/v1",
  });
}

function createCloudflareProvider() {
  const apiKey = process.env.CLOUDFLARE_API_TOKEN;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!apiKey || !accountId) return null;
  return createOpenAI({
    apiKey,
    baseURL: `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`,
  });
}

function createDeepSeekProvider() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com",
  });
}

function createNovitaProvider() {
  const apiKey = process.env.NOVITA_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.novita.ai/openai",
  });
}

type ProviderInstances = {
  google: ReturnType<typeof createGoogle>;
  groq: ReturnType<typeof createGroqProvider>;
  openrouter: ReturnType<typeof createOpenRouterProvider>;
  cerebras: ReturnType<typeof createCerebrasProvider>;
  nvidia: ReturnType<typeof createNvidiaProvider>;
  sambanova: ReturnType<typeof createSambaNovaProvider>;
  cohere: ReturnType<typeof createCohereProvider>;
  cloudflare: ReturnType<typeof createCloudflareProvider>;
  deepseek: ReturnType<typeof createDeepSeekProvider>;
  novita: ReturnType<typeof createNovitaProvider>;
};

function buildProviders(): ProviderInstances {
  return {
    google: createGoogle(),
    groq: createGroqProvider(),
    openrouter: createOpenRouterProvider(),
    cerebras: createCerebrasProvider(),
    nvidia: createNvidiaProvider(),
    sambanova: createSambaNovaProvider(),
    cohere: createCohereProvider(),
    cloudflare: createCloudflareProvider(),
    deepseek: createDeepSeekProvider(),
    novita: createNovitaProvider(),
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
    // Each provider is callable with a model ID, but their call
    // signatures differ (model-ID string unions), so call through a
    // common (modelId: string) => LanguageModel type.
    out.push((provider as (modelId: string) => LanguageModel)(id));
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
 *  then its backups). Empty when no provider key is set. */
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
 *  models, then OpenRouter's most reliable free model + router, then the
 *  fast new providers (Cerebras, NVIDIA, SambaNova), then Cohere,
 *  Cloudflare, DeepSeek, Novita. */
export function getLiteModels(): LanguageModel[] {
  return resolveSpecs(
    [
      ["groq", "openai/gpt-oss-20b"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["cerebras", "gpt-oss-120b"],
      ["nvidia", "openai/gpt-oss-120b"],
      ["sambanova", "gpt-oss-120b"],
      ["cohere", "command-a-03-2025"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["novita", "openai/gpt-oss-120b"],
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
 *  pattern here.
 *
 *  With 10 providers in the chain, this is deliberately wide: a 400 /
 *  "unsupported response_format" from one OpenAI-compatible provider
 *  (it does not support json_schema structured output) must NOT stop
 *  the chain — the same request works on the next provider. */
export function isRetryableProviderError(err: unknown): boolean {
  if (isOverloadedError(err)) return true;
  const text = errorText(err);
  return (
    text.includes("400") ||
    text.includes("401") ||
    text.includes("402") ||
    text.includes("404") ||
    text.includes("bad request") ||
    text.includes("unauthorized") ||
    text.includes("invalid api key") ||
    text.includes("invalid_api_key") ||
    text.includes("authentication") ||
    text.includes("payment required") ||
    text.includes("not_found") ||
    text.includes("model_not_found") ||
    text.includes("model not found") ||
    text.includes("unsupported") ||
    text.includes("response_format") ||
    text.includes("json_schema") ||
    text.includes("no object generated") ||
    text.includes("did not match schema") ||
    text.includes("failed to parse")
  );
}

export const MISSING_KEY_MESSAGE =
  "No AI provider key is configured. Add a free key (Google AI Studio, Groq, OpenRouter, Cerebras, NVIDIA NIM, SambaNova, Cohere, Cloudflare, DeepSeek, or Novita) to the environment to generate content.";

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
    .replace(/nvapi-[0-9A-Za-z_-]{10,}/g, "[key]")
    .replace(/sk-[0-9A-Za-z]{10,}/g, "[key]")
    .replace(/\b[0-9a-f]{40}\b/g, "[key]")
    .slice(0, 300);
}
