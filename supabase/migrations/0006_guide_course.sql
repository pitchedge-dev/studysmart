-- StudySMART — organize saved guides by course (migration 0006).
-- Apply in the Supabase SQL editor (free tier project "studysmart").
-- No premade content: courses are created by users typing a name;
-- nothing here invents or backfills any course.
--
-- study_guides.course: an optional label the user assigns to a guide
-- (e.g. a school course). NULL / empty means "Uncategorized". The
-- existing owner-only RLS on study_guides already covers this column,
-- so no new policy is needed.
--
-- The app code tolerates this column being absent (writes that mention
-- it retry without it, and reads treat a missing value as
-- Uncategorized), so this migration can be applied after the app ships.

alter table public.study_guides
  add column if not exists course text;
