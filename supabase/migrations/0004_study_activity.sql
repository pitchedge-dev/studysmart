-- StudySMART — streaks + XP activity, and spaced-repetition dates.
-- Apply in the Supabase SQL editor (free tier project "studysmart").
-- No premade content: every row is created by a real user action.
--
-- study_activity: one row per user per day, holding that day's totals.
-- XP is awarded only for correct answers, completed sections, and
-- mastered concepts — never for clicks or page views. A "study day" is
-- a day with at least one answered question, completed section, or
-- generated guide.
--
-- guide_errors.next_review_at / review_interval_days: the spaced
-- repetition schedule for a weak concept (wrong = due tomorrow, then
-- intervals 1 → 3 → 7 → 16 days after correct answers). The app code
-- tolerates these columns being absent (it retries the upsert without
-- them), so this migration can be applied after the app ships.

create table if not exists public.study_activity (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  activity_date date not null,
  xp int not null default 0,
  questions_answered int not null default 0,
  questions_correct int not null default 0,
  guides_generated int not null default 0,
  sections_completed int not null default 0,
  concepts_mastered int not null default 0,
  arena_games int not null default 0,
  updated_at timestamptz not null default now(),
  unique (user_id, activity_date)
);

alter table public.study_activity enable row level security;

-- Only the user who did the studying can read, write, or delete it.
create policy "Users manage only their own study activity"
  on public.study_activity for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.study_activity to authenticated;

-- Spaced-repetition schedule on the existing error rows.
alter table public.guide_errors
  add column if not exists next_review_at date,
  add column if not exists review_interval_days int;
