-- Regression coverage for the local club_directory duplicate-seeding bug:
-- adding the full real dataset (supabase/seeds/club_directory.sql) directly
-- alongside the pre-existing 5 hand-written local_dev_seed fixture rows in
-- seed.sql produced two rows for the same real-world club (e.g. two
-- "Burnley RUFC" rows, one per source) since club_directory.name has no
-- uniqueness constraint. Fixed by excluding the 4 colliding rows from the
-- generated seed file -- see supabase/seeds/club_directory.sql's own header
-- comment for exactly which rows and why. This file proves that fix holds
-- and would catch a regression (e.g. someone regenerating the seed file
-- without the exclusion list). NOT a migration -- never applied
-- automatically by `db reset`. Run by hand against local Supabase:
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/club_directory_integrity.sql
--
-- Read-only throughout (no fixtures created, nothing to roll back) --
-- these assertions run directly against whatever a fresh `db reset --local`
-- produced.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Running club_directory integrity checks. ==='

-- ------------------------------------------------------------
-- 1. Total row count is stable and matches the known-good baseline
--    (1385 real rows loaded by seeds/club_directory.sql + 5 hand-written
--    local_dev_seed fixtures in seed.sql = 1390). A regression here would
--    mean either a re-run duplicated rows (the classic 1389 -> 2778 -> 4167
--    growth pattern a non-idempotent seed would produce) or the exclusion
--    list drifted out of sync with the staging CSV.
-- ------------------------------------------------------------
do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.club_directory;
  if v_count = 1390 then
    raise notice 'PASS 1: club_directory has exactly 1390 rows after a fresh reset';
  else
    raise notice 'FAIL 1: club_directory has % rows, expected 1390', v_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 2. No two rows share an exact normalized_key (the strong, unambiguous
--    duplicate signal -- a looser town/county fuzzy check is deliberately
--    NOT automated here, since that's exactly the kind of judgment call
--    that risks merging two genuinely different same-town clubs; see
--    scenario 5 below for the four specific known clubs instead).
-- ------------------------------------------------------------
do $$
declare
  v_dupe_count int;
begin
  select count(*) into v_dupe_count from (
    select normalized_key from public.club_directory
    group by normalized_key having count(*) > 1
  ) d;
  if v_dupe_count = 0 then
    raise notice 'PASS 2: no two club_directory rows share an exact normalized_key';
  else
    raise notice 'FAIL 2: % normalized_key value(s) have more than one row', v_dupe_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. source+external_id does not duplicate where external_id is populated.
-- ------------------------------------------------------------
do $$
declare
  v_dupe_count int;
begin
  select count(*) into v_dupe_count from (
    select source, external_id from public.club_directory
    where external_id is not null
    group by source, external_id having count(*) > 1
  ) d;
  if v_dupe_count = 0 then
    raise notice 'PASS 3: no (source, external_id) pair is duplicated';
  else
    raise notice 'FAIL 3: % (source, external_id) pair(s) duplicated', v_dupe_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. clubs.directory_id has a uniqueness guarantee (pre-existing, not
--    introduced by this fix -- confirms the architecture already prevents
--    two *activated* clubs from ever pointing at the same directory row,
--    independent of how many club_directory rows exist for that club).
-- ------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.clubs'::regclass
      and contype = 'u'
      and conkey = (select array_agg(attnum) from pg_attribute
                    where attrelid = 'public.clubs'::regclass and attname = 'directory_id')
  ) then
    raise notice 'PASS 4: clubs.directory_id has a UNIQUE constraint';
  else
    raise notice 'FAIL 4: clubs.directory_id has no UNIQUE constraint -- two activated clubs could point at the same directory entry';
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. The four specific examples from the bug report each resolve to
--    exactly one row, using the exact same case-insensitive substring
--    match the live searchClubDirectory server action uses.
-- ------------------------------------------------------------
do $$
declare
  v_name text;
  v_count int;
begin
  foreach v_name in array array['Burnley RUFC', 'Blackburn', 'Clitheroe', 'Didsbury Toc H']
  loop
    select count(*) into v_count from public.club_directory
      where rugby_code = 'union' and (name ilike '%' || v_name || '%' or town ilike '%' || v_name || '%');
    if v_count = 1 then
      raise notice 'PASS 5 (%): exactly one search result', v_name;
    else
      raise notice 'FAIL 5 (%): % search results, expected exactly 1', v_name, v_count;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------
-- 6. No activated `clubs` row has been orphaned or duplicated relative to
--    its directory_id -- every existing local test-fixture club (Burnley,
--    Rossendale, Leigh) still resolves to exactly the local_dev_seed
--    directory row it was built against, not a newer real-ingestion row
--    with the same name.
-- ------------------------------------------------------------
do $$
declare
  v_bad_count int;
begin
  select count(*) into v_bad_count
  from public.clubs c
  join public.club_directory cd on cd.id = c.directory_id
  where cd.source <> 'local_dev_seed';
  if v_bad_count = 0 then
    raise notice 'PASS 6: every activated clubs row still points at a local_dev_seed directory row';
  else
    raise notice 'FAIL 6: % activated clubs row(s) point at a non-local_dev_seed directory row', v_bad_count;
  end if;
end $$;

\echo '=== Done. Review PASS/FAIL lines above; every assertion should read PASS. ==='
