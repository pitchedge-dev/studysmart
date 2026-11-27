import type { z } from "zod";
import { z as zod } from "zod";

/**
 * Salvage a truncated JSON response.
 *
 * ROOT CAUSE IT EXISTS FOR (live proof, Vercel logs 2026-11-27
 * 02:46:51 CST): Pollinations ACCEPTED the strictified schema and
 * returned a large, nearly complete guide — then stopped mid-string
 * ("Unterminated string in JSON at position 6064", cut off inside an
 * explanation, "Viscosity affects how readily magma..."). The SDK
 * turns that into NoObjectGeneratedError / AI_JSONParseError, and the
 * SDK's retry loop never retries it (its retry predicate only fires
 * for APICallError with isRetryable === true — see node_modules/ai
 * retryWithExponentialBackoff). With maxRetries: 0 the route made
 * exactly one Pollinations POST and the chain moved on, even though
 * the first ~6,000 characters of the guide were perfectly good.
 *
 * The truncation itself is Pollinations-side: our side sends
 * max_completion_tokens: 8192 (verified in the installed
 * @ai-sdk/openai source — model "openai" starts with "o", so the SDK
 * treats it as a reasoning model and remaps max_tokens to
 * max_completion_tokens), the 20s abort cap did not fire (the error
 * is a parse error on a returned body, not a TimeoutError), and the
 * output simply stopped at ~1,500 tokens / ~19s — Pollinations' own
 * output cap and/or per-request time limit. No schema error occurred:
 * the strictify fix worked. A smaller request (the compact prompt in
 * app/api/generate/route.ts) is the first line of defence; this
 * module is the second — when a response still truncates, the part
 * that arrived is usually most of the guide, and throwing it away
 * for a missing tail is wasteful.
 *
 * WHY THE FIRST SALVAGE NET DID NOT FIRE LIVE (Vercel logs
 * 2026-11-27 09:25:18 CST — the 09:26 failure, request
 * 2wgvk-1795793118503-22b4a112a599): Pollinations truncated AGAIN
 * (unterminated string at position 6759; modules 1 "How Volcanoes
 * Erupt" and 2 "Monitoring Volcanoes" complete, module 3 "Predicting
 * Eruptions" cut mid-word), the wrapper WAS entered — /api/generate's
 * full-shape call goes through generateObjectSafe (app/api/generate/
 * route.ts line ~400), and in JSON mode the SDK's
 * NoObjectGeneratedError carries the raw text — but salvageObject
 * validated every cut prefix against the STRICT GenerateResultSchema,
 * which requires topicType, guideTitle, studyGuide, summary,
 * keyTerms and keyConcepts. Those required fields TRAIL the
 * truncation point in the order Pollinations actually emits them
 * (the compact prompt's own bullets list modules first and
 * studyGuide / key terms / quiz last, so a model following the
 * prompt narrative emits modules first) — so every cut failed
 * validation and salvage returned null. Reproduced locally
 * (hidden_files/verify-pollinations-salvage-2-2026-11-27.mts): a
 * guide cut mid-module-3 salvages fine in schema property order,
 * but returns null when studyGuide/summary trail modules, when
 * modules come first, and when the output is wrapped in ```json
 * fences. The fix below is therefore twofold: (1) a PARTIAL path
 * that fills missing top-level fields with honest empty defaults
 * (empty strings / arrays — never invented content) and drops
 * incomplete array items, so a 2-module partial validates and is
 * RETURNED instead of rethrown; (2) the wrapper now logs every
 * salvage attempt and its outcome, so a future failure is visible
 * in the Vercel logs instead of silent. The route's own checks
 * (sanitizeGuide, missingParts, the one repair attempt, and the
 * /api/enrich finishing sections) then judge the salvaged guide
 * exactly as they would a complete one.
 *
 * How it works: JSON is prefix-closed — any prefix that ends just
 * after a complete value (i.e. at a comma outside a string) becomes
 * valid JSON again once the still-open containers are closed. So the
 * scanner walks the text once, tracking string/escape state and the
 * open-container stack, records every comma that occurs outside a
 * string (with the stack at that point), then tries the cuts from
 * latest to earliest: cut at the comma, append the closers for the
 * open containers, JSON.parse. The first cut that parses wins. A
 * cut inside a module that lost a required field (for example a
 * module whose practice array was cut off) fails zod validation in
 * salvageObject, so the walk continues to an earlier cut — the whole
 * module is dropped instead of shipping a broken one. Pure and
 * deterministic: no LLM call, no network, no guessing at content.
 * It never invents anything — it only returns what the model
 * already wrote, minus the incomplete tail, plus honest empty
 * defaults for fields that never arrived.
 */

