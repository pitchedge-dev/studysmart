import type { GenerateResult } from "@/app/page";

/**
 * Builder Bot — pure guide-diff logic (no AI, no Supabase, no React).
 *
 * `diffGuideEdit` compares the guide BEFORE an edit with the guide AFTER
 * it and returns a human-readable list of what changed, plus whether
 * the edit was destructive (it removed something the student had).
 *
 * The server computes this from the actual before/after JSON, so the
 * change list the user sees comes from the real diff — never from the
 * model's self-report. The client shows the list and, when
 * `destructive` is true, asks for confirmation before saving.
 *
 * Kept pure and dependency-free so it can be unit-tested without a
 * browser, a key, or a database.
 */

export type GuideEditDiff = {
  /** Human-readable change list, e.g. "Added Module 4: …". */
  changes: string[];
  /** True when the edit removed a module, a concept, quiz questions,
   *  or shrank the main text / cheat sheet by more than half. */
  destructive: boolean;
  /** One line saying what would be lost, when destructive. */
  destructiveDetail?: string;
};

type ConceptLike = { title: string };
type ModuleLike = {
  moduleNumber: number;
  title: string;
  concepts?: ConceptLike[];
  practice?: { conceptTitle: string; problems?: unknown[] }[];
  checkpoint?: { questions?: unknown[] };
};

function moduleList(g: GenerateResult): ModuleLike[] {
  return Array.isArray(g.modules) ? (g.modules as ModuleLike[]) : [];
}

function conceptTitles(m: ModuleLike): string[] {
  return Array.isArray(m.concepts)
    ? m.concepts.map((c) => c.title).filter(Boolean)
    : [];
}

function practiceCount(m: ModuleLike): number {
  if (!Array.isArray(m.practice)) return 0;
  return m.practice.reduce(
    (n, grp) => n + (Array.isArray(grp.problems) ? grp.problems.length : 0),
    0
  );
}

function checkpointCount(m: ModuleLike): number {
  return Array.isArray(m.checkpoint?.questions) ? m.checkpoint.questions.length : 0;
}

function textLen(s: unknown): number {
  return typeof s === "string" ? s.length : 0;
}

