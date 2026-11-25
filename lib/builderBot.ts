import type { GenerateResult } from "@/app/page";
import type { GuideJson } from "./guideSchema";

/** True when the student's request is asking to ADD something (more
 *  questions, a new concept, another module, extra examples) without
 *  asking to remove or replace anything. Such requests are additive
 *  by default: the edit must only add, never silently drop existing
 *  content to make room. */
export function isAdditiveRequest(instruction: string): boolean {
  const text = instruction.toLowerCase();
  const asksToAdd =
    /\b(add|more|another|extra|also|include|append)\b/.test(text);
  const asksToRemove =
    /\b(remove|delete|drop|replace|cut|shorten|trim|get rid of|take (out|away)|rewrite)\b/.test(
      text
    );
  return asksToAdd && !asksToRemove;
}

/** Put back anything the edit silently dropped.
 *
 *  A model asked to "add 3 more practice questions" will sometimes
 *  rebuild the guide and quietly drop other content (in the 2026-11-25
 *  re-test it removed 6 final review questions to add 3 practice
 *  ones). For an additive request that is never acceptable: this
 *  merges the BEFORE guide's missing content back into the AFTER
 *  guide — missing modules, concepts, practice problems, checkpoint
 *  questions, quiz questions, final review questions, objectives,
 *  applications, FAQ items, and glossary terms are re-appended.
 *  The model's own additions are kept; only the silent deletions are
 *  undone. Returns the merged guide plus a short list of what was
 *  put back (empty when nothing was missing).
 */
