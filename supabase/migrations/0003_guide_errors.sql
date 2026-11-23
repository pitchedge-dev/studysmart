-- StudySMART — per-user error tracking for personalized practice.
-- Apply in the Supabase SQL editor (free tier project "studysmart").
-- No premade content: every row is created by a real user action.
--
-- Privacy rule: errors belong ONLY to the signed-in user who made them.
-- They are keyed by (user_id, guide_key), where guide_key identifies ONE
-- copy of a guide — a saved guide's row id, or a content hash for an
-- unsaved in-session guide. A published guide, a shared guide, and another
-- user's copy never expose your errors: RLS only ever returns rows whose
-- user_id is the signed-in user, and error rows are never stored inside the
-- guide JSON that gets published or shared.

create table if not exists public.guide_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  guide_key text not null,
  concept_title text not null,
  module_title text not null default '',
  misses int not null default 0,
  correct_streak int not null default 0,
  total_attempts int not null default 0,
  last_question text,
  last_picked text,
  last_correct text,
  last_explanation text,
  updated_at timestamptz not null default now(),
  unique (user_id, guide_key, concept_title)
);

alter table public.guide_errors enable row level security;

-- Only the user who made the errors can read, write, or delete them.
create policy "Users manage only their own guide errors"
  on public.guide_errors for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- The earlier migrations never granted table privileges, which made every
-- app read/write fail with 42501 until grants were added by hand in the
-- live project. Grant them here so this table works on first apply.
grant select, insert, update, delete on public.guide_errors to authenticated;
