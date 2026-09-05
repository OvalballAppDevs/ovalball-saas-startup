-- FUTURE-SEASON FIXTURE OWNERSHIP, closing the gap disclosed in
-- 20260924810000_team_season_identity.sql: a future-season fixture
-- created before that season's rollover has been confirmed has no
-- team_season_identity snapshot yet, so get_team_identity_for_season()
-- was falling back to the team's CURRENT live identity instead of a
-- projected future one. This migration adds a deterministic
-- N-seasons-ahead projector and wires it into that same resolver as a
-- second fallback tier (snapshot -> projection -> current live row),
-- reusing internal.next_age_grade() -- the exact mapping table
-- generate_rollover_proposal() itself uses -- rather than a second,
-- independently-maintained progression rule.

-- internal.project_team_identity: walks the SAME age ladder and hits
-- the SAME two "requires manual choice" conditions generate_rollover_
-- proposal() already encodes (next_age_grade returns null at U16; a
-- Mixed team reaching U11 needs the dedicated Girls-team decision flow
-- via confirm_mixed_boundary_rollover, not a mechanical mapping) --
-- copied here as conditions, never as a second copy of the age table
-- itself. When either condition is hit at any step, the projection is
-- honestly reported as non-deterministic rather than guessed at.
create or replace function internal.project_team_identity(p_age_group text, p_gender text, p_seasons_ahead integer)
returns table(projected_age_group text, is_deterministic boolean)
language plpgsql
immutable
as $$
declare
  v_age text := p_age_group;
  i integer;
begin
  if p_seasons_ahead <= 0 then
    return query select p_age_group, true;
    return;
  end if;
  if p_age_group is null then
    return query select null::text, false;
    return;
  end if;
  for i in 1..p_seasons_ahead loop
    if coalesce(p_gender, '') = 'mixed' and v_age = 'U11' then
      return query select null::text, false;
      return;
    end if;
    v_age := internal.next_age_grade(v_age);
    if v_age is null then
      return query select null::text, false;
      return;
    end if;
  end loop;
  return query select v_age, true;
end;
$$;

comment on function internal.project_team_identity(text, text, integer) is
  'Deterministic age-grade projector reusing internal.next_age_grade() -- the single canonical progression table also used by generate_rollover_proposal(). Returns is_deterministic = false (never a guess) whenever the real rollover flow itself would require a manual choice at some step along the way (U16 with no automatic mapping, or a Mixed team reaching the U11 -> U12 structural boundary).';

-- get_team_identity_for_season: re-declared to add the projection
-- tier. Behaviour for every case this function already handled is
-- byte-for-byte unchanged (snapshot found; p_season_id is the team's
-- current or a past season with no snapshot -- both still resolve to
-- the live teams row, since nothing has diverged from it yet). The
-- only new behaviour is for a FUTURE season, still unconfirmed by
-- rollover, where a deterministic projection is now possible instead
-- of silently reusing the current age.
drop function if exists public.get_team_identity_for_season(uuid, uuid);

create function public.get_team_identity_for_season(p_team_id uuid, p_season_id uuid)
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

  v_current_season_id := internal.resolve_season_for_date(v_team.rugby_code, current_date);

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

  -- Reconstructs the label using this club's own live naming
  -- convention (confirmed against every current team row: "Girls " ||
  -- age for gender = girls, else just the age, with squad_designation
  -- appended when set) rather than string-editing the current
  -- display_name, which cannot be trusted to contain the current age
  -- as a literal substring.
  v_projected_display_name := case when v_team.gender = 'girls' then 'Girls ' || v_projected_age else v_projected_age end
    || case when v_team.squad_designation is not null then ' ' || v_team.squad_designation else '' end;

  return query select v_team.category, v_projected_age, v_team.squad_designation, v_team.gender, v_projected_display_name, true;
end;
$$;

comment on function public.get_team_identity_for_season(uuid, uuid) is
  'Canonical resolver for a team''s age-grade identity during a given season. Resolution order: (1) an immutable team_season_identity snapshot if one was ever written; (2) for a FUTURE season with no snapshot yet, a deterministic projection via internal.project_team_identity(), flagged is_projected = true; (3) otherwise the team''s current live row, flagged is_projected = false. Every display surface reading a team''s age for a specific season/fixture should call this instead of reading teams.age_group directly.';

grant execute on function internal.project_team_identity(text, text, integer) to authenticated;
grant execute on function public.get_team_identity_for_season(uuid, uuid) to authenticated;