/** A comma outside a string, with the open-container stack at it. */
type CutPoint = {
  /** Offset of the comma itself; the cut excludes it. */
  offset: number;
  /** Open containers at the comma, innermost last. */
  stack: Array<"{" | "[">;
};

/**
 * Scan truncated JSON text once: track string/escape state and the
 * open-container stack, and record every comma that occurs outside
 * a string (each is a candidate cut point). Commas inside strings
 * are not cut points — cutting there would split a value.
 */
function scanCutPoints(text: string): CutPoint[] {
  const cuts: CutPoint[] = [];
  const stack: Array<"{" | "["> = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("{");
    } else if (ch === "[") {
      stack.push("[");
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    } else if (ch === ",") {
      cuts.push({ offset: i, stack: [...stack] });
    }
  }
  return cuts;
}

/** Close the open containers of a cut prefix, innermost first. */
function closePrefix(prefix: string, stack: Array<"{" | "[">): string {
  let out = prefix;
  for (let i = stack.length - 1; i >= 0; i--) {
    out += stack[i] === "{" ? "}" : "]";
  }
  return out;
}

/** Maximum cut points tried, latest first — a truncated guide has
 *  on the order of 50–150 commas; the valid cut is normally within
 *  the last few, and dropping a whole module costs a few dozen more.
 *  Bounded so a pathological input cannot loop long. Each attempt is
 *  one JSON.parse of a few kilobytes, so 300 attempts is still
 *  milliseconds. */
const MAX_CUT_ATTEMPTS = 300;

/**
 * Strip anything before the JSON object starts. A model that wraps
 * its answer in a ```json fence (or a line of prose) breaks every
 * cut: no prefix parses when the text does not start with "{". The
 * guide JSON always starts at the first "{" — prose before it never
 * contains a brace that matters — so the text is salvaged from
 * there. A trailing fence is stripped too. Pure text surgery: the
 * JSON itself is untouched.
 */
function cleanTruncatedText(text: string): string {
  let out = text;
  const open = out.indexOf("{");
  if (open > 0) out = out.slice(open);
  else if (open < 0) return text;
  // A trailing fence the model emitted after a complete object.
  const fence = out.lastIndexOf("```");
  if (fence > 0) out = out.slice(0, fence).trimEnd();
  return out;
}

/** What one cut walk found, for the server logs. */
export type SalvageWalkDiagnostics = {
  /** Cut points actually tried (latest first, bounded by MAX_CUT_ATTEMPTS). */
  cutsTried: number;
  /** Of those, how many JSON.parsed (but may still have failed validation). */
  parsedCuts: number;
  /** Why the best parseable prefix failed validation, when one parsed
   *  — the missing required fields, so the next log read names the
   *  cause instead of showing nothing. */
  lastValidationError?: string;
};

/** Outcome of one cut walk. */
type WalkResult = {
  value: unknown | null;
  diagnostics: SalvageWalkDiagnostics;
};

/**
 * Summarise a zod failure as the missing required fields, when the
 * failure is missing fields at all ("studyGuide, summary"). Falls
 * back to the first issue's message. Used only for log lines.
 */
