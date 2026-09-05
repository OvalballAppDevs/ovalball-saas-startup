-- CANONICAL SEASONS RECONCILIATION, Section 4: Season Name and Season Ref
-- are different canonical fields, and today they are not -- `name` is the
-- ONLY derived label (compute_season_identity, 20260906000000), doubling
-- as both the fuller display name AND (implicitly, via ad-hoc parsing) a
-- compact reference. Worse, the compact "26/27"-style reference is
-- independently RECOMPUTED in at least three separate places that must
-- agree by coincidence rather than by construction:
--   1. internal.compute_season_identity (baked into `name`)
--   2. lib/calendar/season-window.ts's seasonYearLabel(startsOn, endsOn)
--      -- derives the SAME concept from raw dates, for Calendar's own
--      season header/arrows
--   3. lib/seasons/validation.ts's seasonYearLabel(rugbyCode, seasonYearStart)
--      -- a THIRD, differently-signatured function of the same name, used
--      by the season create form's live preview
-- This migration adds season_ref as a real, single, canonical column so
-- every consumer can read ONE value instead of recomputing it three ways;
-- `name` itself is left in its existing, already-relied-upon format
-- (e.g. "Rugby Union 26/27") so no existing self-sufficient label (Season
-- Rollover's batch headers, the Admin Seasons table, Calendar's season
-- dropdown options) silently changes shape in this pass -- only the
-- Calendar header specifically, which already imports a redundant
-- calculation JUST for this value, is switched to read the new column.
alter table public.seasons add column season_ref text;

create or replace function internal.compute_season_identity()
returns trigger
language plpgsql
as $$
declare
  v_base text;
  v_ref text;
begin
  if new.season_year_start is null then
    new.season_year_start := extract(year from new.starts_on)::int;
  end if;

  if new.rugby_code = 'union' then
    v_base := 'Rugby Union ' || lpad((new.season_year_start % 100)::text, 2, '0') || '/' || lpad(((new.season_year_start + 1) % 100)::text, 2, '0');
    v_ref := lpad((new.season_year_start % 100)::text, 2, '0') || '/' || lpad(((new.season_year_start + 1) % 100)::text, 2, '0');
  elsif new.rugby_code = 'league' then
    v_base := 'Rugby League ' || new.season_year_start::text;
    v_ref := new.season_year_start::text;
  else
    v_base := 'Season ' || lpad((new.season_year_start % 100)::text, 2, '0') || '/' || lpad(((new.season_year_start + 1) % 100)::text, 2, '0');
    v_ref := lpad((new.season_year_start % 100)::text, 2, '0') || '/' || lpad(((new.season_year_start + 1) % 100)::text, 2, '0');
  end if;

  new.name := case when new.is_regression_fixture then '[TEST] ' || v_base else v_base end;
  new.season_ref := case when new.is_regression_fixture then '[TEST] ' || v_ref else v_ref end;
  return new;
end;
$$;

-- Backfill every existing row's season_ref under the new rule (a genuine
-- UPDATE fires the BEFORE UPDATE trigger even when no touched column's
-- value changes, matching how 20260906000000 originally backfilled name).
update public.seasons set updated_at = updated_at;

alter table public.seasons alter column season_ref set not null;