/** Compare two guides and describe every change. */
export function diffGuideEdit(
  before: GenerateResult,
  after: GenerateResult
): GuideEditDiff {
  const changes: string[] = [];
  const lost: string[] = [];

  const beforeModules = moduleList(before);
  const afterModules = moduleList(after);
  const beforeByNumber = new Map(beforeModules.map((m) => [m.moduleNumber, m]));
  const afterByNumber = new Map(afterModules.map((m) => [m.moduleNumber, m]));

  // Modules added / removed / renamed.
  for (const m of afterModules) {
    if (!beforeByNumber.has(m.moduleNumber)) {
      changes.push(`Added Module ${m.moduleNumber}: ${m.title}`);
    } else {
      const old = beforeByNumber.get(m.moduleNumber) as ModuleLike;
      if (old.title !== m.title) {
        changes.push(`Renamed Module ${m.moduleNumber} to “${m.title}”`);
      }
    }
  }
  for (const m of beforeModules) {
    if (!afterByNumber.has(m.moduleNumber)) {
      changes.push(`Removed Module ${m.moduleNumber}: ${m.title}`);
      lost.push(`Module ${m.moduleNumber} (“${m.title}”)`);
    }
  }

  // Per-module: concepts, practice problems, checkpoint questions.
  for (const m of afterModules) {
    const old = beforeByNumber.get(m.moduleNumber);
    if (!old) continue;
    const oldConcepts = new Set(conceptTitles(old));
    const newConcepts = conceptTitles(m);
    for (const title of newConcepts) {
      if (!oldConcepts.has(title)) {
        changes.push(`Added concept “${title}” to Module ${m.moduleNumber}`);
      }
    }
    for (const title of oldConcepts) {
      if (!newConcepts.includes(title)) {
        changes.push(`Removed concept “${title}” from Module ${m.moduleNumber}`);
        lost.push(`concept “${title}” (Module ${m.moduleNumber})`);
      }
    }
    const practiceDelta = practiceCount(m) - practiceCount(old);
    if (practiceDelta > 0) {
      changes.push(
        `Added ${practiceDelta} practice question${practiceDelta === 1 ? "" : "s"} in Module ${m.moduleNumber}`
      );
    } else if (practiceDelta < 0) {
      changes.push(
        `Removed ${-practiceDelta} practice question${practiceDelta === -1 ? "" : "s"} from Module ${m.moduleNumber}`
      );
      lost.push(`${-practiceDelta} practice question${practiceDelta === -1 ? "" : "s"} (Module ${m.moduleNumber})`);
    }
    const checkpointDelta = checkpointCount(m) - checkpointCount(old);
    if (checkpointDelta !== 0) {
      changes.push(
        checkpointDelta > 0
          ? `Added ${checkpointDelta} checkpoint question${checkpointDelta === 1 ? "" : "s"} in Module ${m.moduleNumber}`
          : `Removed ${-checkpointDelta} checkpoint question${checkpointDelta === -1 ? "" : "s"} from Module ${m.moduleNumber}`
      );
      if (checkpointDelta < 0) {
        lost.push(`${-checkpointDelta} checkpoint question${checkpointDelta === -1 ? "" : "s"} (Module ${m.moduleNumber})`);
      }
    }
  }

  // Whole-guide sections.
  const beforeQuiz = Array.isArray(before.quiz) ? before.quiz.length : 0;
  const afterQuiz = Array.isArray(after.quiz) ? after.quiz.length : 0;
  if (afterQuiz > beforeQuiz) {
    changes.push(`Added ${afterQuiz - beforeQuiz} practice quiz question${afterQuiz - beforeQuiz === 1 ? "" : "s"}`);
  } else if (afterQuiz < beforeQuiz) {
    changes.push(`Removed ${beforeQuiz - afterQuiz} practice quiz question${beforeQuiz - afterQuiz === 1 ? "" : "s"}`);
    lost.push(`${beforeQuiz - afterQuiz} practice quiz question${beforeQuiz - afterQuiz === 1 ? "" : "s"}`);
  }

  const beforeFinal = before.finalReview?.questions.length ?? 0;
  const afterFinal = after.finalReview?.questions.length ?? 0;
  if (afterFinal > beforeFinal) {
    changes.push(`Added ${afterFinal - beforeFinal} final review question${afterFinal - beforeFinal === 1 ? "" : "s"}`);
  } else if (afterFinal < beforeFinal) {
    changes.push(`Removed ${beforeFinal - afterFinal} final review question${beforeFinal - afterFinal === 1 ? "" : "s"}`);
    lost.push(`${beforeFinal - afterFinal} final review question${beforeFinal - afterFinal === 1 ? "" : "s"}`);
  }

  if (!before.cheatSheet && after.cheatSheet) {
    changes.push("Added a cheat sheet");
  } else if (before.cheatSheet && !after.cheatSheet) {
    changes.push("Removed the cheat sheet");
    lost.push("the cheat sheet");
  } else if (before.cheatSheet && after.cheatSheet && before.cheatSheet !== after.cheatSheet) {
    changes.push("Rewrote the cheat sheet");
  }

  if ((before.objectives?.length ?? 0) !== (after.objectives?.length ?? 0)) {
    changes.push("Updated the learning objectives");
  }
  if ((before.faq?.length ?? 0) !== (after.faq?.length ?? 0)) {
    changes.push("Updated the FAQ");
  }
  if ((before.keyTerms?.length ?? 0) !== (after.keyTerms?.length ?? 0)) {
    changes.push("Updated the glossary");
  }
  if (before.summary !== after.summary) {
    changes.push("Updated the summary");
  }

  // The main study-guide text: rewritten is normal; losing most of it
  // is destructive (a bad edit gutting the guide).
  const beforeLen = textLen(before.studyGuide);
  const afterLen = textLen(after.studyGuide);
  if (beforeLen > 0 && afterLen > 0 && beforeLen !== afterLen) {
    if (afterLen < beforeLen * 0.5) {
      changes.push("Shortened the main guide text by more than half");
      lost.push("more than half of the main guide text");
    } else {
      changes.push("Rewrote parts of the main guide text");
    }
  }
  if (before.cheatSheet && after.cheatSheet) {
    const b = textLen(before.cheatSheet);
    const a = textLen(after.cheatSheet);
    if (b > 0 && a < b * 0.5) {
      lost.push("more than half of the cheat sheet");
    }
  }

  if (changes.length === 0) {
    changes.push("No visible changes — the guide looks the same as before.");
  }

  const destructive = lost.length > 0;
  return {
    changes,
    destructive,
    destructiveDetail: destructive
      ? `This edit would remove ${lost.join(", ")}.`
      : undefined,
  };
}
