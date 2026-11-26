import { z } from "zod";

/**
 * Shared zod schemas for the study-guide JSON shape (GenerateResult).
 *
 * These lived inline in app/api/generate/route.ts; they moved here so
 * the Builder Bot edit route can validate the SAME shape without
 * duplicating (and drifting from) it. The generate route imports the
 * strict versions from this module.
 *
 * The Builder Bot needs a LOOSENED guide schema: an edit can legitimately
 * push a guide past the generation bounds (one more module, a fourth
 * practice problem on a concept, a couple more quiz questions), and a
 * slightly-over-bounds edit must still validate instead of failing the
 * whole edit with a 500. The loosened schema keeps the exact same
 * fields — only the array bounds are wider.
 */

/**
 * Why one wrong option is wrong — one entry per wrong option of a
 * multiple-choice question. The option text must match the option
 * exactly, so the UI can show the reason next to that option. This is
 * what makes an explanation teach instead of just confirming the
 * right answer: every distractor comes from a real common mistake,
 * and the student sees why that mistake fails.
 */
export const WhyWrongSchema = z.object({
  option: z
    .string()
    .describe("The exact text of one WRONG option, matching one of the question's options."),
  reason: z
    .string()
    .describe("One sentence saying why this option is wrong — the common mistake behind it, and what goes wrong if you pick it."),
});

export type WhyWrongEntry = z.infer<typeof WhyWrongSchema>;

export const QuizQuestionSchema = z.object({
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
  whyWrong: z
    .array(WhyWrongSchema)
    .optional()
    .describe(
      "REQUIRED for every multiple-choice question: one entry for EACH wrong option, saying why that option is wrong. Never explain only the correct answer — a student who picked a distractor needs to see why their pick fails."
    ),
});

/** A step-by-step worked example that is SOLVED WITH A REAL NUMERIC
 *  CALCULATION: the problem states real numbers from the topic, at
 *  least one step shows the arithmetic written out, and the answer is
 *  the computed result. A step-by-step story with no numbers is not a
 *  worked example — it does not teach the student to work anything
 *  out. (Live proof, 2026-11-25: a guide whose every concept had
 *  Step 1–3 + Answer but no numbers at all, including one that said
 *  "Calculate the effect..." and then calculated nothing.) */
export const WorkedExampleSchema = z.object({
  problem: z
    .string()
    .describe("The worked-example problem — it must state real numbers from the topic (counts, rates, percentages, doses, concentrations, sizes, or dates) and pose a problem that is solved by calculating with them."),
  steps: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe("The working, step by step, in order — each step shows one calculation, decision, or piece of reasoning. At least 2 steps, and at least one step MUST show the arithmetic written out (for example '2,000 × 60 = 120,000' or '10% of 500 = 50'). A time range ('1–2 weeks'), a vague count ('millions of'), or the word 'Calculate' with no numbers in the steps does NOT count."),
  answer: z
    .string()
    .describe("The final answer — the computed result of the worked example, with its unit."),
});

export type WorkedExample = z.infer<typeof WorkedExampleSchema>;

export const ConceptSchema = z.object({
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
  workedExample: WorkedExampleSchema.optional().describe(
    "A step-by-step worked example for this concept, SOLVED WITH A REAL NUMERIC CALCULATION: the problem states real numbers from the topic, at least one step shows the arithmetic written out (for example '2,000 × 60 = 120,000'), and the answer is the computed result with its unit. REQUIRED for every concept — for topics that look non-numeric, find the quantitative angle in the topic itself (how many, how fast, how much, what percentage, how long between two dates). For a pure vocabulary definition with genuinely no worked case, omit it."
  ),
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
  tip: z
    .string()
    .optional()
    .describe(
      "A common mistake to avoid, or a helpful tip, for this concept — only when one genuinely applies to the supplied material."
    ),
  explanation: z
    .string()
    .optional()
    .describe(
      "A full explanation of this concept in plain language — how it works and why it matters, in two to four sentences, taken from the supplied material."
    ),
  commonMistake: z
    .string()
    .optional()
    .describe(
      "The most common mistake students make with this concept and how to avoid it, taken from the supplied material. Include one whenever a real mistake applies."
    ),
  memoryTip: z
    .string()
    .optional()
    .describe(
      "A short memory aid for this concept — a mnemonic, an image, or a way to remember it — derived from the supplied material."
    ),
});

