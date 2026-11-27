import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";

/**
 * Cross-provider AI routing, PER CATEGORY — 18 providers, mixed and
 * matched per job (docs/mix-match-2026-11-25.md).
 *
 * History: everything used to go through Google Gemini only, and the
 * Gemini free tier (~20 requests/day on Flash) kept getting exhausted,
 * which blocked the whole site. First we added one global fallback list
 * (Gemini → Groq → OpenRouter). Then each category routed to the provider
 * best for that job first, with the other two free providers as backups.
 * Then 12 free providers per category. Now 18: the Nov 2026 API hunt
 * (docs/api-hunt-2026-11-25.md) tested ~50 candidates and added
 * Pollinations (no key at all — verified live) and GitHub Models
 * (gated on GITHUB_TOKEN, NOT yet live-verified: the POST test was
 * blocked by an approval timeout, so it sits after Pollinations and
 * only activates once a key is set); the mix-and-match pass (2026-11-25) wired the
 * six remaining free signups from that hunt — SiliconFlow, AIML API,
 * Hugging Face, Moonshot, Zhipu, Qwen/DashScope — and reordered every
 * category so each job leads with the provider
 * best suited to it (strongest reasoning for guides, fastest for chat
 * and lite templates, strictest JSON for practice/games, vision-only
 * for check-reasoning), instead of one shared fallback order.
 *
 * 2026-11-26 — the chains are now INTERLEAVED round-robin by
 * provider (see interleaveSpecs, applied in resolveSpecs): the lists
 * below are written grouped by provider, but the order actually
 * tried is first model of each provider, then second model of each,
 * and so on. The 12:33 outage that day proved why: all four Gemini
 * models were tried first (overload, then three 12s timeouts),
 * Moonshot / AIML / SambaNova then failed fast on billing, and the
 * 50s wall ran out with DeepSeek and Pollinations never tried.
 * Interleaving keeps the provider priority — the first provider in
 * each list still goes first — but one provider's outage can no
 * longer eat the wall. The same day, Moonshot / AIML / SambaNova
 * were proven BILLING-DEAD (free credits exhausted / card required,
 * Vercel logs 12:33:57 CST), so they sit AFTER the live providers
 * in every list below. If a billing-dead provider's balance is ever
 * restored, move it back up; do not delete the entries.
 *
 * 2026-11-26, later the same day — the SECOND outage log (Vercel,
 * 16:52:40 CST, one POST /api/generate, 50.4s, 503) proved the
 * interleave alone was not enough: Gemini 3.8-flash timed out at
 * its 25s first cap, the new timeout→simplified retry then burned
 * ~15s timing out again on the same hanging model, DeepSeek failed
 * fast on "Insufficient Balance" (its 30-day grant is exhausted —
 * billing-dead, alongside Moonshot / AIML / SambaNova), and Cohere
 * timed out at its 20s cap. Pollinations was NEVER tried — no
 * attempt log, no external call. Two changes follow from it:
 * (1) Pollinations now sits SECOND in every text chain, right
 * after the primary, so the only no-key provider is tried while
 * time remains; (2) a full-shape attempt that TIMES OUT no longer
 * gets a simplified retry on the same model — a hanging model
 * times out again, and the 15s it burned is the wall's scarcest
 * resource (see app/api/generate/route.ts). The simplified retry
 * is kept only for NON-timeout failures, where the model answered
 * but the shape was wrong.
 *
 * A provider with no key set is skipped silently, so the app works
 * exactly as before with only the Gemini key set. Keys come ONLY from
 * environment variables. Never hardcode, log, or commit a key value.
 * See .env.example for the names.
 *
 * The 18 providers (all free to start, no card — limits as published
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
 *     BILLING-DEAD 2026-11-26: the key's account needs a payment
 *     method on file ("A payment method is required") — its free
 *     credits are gone, so it sits AFTER the live providers in every
 *     chain until/unless that changes (no card is ever added here).
 *  7. Cohere — trial key free, no card: 1,000 calls/month, 20 RPM.
 *     Trial keys are evaluation-only.
 *  8. Cloudflare Workers AI — free, no card: 10,000 Neurons/day,
 *     300 RPM. Needs TWO env vars: API token + account ID.
 *  9. DeepSeek — 5M free tokens on signup, no card, VALID 30 DAYS.
 *     NOT an ongoing free tier — it expires, so it used to sit
 *     last-but-one. It was reached EARLY while its grant lasted
 *     (2026-11-26 morning), but by that afternoon the grant was
 *     exhausted: Vercel logs 2026-11-26 16:52:40 CST show
 *     "Insufficient Balance", so DeepSeek is BILLING-DEAD as of
 *     2026-11-26 and sits AFTER the live providers in every chain,
 *     alongside Moonshot / AIML / SambaNova. If its balance is ever
 *     topped up, move it back up; do not delete the entry.
 * 10. Novita AI — $1 one-time signup credit, no card. Tiny and
 *     one-time, so it sits LAST among the keyed providers. Once it is
 *     spent, it is paid-only.
 * 11. Pollinations — NO KEY AT ALL. Free public text API, verified
 *     live 2026-11-25 (GET returned the exact reply, HTTP 200, ~1.3s;
 *     JSON mode also verified). Rate limits are unpublished and it is
 *     a shared public service. It is the ONLY no-key provider, so
 *     since 2026-11-26 it sits SECOND in every text chain, right
 *     after the primary — the 16:52 outage proved a no-key fallback
 *     that is never reached cannot save a request (the wall ran out
 *     with Pollinations untried), and if its POST works it saves the
 *     request while time remains; if it fails fast, little time is
 *     lost. Its OpenAI-compatible POST endpoint (used by the AI SDK)
 *     is documented but could NOT be live-tested from this
 *     environment (approval timeout) — if it ever 400s, the chain
 *     treats it as retryable and moves on; the chain trying it
 *     during a real generation is the only way its POST path gets
 *     proven, so do not probe it directly with curl.
 *     OUTPUT CAP 2026-11-27 (Vercel logs 02:46:51 CST): Pollinations
 *     ACCEPTED the strictified schema and returned a nearly complete
 *     guide, then stopped mid-string at JSON position 6064
 *     (~1,500 output tokens, ~19s) — its own output cap and/or
 *     per-request time limit; our side sends max_completion_tokens:
 *     8192 and the 20s abort did not fire, so we are not the
 *     limiter. Two consequences: (1) /api/generate asks Pollinations
 *     for a COMPACT guide (retargeted 2026-11-27 to ~1,000 tokens:
 *     2 modules × 2 concepts, very terse fields — the first compact
 *     shape at ~1,400 tokens STILL truncated live at JSON position
 *     6759, Vercel logs 09:25:18 CST, because the model writes
 *     longer than the prompt's soft limits allow) instead of the
 *     full prompt, which it can never finish; (2) every
 *     generateObject call goes through generateObjectSafe
 *     (lib/safeGenerate.ts), which salvages a truncated response
 *     into the guide it already wrote instead of failing the
 *     attempt — including a PARTIAL salvage that fills missing
 *     top-level fields with honest empty defaults, added after the
 *     09:26 failure showed the strict-only salvage returning null
 *     when the required scalar fields trail the truncation point.
 *     Do not ask Pollinations for a full-size guide again — it will
 *     truncate.
 * 12. GitHub Models — UNVERIFIED. Free with a GitHub token
 *     (GITHUB_TOKEN), model openai/gpt-4.1-mini (fast, vision-capable
 *     per its model card). The inference host IS alive (GET to the
 *     chat-completions path returned HTTP 200 "OK", 0.76s, 2026-11-25),
 *     which refutes the old "retired July 2026" note — but the
 *     authenticated POST test was blocked by an approval timeout, so
 *     this provider is wired but sits AFTER Pollinations in every
 *     chain and only activates once GITHUB_TOKEN is set. Verify with
 *     one curl before setting the key (see docs/api-hunt-2026-11-25.md).
 * 13. SiliconFlow — free credits on signup, no card. OpenAI-compatible
 *     (api.siliconflow.cn/v1). Qwen 3 / DeepSeek V3.2 for text, Qwen
 *     2.5-VL 72B for vision. Fast and cheap — high in the lite chain.
 * 14. AIML API — free credits on signup, no card. OpenAI-compatible
 *     (api.aimlapi.com/v1). Llama 3.3 70B for text, gpt-4o-mini for
 *     vision. Many models behind one key.
 *     BILLING-DEAD 2026-11-26: "You've run out of funds" — its free
 *     credits are exhausted, so it sits AFTER the live providers in
 *     every chain (see SambaNova above).
 * 15. Hugging Face Inference Providers — free token, no card.
 *     OpenAI-compatible router (router.huggingface.co/v1). Llama 3.1
 *     8B / Qwen 2.5 72B for text, Llama 3.2 11B Vision for vision.
 *     CAVEAT: the free serverless tier was reported gone in earlier
 *     research — re-check at signup; skipped silently without a key.
 * 16. Moonshot AI — free credits on signup, no card. OpenAI-compatible
 *     (api.moonshot.ai/v1). Kimi K2 (256K context, strong reasoning)
 *     for text, moonshot-v1-8k (fast/cheap) for lite, v1-8k-vision
 *     for vision.
 *     BILLING-DEAD 2026-11-26: the account is suspended for
 *     insufficient balance — its free credits are exhausted, so it
 *     sits AFTER the live providers in every chain (see SambaNova
 *     above).
 * 17. Zhipu AI (GLM) — free credits on signup, no card.
 *     OpenAI-compatible (open.bigmodel.cn/api/paas/v4). GLM-4.5 for
 *     text, GLM-4.5-Air (fast/cheap) for lite, GLM-4.5V for vision.
 * 18. Qwen / Alibaba DashScope — free credits on signup, no card.
 *     OpenAI-compatible (dashscope-intl.aliyuncs.com/compatible-mode/
 *     v1). Qwen-Plus / Qwen3-8B for text, Qwen2.5-VL 72B for vision.
 * 19. REMOVED 2026-11-26 — Vercel AI Gateway: its free credits
 *     required a credit card on file, which this app never adds; its
 *     account was suspended for insufficient balance and took live
 *     generation down with it (2026-11-25). Do not re-add it without
 *     a card-free way to use it.
 *
 * REJECTED (do not add): Mistral (phone verification required),
 * Together AI (no free tier, $15 min purchase), Fireworks AI (no free
 * plan), Chutes AI (free tier ended 2026-03-15), DeepInfra (no free
 * tier — card or pre-pay required before any request succeeds),
 * OpenAI / Anthropic / xAI / Perplexity (paid-only APIs),
 * Replicate / Azure OpenAI / AWS Bedrock / Google Vertex AI / IBM
 * watsonx / Oracle OCI (need a payment card), DuckDuckGo AI (no
 * official API), Puter.js (client-side only, not server-usable).
 * Still unwired from the hunt shortlist (each ~15 lines once a key
 * exists): 01.AI, Baidu Qianfan, ByteDance Volcengine, Meta Llama API,
 * AI21 Labs, Hyperbolic, FriendliAI, Nebius, MiniMax, StepFun,
 * Upstage, Tencent Hunyuan, Krutrim, Sarvam.
 *
 * Research:
 * ~/workspace/goals/studysmart-educational-web-app/hidden_files/multi-provider-research-2026-11-24.md
 * ~/workspace/goals/studysmart-educational-web-app/hidden_files/ten-backup-providers-research-2026-11-24.md
 * docs/api-hunt-2026-11-25.md
 * docs/mix-match-2026-11-25.md
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
// NOT an ongoing free tier: after 30 days / 5M tokens it is pay-as-you-go.
// BILLING-DEAD 2026-11-26: the 30-day grant ran out ("Insufficient
// Balance", Vercel logs 16:52:40 CST), so it sits AFTER the live
// providers in every chain, alongside Moonshot / AIML / SambaNova.
// If its balance is ever topped up, move it back up; do not delete
// the entry. Model: deepseek-chat (V3.2). Text-only — no vision
// model, so it is NOT in the reasoning chain.
// ---------------------------------------------------------------------------

export const DEEPSEEK_TEXT_MODEL = "deepseek-chat";

// ---------------------------------------------------------------------------
// Novita AI ($1 one-time signup credit, no card — tiny and one-time).
// Once the $1 is spent it is paid-only, so it sits last among the
// keyed providers in every list (its single model is tried in the
// first interleave round, like every other single-model provider).
// Model: openai/gpt-oss-120b. Text-only — not in the reasoning chain.
// ---------------------------------------------------------------------------

export const NOVITA_TEXT_MODEL = "openai/gpt-oss-120b";

// ---------------------------------------------------------------------------
// Pollinations (NO KEY — free public text API, verified live 2026-11-25).
// Reached through its OpenAI-compatibility endpoint. Model: "openai"
// (the default model). No vision model is claimed for it — vision was
// not verified — so it is NOT in the reasoning chain. It sits SECOND
// in every text chain, right after the primary: the only provider
// that needs no key, so it must be tried while time remains.
// ---------------------------------------------------------------------------

export const POLLINATIONS_TEXT_MODEL = "openai";

// ---------------------------------------------------------------------------
// GitHub Models (UNVERIFIED — free with a GitHub token, GITHUB_TOKEN).
// The fast model is openai/gpt-4.1-mini, which is vision-capable per
// its model card, so it is in the reasoning chain too. The inference host answered a GET
// with HTTP 200 on 2026-11-25, but the authenticated POST test was
// blocked by an approval timeout — verify with one curl (see the hunt
// doc) before setting GITHUB_TOKEN. Until then it is LAST everywhere
// and inactive without a key.
// ---------------------------------------------------------------------------

export const GITHUB_TEXT_MODEL = "openai/gpt-4.1-mini";

/** Same model — gpt-4.1-mini is multimodal, so it doubles as the vision model. */
export const GITHUB_VISION_MODEL = "openai/gpt-4.1-mini";

