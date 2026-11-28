import type { LanguageModel } from "ai";
import { modelLabel } from "./providers";
import { isPollinationsModel } from "./strictSchema";

/**
 * Which model runs the one repair attempt in /api/generate (see
 * app/api/generate/route.ts): the serving model — EXCEPT when the
 * serving model is Pollinations.
 *
 * Pollinations' free tier allows 1 reply every 45 seconds per IP
 * (Vercel logs 2026-11-27 17:28, request 92qtd: "Free limit reached:
 * 1 reply every 45 seconds per IP. Retry after 33s"), so a repair
 * that retries the SAME Pollinations model seconds after the first
 * call almost always fails on that limit — and the repair is
 * pointless anyway, since a second Pollinations call cannot produce
 * a fuller guide than the first. A Pollinations-served guide is
 * therefore repaired on the NEXT provider in the chain after the
 * serving model: a different provider with a bigger output budget is
 * the one that could actually beat a thin guide, and the route gives
 * it the FULL prompt for that provider (not the compact Pollinations
 * prompt). If Pollinations was the last model in the resolved chain
 * there is no next provider and the repair is skipped (null) — the
 * original is kept, exactly as when a repair fails. Every other
 * provider keeps the same-model repair — they have no per-IP 45s
 * limit.
 *
 * 2026-11-28 SPEED RULE: the repair is ALSO skipped when the model
 * that would run it is Cohere — whichever way it got selected (next
 * provider after a Pollinations-served guide, or same-model repair
 * of a Cohere-served guide). Cohere has timed out on EVERY
 * full-shape attempt in the Vercel logs (2026-11-26/27: 02:46,
 * 09:25, 13:06, 23:25 — each time at the 20s cap, never a completed
 * guide), so a repair on Cohere burns ~15s and the original is
 * always kept anyway; the repair has never succeeded live at all
 * (once a Pollinations 45s/IP 429, once a Cohere timeout). For a
 * Pollinations-served long-session guide — the common path, since
 * the 2-module compact guide is always below the 3-module depth
 * floor — the repair model IS Cohere, so the repair runs on every
 * such request and buys nothing: skipping it returns the same guide
 * ~15s sooner, with zero quality loss (the student gets the
 * original either way). Re-enable by removing the Cohere check
 * below if Cohere ever proves it can complete a full-shape guide
 * inside the repair cap.
 *
 * Pure function (no I/O) so the rule is logic-testable without
 * running a generation. `models` is the resolved chain the serving
 * model came from (identity matters — the serving model must be one
 * of the objects in `models`, as it is in the route).
 */
function isCohereModel(model: LanguageModel): boolean {
  return modelLabel(model).startsWith("cohere/");
}

export function selectRepairModel(
  models: readonly LanguageModel[],
  modelUsed: LanguageModel | null
): LanguageModel | null {
  if (!modelUsed) return null;
  if (!isPollinationsModel(modelUsed)) {
    // Same-model repair — except Cohere (see the SPEED RULE above).
    if (isCohereModel(modelUsed)) return null;
    return modelUsed;
  }
  const next = models[models.indexOf(modelUsed) + 1];
  // Next-provider repair — except when that provider is Cohere.
  if (next && isCohereModel(next)) return null;
  return next ?? null;
}
