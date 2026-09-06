-- Phase B -- invite-only onboarding: a guardian cannot self-attach to an
-- arbitrary club.
--
-- Replaces add_child_for_guardian with the same behaviour plus an authority
-- check. Everything else about the function -- duplicate detection, age
-- grade resolution, pending team placement, club review routing -- is
-- unchanged and reproduced verbatim from the live definition.
--
-- Forward-only. No data is altered; existing guardians keep working because
-- route 2 of the guard matches any guardian who already has a player at the
-- club.

CREATE OR REPLACE FUNCTION public.add_child_for_guardian(p_first_name text, p_surname text, p_date_of_birth date, p_club_id uuid, p_rugby_code text)
 RETURNS TABLE(result text, player_id uuid, age_grade text, school_year integer, team_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_first text := trim(coalesce(p_first_name, ''));
  v_surname text := trim(coalesce(p_surname, ''));
  v_season_id uuid;
  v_grade record;
  v_existing_player_id uuid;
  v_match_player_id uuid;
  v_match_count integer;
  v_match_team_id uuid;
  v_new_player_id uuid;
  v_candidate_team_id uuid;
  v_candidate_team_count integer;
  v_result text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_first = '' or v_surname = '' then
    raise exception 'First name and surname are required.';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required.';
  end if;
  if not exists (select 1 from public.clubs where id = p_club_id and status = 'active') then
    raise exception 'Club not found.';
  end if;

  -- INVITE-ONLY GUARD (Phase B).
  --
  -- Previously this function guarded only on "is signed in" and "club
  -- exists", then created a players row, a guardians row and a pending
  -- player_team_memberships row at ANY active club. That let an unrelated
  -- signed-in person invent a child at a club they have nothing to do with
  -- and declare themselves its guardian. The pending status meant no team
  -- authority followed, but the identity records were still created.
  --
  -- A guardian must now already have an authorised relationship with THIS
  -- club, by one of three routes:
  --
  --   1. they accepted a guardian invitation from this club
  --      (the canonical way a new parent arrives);
  --   2. they already guardian a player at this club
  --      (an existing parent adding a second child -- this is why existing
  --      users are not disrupted);
  --   3. they hold an active club membership here
  --      (club staff who are also a parent).
  --
  -- Authority is derived server-side from stable IDs. Nothing here trusts a
  -- club id merely because the client sent one.
  if not (
    exists (
      select 1 from public.guardian_invitations gi
      where gi.club_id = p_club_id
        and gi.accepted_by = auth.uid()
        and gi.status = 'accepted'
    )
    or exists (
      select 1
      from public.guardians g
      join public.player_team_memberships ptm on ptm.player_id = g.player_id
      join public.teams t on t.id = ptm.team_id
      where g.guardian_user_id = auth.uid()
        and t.club_id = p_club_id
    )
    or exists (
      select 1 from public.club_memberships cm
      where cm.user_id = auth.uid()
        and cm.club_id = p_club_id
        and cm.status = 'active'
    )
  ) then
    raise exception 'You need an invitation from this club before you can add a child to it.'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_club_id::text || ':' || lower(v_first) || ':' || lower(v_surname) || ':' || p_date_of_birth::text, 0));

  v_season_id := internal.resolve_season_for_date(p_rugby_code, current_date);
  if v_season_id is null then
    raise exception 'No active season is currently configured for this rugby code -- please contact your club.';
  end if;

  select * into v_grade from internal.resolve_player_age_grade(p_rugby_code, v_season_id, p_date_of_birth);
  if v_grade.status = 'TOO_YOUNG' then
    raise exception 'This date of birth is below the youngest supported youth age grade (U6).';
  elsif v_grade.status = 'OUT_OF_YOUTH_RANGE' then
    raise exception 'This date of birth is outside the supported youth age-grade range (U6-U18). Please contact your club directly.';
  end if;

  select p.id into v_existing_player_id
  from public.players p
  join public.guardians g on g.player_id = p.id and g.guardian_user_id = auth.uid() and g.status = 'active'
  join public.player_team_memberships ptm on ptm.player_id = p.id and ptm.status in ('pending', 'active')
  join public.teams t on t.id = ptm.team_id and t.club_id = p_club_id
  where lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname) and p.date_of_birth is not distinct from p_date_of_birth
  limit 1;
  if v_existing_player_id is not null then
    return query select 'already_linked'::text, v_existing_player_id, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  if exists (
    select 1 from public.player_duplicate_reviews pdr
    where pdr.requesting_guardian_user_id = auth.uid()
      and pdr.status = 'pending'
      and lower(pdr.submitted_first_name) = lower(v_first) and lower(pdr.submitted_surname) = lower(v_surname)
      and pdr.submitted_date_of_birth is not distinct from p_date_of_birth
  ) then
    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  end if;

  select count(distinct ptm.player_id) into v_match_count
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  join public.teams t on t.id = ptm.team_id
  where t.club_id = p_club_id and ptm.status in ('pending', 'active')
    and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
    and p.date_of_birth is not distinct from p_date_of_birth;

  if v_match_count >= 1 then
    select distinct ptm.player_id into v_match_player_id
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id
    join public.teams t on t.id = ptm.team_id
    where t.club_id = p_club_id and ptm.status in ('pending', 'active')
      and lower(p.first_name) = lower(v_first) and lower(p.surname) = lower(v_surname)
      and p.date_of_birth is not distinct from p_date_of_birth
    limit 1;
  end if;

  if v_match_count = 1 then
    select ptm.team_id into v_match_team_id
    from public.player_team_memberships ptm
    where ptm.player_id = v_match_player_id and ptm.status in ('pending', 'active')
    order by (ptm.status = 'active') desc, ptm.joined_at desc
    limit 1;

    insert into public.player_duplicate_reviews (team_id, submitted_first_name, submitted_surname, submitted_date_of_birth, matched_player_id, submitted_by, requesting_guardian_user_id)
    values (v_match_team_id, v_first, v_surname, p_date_of_birth, v_match_player_id, auth.uid(), auth.uid());

    return query select 'under_review'::text, null::uuid, v_grade.canonical_age_group, v_grade.school_year, null::uuid;
    return;
  elsif v_match_count > 1 then
    raise exception 'We found more than one possible existing match for this player at this club. Please contact the club directly so they can confirm the correct player.';
  end if;

  insert into public.players (first_name, surname, date_of_birth, created_by)
  values (v_first, v_surname, p_date_of_birth, auth.uid())
  returning id into v_new_player_id;

  insert into public.guardians (guardian_user_id, player_id, relationship_type, created_by)
  values (auth.uid(), v_new_player_id, 'guardian', auth.uid());

  select count(*) into v_candidate_team_count
  from public.teams t
  where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

  if v_candidate_team_count = 1 then
    select t.id into v_candidate_team_id
    from public.teams t
    where t.club_id = p_club_id and t.active = true and t.category = v_grade.canonical_category and t.age_group = v_grade.canonical_age_group;

    insert into public.player_team_memberships (player_id, team_id, status, created_by)
    values (v_new_player_id, v_candidate_team_id, 'pending', auth.uid());
    v_result := 'created_pending_team';
  else
    v_candidate_team_id := null;
    v_result := 'created_needs_club_review';
  end if;

  return query select v_result, v_new_player_id, v_grade.canonical_age_group, v_grade.school_year, v_candidate_team_id;
end;
$function$;
