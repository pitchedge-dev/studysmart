import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel, MISSING_KEY_MESSAGE, safeErrorDetail } from "@/lib/gemini";

// ---------------------------------------------------------------------------
// Schemas — deliberately loosened where the model used to trip validation.
// Practice is 1–3 problems per concept (aim for 3), checkpoints are 5–10
// questions (aim for 10), so a slightly short list still validates instead
// of failing the whole generation with a 500.
// ---------------------------------------------------------------------------

const QuizQuestionSchema = z.object({
  question: z.string().describe("The quiz question text."),
  options: z
    .array(z.string())
    .min(3)
    .max(4)
    .describe("Three or four answer options."),
  correctAnswer: z
    .string()
    .describe("The exact text of the correct option, matching one of the options."),
  explanation: z
    .string()
    .describe("A detailed explanation of why the correct answer is right."),
});

const ConceptSchema = z.object({
  kind: z
    .string()
    .describe(
      "The shape of this concept, derived from the supplied material: for example rule, definition, term, formula, verb, or vocabulary item."
    ),
  label: z
    .string()
    .describe(
      "A short generated label for this concept, in the style of the supplied material (for example a numbered rule, term, or item label). Derive the label wording from the supplied material only."
    ),
  title: z.string().describe("The concept title, taken from the supplied material."),
  formulaOrDefinition: z
    .string()
    .describe(
      "The core formula, definition, translation, or rule for this concept, taken from the supplied material."
    ),
  example: z
    .string()
    .describe("One worked example for this concept, taken from the supplied material."),
  translation: z
    .string()
    .optional()
    .describe("For vocabulary concepts, the translation or meaning, taken from the supplied material."),
  category: z
    .string()
    .optional()
    .describe("For vocabulary concepts, the category or group, taken from the supplied material."),
  pronunciation: z
    .string()
    .optional()
    .describe(
      "For language concepts, a phonetic spelling of the concept title, generated from the supplied material so it can be spoken aloud. Omit for non-language concepts."
    ),
});

const PracticeProblemSchema = z.object({
  type: z
    .string()
    .optional()
    .describe(
      "The problem type, derived from the supplied material: for example multiple-choice, short-answer, simplify, or reasoning."
    ),
  question: z.string().describe("The practice problem, taken from the supplied material."),
  correctAnswer: z
    .string()
    .describe("The correct answer to the practice problem."),
  options: z
    .array(z.string())
    .min(3)
    .max(4)
    .optional()
    .describe(
      "Three or four multiple-choice options when the problem suits multiple choice, with the correct answer matching one of them. Omit for short-answer problems."
    ),
  explanation: z
    .string()
    .describe("A step-by-step explanation of how to reach the correct answer."),
});

const PracticeGroupSchema = z.object({
  conceptTitle: z
    .string()
    .describe("The title of the concept this practice group belongs to, matching a concept title."),
  problems: z
    .array(PracticeProblemSchema)
    .min(1)
    .max(3)
    .describe("One to three practice problems for this concept — aim for three."),
});

const ReasoningExampleSchema = z.object({
  question: z
    .string()
    .describe("One worked-example question for this module, taken from the supplied material."),
  solution: z
    .string()
    .describe("The worked solution to the reasoning question, taken from the supplied material."),
  explanation: z
    .string()
    .describe("Why the solution works, step by step, taken from the supplied material."),
});

const CheckpointSchema = z.object({
  questions: z
    .array(QuizQuestionSchema)
    .min(5)
    .max(10)
    .describe(
      "A mastery quiz for this module — aim for 10 questions. Each question has answer options, the correct answer, and an explanation of why the correct answer works."
    ),
});