function missingFieldsSummary(
  schema: z.ZodType<unknown>,
  value: unknown
): string {
  const result = schema.safeParse(value);
  if (result.success) return "valid";
  const missing = result.error.issues
    .filter(
      (issue) =>
        issue.code === "invalid_type" &&
        (issue as { received?: unknown }).received === "undefined"
    )
    .map((issue) => issue.path.join("."))
    .filter((p) => p.length > 0);
  if (missing.length > 0) return `missing required fields: ${missing.join(", ")}`;
  return result.error.issues
    .slice(0, 3)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Parse truncated JSON by closing it off at the latest cut point
 * that yields valid JSON. Returns the parsed value, or null when no
 * cut point works (for example the text was cut before any complete
 * value, or the model emitted invalid JSON for another reason).
 * Never throws.
 *
 * When `validate` is given, a cut only counts if the parsed value
 * also passes it — and the walk continues to earlier cuts when it
 * does not. That matters: the latest cut that merely PARSES usually
 * keeps a half-written module (for example a module whose concepts
 * arrived but whose `practice` array did not), which the schema
 * rejects. The walk has to keep going back until a whole module
 * boundary is reached, not stop at the first parseable prefix.
 * (Live lesson from the test: the first parseable cut of the 02:46
 * replay kept module 2 without `practice` and validated to nothing.)
 */
export function salvageTruncatedJson(
  text: string,
  validate?: (value: unknown) => boolean
): unknown | null {
  return walkCuts(text, validate).value;
}

/** The same walk, with diagnostics for the server logs. */
function walkCuts(
  text: string,
  validate?: (value: unknown) => boolean,
  schemaForSummary?: z.ZodType<unknown>
): WalkResult {
  const diagnostics: SalvageWalkDiagnostics = { cutsTried: 0, parsedCuts: 0 };
  if (typeof text !== "string" || text.trim().length === 0)
    return { value: null, diagnostics };
  const cleaned = cleanTruncatedText(text);
  try {
    const whole = JSON.parse(cleaned);
    if (!validate || validate(whole)) return { value: whole, diagnostics };
    if (schemaForSummary)
      diagnostics.lastValidationError = missingFieldsSummary(schemaForSummary, whole);
    // Complete JSON that fails validation: fall through to the cut
    // walk — an earlier prefix may still be a valid guide.
  } catch {
    // Not complete JSON — fall through to the cut-and-close walk.
  }
  const cuts = scanCutPoints(cleaned);
  // Latest first: keep as much of the guide as possible.
  const attempts = Math.min(cuts.length, MAX_CUT_ATTEMPTS);
  diagnostics.cutsTried = attempts;
  for (let n = 0; n < attempts; n++) {
    const cut = cuts[cuts.length - 1 - n];
    const closed = closePrefix(cleaned.slice(0, cut.offset), cut.stack);
    try {
      const parsed = JSON.parse(closed);
      diagnostics.parsedCuts += 1;
      if (!validate || validate(parsed)) return { value: parsed, diagnostics };
      if (schemaForSummary)
        diagnostics.lastValidationError = missingFieldsSummary(schemaForSummary, parsed);
      // Parses but does not validate (for example a module cut off
      // before a required field) — try an earlier cut.
    } catch {
      // This cut still does not parse (for example it ends inside a
      // number the scanner could not see) — try an earlier one.
    }
  }
  return { value: null, diagnostics };
}

// ---------------------------------------------------------------------------
// Partial path: fill missing top-level fields with honest empty defaults.
// ---------------------------------------------------------------------------

/** Unwrap ZodOptional / ZodDefault / ZodNullable to the inner schema. */
function unwrapField(field: z.ZodTypeAny): z.ZodTypeAny {
  let current: z.ZodTypeAny = field;
  while (
    current instanceof zod.ZodOptional ||
    current instanceof zod.ZodDefault ||
    current instanceof zod.ZodNullable
  ) {
    current = (current as z.ZodOptional<z.ZodTypeAny>)._def.innerType;
  }
  return current;
}

/**
 * The honest empty default for a required field, by its type.
 * Returns undefined when no honest default exists (an enum, an
 * object, a union): a field that cannot be defaulted honestly must
 * fail the salvage rather than be invented. Note `null` is a real
 * default here — only for a nullable field, where it means "unknown".
 */
function emptyDefaultFor(field: z.ZodTypeAny): unknown {
  const inner = unwrapField(field);
  if (inner instanceof zod.ZodString) return "";
  if (inner instanceof zod.ZodNumber) return 0;
  if (inner instanceof zod.ZodBoolean) return false;
  if (inner instanceof zod.ZodArray) return [];
  if (inner instanceof zod.ZodNullable) return null;
  return undefined;
}

/**
 * Normalise a parsed prefix into a candidate object for the strict
 * schema: drop array items that do not validate against the array's
 * element schema (a half-written trailing module, concept, or
 * question is dropped, never shipped broken), and fill missing
 * top-level fields with honest empty defaults. Returns null when
 * the prefix cannot be normalised honestly. The final strict
 * safeParse is the gate — a normalised object that still does not
 * validate (for example modules emptied to [] by the filter, below
 * the min(1) bound) is rejected and the walk continues.
 */
function normalizePartial<T>(
  value: unknown,
  schema: z.ZodType<T>
): { data: T; filledFields: string[] } | null {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !(schema instanceof zod.ZodObject)
  )
    return null;
  const shape = schema.shape as Record<string, z.ZodTypeAny>;
  const record = value as Record<string, unknown>;
  const filledFields: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(shape)) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      const present = record[key];
      // Array fields: keep only items that validate against the
      // element schema, so a trailing half-written module is dropped
      // instead of failing the whole guide.
      const inner = unwrapField(field);
      if (Array.isArray(present) && inner instanceof zod.ZodArray) {
        const element = (inner as z.ZodArray<z.ZodTypeAny>)._def.type;
        out[key] = present.filter((item) => element.safeParse(item).success);
      } else {
        out[key] = present;
      }
      continue;
    }
    // Absent: fine to omit when the schema accepts its absence
    // (optional, defaulted, or nullable).
    if (field.safeParse(undefined).success) continue;
    const fallback = emptyDefaultFor(field);
    if (fallback === undefined) return null;
    out[key] = fallback;
    filledFields.push(key);
  }
  const result = schema.safeParse(out);
  if (!result.success) return null;
  return { data: result.data, filledFields };
}