// ---------------------------------------------------------------------------
// SiliconFlow (free credits on signup, no card — OpenAI-compatible,
// api.siliconflow.cn/v1). Qwen 3 8B is fast and cheap (lite chain);
// DeepSeek V3.2 is the strong text model; Qwen 2.5-VL 72B is vision.
// Model IDs per provider docs, Nov 2026 — re-check if a 404 appears
// (the chain treats a retired ID as retryable and moves on).
// ---------------------------------------------------------------------------

export const SILICONFLOW_TEXT_MODELS = [
  "deepseek-ai/DeepSeek-V3.2",
  "Qwen/Qwen3-8B",
] as const;

/** SiliconFlow vision model for /api/check-reasoning. */
export const SILICONFLOW_VISION_MODEL = "Qwen/Qwen2.5-VL-72B-Instruct";

// ---------------------------------------------------------------------------
// AIML API (free credits on signup, no card — OpenAI-compatible,
// api.aimlapi.com/v1). Many models behind one key. Llama 3.3 70B for
// text; gpt-4o-mini (multimodal) for vision.
// ---------------------------------------------------------------------------

export const AIMLAPI_TEXT_MODEL = "meta-llama/Llama-3.3-70B-Instruct";

/** AIML API vision model for /api/check-reasoning. */
export const AIMLAPI_VISION_MODEL = "gpt-4o-mini";

