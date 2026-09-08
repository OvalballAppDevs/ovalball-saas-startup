-- Season dates have one authoritative source: the canonical public.seasons
-- record managed in Site Admin -> Seasons.
--
-- The classification behind these assertions is in
-- docs/seasons/source-of-truth.md.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_n int; v_bad text; v_season uuid; v_new_pre date; v_old_pre date;
  v_resolved uuid;
begin

-- ============ 1. No competing operational calendar ============

if not exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'regulatory_season_of'
    and pg_get_function_arguments(p.oid) = 'p_date date'
) then
  raise notice 'PASS 1: the code-blind season calendar regulatory_season_of(date) no longer exists';
else
  raise notice 'FAIL 1: a code-blind season calendar is still defined';
end if;

select count(*) into v_n
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','internal') and p.prokind = 'f'
  and p.proname ~* 'season|rollover|handover|fixture'
  and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ 'date ''\d{4}-(09-01|08-31)''';
if v_n = 0 then
  raise notice 'PASS 2: no operational function hardcodes a season boundary date';
else
  raise notice 'FAIL 2: % operational function(s) hardcode a season boundary', v_n;
end if;

-- ============ 2. The resolvers read the canonical record ============

select string_agg(n.nspname||'.'||p.proname, ', ') into v_bad
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','internal') and p.prokind = 'f'
  and p.proname in ('resolve_season_for_date','regulatory_school_year_start')
  and pg_get_functiondef(p.oid) !~ 'public\.seasons';
if v_bad is null then
  raise notice 'PASS 3: both first-principles season resolvers read public.seasons';
else
  raise notice 'FAIL 3: % do not read the canonical table', v_bad;
end if;

-- ============ 3. Changing the canonical date moves every consumer ============
--
-- The point of the rule: one edit in Site Admin, and everything that derives
-- from it follows. Proved by moving a real canonical column and watching a
-- resolver's answer change, then moving it back.

select id, pre_season_starts_on into v_season, v_old_pre
from public.seasons where rugby_code = 'union' and not is_regression_fixture
order by starts_on desc limit 1;

-- A date inside the season is resolved to that season either way.
v_resolved := internal.resolve_season_for_date('union', (select starts_on + 30 from public.seasons where id = v_season));
if v_resolved = v_season then
  raise notice 'PASS 4: a date inside the season resolves to it';
else
  raise notice 'FAIL 4: an in-season date did not resolve to the season';
end if;

-- A date 20 days BEFORE the season starts is outside it...
-- Before the season's OWN boundary, which is pre_season_starts_on when set.
-- Using starts_on - 20 assumed no pre-season window existed.
v_resolved := internal.resolve_season_for_date('union',
  (select coalesce(pre_season_starts_on, starts_on) - 20 from public.seasons where id = v_season));
if v_resolved is distinct from v_season then
  raise notice 'PASS 5: a date before the season opens does not belong to it';
else
  raise notice 'FAIL 5: a pre-season date resolved into the season anyway';
end if;

-- ...until Site Admin opens pre-season earlier. One canonical edit.
update public.seasons set pre_season_starts_on = starts_on - 40 where id = v_season;
v_resolved := internal.resolve_season_for_date('union', (select starts_on - 30 from public.seasons where id = v_season));
if v_resolved = v_season then
  raise notice 'PASS 6: moving pre_season_starts_on in Site Admin immediately changed which season that date belongs to';
else
  raise notice 'FAIL 6: the resolver ignored the canonical change';
end if;

-- And a fixture filed after that change follows the same canonical answer.
declare
  v_dir uuid; v_club uuid; v_team uuid; v_fx uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SoT RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','sot-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'sot-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U12','boys','x','sot1') returning id into v_team;

  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values (v_team, (select starts_on - 30 from public.seasons where id = v_season), 'Home', 'Booked', 'X')
  returning id into v_fx;

  if (select season_id from public.fixtures where id = v_fx) = v_season then
    raise notice 'PASS 7: a fixture in the widened pre-season window was filed against that canonical season';
  else
    raise notice 'FAIL 7: the fixture did not follow the canonical season change';
  end if;
end;

update public.seasons set pre_season_starts_on = v_old_pre where id = v_season;

-- ============ 4. Labels are not authority ============

if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','internal') and p.prokind = 'f'
      and p.proname ~* 'rollover|handover|fixture'
      and regexp_replace(pg_get_functiondef(p.oid), '--[^\n]*', '', 'g') ~ 'seasons\.name|season_ref\s*=') = 0 then
  raise notice 'PASS 8: no operational function filters or branches on a season NAME or ref -- labels stay presentation';
else
  raise notice 'FAIL 8: an operational function keys off a season label';
end if;

-- ============ 5. A missing canonical date is not guessed ============

if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'process_due_season_transitions')
   ~ 'needs_attention' then
  raise notice 'PASS 9: a missing pre-season date sets the handover to needs_attention rather than defaulting';
else
  raise notice 'FAIL 9: the handover has no needs_attention path for a missing canonical date';
end if;

-- ============ 6. Regulatory derivation is preserved, and separate ============

if exists (
  select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'internal' and p.proname = 'regulatory_season_of'
    and pg_get_function_arguments(p.oid) like '%rugby_code%'
) then
  raise notice 'PASS 10: the governing-body document-season helper is intact -- regulation derives from regulation';
else
  raise notice 'FAIL 10: the regulatory document-season helper was removed';
end if;

if (select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'resolve_player_regulatory_age') ~ 'regulatory_school_year_start' then
  raise notice 'PASS 11: the age resolver takes its school year from the canonical season, not from a date guess';
else
  raise notice 'FAIL 11: the age resolver derives its school year independently';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
