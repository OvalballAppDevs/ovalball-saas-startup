-- RESUME SEASON HANDOVER Sections 7-10: Mini-Rugby next-season group
-- review wizard. A Mini-Rugby Group is scoped to one season_id and its
-- historical composition must never be mutated once real fixtures
-- exist against it (set_scheduling_group_members already enforces
-- that). Progressing a group into a new season therefore always means
-- creating a NEW scheduling_groups row with a NEW id, referencing the
-- new season_id -- the historical group is left completely untouched,
-- exactly like graduate_team() archives rather than mutates a Senior
-- Colts cohort.
--
-- Both helper functions gain an optional p_season_id: omitted (the
-- existing 2-arg call every current caller uses), they check the LIVE
-- team row exactly as before. Passed, they check the PROJECTED
-- identity for that season via the canonical get_team_identity_for_
-- season() resolver instead -- because a next-season group is reviewed
-- and created BEFORE the mechanical rollover has actually run, when
-- teams.age_group still reflects the CURRENT season. Without this, a
-- team that is U8 today and would become an invalid U9 next season
-- could be waved through as if it were still eligible.
create or replace function internal.validate_mini_rugby_team_set(p_club_id uuid, p_team_ids uuid[], p_season_id uuid default null)
returns void
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_bad_club_count integer;
  v_bad_age_count integer;
  v_inactive_count integer;
  v_distinct_age_count integer;
begin
  if array_length(p_team_ids, 1) is null or array_length(p_team_ids, 1) < 1 then
    raise exception 'Select at least one team.';
  end if;

  select count(*) into v_bad_club_count from public.teams where id = any(p_team_ids) and club_id <> p_club_id;
  if v_bad_club_count > 0 then
    raise exception 'Every team in a Mini-Rugby Group must belong to this club.';
  end if;

  if (select count(*) from public.teams where id = any(p_team_ids)) <> array_length(p_team_ids, 1) then
    raise exception 'One or more selected teams could not be found.';
  end if;

  select count(*) into v_inactive_count from public.teams where id = any(p_team_ids) and not active;
  if v_inactive_count > 0 then
    raise exception 'An inactive or folded team cannot be added to a Mini-Rugby Group.';
  end if;

  if p_season_id is null then
    select count(*) into v_bad_age_count from public.teams where id = any(p_team_ids) and age_group not in ('U6', 'U7', 'U8');
    if v_bad_age_count > 0 then
      raise exception 'Mini-Rugby Groups only support U6, U7, and U8 -- never U9 or above.';
    end if;

    select count(distinct age_group) into v_distinct_age_count from public.teams where id = any(p_team_ids);
    if v_distinct_age_count < 2 then
      raise exception 'A Mini-Rugby Group must combine at least two different ages within U6-U8 (e.g. U7/U8).';
    end if;
  else
    select count(*) into v_bad_age_count
    from unnest(p_team_ids) t(team_id)
    join lateral public.get_team_identity_for_season(t.team_id, p_season_id) i on true
    where i.age_group not in ('U6', 'U7', 'U8');
    if v_bad_age_count > 0 then
      raise exception 'One or more of these teams would no longer be a valid Mini-Rugby age (U6-U8) in that season -- an invalid successor such as U8/U9 cannot be created. Remove the team that ages out, or leave it out of the next-season group.';
    end if;

    select count(distinct i.age_group) into v_distinct_age_count
    from unnest(p_team_ids) t(team_id)
    join lateral public.get_team_identity_for_season(t.team_id, p_season_id) i on true;
    if v_distinct_age_count < 2 then
      raise exception 'A Mini-Rugby Group must combine at least two different ages within U6-U8 (e.g. U7/U8) in the season it is created for.';
    end if;
  end if;
end;
$$;

create or replace function internal.mini_rugby_display_tag(p_team_ids uuid[], p_season_id uuid default null)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select case
    when p_season_id is null then (
      select string_agg(age_group, '/' order by
        case age_group when 'U6' then 1 when 'U7' then 2 when 'U8' then 3 end
      )
      from (select distinct age_group from public.teams where id = any(p_team_ids)) t
    )
    else (
      select string_agg(age_group, '/' order by
        case age_group when 'U6' then 1 when 'U7' then 2 when 'U8' then 3 end
      )
      from (
        select distinct i.age_group
        from unnest(p_team_ids) t(team_id)
        join lateral public.get_team_identity_for_season(t.team_id, p_season_id) i on true
      ) t
    )
  end;
$$;

-- Creates the NEW season's group. The historical group named by
-- p_source_group_id is read-only input here (to inherit its alias and
-- confirm the target season is genuinely later) and is never updated.
-- p_team_ids is caller-supplied rather than copied automatically from
-- the source group, because Section 9 explicitly allows "EDIT
-- COMPOSITION THEN CREATE" as a distinct wizard path from "CREATE
-- NEXT-SEASON GROUP (same composition)" -- both go through this same
-- function, the only difference being what the caller passes.
create or replace function public.create_next_season_scheduling_group(p_source_group_id uuid, p_to_season_id uuid, p_team_ids uuid[], p_alias text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_club_id uuid;
  v_source_season_id uuid;
  v_source_alias text;
  v_source_rugby_code text;
  v_to_rugby_code text;
  v_source_starts_on date;
  v_to_starts_on date;
  v_tag text;
  v_new_id uuid;
begin
  select club_id, season_id, alias into v_club_id, v_source_season_id, v_source_alias
  from public.scheduling_groups where id = p_source_group_id;
  if v_club_id is null then
    raise exception 'Mini-Rugby Group not found.';
  end if;
  if not internal.has_capability('manage_mini_rugby_groups', 'club', v_club_id) then
    raise exception 'Not authorized to manage this club''s Mini-Rugby Groups.' using errcode = '42501';
  end if;

  select rugby_code, starts_on into v_source_rugby_code, v_source_starts_on from public.seasons where id = v_source_season_id;
  select rugby_code, starts_on into v_to_rugby_code, v_to_starts_on from public.seasons where id = p_to_season_id;
  if v_to_rugby_code is null then
    raise exception 'Target season not found.';
  end if;
  if v_to_rugby_code <> v_source_rugby_code then
    raise exception 'A next-season Mini-Rugby Group must stay on the same rugby code as the historical group.';
  end if;
  if v_to_starts_on <= v_source_starts_on then
    raise exception 'The target season must be a later season than the historical group''s own season.';
  end if;

  if exists (
    select 1 from public.scheduling_group_members m
    join public.scheduling_groups g on g.id = m.group_id
    where g.club_id = v_club_id and g.season_id = p_to_season_id and m.team_id = any(p_team_ids)
  ) then
    raise exception 'One or more of these teams already belong to another Mini-Rugby Group for the target season.';
  end if;

  perform internal.validate_mini_rugby_team_set(v_club_id, p_team_ids, p_to_season_id);
  v_tag := internal.mini_rugby_display_tag(p_team_ids, p_to_season_id);

  insert into public.scheduling_groups (club_id, display_tag, season_id, alias, created_by)
  values (v_club_id, v_tag, p_to_season_id, nullif(trim(coalesce(p_alias, v_source_alias, '')), ''), auth.uid())
  returning id into v_new_id;

  insert into public.scheduling_group_members (group_id, team_id)
  select v_new_id, unnest(p_team_ids);

  return v_new_id;
end;
$$;
