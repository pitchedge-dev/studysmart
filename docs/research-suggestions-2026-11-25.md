# Research-backed suggestions for StudySMART — 2026-11-25

Researched 2026-11-25 from learning-science papers and the behaviour of
the best study apps (Duolingo, Quizlet, Khan Academy, Anki, Coursera).
Only suggestions NOT already built or in progress were picked. Every
pick below is built in this branch unless marked "Not built".

## What was already covered (so it was NOT rebuilt)

Adaptive per-topic guides, games + pronunciation, Battle Arena, error
tracking + personalized practice, YouTube/Khan Academy videos, study-time
depth scaling, Builder Bot / AI Tutor / Teach-Back, welcome popup, 5
styles + dark mode, streaks/XP/daily goal/mastery/Review queue/focus
mode/Cmd-K, courses, 10-provider fallback, friends, leaderboards,
achievements + certificates, arena options parity + publishing + guide→
arena export, in-guide nav bar.

## 1. SM-2 adaptive spaced-repetition scheduling — BUILT

**Evidence.** Cepeda, Pashler, Vul, Wixted & Rohrer (2006) meta-analysis
of 839 experiments: distributed practice beats massed practice "in
essentially every material and population studied". SM-2 (Wozniak,
SuperMemo 2, 1987) is the scheduler Anki grew out of: one easiness
factor (EF, starts 2.5, floor 1.3) per item; gaps grow by EF after each
pass — I(1)=1 day, I(2)=6 days, I(n)=round(I(n−1)×EF); a miss is a
lapse that restarts the ladder. Latimier, Peyre & Ramus (2021,
Educational Psychology Review) concluded strong recommendations in
favour of spaced retrieval practice are warranted.

**Gap it closed.** The Review queue pushed every correct concept along
the same fixed rungs (1 → 3 → 7 → 16 days), whether the student found
it trivial or barely remembered it.

**Built.** `lib/review.ts` now implements SM-2 (`sm2Schedule`,
`sm2NextEase`, `sm2StateOf`); `lib/errorTracking.ts` stores
`easeFactor` + `reviewReps` per concept and advances them on every
answer; `components/ReviewQueue.tsx` adds an Anki-style self-grade
(Hard / Good / Easy) after each correct review answer, so the next gap
adapts to how hard it felt; migration
`supabase/migrations/0009_sm2_ease.sql` adds `ease_factor` +
`review_reps` to `guide_errors` (parent: apply live; the upsert already
retries without the new columns if the migration is not applied yet,
exactly like migration 0004). Old records default to ease 2.5 / 0
reps, so nothing is lost.

## 2. "Test yourself first" — pretest diagnostic — BUILT

**Evidence.** Richland, Kornell & Kao (2009, Journal of Experimental
Psychology: Applied): students who tried questions about a passage
BEFORE reading it did better on the final test than students who spent
the same time just reading — even though they mostly failed the
pretest. Kornell, Hays & Bjork (2009, JEP: Learning, Memory &
Cognition): failed retrieval attempts before study improved recall by
~10%, immediately and after a 38-hour delay. Roediger & Finn (2010,
Scientific American Mind): "students who make an unsuccessful attempt
to answer a test question before receiving the correct answer remember
the material better".

**Gap it closed.** Guides started with reading; the student never tried
to retrieve anything before studying, so the pretesting effect was
entirely unused.

**Built.** `lib/pretest.ts` + `components/PreTest.tsx`, mounted in both
guide views (`app/page.tsx` inline view, `components/GuideView.tsx`
standalone view). 3 questions sampled round-robin across the guide's
modules from the guide's OWN practice/checkpoint/final-review
questions — no AI call, nothing generated. Guessing is framed as
expected and useful; pretest answers earn no XP and never touch error
records. Before/after scores are stored per guide in localStorage, and
a "Retake after studying" button shows the student's own improvement.

## 3. "My Progress" dashboard + weekly goal — BUILT

**Evidence.** Goal-setting theory (Locke & Latham, 1990/2002):
specific, challenging goals with progress feedback outperform vague
ones; Harkin et al. (2016) meta-analysis found monitoring goal
progress reliably improves attainment. Self-regulated learning
(Zimmerman, 2000) requires students to monitor their own progress and
adjust strategy from feedback. Learning dashboards help students
understand progress and maintain motivation (Verbert et al., 2013,
"Learning Analytics Dashboard Applications").

**Gap it closed.** The app had streaks and XP but no student-facing
progress view: no weekly trend, no accuracy trend, no mastery
overview, no review forecast, and no way to set a weekly goal.

