-- StudySMART — friends and private guide sharing.
-- Apply in the Supabase SQL editor after 0001.

-- ---------------------------------------------------------------------------
-- friendships: friend requests between accounts. One row per pair, in either
-- direction. status = 'pending' | 'accepted'.
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users (id) on delete cascade,
  addressee_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  unique (requester_id, addressee_id),
  check (requester_id <> addressee_id)
);

alter table public.friendships enable row level security;

-- Only the two people involved can see a friendship.
create policy "Involved users can view friendships"
  on public.friendships for select
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

create policy "Users can send friend requests"
  on public.friendships for insert
  with check (auth.uid() = requester_id);

-- Only the addressee can accept a request sent to them.
create policy "Addressee can accept requests"
  on public.friendships for update
  using (auth.uid() = addressee_id);

-- Either side can remove the friendship (decline or unfriend).
create policy "Involved users can delete friendships"
  on public.friendships for delete
  using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- ---------------------------------------------------------------------------
-- shared_guides: a private copy of a guide sent to exactly one friend.
-- guide_snapshot holds the full guide/game JSON at send time, so the copy
-- survives even if the sender later deletes the original. This is NOT
-- publishing — only the sender and the recipient can see it.
-- ---------------------------------------------------------------------------
create table if not exists public.shared_guides (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users (id) on delete cascade,
  recipient_id uuid not null references auth.users (id) on delete cascade,
  guide_id uuid references public.study_guides (id) on delete set null,
  guide_snapshot jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.shared_guides enable row level security;

create policy "Sender and recipient can view shared guides"
  on public.shared_guides for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

create policy "Users can send guides to friends"
  on public.shared_guides for insert
  with check (auth.uid() = sender_id);

create policy "Recipient can delete a shared guide"
  on public.shared_guides for delete
  using (auth.uid() = recipient_id);
