import { NextRequest, NextResponse } from "next/server";
import { generateObject, type LanguageModel } from "ai";
import { z } from "zod";
import {
  getModelsFor,
  isOverloadedError,
  isRetryableProviderError,
  MISSING_KEY_MESSAGE,
  OVERLOADED_MESSAGE,
} from "@/lib/gemini";
import {
  attemptTimeoutMs,
  GENERATE_FULL_ATTEMPT_MS,
  GENERATE_REPAIR_AFTER_MS,
  GENERATE_REPAIR_ATTEMPT_MS,
  GENERATE_SIMPLE_ATTEMPT_MS,
  GENERATE_WALL_CLOCK_MS,
  remainingMs,
} from "@/lib/generationBudget";

// Vercel Hobby functions are killed after a short default timeout; allow the
// full 60s so a real generation can finish instead of dying mid-stream.
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Schemas — deliberately loosened where the model used to trip validation.
// Practice is 1–3 problems per concept (aim for 3), checkpoints are 5–10
// questions (aim for 10), so a slightly short list still validates instead
// of failing the whole generation with a 500.
// ---------------------------------------------------------------------------

import {
  CheckpointSchema,
  ConceptSchema,
  GenerateResultSchema,
  PracticeGroupSchema,
  QuizQuestionSchema,
} from "@/lib/guideSchema";
import {
  isValidStudyHours,
  repairMinModules,
  studyTimeGuidance,
} from "@/lib/studyTime";
import { parseGivenResources } from "@/lib/givenResources";
import { qualityIssues, sanitizeGuide } from "@/lib/guideQuality";

// Simplified fallback shape, used once if the full shape fails to validate:
// concepts + targeted practice only, no checkpoint / reasoning / core ideas.
// It still returns a real, complete guide — never mock content.
const SimpleModuleSchema = z.object({
  moduleNumber: z.number(),
  title: z.string(),
  intro: z.string(),
  format: z.string().optional(),
  concepts: z.array(ConceptSchema).min(1).max(4),
  practice: z.array(PracticeGroupSchema),
});

const SimpleGenerateResultSchema = z.object({
  topicType: z.string(),
  guideTitle: z.string(),
  studyGuide: z.string(),
  summary: z.string().optional(),
  keyTerms: z
    .array(z.object({ term: z.string(), definition: z.string() }))
    .max(12)
    .optional(),
  keyConcepts: z.array(z.string()),
  languageCode: z.string().optional(),
  modules: z.array(SimpleModuleSchema).min(1).max(3),
  quiz: z.array(QuizQuestionSchema).max(6).optional(),
});

const EDUCATION_LEVELS = [
  "Elementary School",
  "Middle School",
  "High School",
  "College / University",
  "Adult learning",
] as const;

const TEST_TIMINGS = [
  "Today",
  "Tomorrow",
  "In 2–3 days",
  "In a week",
  "In 2+ weeks",
  "No test — just learning",
] as const;

function levelGuidance(level: string | undefined): string {
  switch (level) {
    case "Elementary School":
      return "The student is in elementary school: use very simple words, short sentences, and concrete everyday examples. Start with the most basic ideas first and keep explanations short.";
    case "Middle School":
      return "The student is in middle school: use clear, simple language, define any new term when you first use it, and use relatable examples.";
    case "High School":
      return "The student is in high school: use standard school-level depth, correct subject terminology, and examples that fit a high-school class.";
    case "College / University":
      return "The student is at college or university: go deeper, use precise subject terminology, and include the detail and nuance a university student needs.";
    case "Adult learning":
      return "This is an adult learner: be practical and concise, focus on understanding and real-world use, and skip school-style framing.";
    default:
      return "";
  }
}

function timingGuidance(timing: string | undefined): string {
  switch (timing) {
    case "Today":
      return "The test is TODAY: keep the guide short and high-yield — lead with the most testable points first, prioritise ruthlessly, and make practice quick and focused.";
    case "Tomorrow":
      return "The test is tomorrow: keep the guide focused and high-yield, lead with the most testable points, and include focused practice on them.";
    case "In 2–3 days":
      return "The test is in 2–3 days: give a balanced guide with the key points plus solid practice, so the student can review and practise over the next few days.";
    case "In a week":
      return "The test is in a week: give a fuller guide with more explanation and more practice, so the student can study steadily over the week.";
    case "In 2+ weeks":
      return "The test is in 2 or more weeks: give a thorough guide with deeper explanations and plenty of practice, built for learning over time rather than cramming.";
    case "No test — just learning":
      return "There is no test — the student is learning for understanding, not for an exam: do not use any exam or cramming framing, and focus on clear understanding and curiosity.";
    default:
      return "";
  }
}