const ModuleSchema = z.object({
  moduleNumber: z.number().describe("The module number, starting at 1."),
  title: z.string().describe("The module title, taken from the supplied material."),
  intro: z
    .string()
    .describe("One short introductory line for this module, taken from the supplied material."),
  format: z
    .string()
    .describe(
      "The format/layout chosen for this module, based on the classified topic type: one of 'rules', 'vocabulary', 'core-ideas', or 'mixed'. Quantitative material uses 'rules'; language and vocabulary material uses 'vocabulary'; measurement and science material uses 'core-ideas'; anything else uses 'mixed'."
    ),
  concepts: z
    .array(ConceptSchema)
    .min(1)
    .max(4)
    .describe("The concepts in this module, in learning order, taken from the supplied material. At most 4."),
  coreIdeas: z
    .array(z.string())
    .min(1)
    .optional()
    .describe(
      "Core ideas for this module, when the chosen format uses them: a numbered list of short explanations, definitions, or formulas, each taken from the supplied material."
    ),
  reasoningExample: ReasoningExampleSchema.optional().describe(
    "One worked example for this module, when the chosen format uses one: a question the student reasons through before checking the solution."
  ),
  checkpoint: CheckpointSchema.optional().describe(
    "The section checkpoint for this module, when the chosen format uses one: a mastery quiz."
  ),
  practice: z
    .array(PracticeGroupSchema)
    .describe(
      "Targeted practice: one group per concept in this module, each with up to three problems for that concept."
    ),
});

