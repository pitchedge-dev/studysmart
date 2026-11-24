-- 0005: per-user site style (theme) preference.
-- Best-effort sync for the style picker (lib/style.ts): the chosen style
-- is saved to the user's own profile so it follows them across devices.
-- The app works without this column (localStorage is the source of truth
-- and the sync silently no-ops if the column is not applied live yet).
-- The existing "Users can update their own profile" policy already covers
-- this column — no new policy needed.
alter table public.profiles
  add column if not exists style text
  check (style in ('indigo', 'midnight', 'forest', 'sunset', 'ocean'));
