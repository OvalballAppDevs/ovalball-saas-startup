-- The canonical season register, shaped correctly, for local browser UAT.
--
-- WHY THIS EXISTS
--
-- Every season date in Ovalball derives from public.seasons -- the register a
-- Site Admin manages under Site Admin -> Seasons. There is one authoritative
-- season calendar and no second answer anywhere in the product. Until now the
-- local register was ad-hoc rows created by hand, present in no migration and
-- no seed, so a database reset produced a different calendar from the one the
-- last person tested against, and two defects were baked into it.
--
-- WHAT WAS WRONG
--
-- 1. THE LEAGUE SEASON HAD A UNION SHAPE. 'Rugby League 2026' ran
--    2026-09-01 -> 2027-06-30: across two calendar years, while carrying the
--    season_ref '2026'. Rugby League runs INSIDE one calendar year, which is
--    exactly why its reference is a single year and Union's is a pair
--    ("26/27"). A League season configured across a year boundary is
--    mislabelled by its own reference -- the row asserted one thing in its
--    dates and another in its name. Nothing had yet rendered it, so nothing
--    caught it; it would have become a real cross-code defect the first time a
--    League club opened Calendar.
--
-- 2. THE CURRENT UNION SEASON HAD NO PRE-SEASON. pre_season_starts_on was
--    null on 26/27, so no pre-season phase resolved and Calendar correctly
--    offered no Pre-Season control. That behaviour is right -- a missing
--    canonical date must never be papered over with an assumed cutoff -- but
--    it meant the pre-season half of the product could not be exercised at
--    all locally, and its absence read as a missing feature rather than as
--    missing data.
--
-- WHAT THIS IS NOT
--
-- Not a second source of season truth. This seeds the canonical register
-- itself and then gets out of the way: no surface reads this file, no code
-- path knows these ids, and every season answer still resolves through
-- public.seasons exactly as it did before. Change a date in Site Admin ->
-- Seasons and the change propagates; this only decides what the register
-- holds on a freshly seeded machine.
--
-- Written as an idempotent upsert keyed on (rugby_code, season_ref), so it is
-- safe to re-run and never duplicates a season. It deliberately does NOT
-- delete or rewrite seasons that carry fixtures, training or recorded team
-- identities beyond these date corrections -- a historical season is a record
-- of what happened and is not re-shaped because presentation improved.

do $$
declare
  v_actor uuid;
begin
  -- Any Site Admin serves as the recording actor; these are audit columns, not
  -- authority. If the local database has none yet, the columns stay null
  -- rather than inventing an identity.
  select user_id into v_actor from public.site_admins limit 1;

  -- ---------------------------------------------------------------------
  -- RUGBY UNION 26/27 -- the current season.
  --
  -- Union runs across two calendar years: pre-season from August, the season
  -- proper from September to the following June. The pre-season start is the
  -- canonical boundary the handover, registration windows and the Calendar's
  -- Pre-Season phase all read; it is a recorded fact here, never a computed
  -- "1 August" cutoff written into a function.
  -- ---------------------------------------------------------------------
  update public.seasons
     set pre_season_starts_on = date '2026-08-01',
         starts_on            = date '2026-09-01',
         ends_on              = date '2027-06-30',
         updated_by           = coalesce(v_actor, updated_by)
   where rugby_code = 'union'
     and season_ref = '26/27';

  -- ---------------------------------------------------------------------
  -- RUGBY LEAGUE 2026 -- one calendar year, which is the whole point.
  --
  -- The community game runs roughly February to October, so the season sits
  -- wholly inside 2026 and its reference is the year itself. Pre-season
  -- begins in January. Correcting the dates makes the row agree with its own
  -- season_ref instead of contradicting it.
  -- ---------------------------------------------------------------------
  update public.seasons
     set pre_season_starts_on = date '2026-01-05',
         starts_on            = date '2026-02-01',
         ends_on              = date '2026-10-31',
         updated_by           = coalesce(v_actor, updated_by)
   where rugby_code = 'league'
     and season_ref = '2026';

  -- ---------------------------------------------------------------------
  -- RUGBY UNION 27/28 -- next season.
  --
  -- CREATED here, not merely corrected. This file said it was "an idempotent
  -- upsert keyed on (rugby_code, season_ref)" and was in fact three UPDATEs,
  -- so on a FRESH database 27/28 simply did not exist -- it was one of the
  -- ad-hoc hand-made rows this file was written to put an end to, and it had
  -- survived on the development machine only because nobody ever reset it.
  --
  -- A season handover has no meaning without a season to hand over INTO, so
  -- its absence did not read as missing data: it read as the handover being
  -- broken. An existing row is still left alone beyond the date corrections
  -- above, because a season that carries recorded team identities is a record
  -- of what happened.
  -- ---------------------------------------------------------------------
  -- season_year_start and season_year_end are DERIVED from the dates by the table itself, so they
  -- are deliberately absent here: writing them would be a second answer to a question the register
  -- already answers.
  insert into public.seasons (name, season_ref, rugby_code, starts_on, ends_on,
                              pre_season_starts_on, active, created_by, updated_by)
  select 'Rugby Union 27/28', '27/28', 'union', date '2027-09-01', date '2028-06-30',
         date '2027-08-01', true, v_actor, v_actor
  where not exists (
    select 1 from public.seasons s where s.rugby_code = 'union' and s.season_ref = '27/28'
  );
end
$$;
