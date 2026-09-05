-- Bug found live-testing the future-fixture identity acceptance test:
-- get_team_identity_for_season used internal.resolve_season_for_date()
-- (the pre-season-aware CALENDAR resolver -- correctly used everywhere
-- a human should see "today's season" for display purposes) to decide
-- its OWN "how many age-grade steps ahead is the target season"
-- anchor. But resolve_season_for_date treats a season as current the
-- moment its PRE-SEASON starts -- so the instant a future season's
-- pre_season_starts_on is reached, this function would already treat
-- THAT season as "current" (zero steps ahead), silently returning the
-- team's live (not-yet-progressed) row instead of projecting forward --
-- exactly backwards from Section 5's requirement that a fixture in the
-- next season must show the progressed identity even BEFORE the
-- automatic engine has actually run.
--
-- Fixed the same way as internal.process_due_season_transitions()'s own
-- anchor (20260924970000/20260924980000): "current" for this specific
-- purpose means the most recent season whose MAIN season has already
-- started, never the pre-season-aware calendar resolver -- these are
-- two genuinely different questions (what a human sees as today's
-- season for the Calendar, vs. what age this team's own progression
-- state is anchored to) that must not share one resolver.
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
    and starts_on > v_current_starts_on and starts_on <= v_target_starts_on;

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
