import type { z } from "zod";

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
 * already wrote, minus the incomplete tail.
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
  if (typeof text !== "string" || text.trim().length === 0) return null;
  try {
    const whole = JSON.parse(text);
    if (!validate || validate(whole)) return whole;
    // Complete JSON that fails validation: fall through to the cut
    // walk — an earlier prefix may still be a valid guide.
  } catch {
    // Not complete JSON — fall through to the cut-and-close walk.
  }
  const cuts = scanCutPoints(text);
  // Latest first: keep as much of the guide as possible.
  const attempts = Math.min(cuts.length, MAX_CUT_ATTEMPTS);
  for (let n = 0; n < attempts; n++) {
    const cut = cuts[cuts.length - 1 - n];
    const closed = closePrefix(text.slice(0, cut.offset), cut.stack);
    try {
      const parsed = JSON.parse(closed);
      if (!validate || validate(parsed)) return parsed;
      // Parses but does not validate (for example a module cut off
      // before a required field) — try an earlier cut.
    } catch {
      // This cut still does not parse (for example it ends inside a
      // number the scanner could not see) — try an earlier one.
    }
  }
  return null;
}

/**
 * Salvage a truncated JSON response and validate it against the
 * SAME zod schema the live call uses — a salvaged object that does
 * not validate is not a guide, so it is rejected exactly as a
 * malformed complete response would be. Returns the validated value,
 * or null when the text cannot be salvaged into a valid object.
 */
export function salvageObject<T>(
  text: string,
  schema: z.ZodType<T>
): T | null {
  // The schema check runs INSIDE the cut walk: the latest parseable
  // prefix is usually a half-written module, so the walk must keep
  // going back until a prefix validates as a whole guide.
  const parsed = salvageTruncatedJson(text, (value) =>
    schema.safeParse(value).success
  );
  if (parsed === null) return null;
  const result = schema.safeParse(parsed);
  return result.success ? result.data : null;
}
