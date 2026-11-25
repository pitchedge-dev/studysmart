-- StudySMART — Battle Arena leaderboards (migration 0007).
-- Apply in the Supabase SQL editor (free tier project "studysmart").
-- No premade content: every row is created by a real finished game.
-- Nothing here seeds, backfills, or invents a single score.
--
-- arena_scores: one row per finished trivia game, for the signed-in
-- account holder only (Player 1 in 2-player / multiplayer local games).
-- A score reaches the board only when a real game was actually played to
-- the end — the app records it from the results screen, never from a
-- preview, a template, or a half-played game.
--
-- Privacy: rows carry only the player's username / display name snapshot
-- (never an email). Anyone can read the boards; only the signed-in owner
-- can insert their own rows. Scores are history — no update or delete
-- policy, so a posted score cannot be rewritten by anyone.

create table if not exists public.arena_scores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null default 'Anonymous',
  display_name text not null default '',
  game_title text not null,
  game_type text,
  topic text,
  mode text not null default '1 Player',
  score int not null default 0 check (score >= 0),
  accuracy numeric not null default 0 check (accuracy >= 0 and accuracy <= 1),
  best_streak int not null default 0 check (best_streak >= 0),
  correct int not null default 0 check (correct >= 0),
  answered int not null default 0 check (answered >= 0),
  question_count int not null default 0 check (question_count >= 0),
  played_at timestamptz not null default now(),
  check (correct <= answered),
  check (answered <= question_count)
);

alter table public.arena_scores enable row level security;

-- Public boards: anyone (signed in or not) can read the scores.
create policy "Anyone can read arena scores"
  on public.arena_scores for select
  using (true);

-- Only the signed-in owner can insert their own rows.
create policy "Users insert only their own arena scores"
  on public.arena_scores for insert
  with check (auth.uid() = user_id);

create index if not exists arena_scores_score_idx
  on public.arena_scores (score desc);
create index if not exists arena_scores_game_title_score_idx
  on public.arena_scores (game_title, score desc);
create index if not exists arena_scores_user_score_idx
  on public.arena_scores (user_id, score desc);

-- Grants so the table works on first apply (see migration 0003: earlier
-- migrations never granted privileges and every app read/write failed).
grant select on public.arena_scores to anon, authenticated;
grant insert on public.arena_scores to authenticated;