/** Which fields the partial path filled, for the server logs. */
export type SalvageDiagnostics = SalvageWalkDiagnostics & {
  /** "strict" when the prefix validated as-is; "partial" when
   *  missing fields were filled with honest empty defaults; null
   *  when nothing could be salvaged. */
  mode: "strict" | "partial" | null;
  /** Top-level fields the partial path filled with empty defaults. */
  filledFields: string[];
};

/** Full salvage outcome, with diagnostics for the server logs. */
export type SalvageResult<T> = {
  object: T | null;
  diagnostics: SalvageDiagnostics;
};

/**
 * Salvage a truncated JSON response and validate it against the
 * SAME zod schema the live call uses — a salvaged object that does
 * not validate is not a guide, so it is rejected exactly as a
 * malformed complete response would be. Returns the validated value,
 * or null when the text cannot be salvaged into a valid object.
 *
 * Two passes, latest cut first: (1) STRICT — the prefix validates
 * as-is, exactly as before; (2) PARTIAL — the prefix is normalised
 * (incomplete array items dropped, missing top-level fields filled
 * with honest empty defaults) and then validated. The partial pass
 * is what saves the live 09:26 case, where the required scalar
 * fields trail the truncation point: a 2-module guide with an empty
 * studyGuide is returned instead of a 503, and the route's repair
 * pass and /api/enrich add the rest. It never invents content —
 * filled fields are empty strings / arrays, and every surviving
 * module, concept, and question is text the model actually wrote.
 */
export function salvageObject<T>(
  text: string,
  schema: z.ZodType<T>
): T | null {
  return salvageObjectDetailed(text, schema).object;
}

/** salvageObject with diagnostics — what the wrapper logs. */
export function salvageObjectDetailed<T>(
  text: string,
  schema: z.ZodType<T>
): SalvageResult<T> {
  // Pass 1 — strict: the prefix validates against the schema as-is.
  const strict = walkCuts(
    text,
    (value) => schema.safeParse(value).success,
    schema
  );
  if (strict.value !== null) {
    const result = schema.safeParse(strict.value);
    if (result.success) {
      return {
        object: result.data,
        diagnostics: { ...strict.diagnostics, mode: "strict", filledFields: [] },
      };
    }
  }
  // Pass 2 — partial: normalise (drop broken items, fill missing
  // top-level fields with honest empty defaults), then validate.
  const partial = walkCuts(text, (value) => {
    const normalised = normalizePartial(value, schema);
    return normalised !== null;
  });
  if (partial.value !== null) {
    const normalised = normalizePartial(partial.value, schema);
    if (normalised !== null) {
      return {
        object: normalised.data,
        diagnostics: {
          ...partial.diagnostics,
          mode: "partial",
          filledFields: normalised.filledFields,
        },
      };
    }
  }
  // Nothing salvaged — report the best diagnosis from the strict
  // pass (its last parseable prefix names the missing fields).
  return {
    object: null,
    diagnostics: {
      cutsTried: Math.max(strict.diagnostics.cutsTried, partial.diagnostics.cutsTried),
      parsedCuts: Math.max(strict.diagnostics.parsedCuts, partial.diagnostics.parsedCuts),
      lastValidationError:
        strict.diagnostics.lastValidationError ??
        partial.diagnostics.lastValidationError,
      mode: null,
      filledFields: [],
    },
  };
}