**Built.** `lib/weeklyGoal.ts` (goal stored in localStorage: questions /
XP / focus minutes per week, Mon–Sun) + `components/ProgressDashboard.tsx`,
new "Progress" nav section (with G-then-P shortcut). Shows: headline
numbers (streak, XP, questions, accuracy), a 7-day questions chart
with last-7-days vs overall accuracy, a weekly-goal card with a
progress ring and pace note, mastery breakdown by level, and a 7-day
review forecast from the SM-2 due dates. All computed from the user's
real activity days and error records; a new user sees honest 0s.

## 4. Adaptive difficulty in personalized practice — BUILT

**Evidence.** Bloom's mastery learning (Bloom, 1984, "2 Sigma
Problem": tutored + mastery students outperformed 98% of conventional
students) and Vygotsky's zone of proximal development: practice works
best at the edge of what the student can do. Kulik & Fletcher (2014)
meta-analysis of 50 intelligent-tutoring-system studies found a median
effect of 0.66 SD. **Honest caveat:** the evidence is mixed — a large
Dutch randomized field experiment (Economics of Education Review,
2017) found no average test-score effect for adaptive vs static
practice. So this is implemented as difficulty *matching*, not a
promised gain, and the research note in the code says so.

**Gap it closed.** Personalized practice generated the same difficulty
for every weak concept, whether the student had just attempted it or
nearly mastered it.

**Built.** `app/api/personalized-practice/route.ts` accepts an optional
`masteryLevel` per weak concept and tags each generated question with
a Bloom's difficulty (`Recall` / `Apply` / `Analyse`): Recall for
Attempted/Familiar, Apply for Proficient, Analyse for Mastered.
`components/ReviewQueue.tsx` and `components/PersonalizedPractice.tsx`
pass the concept's real mastery level and show the difficulty tag on
each question.

## Considered and NOT built

- **Offline/PWA mode.** Real gap (students study on the go), but it
  needs a service worker + caching strategy for generated guides; a
  half-done offline mode that serves stale guides would violate the
  "never show wrong data" rule. Needs its own task.
- **Parent/teacher progress sharing.** No parent/teacher role exists
  yet, and sharing a child's progress raises consent/privacy design
  questions the user has not decided. Friends sharing already covers
  peer sharing.
- **Push reminders for due reviews.** Needs a push/notification
  service (paid or platform-gated); the in-app Review badge + forecast
  cover the same need for now.
- **FSRS (the newer Anki scheduler).** More accurate than SM-2 in
  Anki's data, but it is a fitted ML model with parameters that need
  tuning per population; SM-2 is transparent, published, and good
  enough for per-concept scheduling here.
- **Diagnostic exam for the whole account.** A full diagnostic across
  all guides would be valuable, but the per-guide pretest (pick 2)
  covers the same mechanism with real guide content; a cross-guide
  diagnostic is a follow-up, not a duplicate.

## Sources

- Cepeda, N. J., Pashler, H., Vul, E., Wixted, J. T., & Rohrer, D.
  (2006). Distributed practice in verbal recall tasks. Review of
  General Psychology, 10(4), 354–366.
- Wozniak, P. (1990). SM-2 algorithm (SuperMemo 2), adapted from
  master's thesis; described at supermemo.com and in Anki docs.
- Latimier, A., Peyre, H., & Ramus, F. (2021). A meta-analytic review
  of the benefit of spacing out retrieval practice. Educational
  Psychology Review.
- Richland, L. E., Kornell, N., & Kao, L. S. (2009). The pretesting
  effect: Do unsuccessful retrieval attempts enhance learning? Journal
  of Experimental Psychology: Applied, 15(3), 243–257.
- Kornell, N., Hays, M. J., & Bjork, R. A. (2009). Unsuccessful
  retrieval attempts enhance subsequent learning. Journal of
  Experimental Psychology: Learning, Memory, and Cognition, 35(4).
- Roediger, H. L., & Finn, B. (2010). Getting it wrong: Surprising
  tips on how to learn. Scientific American Mind, March/April 2010.
- Locke, E. A., & Latham, G. P. (2002). Building a practically useful
  theory of goal setting and task motivation. American Psychologist,
  57(9), 705–717. And Harkin, B. et al. (2016) meta-analysis of
  goal-progress monitoring.
- Zimmerman, B. J. (2000). Attaining self-regulation: A social
  cognitive perspective. Handbook of Self-Regulation.
- Verbert, K., Duval, E., Klerkx, J., Govaerts, S., & Santos, J. L.
  (2013). Learning analytics dashboard applications. American
  Behavioral Scientist, 57(10).
- Bloom, B. S. (1984). The 2 Sigma Problem. Educational Researcher,
  13(6). Kulik, J. A., & Fletcher, J. D. (2014). Meta-analysis of
  intelligent tutoring systems (50 studies).
- "The effect of adaptive versus static practicing on student
  learning — evidence from a randomized field experiment", Economics
  of Education Review, 58 (2017), 175–187.
