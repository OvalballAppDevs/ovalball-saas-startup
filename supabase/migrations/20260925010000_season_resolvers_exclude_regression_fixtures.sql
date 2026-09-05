-- Found live while re-running the full regression suite after
-- 20260925000000: season_transition_future_fixture.sql's PASS 1/2
-- regressed to FAIL (identity resolved to U15 instead of the expected
-- U14). Root cause: tournaments.sql leaves a genuinely PERSISTENT
-- (never rolled back, by this project's own dual-test-pattern
-- convention) regression-fixture season row in the real, global,
-- unscoped `seasons` table -- and its `starts_on` (current_date + 200,
-- frozen at whatever day tournaments.sql last ran) happened to land on
-- exactly the same date as this test's own synthetic target season,
-- because both were run on the same calendar day this session.
--
-- The real bug this exposes is broader than one test collision:
-- public.get_team_identity_for_season()'s season-count query counts
-- ALL seasons of a rugby_code strictly by date range, with no
-- is_regression_fixture filter at all -- so ANY persistent test season
-- (from any test file, past or future) sharing a date range with a
-- real projection window silently adds a phantom extra step to a real
-- team's projected age-grade identity. Fixed by excluding
-- regression-fixture rows from the season-count, UNLESS the row being
-- counted is the literal season the caller explicitly asked about
-- (`id = p_season_id`) -- preserving every existing isolated test in
-- this suite that deliberately projects a team into ITS OWN synthetic
-- future season by explicit id, while no longer letting an unrelated
-- test file's leftover season silently inflate the count.
--
-- internal.resolve_season_for_date() -- the CALENDAR-DISPLAY resolver
-- a real user's Calendar/Fixture pages use to answer "what season is
-- today" -- never takes an explicit season id at all, so there is no
-- equivalent carve-out to make: it must always ignore regression
-- fixtures unconditionally, exactly like the Directive A app-layer
-- fix already does for the TypeScript queries that read this same
-- table directly (resolveCalendarSeasonContext, the rollover page,
-- fixture/training date validation, etc.) -- this closes the same gap
-- at the SQL layer these functions actually run in.
create or replace function internal.resolve_season_for_date(p_rugby_code text, p_date date)
returns uuid
language sql
stable
as $$
  select id from public.seasons
  where rugby_code = p_rugby_code
    and is_regression_fixture = false
    and p_date >= coalesce(pre_season_starts_on, starts_on)
    and p_date <= ends_on
  order by starts_on desc
  limit 1;
$$;

create or replace function public.get_team_identity_for_season(p_team_id uuid, p_season_id uuid)
returns table(category text, age_group text, squad_designation text, gender text, display_name text, is_projected boolean)
language plpgsql
stable
as $$
declare
  v_team public.teams;
  v_current_season_id uuid;
  v_current_starts_on date;
  v_target_starts_on date;
  v_seasons_ahead integer;
  v_projected_age text;
  v_is_deterministic boolean;
  v_projected_display_name text;
begin
  select * into v_team from public.teams where id = p_team_id;
  if not found then
    return;
  end if;

  return query
    select tsi.category, tsi.age_group, tsi.squad_designation, tsi.gender, tsi.display_name, false
    from public.team_season_identity tsi
    where tsi.team_id = p_team_id and tsi.season_id = p_season_id;
  if found then
    return;
  end if;

  select id into v_current_season_id
  from public.seasons
  where rugby_code = v_team.rugby_code and starts_on < current_date
  order by starts_on desc limit 1;

  if v_current_season_id is null or v_current_season_id = p_season_id or v_team.category <> 'youth' or v_team.age_group is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select starts_on into v_current_starts_on from public.seasons where id = v_current_season_id;
  select starts_on into v_target_starts_on from public.seasons where id = p_season_id;

  if v_target_starts_on is null or v_current_starts_on is null or v_target_starts_on <= v_current_starts_on then
    -- Not a future season (an unresolvable id, or a PAST season with no
    -- surviving snapshot) -- current live identity is the correct or
    -- only available answer either way.
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select count(*) into v_seasons_ahead
  from public.seasons
  where rugby_code = v_team.rugby_code
    and starts_on > v_current_starts_on and starts_on <= v_target_starts_on
    and (is_regression_fixture = false or id = p_season_id);

  select p.projected_age_group, p.is_deterministic
  into v_projected_age, v_is_deterministic
  from internal.project_team_identity(v_team.age_group, v_team.gender, v_seasons_ahead) p;

  if not v_is_deterministic or v_projected_age is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  v_projected_display_name := case when v_team.gender = 'girls' then 'Girls ' || v_projected_age else v_projected_age end
    || case when v_team.squad_designation is not null then ' ' || v_team.squad_designation else '' end;

  return query select v_team.category, v_projected_age, v_team.squad_designation, v_team.gender, v_projected_display_name, true;
end;
$$;
