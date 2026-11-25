-- SM-2 scheduler state for the Review queue (research-extras, 2026-11-25).
-- The fixed 1 → 3 → 7 → 16 day ladder is replaced by the SM-2 algorithm
-- (Wozniak, SuperMemo 2, 1987): each weak concept carries an easiness
-- factor and a consecutive-pass count, and the next gap grows by the
-- factor after each pass. Old rows keep working — the app falls back to
-- ease 2.5 / 0 reps when these are null.
alter table public.guide_errors
  add column if not exists ease_factor numeric default 2.5,
  add column if not exists review_reps integer default 0;