// ---------------------------------------------------------------------------
// Hugging Face Inference Providers (free token, no card —
// OpenAI-compatible router, router.huggingface.co/v1). Llama 3.1 8B is
// the cheap/fast text model; Qwen 2.5 72B is the strong one; Llama 3.2
// 11B Vision is vision. CAVEAT: the free serverless tier was reported
// gone in earlier research — re-check at signup; without a key this
// provider is skipped silently.
// ---------------------------------------------------------------------------

export const HUGGINGFACE_TEXT_MODELS = [
  "Qwen/Qwen2.5-72B-Instruct",
  "meta-llama/Llama-3.1-8B-Instruct",
] as const;

/** Hugging Face vision model for /api/check-reasoning. */
export const HUGGINGFACE_VISION_MODEL =
  "meta-llama/Llama-3.2-11B-Vision-Instruct";

// ---------------------------------------------------------------------------
// Moonshot AI (free credits on signup, no card — OpenAI-compatible,
// api.moonshot.ai/v1). Kimi K2 (256K context, strong reasoning) for
// text; moonshot-v1-8k is the fast/cheap lite model; v1-8k-vision is
// vision.
// ---------------------------------------------------------------------------

export const MOONSHOT_TEXT_MODEL = "kimi-k2-0711-preview";

/** Fast/cheap Moonshot model for the lite-first steps. */
export const MOONSHOT_LITE_MODEL = "moonshot-v1-8k";

/** Moonshot vision model for /api/check-reasoning. */
export const MOONSHOT_VISION_MODEL = "moonshot-v1-8k-vision";

// ---------------------------------------------------------------------------
// Zhipu AI / GLM (free credits on signup, no card — OpenAI-compatible,
// open.bigmodel.cn/api/paas/v4). GLM-4.5 is the strong text model;
// GLM-4.5-Air is the fast/cheap lite model; GLM-4.5V is vision.
// ---------------------------------------------------------------------------

export const ZHIPU_TEXT_MODELS = ["glm-4.5", "glm-4.5-air"] as const;

/** Zhipu vision model for /api/check-reasoning. */
export const ZHIPU_VISION_MODEL = "glm-4.5v";

// ---------------------------------------------------------------------------
// Qwen / Alibaba DashScope (free credits on signup, no card —
// OpenAI-compatible, dashscope-intl.aliyuncs.com/compatible-mode/v1).
// Qwen-Plus is the strong text model; Qwen3-8B is fast/cheap;
// Qwen2.5-VL 72B is vision. Use the international endpoint
// (dashscope-intl) for accounts created on the international console.
// ---------------------------------------------------------------------------

export const DASHSCOPE_TEXT_MODELS = ["qwen-plus", "qwen3-8b"] as const;

/** DashScope vision model for /api/check-reasoning. */
export const DASHSCOPE_VISION_MODEL = "qwen2.5-vl-72b-instruct";

// NOTE (2026-11-26): Vercel AI Gateway was removed from every chain.
// It needs a credit card on file to unlock its free credits — which this
// app will never add — and its account was suspended for insufficient
// balance, which took live generation down with it (2026-11-25). A
// provider that can only work with a card on file must never be wired in.

