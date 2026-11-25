-- StudySMART — achievements earned from real study activity.
-- Apply in the Supabase SQL editor (free tier project "studysmart").
-- No premade content: every row is created when a user actually earns
-- an achievement (focus sessions, streaks, XP, mastery, arena wins).
-- The app code tolerates this table being absent (best-effort sync only,
-- localStorage is the source of truth), so it can be applied after the
-- app ships.
--
-- achievements: one row per user per achievement, with the earned date.

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  achievement_id text not null,
  earned_at timestamptz not null default now(),
  unique (user_id, achievement_id)
);

alter table public.achievements enable row level security;

-- Only the user who earned an achievement can read or add it.
create policy "Users manage only their own achievements"
  on public.achievements for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

grant select, insert, update, delete on public.achievements to authenticated;
