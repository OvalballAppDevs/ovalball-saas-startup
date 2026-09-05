-- ============================================================
-- Structured Season identity. Previously `seasons.name` was a free-typed
-- text field ("Union 2026/27", "Tournament Test Season") that a Site Admin
-- typed by hand and every other screen then treated as the season's
-- operational identity. Season identity must instead be structured product
-- configuration: rugby_code + a starting year, with pre-season/main-season
-- date ranges (both already existed). The display name is now DERIVED
-- from those fields, never independently typed.
-- ============================================================

alter table public.seasons
  add column season_year_start integer,
  add column is_regression_fixture boolean not null default false;

comment on column public.seasons.is_regression_fixture is
  'True only for seasons created purely as SQL regression-test scaffolding (contrived date ranges relative to current_date, not a real product season). Never set by any app UI -- flips the [TEST] marker in the generated name and lets a future admin view filter these out of the normal playground.';

-- Backfill every pre-existing row's starting year from its own starts_on
-- (deterministic: the calendar year a season's main window begins in),
-- then require it going forward.
update public.seasons set season_year_start = extract(year from starts_on)::int where season_year_start is null;

alter table public.seasons
  alter column season_year_start set not null,
  add constraint seasons_season_year_start_check check (season_year_start between 2000 and 2200);

alter table public.seasons
  add column season_year_end integer generated always as (season_year_start + 1) stored;

-- `name` stops being independently writable operational identity: it is
-- always recomputed from rugby_code + season_year_start (+ the
-- is_regression_fixture marker) by this trigger, on every insert and
-- update -- including direct SQL fixture inserts (every supabase/tests/*.sql
-- file that creates its own season row) which never supply
-- season_year_start explicitly. A plain `generated always as (...) stored`
-- column can't be used here because season_year_start itself must be
-- auto-derived from starts_on when the caller omits it, which a generated
-- expression cannot do.
create or replace function internal.compute_season_identity()
returns trigger
language plpgsql
as $$
declare
  v_base text;
begin
  if new.season_year_start is null then
    new.season_year_start := extract(year from new.starts_on)::int;
  end if;

  if new.rugby_code = 'union' then
    v_base := 'Rugby Union ' || lpad((new.season_year_start % 100)::text, 2, '0') || '/' || lpad(((new.season_year_start + 1) % 100)::text, 2, '0');
  elsif new.rugby_code = 'league' then
    v_base := 'Rugby League ' || new.season_year_start::text;
  else
    v_base := 'Season ' || lpad((new.season_year_start % 100)::text, 2, '0') || '/' || lpad(((new.season_year_start + 1) % 100)::text, 2, '0');
  end if;

  new.name := case when new.is_regression_fixture then '[TEST] ' || v_base else v_base end;
  return new;
end;
$$;

drop trigger if exists compute_season_identity on public.seasons;
create trigger compute_season_identity
  before insert or update on public.seasons
  for each row execute function internal.compute_season_identity();

-- `name` is now a derived display label, not a unique operational key --
-- two distinct seasons (e.g. a real "Rugby Union 26/27" and a
-- regression-only "[TEST] Rugby Union 26/27" sharing the same computed
-- window) legitimately produce the same or colliding labels. The row `id`
-- is, and always was, the actual identity every FK/RPC resolves against.
alter table public.seasons drop constraint if exists seasons_name_key;

-- Flag the specific regression-only "clutter" seasons the product owner
-- flagged as visibly cluttering the Site Admin Seasons screen (exact ids
-- these test files already insert against -- see
-- supabase/tests/tournaments.sql, controlled_missing_team.sql,
-- competition_management.sql). Flagging (not deleting/renaming in the test
-- files themselves) keeps every regression test's own id-based lookups
-- completely unchanged.
update public.seasons
  set is_regression_fixture = true
  where id in (
    '93000000-0000-0000-0000-000000000001', -- Tournament Test Season (supabase/tests/tournaments.sql)
    '99800000-0000-0000-0000-000000000401', -- Union Missing-Team Test Season (supabase/tests/controlled_missing_team.sql)
    '95100000-0000-0000-0000-00000000ff01'  -- Competition Mgmt Test Season (supabase/tests/competition_management.sql)
  );

-- Recompute every existing row's name under the new rule immediately (a
-- genuine UPDATE fires the BEFORE UPDATE trigger even when the touched
-- column's value doesn't change), so the Site Admin Seasons screen reflects
-- canonical, non-free-typed names right away rather than only on the next
-- unrelated write.
update public.seasons set updated_at = updated_at;