export const PracticeProblemSchema = z.object({
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
    .describe(
      "A step-by-step explanation of how to reach the correct answer."
    ),
  whyWrong: z
    .array(WhyWrongSchema)
    .optional()
    .describe(
      "For multiple-choice problems: one entry for EACH wrong option, saying why that option is wrong. Omit for short-answer problems (no options). Never explain only the correct answer."
    ),
});

export const PracticeGroupSchema = z.object({
  conceptTitle: z
    .string()
    .describe("The title of the concept this practice group belongs to, matching a concept title."),
  problems: z
    .array(PracticeProblemSchema)
    .min(1)
    .max(3)
    .describe("One to three practice problems for this concept — aim for three."),
});

export const ReasoningExampleSchema = z.object({
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

export const CheckpointSchema = z.object({
  questions: z
    .array(QuizQuestionSchema)
    .min(5)
    .max(10)
    .describe(
      "A mastery quiz for this module — aim for 10 questions. Each question has answer options, the correct answer, an explanation of why the correct answer works, and one whyWrong entry for EACH wrong option."
    ),
});

export const ModuleSchema = z.object({
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
    .max(6)
    .describe("The concepts in this module, in learning order, taken from the supplied material. At most 6."),
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

export const FaqItemSchema = z.object({
  question: z.string().describe("A question a student would actually ask about this topic, derived from the supplied material."),
  answer: z.string().describe("A clear, direct answer to the question, derived from the supplied material."),
});

/**
 * One material the teacher gave for the unit — a file the student
 * uploaded when this guide was generated. Names and kinds only: file
 * contents are NEVER stored in the guide JSON (they would bloat saves
 * and leak private uploads); the extracted text the guide was built
 * from is already in the guide itself. Empty/absent when nothing was
 * uploaded — the section never renders then, and nothing is invented.
 */
export const GivenResourceSchema = z.object({
  name: z
    .string()
    .max(200)
    .optional()
    .describe("The file name exactly as the student uploaded it. Omitted for uploaded images, which carry no file name in the generate request."),
  kind: z
    .enum(["pdf", "text", "image"])
    .describe("What kind of material this is: a PDF, a text file (.txt/.md/.csv), or an uploaded image."),
  size: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("File size in bytes, when the uploader sent it."),
  chars: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Characters of extracted text from this file that were included when the guide was generated, when known."),
});

export type GivenResource = z.infer<typeof GivenResourceSchema>;

export const GenerateResultSchema = z.object({
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
  summary: z
    .string()
    .describe(
      "A short summary of the whole guide in two or three sentences, based strictly on the supplied material."
    ),
  keyTerms: z
    .array(
      z.object({
        term: z.string().describe("A key term from the supplied material."),
        definition: z
          .string()
          .describe("A short definition of the term, from the supplied material."),
      })
    )
    .max(20)
    .describe(
      "The key terms of the topic with short definitions, taken from the supplied material — the guide's glossary. At most 20."
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
    .max(6)
    .describe(
      "The study material organised into up to 6 modules, each with concept cards and targeted practice. Use as many modules as the material supports — a complete guide, not a summary."
    ),
  quiz: z
    .array(QuizQuestionSchema)
    .max(6)
    .optional()
    .describe("Multiple-choice practice questions, only when a quiz was requested. At most 6."),
  objectives: z
    .array(z.string())
    .max(6)
    .optional()
    .describe("Learning objectives for the whole guide — filled in by the enrichment pass."),
  cheatSheet: z
    .string()
    .optional()
    .describe("A one-page cheat sheet in Markdown — filled in by the enrichment pass."),
  realWorldApplications: z
    .array(z.string())
    .max(5)
    .optional()
    .describe("Real-world applications of the topic — filled in by the enrichment pass."),
  faq: z
    .array(FaqItemSchema)
    .max(6)
    .optional()
    .describe("Frequently asked questions with answers — filled in by the enrichment pass."),
  finalReview: CheckpointSchema.optional().describe(
    "A final review quiz covering the whole guide — filled in by the enrichment pass."
  ),
  givenResources: z
    .array(GivenResourceSchema)
    .max(20)
    .optional()
    .describe("The materials the teacher gave for this unit — the files the student uploaded when generating this guide (file names and kinds only; file contents are never stored). Empty or omitted when nothing was uploaded."),
});

export type GuideJson = z.infer<typeof GenerateResultSchema>;

/**
 * Guide-level finishing sections, generated in a second, lighter pass
 * AFTER the core guide lands — via /api/enrich, which the client calls
 * once /api/generate has returned. They used to run inside /api/generate
 * and pushed full generations past Vercel's 60s timeout (HTTP 504), so
 * they moved out: a slow finishing pass can no longer fail a
 * generation the core pass already served. Everything here is derived
 * strictly from the guide content, never invented. Best effort: if
 * this pass fails, the core guide is still returned complete.
 */
export const EnrichmentSchema = z.object({
  objectives: z
    .array(z.string())
    .min(1)
    .max(6)
    .describe("What the student will be able to do after studying this guide — 3 to 6 clear learning objectives."),
  cheatSheet: z
    .string()
    .describe(
      "A one-page cheat sheet in Markdown: the essential definitions, formulas, and steps from the whole guide, nothing else — the page a student glances at right before the test."
    ),
  realWorldApplications: z
    .array(z.string())
    .min(1)
    .max(5)
    .describe("Where this topic actually shows up in real life — 3 to 5 concrete applications, derived from the supplied material."),
  faq: z
    .array(FaqItemSchema)
    .min(1)
    .max(6)
    .describe("Frequently asked questions a student would actually ask about this topic, with clear answers — 4 to 6."),
  finalReview: CheckpointSchema.describe(
    "A final review quiz covering the whole guide — aim for 10 questions, each with options, the correct answer, and an explanation."
  ),
});

// ---------------------------------------------------------------------------
// Builder Bot — loosened guide schema for edits.
// Same fields as GenerateResultSchema; only the array bounds are wider,
// so a legitimate edit (one more module, a fourth practice problem, a
// couple more quiz questions) still validates instead of failing.
// ---------------------------------------------------------------------------

/** A practice group that may hold a fourth problem (the user asked for
 *  "3 more questions" on a concept that already has 3). */
export const BuilderBotPracticeGroupSchema = PracticeGroupSchema.extend({
  problems: z
    .array(PracticeProblemSchema)
    .min(1)
    .max(4)
    .describe("One to four practice problems for this concept."),
});

/** A checkpoint that may be shorter than the generated 5–10 (an edit
 *  can legitimately trim it). */
export const BuilderBotCheckpointSchema = CheckpointSchema.extend({
  questions: z
    .array(QuizQuestionSchema)
    .min(1)
    .max(10)
    .describe("A mastery quiz for this module — each question has options, the correct answer, and an explanation."),
});

export const BuilderBotModuleSchema = ModuleSchema.extend({
  concepts: z
    .array(ConceptSchema)
    .min(1)
    .max(8)
    .describe("The concepts in this module, in learning order. At most 8."),
  checkpoint: BuilderBotCheckpointSchema.optional(),
  practice: z
    .array(BuilderBotPracticeGroupSchema)
    .describe("Targeted practice: one group per concept in this module."),
});

export const BuilderBotGuideSchema = GenerateResultSchema.extend({
  modules: z
    .array(BuilderBotModuleSchema)
    .min(1)
    .max(8)
    .describe("The study material organised into modules, each with concept cards and targeted practice."),
  quiz: z
    .array(QuizQuestionSchema)
    .max(8)
    .optional()
    .describe("Multiple-choice practice questions. At most 8."),
  keyTerms: z
    .array(
      z.object({
        term: z.string(),
        definition: z.string(),
      })
    )
    .max(24)
    .optional()
    .describe("The key terms of the topic with short definitions — the guide's glossary."),
  objectives: z
    .array(z.string())
    .max(8)
    .optional()
    .describe("Learning objectives for the whole guide."),
  realWorldApplications: z
    .array(z.string())
    .max(8)
    .optional()
    .describe("Real-world applications of the topic."),
  faq: z
    .array(FaqItemSchema)
    .max(8)
    .optional()
    .describe("Frequently asked questions with answers."),
  finalReview: BuilderBotCheckpointSchema.optional().describe(
    "A final review quiz covering the whole guide."
  ),
});

/** What the Builder Bot returns for one edit request: a one-line
 *  summary, a short list of what changed, and the complete updated
 *  guide. The client shows the summary + changes, and the server also
 *  computes an independent diff (lib/builderBot.ts) so the displayed
 *  change list comes from the actual before/after, not the model's
 *  self-report. */
export const BuilderBotEditResultSchema = z.object({
  summary: z
    .string()
    .describe("One or two sentences saying what was changed in this edit, in plain language."),
  changes: z
    .array(z.string())
    .max(12)
    .describe("A short bullet list of the concrete changes made, one per item."),
  updatedGuide: BuilderBotGuideSchema.describe(
    "The COMPLETE updated study guide — every field, including everything that did not change. Never return a partial guide or a patch."
  ),
});

export type BuilderBotEditResult = z.infer<typeof BuilderBotEditResultSchema>;