// ---------------------------------------------------------------------------
// Per-category routing — MIXED AND MATCHED per job (2026-11-25,
// docs/mix-match-2026-11-25.md). Each category lists its models grouped
// How to read the lists below (and what resolveSpecs does with them).
// The lists are written grouped by provider: the PRIMARY provider
// first (best for that job), then backups in priority order — 18
// providers per text category (primary + up to 17 backups). The same
// provider appears in several categories, but the ORDER differs per
// job: strongest reasoning leads guides, fastest/cheapest leads chat
// and the lite steps, strictest JSON leads practice/games, vision-only
// models (ordered by vision quality) make up the reasoning chain.
// Within a provider, models are ordered best-first for the job.
// Cerebras sits low for guides (8K free-tier context cap) and high
// for short jobs (fastest).
//
// Billing-dead providers (Moonshot, AIML, SambaNova, DeepSeek —
// free credits exhausted / card required, proven 2026-11-26) sit
// AFTER the live providers in every list, never ahead of one.
// DeepSeek joined them on 2026-11-26 (its 30-day grant ran out —
// "Insufficient Balance", Vercel logs 16:52:40 CST). Pollinations
// (no key) sits SECOND in every text chain, right after the primary:
// it is the only provider that works with zero keys set, so it must
// be tried while time remains, not after the wall is nearly gone.
// After the live and billing-dead providers come the no-key
// providers in their old relative order (skipped silently until a
// key is set), then GitHub Models (unverified, key-gated).
//
// The lists are NOT the try order: resolveSpecs() interleaves them
// round-robin by provider (see interleaveSpecs), so the order
// actually tried is first model of each provider, then second model
// of each, and so on. docs/mix-match-2026-11-25.md shows the
// resolved (interleaved) order per category.
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
  | "novita"
  | "pollinations"
  | "github"
  | "siliconflow"
  | "aiml"
  | "huggingface"
  | "moonshot"
  | "zhipu"
  | "dashscope"
type ModelSpec = readonly [ProviderKind, string];

