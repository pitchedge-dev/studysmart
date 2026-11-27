import { jsonSchema, zodSchema, type LanguageModel, type Schema } from "ai";
import type { z } from "zod";
import { modelLabel } from "./providers";

type JsonSchema7 = Parameters<typeof jsonSchema>[0];

/**
 * Pollinations strict-schema handling.
 *
 * ROOT CAUSE (live proof, Vercel logs 2026-11-26 22:57:39 CST): the
 * Pollinations OpenAI-compatible endpoint enforces STRICT JSON Schema
 * for response_format json_schema — `required` must be supplied and
 * must include EVERY key in `properties`, recursively. The zod
 * schemas in this app use `.optional()` liberally (workedExample,
 * translation, pronunciation, whyWrong, ...), so the JSON Schema the
 * AI SDK derives from them omits those keys from `required`, and
 * Pollinations rejected the request with a 400 before the model ever
 * ran: "Invalid schema for response_format 'response': ... Missing
 * 'workedExample'." The POST path itself is live (it answered in
 * 0.4s) — the blocker is our schema, not the provider.
 *
 * FIX CHOSEN (b) — a provider-specific strictify transform, applied
 * ONLY to Pollinations:
 *   1. The schema is derived from the SAME zod schema via the SDK's
 *      own zodSchema() conversion, so other providers receive a
 *      byte-identical schema to today.
 *   2. The JSON Schema is then strictified (see strictifyJsonSchema):
 *      every object's `required` is filled with all of its property
 *      keys, `additionalProperties: false` is set, and the keywords
 *      OpenAI strict mode does not support (minItems, maxItems,
 *      minLength, format, ...) are dropped — the prompt carries the
 *      counts, and the zod validation below still enforces the bounds
 *      on the response.
 *   3. The response is still validated by the SAME zod schema (the
 *      validate function from zodSchema()), so a malformed guide is
 *      still rejected exactly as before.
 *
 * WHY NOT THE ALTERNATIVES:
 * (a) Making the zod schemas strict-compatible by removing
 * `.optional()` would force the model to emit every field everywhere
 * AND would break the language-guide worked-example exemption at
 * validation: a language guide without a numeric worked example
 * would fail zod validation and the whole generation would fail.
 * With this fix the exemption is untouched — workedExample stays
 * optional in zod, so a guide without one still validates. The only
 * change is that Pollinations is ASKED (via the schema) to include
 * it; the system prompt already tells the model to find a
 * quantitative angle for non-numeric topics, and lib/guideQuality.ts
 * drops a worked example that promises a calculation but shows none.
 * (c) Dropping response_format for Pollinations (json_object mode)
 * would need `structuredOutputs: false` on the provider — which
 * flips generateObject's default mode to tool-calling — plus
 * `mode: "json"` at every call site, and any call site that forgot
 * it would silently send a function-calling request Pollinations
 * likely does not support. It also gives up schema-guided
 * generation for the largest schema in the app, so malformed JSON
 * becomes likely. Strictifying keeps the guidance Pollinations
 * demonstrably processes.
 *
 * The same rule applies to EVERY generateObject call site: any
 * schema with an optional property hits the identical rejection when
 * Pollinations is tried, so every call site goes through
 * schemaForModel() — for non-Pollinations models it returns the
 * SDK's own conversion unchanged (zero behaviour change), and for
 * Pollinations it returns the strictified version.
 */

/** True when this model is the Pollinations no-key provider. */
export function isPollinationsModel(model: LanguageModel): boolean {
  return modelLabel(model).startsWith("pollinations/");
}

/**
 * Keywords OpenAI strict structured-output mode does not support in
 * a schema (and which Pollinations' strict validator may therefore
 * reject after the `required` check passes). They are all
 * generation-time hints, not validation: the prompt carries the
 * counts, and the zod schema still enforces the bounds on the
 * response. Dropping them from the SENT schema changes nothing the
 * student sees.
 */
const UNSUPPORTED_STRICT_KEYS = new Set([
  "$schema",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minItems",
  "maxItems",
  "uniqueItems",
  "multipleOf",
  "minProperties",
  "maxProperties",
  "contains",
  "minContains",
  "maxContains",
  "propertyNames",
  "dependentRequired",
  "dependentSchemas",
  "unevaluatedProperties",
  "unevaluatedItems",
  "if",
  "then",
  "else",
  "not",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
]);

function strictifyNode(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictifyNode);
  if (node === null || typeof node !== "object") return node;
  const record = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (UNSUPPORTED_STRICT_KEYS.has(key)) continue;
    out[key] = strictifyNode(value);
  }
  // Strict rule, applied at EVERY object level (Pollinations checks
  // recursively — the live error cited modules[].concepts[]): the
  // `required` array must list every key in `properties`, and no
  // extra properties may appear.
  if (
    out.properties !== null &&
    typeof out.properties === "object" &&
    !Array.isArray(out.properties)
  ) {
    out.required = Object.keys(out.properties as Record<string, unknown>);
    out.additionalProperties = false;
  }
  return out;
}

/**
 * Strictify a JSON Schema (as derived by the AI SDK from a zod
 * schema) so a strict validator accepts it: `required` includes
 * every property key at every object level, `additionalProperties`
 * is false, and strict-unsupported keywords are dropped. Pure —
 * returns a new object, never mutates the input.
 */
export function strictifyJsonSchema(schema: JsonSchema7): JsonSchema7 {
  return strictifyNode(schema) as JsonSchema7;
}

/**
 * The schema to pass to generateObject for this model: the SDK's own
 * zod conversion unchanged for every provider except Pollinations,
 * where the strictified version is sent instead. The response is
 * validated by the same zod schema either way — including the
 * language-guide worked-example exemption, which lives in zod, not
 * in the sent JSON Schema.
 */
export function schemaForModel<T>(
  model: LanguageModel,
  schema: z.ZodType<T>
): Schema<T> {
  const base = zodSchema(schema);
  if (!isPollinationsModel(model)) return base;
  return jsonSchema(strictifyJsonSchema(base.jsonSchema), {
    validate: base.validate,
  });
}
