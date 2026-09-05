-- CANONICAL SEASONS SINGLE-SOURCE-OF-TRUTH RECONCILIATION AUDIT.
--
-- Root cause of the "Season 27/28, Code: --" row visible in Site Admin ->
-- Seasons: supabase/tests/competition_management.sql inserts a seasons row
-- (id 95100000-0000-0000-0000-00000000ff01) supplying only
-- (id, name, starts_on, ends_on) -- no rugby_code. The
-- internal.compute_season_identity trigger (20260906000000) ALWAYS
-- overwrites `name` from rugby_code + season_year_start; with rugby_code
-- NULL it falls into that trigger's own "no rugby_code" branch and
-- produces the generic 'Season 27/28' label, discarding the test file's
-- intended 'Competition Mgmt Test Season' name entirely. Separately, this
-- row is NOT one of the three ids the 20260906000000 migration's one-time
-- is_regression_fixture backfill UPDATE flagged in practice: that row did
-- not yet exist the first time this local database's migrations ran (it
-- is (re)created by the test file itself, which is invoked as part of this
-- project's own regression-suite/local-bootstrap process, not a plain
-- schema migration) -- so the one-time backfill could never have caught
-- it, and it will keep reappearing exactly this way on every future
-- fresh reset unless the SOURCE test file itself is fixed (see below).
--
-- This row IS referenced (one inactive competition_editions row, itself
-- referenced by one real Booked fixture via competition_edition_id, NOT
-- via that fixture's own season_id, which already correctly points at the
-- real Rugby Union 26/27 season) -- so per this audit's own "referenced
-- data must be reconciled, never casually deleted" rule, it is corrected
-- in place, preserving its id and every real reference to it, rather than
-- deleted and recreated.
update public.seasons
set rugby_code = 'union', season_year_start = 2200, is_regression_fixture = true
where id = '95100000-0000-0000-0000-00000000ff01';

-- Canonical hardening, now safe because the only rugby_code-less row has
-- just been reconciled above: a season with no rugby_code cannot be
-- resolved by ANY of this product's season resolvers (all of them key off
-- rugby_code), so it was never a meaningful canonical record to allow.
alter table public.seasons alter column rugby_code set not null;

-- Same-rugby-code seasons must be distinguishable by their own configured
-- starting year -- this is what actually prevents a future duplicate
-- "Rugby Union 27/28"-shaped row from being created outside the
-- application-level check createSeason() already performs (Section 33).
-- Safe to add now: verified zero duplicate (rugby_code, season_year_start)
-- pairs exist in this local database at migration time.
alter table public.seasons add constraint seasons_rugby_code_year_unique unique (rugby_code, season_year_start);

-- Date-ordering, enforced at the one real boundary (Section 12) rather
-- than trusted to the client form and the server action's shared
-- validateSeasonDates() alone: pre-season, when configured, must
-- genuinely precede main-season start.
alter table public.seasons add constraint seasons_preseason_before_main check (pre_season_starts_on is null or pre_season_starts_on < starts_on);