const GenerateResultSchema = z.object({
  topicType: z
    .string()
    .describe(
      "How the supplied material was classified, derived only from that material: for example quantitative, language, science, measurement, history, or mixed. Never use a hardcoded topic list; classify what was actually supplied."
    ),
  guideTitle: z
    .string()
    .describe(
      "The study guide title, derived from the supplied material, in the form '<Topic> Study Guide' where <Topic> is the topic of the supplied material."
    ),
  studyGuide: z
    .string()
    .describe(
      "A comprehensive study guide in Markdown with headers, bullet points, and clear explanations, based strictly on the supplied material."
    ),
  keyConcepts: z
    .array(z.string())
    .describe("The key concepts extracted from the supplied material."),
  languageCode: z
    .string()
    .optional()
    .describe(
      "When the supplied material is in a language, the language code for that language, derived only from the supplied material. Omit when the material is not language material."
    ),
  modules: z
    .array(ModuleSchema)
    .min(1)
    .max(2)
    .describe(
      "The study material organised into at most 2 modules, each with concept cards and targeted practice."
    ),
  quiz: z
    .array(QuizQuestionSchema)
    .max(8)
    .optional()
    .describe("Multiple-choice practice questions, only when a quiz was requested. At most 8."),
});

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
  keyConcepts: z.array(z.string()),
  languageCode: z.string().optional(),
  modules: z.array(SimpleModuleSchema).min(1).max(2),
  quiz: z.array(QuizQuestionSchema).max(8).optional(),
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, images, includeQuiz, extractConcepts, educationLevel, testTiming } = body as {
      text?: string;
      images?: string[];
      includeQuiz?: boolean;
      extractConcepts?: boolean;
      educationLevel?: string;
      testTiming?: string;
    };

    const hasText = typeof text === "string" && text.trim().length > 0;
    const hasImages = Array.isArray(images) && images.length > 0;
    if (!hasText && !hasImages) {
      return NextResponse.json(
        { error: "Provide notes, text, or an image to generate from." },
        { status: 400 }
      );
    }

    const model = getModel();
    if (!model) {
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

    const quizInstruction = includeQuiz
      ? "Also create multiple-choice practice questions (three or four options each) covering the material — at most 8, one per major concept — each with the correct answer and a detailed explanation."
      : "Do not include a quiz.";
    const conceptsInstruction = extractConcepts
      ? "Extract the key concepts as a short list of concise terms or phrases."
      : "Return an empty keyConcepts list.";
    const tailoring = [levelGuidance(level), timingGuidance(timing)]
      .filter(Boolean)
      .join(" ");

    const systemPrompt = `You are StudySMART, an expert study assistant. First classify the material the user supplies below — derive the topic type only from that material (for example quantitative, language, science, measurement, history, or mixed). Never use a hardcoded topic list, and never classify from any other guide. Then choose the format that fits that classified topic, per module: quantitative material uses rule/formula cards with up to three targeted problems per rule; language and vocabulary material uses spotlight cards with translations and categories plus topic-mastery practice; measurement and science material uses a numbered core-ideas list, one show-your-reasoning worked example, and a section checkpoint quiz with an explanation of why each answer works; other topics use a mixed layout of concept cards, core ideas, and targeted practice. Only include the sections that fit the chosen format for each module — do not force a checkpoint, a reasoning example, or core ideas into a module whose format does not use them. When the material is language material, return the language code for that language and include a phonetic pronunciation spelling for each language concept, generated from the supplied material. Generate study material strictly from the material the user supplies below. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Derive EVERY module, concept, example, practice problem, and quiz question strictly from the supplied material. Never reuse a topic from any other guide, never return a premade guide, and never include content that is not in the supplied material. ${quizInstruction} ${conceptsInstruction} ${tailoring} Organise the material into at most 2 modules, with at most 4 concepts per module. Each module has a title, a one-line intro, a format field naming its chosen layout, concepts in learning order, and targeted practice: one practice group per concept, with up to three problems per concept. Each concept has a kind (rule, definition, term, formula, verb, or vocabulary item), a short generated label, a title, a formula or definition, and one worked example; vocabulary concepts also carry a translation and a category. Each practice problem has a type (multiple-choice, short-answer, simplify, or reasoning), a question, a correct answer, a step-by-step explanation, and three or four multiple-choice options when the problem suits multiple choice (omit options for short-answer problems). The guide title is the topic of the supplied material followed by "Study Guide". Keep the whole response compact enough to fit: short explanations, short examples, short practice questions.`;

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

    // Attempt 1: the full adaptive shape, with a generous output budget and
    // one built-in retry on transient/validation failures.
    try {
      const { object } = await generateObject({
        model,
        schema: GenerateResultSchema,
        system: systemPrompt,
        messages: [{ role: "user", content }],
        maxTokens: 8192,
        maxRetries: 2,
      });

      return NextResponse.json({
        topicType: object.topicType,
        languageCode: object.languageCode,
        guideTitle: object.guideTitle,
        studyGuide: object.studyGuide,
        keyConcepts: object.keyConcepts ?? [],
        modules: object.modules ?? [],
        quiz: includeQuiz ? object.quiz ?? [] : undefined,
      });
    } catch (fullErr) {
      logError("[/api/generate] full-shape attempt failed, trying simplified shape:", fullErr);

      // Attempt 2: simplified shape (concepts + practice only). A real guide
      // in the simpler shape beats a 500.
      const simplePrompt = `${systemPrompt} IMPORTANT — simplified shape for this attempt: return at most 2 modules with at most 4 concepts each, concept cards with targeted practice only. Do NOT include a checkpoint, a reasoning example, or core ideas in this attempt. Keep everything short.`;
      try {
        const { object } = await generateObject({
          model,
          schema: SimpleGenerateResultSchema,
          system: simplePrompt,
          messages: [{ role: "user", content }],
          maxTokens: 8192,
          maxRetries: 1,
        });

        return NextResponse.json({
          topicType: object.topicType,
          languageCode: object.languageCode,
          guideTitle: object.guideTitle,
          studyGuide: object.studyGuide,
          keyConcepts: object.keyConcepts ?? [],
          modules: (object.modules ?? []).map((m) => ({
            ...m,
            format: m.format ?? "mixed",
          })),
          quiz: includeQuiz ? object.quiz ?? [] : undefined,
        });
      } catch (simpleErr) {
        logError("[/api/generate] simplified-shape attempt also failed:", simpleErr);
        throw simpleErr;
      }
    }
  } catch (err) {
    logError("[/api/generate] error:", err);
    return NextResponse.json(
      {
        error: "Failed to generate study material. Please try again.",
        detail: safeErrorDetail(err),
      },
      { status: 500 }
    );
  }
}
