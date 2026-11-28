-- StudySMART — group chats for friends.
-- Apply in the Supabase SQL editor after 0009.
--
-- A group chat is created by one user for their ACCEPTED friends only:
-- strangers and pending requests can never be added (enforced in the
-- member-insert policy below, and again in the app code). Groups are
-- in-app only — no emails, no notifications. Messages are plain text
-- (max 1000 characters) or a shared guide (one message carrying the
-- guide snapshot, visible to every member — the guide is NOT copied
-- into shared_guides once per member).

-- ---------------------------------------------------------------------------
-- is_group_member: membership test used by the policies below.
-- SECURITY DEFINER so the policies can ask "is the caller a member?"
-- without the policy querying its own table (which Postgres rejects as
-- infinite recursion). It only ever answers about the CALLER's own
-- membership, so it leaks nothing.
-- ---------------------------------------------------------------------------
create or replace function public.is_group_member(p_group_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.group_chat_members
    where group_id = p_group_id and user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- group_chats: a named chat. created_by is the creator (the only person
-- who can rename it, add/remove members, or delete it).
-- ---------------------------------------------------------------------------
create table if not exists public.group_chats (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.group_chats enable row level security;

-- Only members can see a group.
create policy "Members can view group chats"
  on public.group_chats for select
  using (public.is_group_member(group_chats.id));

-- Anyone signed in can create a group (they become its creator; the
-- member rows are added separately and are creator-gated there).
create policy "Users can create group chats"
  on public.group_chats for insert
  with check (auth.uid() = created_by);

-- Only the creator can rename a group.
create policy "Creator can rename group chats"
  on public.group_chats for update
  using (auth.uid() = created_by)
  with check (auth.uid() = created_by);

-- Only the creator can delete a group (members and messages cascade).
create policy "Creator can delete group chats"
  on public.group_chats for delete
  using (auth.uid() = created_by);

-- ---------------------------------------------------------------------------
-- group_chat_members: one row per member. A group needs at least 2 people
-- total (creator + 1 friend) — enforced in the app code, since a bare
-- CHECK cannot count rows.
-- ---------------------------------------------------------------------------
create table if not exists public.group_chat_members (
  group_id uuid not null references public.group_chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

alter table public.group_chat_members enable row level security;

-- Members can see who else is in their groups.
create policy "Members can view group members"
  on public.group_chat_members for select
  using (public.is_group_member(group_chat_members.group_id));

-- Only the creator can add members, and only accepted friends (or
-- themselves, for the creator's own row). The friendship check keeps
-- strangers and pending requests out of groups at the data layer, not
-- just in the UI.
create policy "Creator can add accepted friends as members"
  on public.group_chat_members for insert
  with check (
    auth.uid() = (select created_by from public.group_chats where id = group_id)
    and (
      user_id = auth.uid()
      or exists (
        select 1 from public.friendships f
        where f.status = 'accepted'
          and ((f.requester_id = auth.uid() and f.addressee_id = user_id)
            or (f.requester_id = user_id and f.addressee_id = auth.uid()))
      )
    )
  );

-- A member can leave (delete their own row); the creator can remove anyone.
create policy "Members can leave, creator can remove members"
  on public.group_chat_members for delete
  using (
    auth.uid() = user_id
    or auth.uid() = (select created_by from public.group_chats where id = group_id)
  );

-- ---------------------------------------------------------------------------
-- group_chat_messages: plain-text messages and shared guides.
-- A text message has 1–1000 characters of content and no snapshot.
-- A guide message has a guide snapshot (the full guide JSON at send
-- time, same shape as shared_guides) and empty content. The snapshot
-- survives even if the sender later deletes the original guide.
-- ---------------------------------------------------------------------------
create table if not exists public.group_chat_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.group_chats (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  message_type text not null default 'text' check (message_type in ('text', 'guide')),
  content text not null default '',
  guide_id uuid references public.study_guides (id) on delete set null,
  guide_snapshot jsonb,
  created_at timestamptz not null default now(),
  check (
    (message_type = 'text' and char_length(content) between 1 and 1000)
    or (message_type = 'guide' and guide_snapshot is not null)
  )
);

alter table public.group_chat_messages enable row level security;

-- Only members can read a group's messages.
create policy "Members can view group messages"
  on public.group_chat_messages for select
  using (public.is_group_member(group_chat_messages.group_id));

-- Only members can post, and only as themselves. (No update policy:
-- messages cannot be edited in v1. No delete policy: messages stay as
-- the group's history; deleting the group removes them all.)
create policy "Members can send group messages"
  on public.group_chat_messages for insert
  with check (
    auth.uid() = sender_id
    and public.is_group_member(group_chat_messages.group_id)
  );
