-- The future-season identity projection has never worked.
--
-- public.get_team_identity_for_season has three branches: a recorded season
-- identity, a code-aware PROJECTION for a future season, and the team's
-- current identity. The middle branch ends with:
--
--   internal.compute_team_display_name(category, projected_age, gender,
--                                      squad_designation, team_number)
--
-- and internal.compute_team_display_name takes FOUR arguments, not five:
--
--   (p_category text, p_age_group text, p_gender text, p_squad_designation text)
--
-- So every call that reaches the projection branch raises
-- "function internal.compute_team_display_name(text, text, text, text, integer)
-- does not exist" and the whole query fails. Not a wrong label -- an error.
--
-- WHY NOTHING NOTICED
--
-- The branch is only reached for a team with NO recorded identity for a season
-- that is genuinely ahead of the current one. Every existing caller -- the
-- Calendar, the Agenda, the Match Centre, the Season Handover page -- asks
-- about seasons that either have a recorded identity or are not in the future,
-- so they land on branch 1 or branch 3 and never touch it. It surfaced only
-- when the handover's placement chooser started asking what each team WILL BE
-- next season, which is precisely the question this branch exists to answer.
--
-- This matters beyond the chooser: the product rule for future fixtures is
-- that a fixture booked for next season may already read U13 before the
-- handover has run, because it belongs to next season. That rule is
-- implemented here, and it has been raising an exception rather than
-- projecting.

create or replace function public.get_team_identity_for_season(p_team_id uuid, p_season_id uuid)
returns table (category text, age_group text, squad_designation text, gender text, display_name text, is_projected boolean)
language plpgsql stable
as $function$
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
  if not found then return; end if;

  -- A stored season identity always wins: it is the historical record of what
  -- this team actually was in that season, and must never be re-derived.
  return query
    select tsi.category, tsi.age_group, tsi.squad_designation, tsi.gender, tsi.display_name, false
    from public.team_season_identity tsi
    where tsi.team_id = p_team_id and tsi.season_id = p_season_id;
  if found then return; end if;

  select id into v_current_season_id
  from public.seasons
  where rugby_code = v_team.rugby_code and starts_on < current_date
  order by starts_on desc, is_regression_fixture asc, id asc limit 1;

  if v_current_season_id is null or v_current_season_id = p_season_id or v_team.category <> 'youth' or v_team.age_group is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  select starts_on into v_current_starts_on from public.seasons where id = v_current_season_id;
  select starts_on into v_target_starts_on from public.seasons where id = p_season_id;
  if v_current_starts_on is null or v_target_starts_on is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  v_seasons_ahead := (extract(year from age(v_target_starts_on, v_current_starts_on)))::integer;
  if v_seasons_ahead <= 0 then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  -- Code-aware projection. Passing v_team.rugby_code is the whole fix.
  select p.projected_age_group, p.is_deterministic into v_projected_age, v_is_deterministic
  from internal.project_team_identity(v_team.age_group, v_team.gender, v_team.rugby_code, v_seasons_ahead) p;

  if not coalesce(v_is_deterministic, false) or v_projected_age is null then
    return query select v_team.category, v_team.age_group, v_team.squad_designation, v_team.gender, v_team.display_name, false;
    return;
  end if;

  -- Four arguments. The fifth (team_number) was never part of this function's
  -- signature, and passing it made every projection raise instead of project.
  v_projected_display_name := internal.compute_team_display_name(
    v_team.category, v_projected_age, v_team.gender, v_team.squad_designation);

  return query select v_team.category, v_projected_age, v_team.squad_designation, v_team.gender, v_projected_display_name, true;
end;
$function$;

do $$
declare
  v_dir uuid; v_club uuid; v_to uuid; v_team uuid;
  v_label text; v_age text; v_proj boolean;
begin
  -- Prove the branch actually runs now, on a team with no recorded identity
  -- for a season that is genuinely ahead.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Projection Check','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','projcheck-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir,'projcheck-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('ProjCheck','2029-09-01','2030-06-30',true,'union',2029,'29/30',true,'2029-08-01') returning id into v_to;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U12','boys','x','projcheck-u12') returning id into v_team;

  select i.age_group, i.display_name, i.is_projected into v_age, v_label, v_proj
  from public.get_team_identity_for_season(v_team, v_to) i;

  if v_age is null then
    raise exception 'The projection branch still fails to return an identity.';
  end if;
  if not v_proj then
    raise exception 'A future season with no recorded identity was not projected (got %, projected=%).', v_age, v_proj;
  end if;

  delete from public.teams where id = v_team;
  delete from public.seasons where id = v_to;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = v_dir;
end $$;
