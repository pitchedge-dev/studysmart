import {
  generateObject,
  NoObjectGeneratedError,
  type CoreMessage,
  type LanguageModel,
} from "ai";
import type { z } from "zod";
import { modelLabel } from "./providers";
import { salvageObject } from "./salvageJson";
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
 *     503. The route's own checks (sanitizeGuide, missingParts,
 *     the repair pass) then judge the salvaged guide exactly as they
 *     would a complete one, so a thin salvaged guide still gets its
 *     repair attempt.
 *  3. When the text cannot be salvaged into a valid object, the
 *     original error is rethrown unchanged — the caller's fallback
 *     chain behaves exactly as before.
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
    if (
      NoObjectGeneratedError.isInstance(err) &&
      typeof err.text === "string" &&
      err.text.length > 0
    ) {
      const salvaged = salvageObject(err.text, zodSchema);
      if (salvaged !== null) {
        console.error(
          `[safeGenerate] salvaged truncated output from ${modelLabel(model)} (${err.text.length} chars received, salvaged object validated)`
        );
        return { object: salvaged };
      }
    }
    throw err;
  }
}
