import {
  generateObject,
  NoObjectGeneratedError,
  type CoreMessage,
  type LanguageModel,
} from "ai";
import type { z } from "zod";
import { modelLabel } from "./providers";
import { salvageObjectDetailed } from "./salvageJson";
import { schemaForModel } from "./strictSchema";

/**
 * generateObject with a truncation safety net, for every call site.
 *
 * WHY (live proof, Vercel logs 2026-11-27 02:46:51 CST): Pollinations
 * returned a nearly complete guide and then stopped mid-string at
 * JSON position 6064; the SDK threw NoObjectGeneratedError /
 * AI_JSONParseError, and nothing retried it — the SDK's retry loop
 * only retries APICallError with isRetryable === true, and a parse
 * failure is not one — so the chain moved on with a usable guide
 * thrown away. The same truncation can hit any generateObject call
 * whose output is large (guides, builder-bot edits, games, practice,
 * enrichment), so every call site goes through this wrapper instead
 * of calling generateObject directly.
 *
 * WHAT IT DOES, in order:
 *  1. Calls generateObject exactly as the caller asked — same model,
 *     same schema (schemaForModel is applied here, so Pollinations
 *     still gets the strictified schema and every other provider the
 *     zod schema unchanged), same prompt, tokens, retries and abort.
 *     A healthy response passes through untouched.
 *  2. On a NoObjectGeneratedError that carries the model's raw text,
 *     it salvages the text (see lib/salvageJson.ts): close off the
 *     truncated JSON at the latest cut point that parses, and validate
 *     it against the SAME zod schema. When that validates, the
 *     salvaged object is returned — the student gets the guide the
 *     model already wrote, minus its incomplete tail, instead of a
 *     503. When the strict validation fails, a second PARTIAL pass
 *     fills missing top-level fields with honest empty defaults
 *     (empty strings / arrays — never invented content) and drops
 *     incomplete array items, so a partial whose required scalar
 *     fields trail the truncation point still validates and is
 *     returned. The route's own checks (sanitizeGuide, missingParts,
 *     the repair pass) then judge the salvaged guide exactly as they
 *     would a complete one, so a thin salvaged guide still gets its
 *     repair attempt.
 *  3. When the text cannot be salvaged into a valid object, the
 *     original error is rethrown unchanged — the caller's fallback
 *     chain behaves exactly as before. BUT THE FAILURE IS LOGGED:
 *     the first version of this wrapper logged only on success, so
 *     the live 09:26 failure (Vercel logs 2026-11-27 09:25:18 CST)
 *     left NO salvage line anywhere and the silence itself had to
 *     be root-caused from the absence of a log line. Every salvage
 *     attempt now logs its outcome — attempted, salvaged (strict or
 *     partial, with what was filled), or failed (with the cut
 *     counts and the missing fields) — so the next Vercel log read
 *     can SEE the salvage net work or name why it did not.
 *
 * WHAT IT DOES NOT DO: it never asks the model to complete or repair
 * the JSON (a "complete this JSON" follow-up would have to output
 * the remainder, ~1,000–2,000 tokens, which likely exceeds the same
 * ~1,500-token cap that truncated the first call), and it never
 * invents content — salvage only returns what the model already
 * wrote. The returned result on the salvaged path carries only
 * `.object` (no usage / finishReason — the call failed); every call
 * site in this app reads only `.object`, so nothing else changes.
 *
 * The options type covers exactly the fields this app's ten call
 * sites use (model, system, prompt, messages, maxTokens, maxRetries,
 * abortSignal). A future call site that needs another generateObject
 * option (mode, temperature, providerOptions, ...) must add it here
 * first — tsc will flag the omission at that call site.
 */

export type SafeGenerateOptions<T> = {
  /** The model to call, from the fallback chain. */
  model: LanguageModel;
  /** The zod schema for the call — used for the live request (via
   *  schemaForModel) AND to validate any salvaged object. */
  zodSchema: z.ZodType<T>;
  system?: string;
  prompt?: string;
  messages?: CoreMessage[];
  maxTokens?: number;
  maxRetries?: number;
  abortSignal?: AbortSignal;
};

export async function generateObjectSafe<T>(
  options: SafeGenerateOptions<T>
): Promise<{ object: T }> {
  const { zodSchema, ...rest } = options;
  const model = options.model;
  try {
    const result = await generateObject({
      ...rest,
      schema: schemaForModel(model, zodSchema),
    });
    return { object: result.object as T };
  } catch (err) {
    // Only a parse failure on returned text can be salvaged: the
    // model answered, but its JSON was cut off. Every other failure
    // (overload, billing, timeout, a schema mismatch on a COMPLETE
    // response) rethrows untouched — salvage cannot help those, and
    // the caller's fallback chain must see the real error.
    if (NoObjectGeneratedError.isInstance(err)) {
      if (typeof err.text === "string" && err.text.length > 0) {
        const { object: salvaged, diagnostics } = salvageObjectDetailed(
          err.text,
          zodSchema
        );
        if (salvaged !== null) {
          // How much of the guide survived, for the log line (a
          // guide reports its module count; other shapes report
          // nothing — the line stays generic).
          const modules = (salvaged as unknown as { modules?: unknown[] })
            .modules;
          const kept =
            Array.isArray(modules) && modules.length > 0
              ? `, kept ${modules.length} module(s)`
              : "";
          const filled =
            diagnostics.filledFields.length > 0
              ? `, filled with empty defaults: ${diagnostics.filledFields.join(", ")}`
              : "";
          console.error(
            `[safeGenerate] salvaged truncated output from ${modelLabel(model)} (${err.text.length} chars received, ${diagnostics.mode} salvage${kept}${filled})`
          );
          return { object: salvaged };
        }
        // Salvage was attempted and failed — log it. A wrapper that
        // silently rethrows the original error hides the salvage
        // net's failure from the Vercel logs (that is exactly what
        // happened live on 2026-11-27 09:26: no salvage line
        // anywhere, and the 2-module partial was thrown away
        // unnoticed). The cut counts and missing fields name the
        // cause for the next log read.
        console.error(
          `[safeGenerate] salvage FAILED for ${modelLabel(model)} (${err.text.length} chars received, ${diagnostics.cutsTried} cut points tried, ${diagnostics.parsedCuts} parsed${diagnostics.lastValidationError ? ` — ${diagnostics.lastValidationError}` : ""})`
        );
      } else {
        // No raw text on the error (for example the model returned
        // no tool call in tool mode) — nothing to salvage from.
        // Logged, so this case is distinguishable from a salvage
        // validation failure in the next log read.
        console.error(
          `[safeGenerate] cannot salvage ${modelLabel(model)}: NoObjectGeneratedError with no raw text (finishReason ${err.finishReason ?? "unknown"})`
        );
      }
    }
    throw err;
  }
}