function logError(tag: string, err: unknown) {
  // Log the real error server-side so a 500 can actually be diagnosed.
  // Never log the API key — it is not in scope here.
  if (err instanceof Error) {
    console.error(tag, {
      name: err.name,
      message: err.message,
      cause: (err as { cause?: unknown }).cause,
    });
  } else {
    console.error(tag, err);
  }
}

/**
 * Cheap self-check for a generated guide: what required parts are
 * missing? Only genuinely broken results count — no modules, almost no
 * concepts, no practice at all, or no key concepts / quiz when they were
 * requested. A small guide for a small input passes fine and is left
 * alone; only a thin result triggers the one repair attempt.
 */
function missingParts(
  core: z.infer<typeof GenerateResultSchema>,
  opts: { extractConcepts: boolean; includeQuiz: boolean }
): string[] {
  const missing: string[] = [];
  const modules = core.modules ?? [];
  const totalConcepts = modules.reduce(
    (n, m) => n + (m.concepts?.length ?? 0),
    0
  );
  const practiceGroups = modules.reduce(
    (n, m) => n + (m.practice?.length ?? 0),
    0
  );
  if (modules.length === 0) missing.push("no modules");
  if (totalConcepts < 3)
    missing.push(`only ${totalConcepts} concept(s) in total`);
  if (practiceGroups === 0) missing.push("no targeted practice");
  if (opts.extractConcepts && (core.keyConcepts?.length ?? 0) === 0)
    missing.push("no key concepts");
  if (opts.includeQuiz && (core.quiz?.length ?? 0) === 0)
    missing.push("no quiz questions");
  if (!core.studyGuide?.trim()) missing.push("empty study guide text");
  return missing;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, images, files, includeQuiz, extractConcepts, educationLevel, testTiming, studyHours } = body as {
      text?: string;
      images?: string[];
      /** Optional per-file metadata the Generate form may send (name/kind/size). */
      files?: unknown;
      includeQuiz?: boolean;
      extractConcepts?: boolean;
      educationLevel?: string;
      testTiming?: string;
      studyHours?: string;
    };

    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasImages = Array.isArray(images) && images.length > 0;
    if (!hasText && !hasImages) {
      return NextResponse.json(
        { error: "Provide notes, text, or an image to generate from." },
        { status: 400 }
      );
    }

    // Long structured guides route to the guide category: Gemini first
    // (proven structured output here), then Groq, then OpenRouter.
    const models = getModelsFor("guides");
    if (models.length === 0) {
      return NextResponse.json({ error: MISSING_KEY_MESSAGE }, { status: 500 });
    }

    const level =
      typeof educationLevel === "string" &&
      (EDUCATION_LEVELS as readonly string[]).includes(educationLevel)
        ? educationLevel
        : undefined;
    const timing =
      typeof testTiming === "string" &&
      (TEST_TIMINGS as readonly string[]).includes(testTiming)
        ? testTiming
        : undefined;
    // "How long will you study?" — scales how deep the guide is. An
    // unknown value (or "No set time") means standard depth, exactly as
    // before; the validated value is echoed back so the app can show
    // "Built for a 2-hour session" on the saved guide.
    const hours = isValidStudyHours(studyHours) ? studyHours : undefined;

    const quizInstruction = includeQuiz
      ? "Also create multiple-choice practice questions (three or four options each) covering the material — at most 6, one per major concept — each with the correct answer and a detailed explanation."
      : "Do not include a quiz.";
    const conceptsInstruction = extractConcepts
      ? "Extract the key concepts as a short list of concise terms or phrases."
      : "Return an empty keyConcepts list.";
    const tailoring = [
      levelGuidance(level),
      timingGuidance(timing),
      studyTimeGuidance(hours),
    ]
      .filter(Boolean)
      .join(" ");

    const systemPrompt = `You are StudySMART, an expert study assistant. First classify the material the user supplies below — derive the topic type only from that material (for example quantitative, language, science, measurement, history, or mixed). Never use a hardcoded topic list, and never classify from any other guide. Then choose the format that fits that classified topic, per module: quantitative material uses rule/formula cards with up to three targeted problems per rule; language and vocabulary material uses spotlight cards with translations and categories plus topic-mastery practice; measurement and science material uses a numbered core-ideas list, one show-your-reasoning worked example, and a section checkpoint quiz with an explanation of why each answer works; other topics use a mixed layout of concept cards, core ideas, and targeted practice. Only include the sections that fit the chosen format for each module — do not force a checkpoint, a reasoning example, or core ideas into a module whose format does not use them. When the material is language material, return the language code for that language and include a phonetic pronunciation spelling for each language concept, generated from the supplied material. Generate study material strictly from the material the user supplies below. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Derive EVERY module, concept, example, practice problem, and quiz question strictly from the supplied material. Never reuse a topic from any other guide, never return a premade guide, and never include content that is not in the supplied material. ${quizInstruction} ${conceptsInstruction} ${tailoring} This guide must be a COMPLETE, self-contained resource on the topic — thorough enough to stand on its own as a mini study site, not a summary. Organise the material into as many modules as the material supports, up to 6 modules, with up to 6 concepts per module, and include at most one checkpoint in the whole guide. Cover the input topic in depth: never drop a topic from the supplied material, and let depth scale with the input — short notes get a focused but complete guide, long notes get full coverage of everything in them. Never pad with unrelated material and never invent content beyond the input. Start the guide with a short summary of two or three sentences, and include a key-terms glossary with short definitions (up to 20 terms). Each module has a title, a one-line intro, a format field naming its chosen layout, concepts in learning order, and targeted practice: one practice group per concept, with two problems per concept. Each concept has a kind (rule, definition, term, formula, verb, or vocabulary item), a short generated label, a title, a formula or definition, a full plain-language explanation of how it works and why it matters (two to four sentences), one worked example, the most common mistake students make with it and how to avoid it, and a short memory tip; vocabulary concepts also carry a translation and a category. Each practice problem has a type (multiple-choice, short-answer, simplify, or reasoning), a question, a correct answer, a step-by-step explanation, and three or four multiple-choice options when the problem suits multiple choice (omit options for short-answer problems). The guide title is the topic of the supplied material followed by "Study Guide". Do NOT include learning objectives, a cheat sheet, real-world applications, a FAQ, or a final review quiz in this pass — those are added later. Keep every field tight so the whole guide fits: short sentences, no repetition, no filler — every sentence earns its place. WORKED EXAMPLES ARE REQUIRED, NOT OPTIONAL: every concept must include a workedExample — a problem that is SOLVED WITH A REAL NUMERIC CALCULATION. The problem must state real numbers from the topic (counts, rates, percentages, doses, concentrations, sizes, or dates), at least one step must show the arithmetic written out (for example '2,000 × 60 = 120,000' or '10% of 500 = 50'), and the answer must be the computed result with its unit. A time range ('1–2 weeks'), a vague count ('millions of'), or the word 'Calculate' with no numbers in the steps does NOT count — never write 'Calculate ...' unless the steps actually calculate it with real numbers. For topics that look non-numeric, find the quantitative angle in the topic itself (how many, how fast, how much, what percentage, how long between two dates) and work it with real numbers — every real topic has one. A pure vocabulary definition with genuinely no worked case may omit workedExample, and nothing else may. Never write a one-line "Example:" and stop — show the steps. For every multiple-choice problem, write plausible distractors drawn from the common mistakes students make on this topic, and the explanation must say why the correct answer is right AND why EACH wrong option is wrong — fill in one whyWrong entry per wrong option, naming the mistake behind it. Never explain only the correct answer. Never write generic filler sentences such as 'X is important' or 'X is a key concept' — every sentence must teach something specific from the material. Do not repeat the same point in the summary, in the studyGuide Markdown, and in a concept explanation: say each fact ONCE, in the place where it belongs — the summary states it briefly, the studyGuide Markdown gives the readable overview, and the modules carry the detail, with no fact stated twice across those three. If the supplied material is only a topic name, write the guide from your own knowledge of that topic — never write that notes, content, or information is missing, and never return a blank or placeholder item.`;

    const textPart = hasText
      ? `User-supplied material:\n\n${text}`
      : "User-supplied material: see the attached image(s) only.";

    const content: Array<
      | { type: "text"; text: string }
      | { type: "image"; image: string }
    > = [{ type: "text", text: textPart }];
    if (hasImages) {
      for (const img of images as string[]) {
        content.push({ type: "image", image: img });
      }
    }

    // Generation runs in ONE pass here — the CORE guide only (deep
    // modules, concepts, practice, and quiz). The finishing sections
    // (objectives, cheat sheet, real-world applications, FAQ, final
    // review) used to run as a second pass inside this same request,
    // concurrently with the core pass. That still overran Vercel's
    // 60s function timeout: the wall clock was only checked *between*
    // attempts, so an enrichment attempt started at ~44s ran its full
    // 15s cap to ~59s while the core pass could run 35s + 20s, and
    // the request was still working when Vercel killed it (HTTP 504
    // on a full generation, while a lighter one finished in ~14s).
    // The finishing sections now live in /api/enrich, which the
    // client calls AFTER the core guide lands — a slow finishing
    // pass can no longer fail a generation the core pass already
    // served, and a failed enrichment simply leaves those sections
    // absent (the guide is complete without them).
    //
    // Walk the model fallback chain. Each model is tried at most once
    // per shape — retrying the same overloaded model just burns its
    // free quota. The whole core pass stays inside a 40s wall clock
    // (see lib/generationBudget.ts): every attempt's abort is cut
    // down to the wall clock REMAINING when the attempt starts, so
    // an attempt can never run past the budget — the old code's
    // 35s + 20s per-model caps could. A real guide in the simpler
    // shape beats a 500.
    const startedAt = Date.now();
    const simplePrompt = `${systemPrompt} IMPORTANT — simplified shape for this attempt: return at most 2 modules with at most 3 concepts each, concept cards with targeted practice only. Do NOT include a checkpoint, a reasoning example, or core ideas in this attempt. Keep everything short.`;

    const corePromise = (async (): Promise<{
      core: z.infer<typeof GenerateResultSchema> | null;
      modelUsed: LanguageModel | null;
      lastErr: unknown;
    }> => {
      let lastErr: unknown = null;
      // One pass per model in the chain: the for loop itself bounds the
      // walk to one attempt per model. An earlier version counted
      // attempts (full + simplified calls) against models.length, so a
      // few non-retryable failures burned the whole budget and the tail
      // of the chain — including the no-key safety net — was never
      // tried (2026-11-25: generation failed while untried providers
      // remained). The only early exit now is the wall clock.
      for (const model of models) {
        if (remainingMs(startedAt, GENERATE_WALL_CLOCK_MS) < 5000) break;
        try {
          const { object } = await generateObject({
            model,
            schema: GenerateResultSchema,
            system: systemPrompt,
            messages: [{ role: "user", content }],
            maxTokens: 8192,
            maxRetries: 0,
            abortSignal: AbortSignal.timeout(
              attemptTimeoutMs(
                startedAt,
                GENERATE_WALL_CLOCK_MS,
                GENERATE_FULL_ATTEMPT_MS
              )
            ),
          });
          return { core: object, modelUsed: model, lastErr };
        } catch (fullErr) {
          lastErr = fullErr;
          logError("[/api/generate] full-shape attempt failed:", fullErr);
          if (isRetryableProviderError(fullErr)) continue;
          if (remainingMs(startedAt, GENERATE_WALL_CLOCK_MS) < 5000) break;
          try {
            const { object } = await generateObject({
              model,
              schema: SimpleGenerateResultSchema,
              system: simplePrompt,
              messages: [{ role: "user", content }],
              maxTokens: 3072,
              maxRetries: 0,
              abortSignal: AbortSignal.timeout(
                attemptTimeoutMs(
                  startedAt,
                  GENERATE_WALL_CLOCK_MS,
                  GENERATE_SIMPLE_ATTEMPT_MS
                )
              ),
            });
            return {
              core: {
                ...object,
                modules: (object.modules ?? []).map((m) => ({
                  ...m,
                  format: m.format ?? "mixed",
                })),
              } as z.infer<typeof GenerateResultSchema>,
              modelUsed: model,
              lastErr,
            };
          } catch (simpleErr) {
            lastErr = simpleErr;
            logError(
              "[/api/generate] simplified-shape attempt failed:",
              simpleErr
            );
            continue;
          }
        }
      }
      return { core: null, modelUsed: null, lastErr };
    })();

    const { core: coreResult, modelUsed, lastErr } = await corePromise;
    // Sanitize FIRST: strip any refusal / blank / broken content the
    // model produced, so the checks below judge the guide the student
    // would actually see — not the raw model output.
    let core = coreResult ? sanitizeGuide(coreResult) : null;

    if (!core) {
      // Every model in the chain failed. The student gets one plain
      // message — never a single provider's raw error (2026-11-25: an
      // AI Gateway billing demand reached the student this way). The
      // real error is already in the server logs via logError.
      if (isOverloadedError(lastErr)) {
        return NextResponse.json(
          { error: OVERLOADED_MESSAGE },
          { status: 503 }
        );
      }
      return NextResponse.json(
        { error: "Failed to generate study material. Please try again." },
        { status: 500 }
      );
    }

    // Cheap self-check: a guide that came back missing required parts
    // or failing a quality rule is repaired once instead of shipped
    // thin. This only triggers on a genuinely broken or low-quality
    // result (see missingParts / qualityIssues) — a small guide for a
    // small input is left alone. The repair regenerates the whole guide
    // with a prompt naming exactly what was missing or wrong, on the
    // model that already answered; the repaired guide is kept only
    // when it has strictly fewer problems than the original (or none
    // at all) — the repair never fails the request and never ships a
    // worse guide. The repair only starts when the core landed early
    // enough (see GENERATE_REPAIR_AFTER_MS) and its abort is cut to
    // the wall clock remaining, so the request still finishes in time.
    const checkOpts = {
      extractConcepts: !!extractConcepts,
      includeQuiz: !!includeQuiz,
    };
    const missing = missingParts(core, checkOpts);
    const quality = qualityIssues(core, checkOpts);
    const problemCount = missing.length + quality.length;
    if (
      problemCount > 0 &&
      modelUsed &&
      Date.now() - startedAt < GENERATE_REPAIR_AFTER_MS
    ) {
      // The repair minimum follows the study time, so a short-session
      // guide is not "repaired" into a long one.
      const minModules = repairMinModules(hours);
      const problems = [...missing, ...quality].join("; ");
      const repairPrompt = `${systemPrompt} IMPORTANT — REPAIR: a previous attempt at this guide came back with these problems: ${problems}. Regenerate the COMPLETE guide from the supplied material, making sure it includes at least ${minModules} module${minModules === 1 ? "" : "s"} with at least 2 concepts each, targeted practice for every concept,${extractConcepts ? " a non-empty keyConcepts list," : ""}${includeQuiz ? " the quiz," : ""} and the full studyGuide Markdown. Every concept needs a workedExample with a REAL NUMERIC CALCULATION: the problem states real numbers from the topic, at least one step shows the arithmetic written out (for example 2,000 × 60 = 120,000), and the answer is the computed result with its unit. A time range, a vague count, or the word 'Calculate' with no numbers does NOT count. Every multiple-choice question needs one whyWrong entry for EACH wrong option. Keep the same depth and quality standard as a normal generation.`;
      try {
        const { object } = await generateObject({
          model: modelUsed,
          schema: GenerateResultSchema,
          system: repairPrompt,
          messages: [{ role: "user", content }],
          maxTokens: 8192,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(
            attemptTimeoutMs(
              startedAt,
              GENERATE_WALL_CLOCK_MS,
              GENERATE_REPAIR_ATTEMPT_MS
            )
          ),
        });
        const repaired = sanitizeGuide(object);
        const repairedProblems =
          missingParts(repaired, checkOpts).length +
          qualityIssues(repaired, checkOpts).length;
        if (repairedProblems < problemCount) {
          core = repaired;
        } else {
          logError(
            "[/api/generate] repair not better, keeping original:",
            { before: problemCount, after: repairedProblems, problems }
          );
        }
      } catch (repairErr) {
        logError(
          "[/api/generate] repair attempt failed, keeping original:",
          repairErr
        );
      }
    }

    // "Given resources" — the materials the teacher gave for the unit:
    // the files uploaded with this generation. Read from the request
    // the form already sends (an explicit `files` array when present,
    // otherwise the `--- From file: <name> ---` markers in the text
    // plus the uploaded images). Names/kinds only — file contents are
    // never stored. Empty when nothing was uploaded, so the section
    // simply does not render. The saved guide carries this field, so
    // it survives reloads and shows on the standalone guide page.
    const givenResources = parseGivenResources({ text, images, files });

    // Sanitize the assembled guide once more: the enrichment pass
    // (objectives, cheat sheet, applications, FAQ, final review) now
    // runs in /api/enrich AFTER this response lands, so the finishing
    // sections are empty here — the client merges them in when they
    // arrive. The core guide is complete without them, and the UI
    // already omits empty sections (the same state as when the old
    // in-route enrichment pass failed).
    const response = sanitizeGuide({
      topicType: core.topicType,
      languageCode: core.languageCode,
      guideTitle: core.guideTitle,
      studyGuide: core.studyGuide,
      summary: core.summary,
      studyHours: hours,
      givenResources: givenResources.length > 0 ? givenResources : undefined,
      keyTerms: core.keyTerms ?? [],
      keyConcepts: core.keyConcepts ?? [],
      modules: core.modules ?? [],
      quiz: includeQuiz ? core.quiz ?? [] : undefined,
      objectives: [],
      cheatSheet: undefined,
      realWorldApplications: [],
      faq: [],
      finalReview: undefined,
    });
    return NextResponse.json(response);
  } catch (err) {
    logError("[/api/generate] error:", err);
    return NextResponse.json(
      { error: "Failed to generate study material. Please try again." },
      { status: 500 }
    );
  }
}
