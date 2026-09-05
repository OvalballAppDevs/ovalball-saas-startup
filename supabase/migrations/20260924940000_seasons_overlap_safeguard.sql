-- CRITICAL finding from this audit's own reconciliation: giving the
-- malformed test season (95100000-...-ff01) a real rugby_code in
-- 20260924930000, without ALSO addressing its date range, created a
-- genuine, LIVE ambiguity -- its window (2027-03-22 to 2028-01-16)
-- overlaps the real Rugby Union 26/27 (2026-09-01 to 2027-05-31) and
-- 27/28 (2027-09-01 to 2028-05-31) seasons. Proven live:
-- internal.resolve_season_for_date('union', '2027-04-15') was returning
-- this regression-fixture row instead of the real Rugby Union 26/27 --
-- exactly the kind of silent misresolution the Automatic Season
-- Transition engine (and any future consumer of resolve_season_for_date)
-- must never be exposed to for a real club.
--
-- Fixed at the root: this row's dates move to a window centuries away
-- from any real season this product will configure for a long time,
-- eliminating the overlap outright, rather than only filtering it out at
-- specific call sites.
update public.seasons
set starts_on = '2150-01-01', ends_on = '2150-12-31', pre_season_starts_on = null, season_year_start = 2150
where id = '95100000-0000-0000-0000-00000000ff01';

-- Structural safeguard, so this class of bug cannot recur even for a
-- future, entirely different season row: two seasons of the SAME
-- rugby_code must never claim overlapping operational date ranges.
-- Deliberately scoped to real (is_regression_fixture = false) seasons
-- only -- several existing SQL regression tests (e.g.
-- supabase/tests/season_transitions.sql) intentionally create
-- is_regression_fixture seasons that overlap real ones on purpose, as
-- isolated synthetic date windows for exercising engine logic without
-- touching real club data. That isolation pattern is legitimate and
-- must keep working; only REAL canonical seasons need to be mutually
-- exclusive from each other.
create or replace function internal.reject_overlapping_real_seasons()
returns trigger
language plpgsql
as $$
declare
  v_conflict record;
begin
  if new.is_regression_fixture then
    return new;
  end if;
  select id, name into v_conflict
  from public.seasons s
  where s.id <> new.id
    and s.rugby_code = new.rugby_code
    and s.is_regression_fixture = false
    and s.starts_on <= new.ends_on
    and s.ends_on >= new.starts_on
  limit 1;
  if found then
    raise exception 'This season''s dates (% to %) overlap the existing % rugby_code season "%" (%). Two real seasons of the same rugby_code may not claim overlapping operational date ranges.',
      new.starts_on, new.ends_on, new.rugby_code, v_conflict.name, v_conflict.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists reject_overlapping_real_seasons on public.seasons;
create trigger reject_overlapping_real_seasons
  before insert or update of starts_on, ends_on, rugby_code, is_regression_fixture on public.seasons
  for each row execute function internal.reject_overlapping_real_seasons();
