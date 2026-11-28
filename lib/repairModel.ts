import type { LanguageModel } from "ai";
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
 * Pure function (no I/O) so the rule is logic-testable without
 * running a generation. `models` is the resolved chain the serving
 * model came from (identity matters — the serving model must be one
 * of the objects in `models`, as it is in the route).
 */
export function selectRepairModel(
  models: readonly LanguageModel[],
  modelUsed: LanguageModel | null
): LanguageModel | null {
  if (!modelUsed) return null;
  if (!isPollinationsModel(modelUsed)) return modelUsed;
  const next = models[models.indexOf(modelUsed) + 1];
  return next ?? null;
}