export const CATEGORY_SPECS: Record<GenerationCategory, readonly ModelSpec[]> =
  {
    // Long structured output (guide Markdown + quiz JSON, big schema).
    // Provider priority (grouped — resolveSpecs interleaves it):
    // Gemini first (proven in this app, 1M context, strong structured
    // output), then the no-key safety net Pollinations SECOND (the
    // 16:52 outage proved a fallback that is never reached cannot
    // save a request), Cohere, then GitHub Models (unverified,
    // key-gated), then the billing-dead providers — Moonshot, AIML,
    // SambaNova, DeepSeek (free credits exhausted / card required,
    // 2026-11-26) — then the no-key providers in their old relative
    // order (NVIDIA Nemotron 3 Ultra, OpenRouter, Zhipu GLM-4.5,
    // DashScope Qwen-Plus, Groq, SiliconFlow, Hugging Face,
    // Cloudflare, Cerebras, Novita). Resolved with all keys set, the
    // try order is: Gemini 3.8 → Pollinations → Cohere → GitHub →
    // Moonshot → AIML → SambaNova → DeepSeek → Gemini 3.6 →
    // Gemini 3.5-lite → Gemini 3.1-lite (plus the no-key providers'
    // models if their keys are ever set).
    guides: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["pollinations", "openai"],
      ["cohere", "command-a-03-2025"],
      ["github", "openai/gpt-4.1-mini"],
      ["moonshot", "kimi-k2-0711-preview"],
      ["aiml", "meta-llama/Llama-3.3-70B-Instruct"],
      ["sambanova", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["nvidia", "nvidia/nemotron-3-ultra-550b-a55b"],
      ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["openrouter", "openrouter/free"],
      ["zhipu", "glm-4.5"],
      ["dashscope", "qwen-plus"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["siliconflow", "deepseek-ai/DeepSeek-V3.2"],
      ["huggingface", "Qwen/Qwen2.5-72B-Instruct"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["cerebras", "gpt-oss-120b"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Conversational tutor, short replies — latency is what matters.
    // Primary Groq 20b: ~1,000 tok/s, first token ~0.24s. Then the
    // no-key safety net Pollinations SECOND, Gemini Lite, Cohere,
    // GitHub Models, then the billing-dead providers (Moonshot v1-8k,
    // AIML, SambaNova, DeepSeek), then the fast/cheap small models
    // and the rest in their old relative order (Zhipu Air, SiliconFlow
    // Qwen3-8B, DashScope Qwen3-8B, Cerebras, Cloudflare, OpenRouter,
    // NVIDIA, Hugging Face, Novita).
    chat: [
      ["groq", "openai/gpt-oss-20b"],
      ["groq", "openai/gpt-oss-120b"],
      ["pollinations", "openai"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["google", "gemini-3.8-flash"],
      ["cohere", "command-a-03-2025"],
      ["github", "openai/gpt-4.1-mini"],
      ["moonshot", "moonshot-v1-8k"],
      ["aiml", "meta-llama/Llama-3.3-70B-Instruct"],
      ["sambanova", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["zhipu", "glm-4.5-air"],
      ["siliconflow", "Qwen/Qwen3-8B"],
      ["dashscope", "qwen3-8b"],
      ["cerebras", "gpt-oss-120b"],
      ["cerebras", "qwen-3-235b-a22b-instruct-2507"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["nvidia", "openai/gpt-oss-120b"],
      ["huggingface", "meta-llama/Llama-3.1-8B-Instruct"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Battle Arena games — short trivia, templates must return in seconds.
    // Primary Groq 20b: fastest by far, and Groq's 1,000 req/day per
    // model is the deepest free allowance for high-volume game traffic.
    // Then the no-key safety net Pollinations SECOND, Gemini Lite,
    // Cohere, GitHub Models, then the billing-dead providers
    // (Moonshot K2, AIML, SambaNova, DeepSeek), then the rest in
    // their old relative order (OpenRouter Super VL, Zhipu Air,
    // SiliconFlow Qwen3-8B, Cerebras, NVIDIA, DashScope, Cloudflare,
    // Hugging Face, Novita).
    games: [
      ["groq", "openai/gpt-oss-20b"],
      ["groq", "openai/gpt-oss-120b"],
      ["pollinations", "openai"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["google", "gemini-3.8-flash"],
      ["cohere", "command-a-03-2025"],
      ["github", "openai/gpt-4.1-mini"],
      ["moonshot", "kimi-k2-0711-preview"],
      ["aiml", "meta-llama/Llama-3.3-70B-Instruct"],
      ["sambanova", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["zhipu", "glm-4.5-air"],
      ["siliconflow", "Qwen/Qwen3-8B"],
      ["cerebras", "gpt-oss-120b"],
      ["nvidia", "openai/gpt-oss-120b"],
      ["dashscope", "qwen-plus"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["huggingface", "meta-llama/Llama-3.1-8B-Instruct"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Small structured question sets — schema reliability matters most
    // (this route failed on a schema mismatch before). Primary Gemini
    // 3.8: proven structured output here. Then the no-key safety net
    // Pollinations SECOND, Cohere, GitHub Models, then the
    // billing-dead providers (Moonshot K2, AIML, SambaNova, DeepSeek),
    // then the rest in their old relative order (Groq 120b strict
    // JSON, OpenRouter Super VL, NVIDIA Nemotron 3 Ultra, Zhipu,
    // DashScope, SiliconFlow, HF, Cloudflare, Cerebras, Novita).
    practice: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["pollinations", "openai"],
      ["cohere", "command-a-03-2025"],
      ["github", "openai/gpt-4.1-mini"],
      ["moonshot", "kimi-k2-0711-preview"],
      ["aiml", "meta-llama/Llama-3.3-70B-Instruct"],
      ["sambanova", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["nvidia", "nvidia/nemotron-3-ultra-550b-a55b"],
      ["zhipu", "glm-4.5"],
      ["dashscope", "qwen-plus"],
      ["siliconflow", "deepseek-ai/DeepSeek-V3.2"],
      ["huggingface", "Qwen/Qwen2.5-72B-Instruct"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["cerebras", "gpt-oss-120b"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Suggesting real YouTube video IDs — a short, cheap call, so the
    // cheapest allowance leads: Cloudflare (10,000 Neurons/day, 300 RPM).
    // Then the no-key safety net Pollinations SECOND, Gemini 3.8
    // (broadest knowledge, proven for video IDs here) — every
    // candidate is verified with oEmbed before it is shown, so a
    // hallucinated ID from a cheap model just costs one retry, never
    // a fake video. Then Cohere, GitHub Models, then the billing-dead
    // providers (Moonshot K2, AIML, SambaNova, DeepSeek), then the
    // rest in their old relative order (Groq, OpenRouter, NVIDIA,
    // Zhipu, DashScope, SiliconFlow, HF, Cerebras, Novita).
    videos: [
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["pollinations", "openai"],
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.5-flash-lite"],
      ["cohere", "command-a-03-2025"],
      ["github", "openai/gpt-4.1-mini"],
      ["moonshot", "kimi-k2-0711-preview"],
      ["aiml", "meta-llama/Llama-3.3-70B-Instruct"],
      ["sambanova", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["groq", "openai/gpt-oss-120b"],
      ["groq", "openai/gpt-oss-20b"],
      ["openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free"],
      ["openrouter", "openrouter/free"],
      ["nvidia", "nvidia/nemotron-3-ultra-550b-a55b"],
      ["zhipu", "glm-4.5"],
      ["dashscope", "qwen-plus"],
      ["siliconflow", "deepseek-ai/DeepSeek-V3.2"],
      ["huggingface", "Qwen/Qwen2.5-72B-Instruct"],
      ["cerebras", "qwen-3-235b-a22b-instruct-2507"],
      ["novita", "openai/gpt-oss-120b"],
    ],
    // Vision: reads a handwriting PNG and grades work + process.
    // Text-only models are NOT in this list — sending them an image would
    // just error. Ordered by vision quality: Gemini (proven here), then
    // Cohere Command A Vision, GitHub gpt-4.1-mini (unverified,
    // key-gated), then the no-key providers in their old relative
    // order (OpenRouter Nemotron 3.5 Super VL, 20/20 passed; NVIDIA
    // Nemotron 3.5 Super VL + Llama 3.2 90B Vision; DashScope +
    // SiliconFlow Qwen2.5-VL 72B; Zhipu GLM-4.5V; Groq qwen3.8-27b,
    // multimodal + JSON mode, 450 tok/s; HF Llama 3.2 11B Vision;
    // Cerebras Gemma 4 31B; Cloudflare Llama 3.2 11B Vision), then the
    // billing-dead providers (AIML gpt-4o-mini, Moonshot v1-8k-vision,
    // SambaNova Gemma 4 31B — free credits exhausted, 2026-11-26).
    // (DeepSeek and Novita have no reliable vision model, so they are
    // not in this chain — 16 vision providers, 18 models.)
    reasoning: [
      ["google", "gemini-3.8-flash"],
      ["google", "gemini-3.6-flash"],
      ["cohere", "command-a-vision-07-2025"],
      ["github", "openai/gpt-4.1-mini"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["nvidia", "nvidia/nemotron-3.5-super-vl-120b-a12b"],
      ["nvidia", "meta/llama-3.2-90b-vision-instruct"],
      ["dashscope", "qwen2.5-vl-72b-instruct"],
      ["siliconflow", "Qwen/Qwen2.5-VL-72B-Instruct"],
      ["zhipu", "glm-4.5v"],
      ["groq", "qwen/qwen3.8-27b"],
      ["huggingface", "meta-llama/Llama-3.2-11B-Vision-Instruct"],
      ["cerebras", "gemma-4-31b"],
      ["cloudflare", "@cf/meta/llama-3.2-11b-vision-instruct"],
      ["aiml", "gpt-4o-mini"],
      ["moonshot", "moonshot-v1-8k-vision"],
      ["sambanova", "gemma-4-31B-it"],
    ],
  } as const;

/** Human-readable routing per category: the primary provider, then the
 *  backups in provider-priority order (the grouped order in
 *  CATEGORY_SPECS — the actual try order is interleaved round-robin,
 *  see interleaveSpecs). For docs and debugging. */
export const CATEGORY_ROUTING: Record<
  GenerationCategory,
  { primary: string; backups: string[] }
> = {
  guides: {
    primary: "Gemini (3.8-flash)",
    backups: [
      "Pollinations (openai, no key — safety net, tried 2nd)",
      "Cohere (Command A)",
      "GitHub Models (gpt-4.1-mini, needs GITHUB_TOKEN — unverified)",
      "Moonshot (Kimi K2, billing-dead — free credits exhausted)",
      "AIML API (Llama 3.3 70B, billing-dead — out of funds)",
      "SambaNova (gpt-oss-120b, billing-dead — card required)",
      "DeepSeek (deepseek-chat, billing-dead — 30-day grant exhausted)",
      "NVIDIA NIM (Nemotron 3 Ultra, 10,000/day)",
      "OpenRouter (Nemotron 3 Ultra)",
      "Zhipu (GLM-4.5)",
      "DashScope (Qwen-Plus)",
      "Groq (gpt-oss-120b, strict JSON)",
      "SiliconFlow (DeepSeek V3.2)",
      "Hugging Face (Qwen 2.5 72B)",
      "Cloudflare (gpt-oss-120b)",
      "Cerebras (gpt-oss-120b, 8K context cap)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  chat: {
    primary: "Groq (gpt-oss-20b)",
    backups: [
      "Pollinations (openai, no key — safety net, tried 2nd)",
      "Gemini (3.5-flash-lite)",
      "Cohere (Command A)",
      "GitHub Models (gpt-4.1-mini, needs GITHUB_TOKEN — unverified)",
      "Moonshot (moonshot-v1-8k, billing-dead — free credits exhausted)",
      "AIML API (Llama 3.3 70B, billing-dead — out of funds)",
      "SambaNova (gpt-oss-120b, billing-dead — card required)",
      "DeepSeek (deepseek-chat, billing-dead — 30-day grant exhausted)",
      "Zhipu (GLM-4.5-Air, fast/cheap)",
      "SiliconFlow (Qwen3-8B, fast/cheap)",
      "DashScope (Qwen3-8B, fast/cheap)",
      "Cerebras (gpt-oss-120b)",
      "Cloudflare (gpt-oss-120b, 300 RPM)",
      "OpenRouter (Nemotron 3.5 Super VL)",
      "NVIDIA NIM (gpt-oss-120b)",
      "Hugging Face (Llama 3.1 8B)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  games: {
    primary: "Groq (gpt-oss-20b)",
    backups: [
      "Pollinations (openai, no key — safety net, tried 2nd)",
      "Gemini (3.5-flash-lite)",
      "Cohere (Command A)",
      "GitHub Models (gpt-4.1-mini, needs GITHUB_TOKEN — unverified)",
      "Moonshot (Kimi K2, billing-dead — free credits exhausted)",
      "AIML API (Llama 3.3 70B, billing-dead — out of funds)",
      "SambaNova (gpt-oss-120b, billing-dead — card required)",
      "DeepSeek (deepseek-chat, billing-dead — 30-day grant exhausted)",
      "OpenRouter (Nemotron 3.5 Super VL)",
      "Zhipu (GLM-4.5-Air, fast/cheap)",
      "SiliconFlow (Qwen3-8B, fast/cheap)",
      "Cerebras (gpt-oss-120b)",
      "NVIDIA NIM (gpt-oss-120b)",
      "DashScope (Qwen-Plus)",
      "Cloudflare (gpt-oss-120b)",
      "Hugging Face (Llama 3.1 8B)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  practice: {
    primary: "Gemini (3.8-flash)",
    backups: [
      "Pollinations (openai, no key — safety net, tried 2nd)",
      "Cohere (Command A)",
      "GitHub Models (gpt-4.1-mini, needs GITHUB_TOKEN — unverified)",
      "Moonshot (Kimi K2, billing-dead — free credits exhausted)",
      "AIML API (Llama 3.3 70B, billing-dead — out of funds)",
      "SambaNova (gpt-oss-120b, billing-dead — card required)",
      "DeepSeek (deepseek-chat, billing-dead — 30-day grant exhausted)",
      "Groq (gpt-oss-120b, strict JSON)",
      "OpenRouter (Nemotron 3.5 Super VL)",
      "NVIDIA NIM (Nemotron 3 Ultra)",
      "Zhipu (GLM-4.5)",
      "DashScope (Qwen-Plus)",
      "SiliconFlow (DeepSeek V3.2)",
      "Hugging Face (Qwen 2.5 72B)",
      "Cloudflare (gpt-oss-120b)",
      "Cerebras (gpt-oss-120b)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  videos: {
    primary: "Cloudflare (gpt-oss-120b, cheapest short call)",
    backups: [
      "Pollinations (openai, no key — safety net, tried 2nd)",
      "Gemini (3.8-flash, proven video IDs)",
      "Cohere (Command A)",
      "GitHub Models (gpt-4.1-mini, needs GITHUB_TOKEN — unverified)",
      "Moonshot (Kimi K2, billing-dead — free credits exhausted)",
      "AIML API (Llama 3.3 70B, billing-dead — out of funds)",
      "SambaNova (gpt-oss-120b, billing-dead — card required)",
      "DeepSeek (deepseek-chat, billing-dead — 30-day grant exhausted)",
      "Groq (gpt-oss-120b)",
      "OpenRouter (Nemotron 3 Ultra)",
      "NVIDIA NIM (Nemotron 3 Ultra)",
      "Zhipu (GLM-4.5)",
      "DashScope (Qwen-Plus)",
      "SiliconFlow (DeepSeek V3.2)",
      "Hugging Face (Qwen 2.5 72B)",
      "Cerebras (Qwen 3 235B)",
      "Novita (gpt-oss-120b, $1 credit)",
    ],
  },
  reasoning: {
    primary: "Gemini (3.8-flash, vision)",
    backups: [
      "Cohere (Command A Vision)",
      "GitHub Models (gpt-4.1-mini, vision, needs GITHUB_TOKEN — unverified)",
      "OpenRouter (Nemotron 3.5 Super VL, vision)",
      "NVIDIA NIM (Nemotron 3.5 Super VL / Llama 3.2 90B Vision)",
      "DashScope (Qwen2.5-VL 72B, vision)",
      "SiliconFlow (Qwen2.5-VL 72B, vision)",
      "Zhipu (GLM-4.5V, vision)",
      "Groq (qwen3.8-27b, vision)",
      "Hugging Face (Llama 3.2 11B Vision)",
      "Cerebras (Gemma 4 31B, vision)",
      "Cloudflare (Llama 3.2 11B Vision)",
      "AIML API (gpt-4o-mini, vision, billing-dead — out of funds)",
      "Moonshot (moonshot-v1-8k-vision, billing-dead — free credits exhausted)",
      "SambaNova (Gemma 4 31B, vision, billing-dead — card required)",
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
  // The /v1 is required: the SDK appends /chat/completions to this base
  // URL. Without it every DeepSeek call 404d — DeepSeek never worked
  // in this app until this fix (2026-11-26).
  return createOpenAI({
    apiKey,
    baseURL: "https://api.deepseek.com/v1",
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

function createPollinationsProvider() {
  // No key exists for Pollinations — it is a free public API. The AI
  // SDK requires a non-empty apiKey, so a placeholder is sent; the
  // service ignores it. Verified live 2026-11-25 (GET: exact reply,
  // HTTP 200, ~1.3s; JSON mode verified). Its OpenAI-compatible POST
  // endpoint was PROVEN live 2026-11-26 22:57:39 CST — it answered in
  // 0.4s, but REJECTED the guide schema: Pollinations enforces strict
  // JSON Schema (required must list every property key) and our zod
  // schemas use .optional() liberally, so 'workedExample' was missing
  // from required. That is fixed in lib/strictSchema.ts: every
  // generateObject call goes through schemaForModel(), which sends
  // Pollinations a strictified copy of the schema (same zod
  // validation on the response) and every other provider the zod
  // schema unchanged. Pollinations sits SECOND in every text chain,
  // so the worst case for a failure there is a fast failure and the
  // chain moves on; the chain trying it during a real generation is
  // the only way its POST path gets proven, so do not probe it
  // directly with curl.
  return createOpenAI({
    apiKey: "pollinations-no-key",
    baseURL: "https://text.pollinations.ai/openai",
  });
}

function createGitHubModelsProvider() {
  // UNVERIFIED: the inference host answered a GET with HTTP 200 on
  // 2026-11-25, but the authenticated POST test was blocked by an
  // approval timeout. This constructor only activates when GITHUB_TOKEN
  // is set — verify with one curl (docs/api-hunt-2026-11-25.md) before
  // setting it in Vercel.
  const apiKey = process.env.GITHUB_TOKEN;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://models.github.ai/inference",
  });
}

function createSiliconFlowProvider() {
  const apiKey = process.env.SILICONFLOW_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.siliconflow.cn/v1",
  });
}

function createAimlProvider() {
  const apiKey = process.env.AIMLAPI_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.aimlapi.com/v1",
  });
}

function createHuggingFaceProvider() {
  const apiKey = process.env.HF_TOKEN;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://router.huggingface.co/v1",
  });
}

function createMoonshotProvider() {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://api.moonshot.ai/v1",
  });
}

function createZhipuProvider() {
  const apiKey = process.env.ZHIPU_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://open.bigmodel.cn/api/paas/v4",
  });
}

function createDashScopeProvider() {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;
  return createOpenAI({
    apiKey,
    baseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
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
  pollinations: ReturnType<typeof createPollinationsProvider>;
  github: ReturnType<typeof createGitHubModelsProvider>;
  siliconflow: ReturnType<typeof createSiliconFlowProvider>;
  aiml: ReturnType<typeof createAimlProvider>;
  huggingface: ReturnType<typeof createHuggingFaceProvider>;
  moonshot: ReturnType<typeof createMoonshotProvider>;
  zhipu: ReturnType<typeof createZhipuProvider>;
  dashscope: ReturnType<typeof createDashScopeProvider>;
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
    pollinations: createPollinationsProvider(),
    github: createGitHubModelsProvider(),
    siliconflow: createSiliconFlowProvider(),
    aiml: createAimlProvider(),
    huggingface: createHuggingFaceProvider(),
    moonshot: createMoonshotProvider(),
    zhipu: createZhipuProvider(),
    dashscope: createDashScopeProvider(),
  };
}

// Spec key ("moonshot/kimi-k2-0711-preview") for each model built by
// resolveSpecs(), keyed by the model object itself — so modelLabel()
// can name the provider exactly. The SDK's own provider/modelId is
// NOT enough: every OpenAI-compatible provider reports provider
// "openai.chat", so SambaNova and Cerebras both come out as
// "openai.chat/gpt-oss-120b" and NVIDIA and Novita both as
// "openai.chat/openai/gpt-oss-120b". A WeakMap keeps the mapping
// without mutating the SDK's model objects, and entries die with
// the model objects (models are rebuilt per request).
const MODEL_SPEC_KEYS = new WeakMap<LanguageModel, string>();

/**
 * Interleave a spec list round-robin by provider: first model of
 * each provider (in the order the providers first appear), then
 * second model of each provider, and so on. Providers with a single
 * model appear once, in round one.
 *
 * Why: the CATEGORY_SPECS lists are written grouped by provider
 * (all four Gemini models together, both Groq models together, ...).
 * Tried in that order, one provider's outage burns the whole wall —
 * 2026-11-26 12:33: all four Gemini models went first (overload,
 * then three 12s timeouts), the billing-dead providers then failed
 * fast, and the 50s wall ran out with DeepSeek and Pollinations
 * never tried. Round-robin keeps the provider priority — the first
 * provider in the list still goes first — but a single provider can
 * no longer eat the wall: after its first model fails, a different
 * provider gets the next attempt. Counts are unchanged; only the
 * order changes. Applied in resolveSpecs(), so every category and
 * the lite list get it from the same place.
 */
function interleaveSpecs(
  specs: readonly ModelSpec[]
): readonly ModelSpec[] {
  const byProvider = new Map<ProviderKind, ModelSpec[]>();
  for (const spec of specs) {
    const list = byProvider.get(spec[0]);
    if (list) list.push(spec);
    else byProvider.set(spec[0], [spec]);
  }
  const out: ModelSpec[] = [];
  let round = 0;
  let added = true;
  while (added) {
    added = false;
    for (const list of byProvider.values()) {
      const spec = list[round];
      if (spec) {
        out.push(spec);
        added = true;
      }
    }
    round++;
  }
  return out;
}

function resolveSpecs(
  specs: readonly ModelSpec[],
  providers: ProviderInstances
): LanguageModel[] {
  const out: LanguageModel[] = [];
  // Interleaved try order (see interleaveSpecs): providers are
  // skipped silently when their key is not set, which preserves the
  // relative order of the ones that remain.
  for (const [kind, id] of interleaveSpecs(specs)) {
    const provider = providers[kind];
    if (!provider) continue; // no key set for this provider — skip silently
    // Each provider is callable with a model ID, but their call
    // signatures differ (model-ID string unions), so call through a
    // common (modelId: string) => LanguageModel type.
    const model = (provider as (modelId: string) => LanguageModel)(id);
    MODEL_SPEC_KEYS.set(model, `${kind}/${id}`);
    out.push(model);
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
 *  (guide enrichment). Cheap and fast first: Groq 20b leads on raw
 *  speed, then the Gemini Lite models, then the cheapest allowances —
 *  Cloudflare (300 RPM), Zhipu GLM-4.5-Air, SiliconFlow Qwen3-8B,
 *  DashScope Qwen3-8B — then Cerebras, AIML, HF, Moonshot v1-8k,
 *  OpenRouter's most reliable free model + router, NVIDIA,
 *  SambaNova, Cohere, DeepSeek, Novita, Pollinations (no key), GitHub
 *  Models (unverified, last). */
export function getLiteModels(): LanguageModel[] {
  // Same provider priority as chat (fastest/cheapest first), with the
  // live providers first and the billing-dead ones (AIML, Moonshot,
  // SambaNova, DeepSeek) after them. Pollinations sits second, right
  // after Groq. resolveSpecs interleaves this list round-robin by
  // provider, same as the categories.
  return resolveSpecs(
    [
      ["groq", "openai/gpt-oss-20b"],
      ["pollinations", "openai"],
      ["google", "gemini-3.5-flash-lite"],
      ["google", "gemini-3.1-flash-lite"],
      ["cohere", "command-a-03-2025"],
      ["github", "openai/gpt-4.1-mini"],
      ["aiml", "meta-llama/Llama-3.3-70B-Instruct"],
      ["moonshot", "moonshot-v1-8k"],
      ["sambanova", "gpt-oss-120b"],
      ["deepseek", "deepseek-chat"],
      ["cloudflare", "@cf/openai/gpt-oss-120b"],
      ["zhipu", "glm-4.5-air"],
      ["siliconflow", "Qwen/Qwen3-8B"],
      ["dashscope", "qwen3-8b"],
      ["cerebras", "gpt-oss-120b"],
      ["huggingface", "meta-llama/Llama-3.1-8B-Instruct"],
      ["openrouter", "nvidia/nemotron-3.5-super-vl:free"],
      ["openrouter", "openrouter/free"],
      ["nvidia", "openai/gpt-oss-120b"],
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

/**
 * Human-readable "provider/model-id" label for a model, for server
 * logs — e.g. "google/gemini-3.8-flash", "moonshot/kimi-k2-0711-preview".
 * Prefers the chain spec key recorded when the model was built (see
 * MODEL_SPEC_KEYS): the SDK's own provider/modelId is ambiguous for
 * the OpenAI-compatible providers, so the spec key is what makes the
 * label exact. Falls back to the SDK's provider/modelId for models
 * built outside the chain. Server logs are the only diagnostic we
 * have (Hobby retention is 1 hour), so every attempt-failure log line
 * must carry this label: without it, a failure has to be matched to
 * its model by call order, which is how the 2026-11-26 02:37 outage
 * had to be diagnosed. Never includes a key — these are public model
 * identifiers only.
 */
export function modelLabel(model: LanguageModel): string {
  const specKey = MODEL_SPEC_KEYS.get(model);
  if (specKey) return specKey;
  const provider =
    typeof model.provider === "string" && model.provider
      ? model.provider
      : "unknown-provider";
  const modelId =
    typeof model.modelId === "string" && model.modelId
      ? model.modelId
      : "unknown-model";
  return `${provider}/${modelId}`;
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
 *  all providers are exhausted. Billing exhaustion (402, suspended
 *  account, card required) counts too: the chain is out of free calls
 *  either way. Used only for the final 503 response. */
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
    text.includes("402") ||
    text.includes("insufficient balance") ||
    text.includes("suspend") ||
    text.includes("credit card") ||
    text.includes("billing") ||
    text.includes("payment") ||
    text.includes("out of credits") ||
    text.includes("free credits") ||
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
 *  the chain — the same request works on the next provider. Billing
 *  errors (402, insufficient balance, suspended account, credit-card
 *  demands) are provider-side too: they must never stop the chain and
 *  must never reach the student as the failure message (2026-11-25:
 *  an AI Gateway billing error surfaced as the generation failure
 *  because these patterns were missing). */
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
    text.includes("payment") ||
    text.includes("insufficient balance") ||
    text.includes("insufficient_balance") ||
    text.includes("suspend") ||
    text.includes("credit card") ||
    text.includes("add a card") ||
    text.includes("recharge") ||
    text.includes("billing") ||
    text.includes("out of credits") ||
    text.includes("credits exhausted") ||
    text.includes("free credits") ||
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

/**
 * True when an error is a timeout — the attempt ran out of its cap
 * before the provider answered. Separate from isRetryableProviderError
 * on purpose: the classifiers above decide whether the chain moves on
 * to the next model, while this one decides whether the SAME model
 * gets a second chance at the SIMPLIFIED shape (see
 * app/api/generate/route.ts). Since 2026-11-26 a timeout means NO
 * simplified retry: the 16:52 outage proved a hanging model times
 * out again on the smaller shape (~15s burned for nothing), so the
 * chain moves straight to the next provider. The simplified retry
 * survives only for NON-timeout failures, where the model answered
 * but the shape was wrong. Matches the timeout signals the AI SDK
 * and fetch produce (TimeoutError, "timed out", "timeout",
 * "aborted" from an AbortSignal timeout). Deliberately narrow — an
 * overload error that merely mentions "timeout" in passing is
 * already retryable and moves on to the next model instead.
 */
export function isTimeoutError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const text = `${err.name} ${err.message}`.toLowerCase();
  return (
    err.name === "TimeoutError" ||
    text.includes("timed out") ||
    text.includes("timeout") ||
    text.includes("timedout") ||
    text.includes("aborted")
  );
}

export const MISSING_KEY_MESSAGE =
  "No AI provider key is configured. Add a free key (Google AI Studio, Groq, OpenRouter, Cerebras, NVIDIA NIM, SambaNova, Cohere, Cloudflare, DeepSeek, Novita, SiliconFlow, AIML API, Hugging Face, Moonshot, Zhipu, Qwen/DashScope, or a GitHub token) to the environment to generate content — Pollinations (no key) is always in the chain as a safety net.";

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
    .replace(/ghp_[0-9A-Za-z]{10,}/g, "[key]")
    .replace(/github_pat_[0-9A-Za-z_]{10,}/g, "[key]")
    .replace(/gho_[0-9A-Za-z]{10,}/g, "[key]")
    .replace(/hf_[0-9A-Za-z]{10,}/g, "[key]")
    .replace(/sk-[0-9A-Za-z]{10,}/g, "[key]")
    .replace(/\b[0-9a-f]{40}\b/g, "[key]")
    .slice(0, 300);
}
