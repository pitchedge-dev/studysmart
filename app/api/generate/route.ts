import { NextRequest, NextResponse } from "next/server";
import { generateObject } from "ai";
import { z } from "zod";
import { getModel, MISSING_KEY_MESSAGE } from "@/lib/gemini";

const QuizQuestionSchema = z.object({
  question: z.string().describe("The quiz question text."),
  options: z
    .array(z.string())
    .length(4)
    .describe("Exactly four answer options."),
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
    .length(4)
    .optional()
    .describe(
      "Exactly four multiple-choice options when the problem suits multiple choice, with the correct answer matching one of them. Omit for short-answer problems."
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
    .length(3)
    .describe("Exactly three practice problems for this concept."),
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
    .length(10)
    .describe(
      "A 10-question mastery quiz for this module. Each question has exactly four options, the correct answer, and an explanation of why the correct answer works."
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
    .describe("The concepts in this module, in learning order, taken from the supplied material."),
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
    "The section checkpoint for this module, when the chosen format uses one: a 10-question mastery quiz."
  ),
  practice: z
    .array(PracticeGroupSchema)
    .describe(
      "Targeted practice: one group per concept in this module, each with exactly three problems for that concept."
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
    .describe(
      "The study material organised into modules, each with concept cards and targeted practice."
    ),
  quiz: z
    .array(QuizQuestionSchema)
    .optional()
    .describe("Multiple-choice practice questions, only when a quiz was requested."),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { text, images, includeQuiz, extractConcepts } = body as {
      text?: string;
      images?: string[];
      includeQuiz?: boolean;
      extractConcepts?: boolean;
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

    const quizInstruction = includeQuiz
      ? "Also create multiple-choice practice questions (exactly 4 options each) covering the material — as many as the material supports, one per major concept — each with the correct answer and a detailed explanation."
      : "Do not include a quiz.";
    const conceptsInstruction = extractConcepts
      ? "Extract the key concepts as a short list of concise terms or phrases."
      : "Return an empty keyConcepts list.";

    const systemPrompt = `You are StudySMART, an expert study assistant. First classify the material the user supplies below — derive the topic type only from that material (for example quantitative, language, science, measurement, history, or mixed). Never use a hardcoded topic list, and never classify from any other guide. Then choose the format that fits that classified topic, per module: quantitative material uses rule/formula cards with three targeted problems per rule; language and vocabulary material uses spotlight cards with translations and categories plus topic-mastery practice; measurement and science material uses a numbered core-ideas list, one show-your-reasoning worked example, and a 10-question section checkpoint quiz with an explanation of why each answer works; other topics use a mixed layout of concept cards, core ideas, and targeted practice. Only include the sections that fit the chosen format for each module — do not force a checkpoint, a reasoning example, or core ideas into a module whose format does not use them. When the material is language material, return the language code for that language and include a phonetic pronunciation spelling for each language concept, generated from the supplied material. Generate study material strictly from the material the user supplies below. Do not invent facts beyond what the supplied material supports, and do not add topics of your own. Derive EVERY module, concept, example, practice problem, and quiz question strictly from the supplied material. Never reuse a topic from any other guide, never return a premade guide, and never include content that is not in the supplied material. ${quizInstruction} ${conceptsInstruction} Organise the material into as many modules as the material supports, with no fixed limit. Each module has a title, a one-line intro, a format field naming its chosen layout, concepts in learning order, and targeted practice: one practice group per concept, with exactly three problems per concept. Each concept has a kind (rule, definition, term, formula, verb, or vocabulary item), a short generated label, a title, a formula or definition, and one worked example; vocabulary concepts also carry a translation and a category. Each practice problem has a type (multiple-choice, short-answer, simplify, or reasoning), a question, a correct answer, a step-by-step explanation, and exactly four multiple-choice options when the problem suits multiple choice (omit options for short-answer problems). The guide title is the topic of the supplied material followed by "Study Guide".`;

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

    const { object } = await generateObject({
      model,
      schema: GenerateResultSchema,
      system: systemPrompt,
      messages: [{ role: "user", content }],
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
  } catch (err) {
    console.error("[/api/generate] error:", err);
    return NextResponse.json(
      { error: "Failed to generate study material. Please try again." },
      { status: 500 }
    );
  }
}