export function restoreRemovedContent(
  before: GuideJson,
  after: GuideJson
): { guide: GuideJson; restored: string[] } {
  const guide = JSON.parse(JSON.stringify(after)) as GuideJson;
  const restored: string[] = [];

  const byText = (items: { question?: string }[]) =>
    new Set(items.map((q) => (q.question ?? "").trim()).filter(Boolean));

  // Modules (by number) — a dropped module comes back whole.
  const afterModules = new Map(
    (guide.modules ?? []).map((m) => [m.moduleNumber, m])
  );
  for (const m of before.modules ?? []) {
    if (!afterModules.has(m.moduleNumber)) {
      guide.modules = [...(guide.modules ?? []), JSON.parse(JSON.stringify(m))];
      restored.push(`Module ${m.moduleNumber} (“${m.title}”)`);
    }
  }
  guide.modules = (guide.modules ?? []).sort(
    (a, b) => a.moduleNumber - b.moduleNumber
  );

  // Per-module content, matched by module number.
  const beforeByNumber = new Map(
    (before.modules ?? []).map((m) => [m.moduleNumber, m])
  );
  for (const m of guide.modules ?? []) {
    const old = beforeByNumber.get(m.moduleNumber);
    if (!old) continue;

    const oldConcepts = new Set((old.concepts ?? []).map((c) => c.title));
    const newConcepts = new Set((m.concepts ?? []).map((c) => c.title));
    const missingConcepts = (old.concepts ?? []).filter(
      (c) => !newConcepts.has(c.title)
    );
    if (missingConcepts.length > 0) {
      m.concepts = [
        ...(m.concepts ?? []),
        ...missingConcepts.map((c) => JSON.parse(JSON.stringify(c))),
      ];
      restored.push(
        `${missingConcepts.length} concept${missingConcepts.length === 1 ? "" : "s"} in Module ${m.moduleNumber}`
      );
    }

    // Practice problems, matched within their concept group.
    const oldGroups = new Map(
      (old.practice ?? []).map((g) => [g.conceptTitle, g])
    );
    const newGroups = new Map(
      (m.practice ?? []).map((g) => [g.conceptTitle, g])
    );
    for (const [title, oldGroup] of oldGroups) {
      const newGroup = newGroups.get(title);
      if (!newGroup) {
        m.practice = [
          ...(m.practice ?? []),
          JSON.parse(JSON.stringify(oldGroup)),
        ];
        restored.push(
          `${oldGroup.problems.length} practice question${oldGroup.problems.length === 1 ? "" : "s"} for “${title}”`
        );
        continue;
      }
      const seen = byText(newGroup.problems ?? []);
      const missingProblems = (oldGroup.problems ?? []).filter(
        (p) => p.question?.trim() && !seen.has(p.question.trim())
      );
      if (missingProblems.length > 0) {
        newGroup.problems = [
          ...(newGroup.problems ?? []),
          ...missingProblems.map((p) => JSON.parse(JSON.stringify(p))),
        ];
        restored.push(
          `${missingProblems.length} practice question${missingProblems.length === 1 ? "" : "s"} in Module ${m.moduleNumber}`
        );
      }
    }

    // Checkpoint questions, matched by question text.
    if (old.checkpoint) {
      const seen = byText(m.checkpoint?.questions ?? []);
      const missingQs = (old.checkpoint.questions ?? []).filter(
        (q) => q.question?.trim() && !seen.has(q.question.trim())
      );
      if (missingQs.length > 0) {
        if (!m.checkpoint) m.checkpoint = { questions: [] };
        m.checkpoint.questions = [
          ...(m.checkpoint.questions ?? []),
          ...missingQs.map((q) => JSON.parse(JSON.stringify(q))),
        ];
        restored.push(
          `${missingQs.length} checkpoint question${missingQs.length === 1 ? "" : "s"} in Module ${m.moduleNumber}`
        );
      }
    }
  }

  // Guide-level quiz + final review, matched by question text.
  const restoreQuestions = (
    beforeQs: { question: string }[] | undefined,
    afterQs: { question: string }[] | undefined,
    label: string
  ): { question: string }[] => {
    const seen = byText(afterQs ?? []);
    const missing = (beforeQs ?? []).filter(
      (q) => q.question?.trim() && !seen.has(q.question.trim())
    );
    if (missing.length > 0) {
      restored.push(
        `${missing.length} ${label} question${missing.length === 1 ? "" : "s"}`
      );
      return [
        ...(afterQs ?? []),
        ...missing.map((q) => JSON.parse(JSON.stringify(q))),
      ];
    }
    return (afterQs ?? []) as { question: string }[];
  };
  if (before.quiz && before.quiz.length > 0) {
    guide.quiz = restoreQuestions(
      before.quiz,
      guide.quiz,
      "practice quiz"
    ) as GuideJson["quiz"];
  }
  if (before.finalReview) {
    const qs = restoreQuestions(
      before.finalReview.questions,
      guide.finalReview?.questions,
      "final review"
    );
    if (!guide.finalReview) guide.finalReview = { questions: [] };
    guide.finalReview.questions = qs as NonNullable<
      GuideJson["finalReview"]
    >["questions"];
  }

  // Finishing sections — restore dropped items by value.
  const restoreStrings = (
    beforeItems: string[] | undefined,
    afterItems: string[] | undefined,
    label: string
  ): string[] => {
    const seen = new Set((afterItems ?? []).map((s) => s.trim()));
    const missing = (beforeItems ?? []).filter(
      (s) => s.trim() && !seen.has(s.trim())
    );
    if (missing.length > 0) {
      restored.push(`${missing.length} ${label}`);
    }
    return [...(afterItems ?? []), ...missing];
  };
  if (before.objectives?.length) {
    guide.objectives = restoreStrings(
      before.objectives,
      guide.objectives,
      "learning objectives"
    );
  }
  if (before.realWorldApplications?.length) {
    guide.realWorldApplications = restoreStrings(
      before.realWorldApplications,
      guide.realWorldApplications,
      "real-world applications"
    );
  }
  if (before.faq?.length) {
    const seen = new Set(
      (guide.faq ?? []).map((f) => (f.question ?? "").trim())
    );
    const missing = before.faq.filter(
      (f) => f.question?.trim() && !seen.has(f.question.trim())
    );
    if (missing.length > 0) {
      guide.faq = [
        ...(guide.faq ?? []),
        ...missing.map((f) => JSON.parse(JSON.stringify(f))),
      ];
      restored.push(`${missing.length} FAQ items`);
    }
  }
  if (before.keyTerms?.length) {
    const seen = new Set((guide.keyTerms ?? []).map((t) => t.term));
    const missing = before.keyTerms.filter((t) => !seen.has(t.term));
    if (missing.length > 0) {
      guide.keyTerms = [
        ...(guide.keyTerms ?? []),
        ...missing.map((t) => JSON.parse(JSON.stringify(t))),
      ];
      restored.push(`${missing.length} glossary terms`);
    }
  }

  return { guide, restored };
}

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
  // Added vs removed, grouped: what was added comes first, then what
  // was removed, then rewrites — so the student sees at a glance
  // whether an edit was purely additive or took something away.
  const added = changes.filter((c) => c.startsWith("Added"));
  const removed = changes.filter((c) => c.startsWith("Removed"));
  const other = changes.filter(
    (c) => !c.startsWith("Added") && !c.startsWith("Removed")
  );
  return {
    changes: [...added, ...removed, ...other],
    destructive,
    destructiveDetail: destructive
      ? `This edit would remove ${lost.join(", ")}.`
      : undefined,
  };
}
