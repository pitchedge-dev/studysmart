-- StudySMART — accounts, saved guides, Browse, favorites.
-- Apply in the Supabase SQL editor (free tier project "studysmart").
-- No premade content: every row is created by a real user action.

-- ---------------------------------------------------------------------------
-- profiles: public identity for each account. Usernames are unique and are
-- the ONLY public identity — email addresses are never shown anywhere.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Anyone (even signed out) can read usernames/display names — that is how
-- friending and Browse author names work. No email lives in this table.
create policy "Anyone can view profiles"
  on public.profiles for select using (true);

create policy "Users can create their own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- study_guides: guides and Battle Arena games saved to an account.
-- kind = 'guide' | 'game'. game holds the Battle Arena game JSON.
-- is_public = true only when the owner explicitly publishes it.
-- ---------------------------------------------------------------------------
create table if not exists public.study_guides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  topic text not null,
  education_level text,
  test_timing text,
  guide jsonb not null,
  quiz jsonb,
  kind text not null default 'guide' check (kind in ('guide', 'game')),
  game jsonb,
  is_public boolean not null default false,
  published_at timestamptz,
  author_name text not null default 'Anonymous',
  created_at timestamptz not null default now()
);

alter table public.study_guides enable row level security;

-- Public (including signed-out visitors) can read published items only.
create policy "Public can view published guides"
  on public.study_guides for select using (is_public = true);

-- Owners can read their own rows, public or private.
create policy "Owners can view their own guides"
  on public.study_guides for select using (auth.uid() = user_id);

create policy "Owners can save guides"
  on public.study_guides for insert
  with check (auth.uid() = user_id);

-- Only the owner can publish/unpublish or edit their own rows.
create policy "Owners can update their own guides"
  on public.study_guides for update
  using (auth.uid() = user_id);

create policy "Owners can delete their own guides"
  on public.study_guides for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- favorites: per-user favorites of published guides/games.
-- ---------------------------------------------------------------------------
create table if not exists public.favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  guide_id uuid not null references public.study_guides (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, guide_id)
);

alter table public.favorites enable row level security;

create policy "Users manage only their own favorites"
  on public.favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
